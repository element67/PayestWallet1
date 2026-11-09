/**
 * Withdrawals from the platform wallet: Naira to a saved bank account (sandbox provider) or crypto to an
 * external address (simulated send). Deterministic checks only: status, tier, per-day limit, balance, idempotency.
 */
import { z } from 'zod'
import { getAsset } from './assets'
import { HttpError } from './auth'
import { alert, all, audit, db, get, notify, now, run, setting, uid } from './db'
import { body, route } from './http'
import { post } from './ledger'
import { assertOperational, verifyPin } from './naira/wallet'
import { fromUnits, toUnits } from './money'
import { provider, type PaymentEvent } from './providers'
import { randomHex } from './security'
import { validDestination } from './vault'

const MIN_NGN_KOBO = 100_000n // NGN 1,000

interface WithdrawalRow {
  id: string; user_id: string; kind: 'ngn' | 'crypto'; asset: string; amount: string; value_kobo: string; dest: string | null
  bank_account_id: string | null; status: string; reference: string | null; tx_hash: string | null; created_at: number; updated_at: number
}

function view(w: WithdrawalRow) {
  const decimals = w.kind === 'ngn' ? 2 : (getAsset(w.asset)?.decimals ?? 6)
  return {
    id: w.id, kind: w.kind, asset: w.asset, amount: fromUnits(BigInt(w.amount), decimals), valueNgn: fromUnits(BigInt(w.value_kobo), 2),
    dest: w.dest, status: w.status, txHash: w.tx_hash, reference: w.reference, simulated: true, createdAt: w.created_at, updatedAt: w.updated_at,
  }
}

const dailyWithdrawnKobo = (userId: string) =>
  all<{ value_kobo: string }>("SELECT value_kobo FROM withdrawals WHERE user_id=? AND created_at>? AND status<>'failed'", userId, now() - 86_400_000)
    .reduce((s, r) => s + BigInt(r.value_kobo), 0n)

route('GET', '/api/withdrawals', 'user', (c) => ({
  withdrawals: all<WithdrawalRow>('SELECT * FROM withdrawals WHERE user_id=? ORDER BY created_at DESC LIMIT 50', c.user.id).map(view),
  dailyLimitNgn: fromUnits(BigInt(setting('daily_withdraw_limit_kobo')), 2),
  usedTodayNgn: fromUnits(dailyWithdrawnKobo(c.user.id), 2),
}))

route('POST', '/api/withdrawals', 'user', (c) => {
  const b = body(c, z.object({
    idempotencyKey: z.string().min(8).max(80), asset: z.string().max(10), amount: z.string().regex(/^\d+(\.\d+)?$/).max(30),
    bankAccountId: z.string().max(40).optional(), destAddress: z.string().max(100).optional(), pin: z.string().regex(/^\d{4}$/),
  }))
  const dupe = get<WithdrawalRow>('SELECT * FROM withdrawals WHERE user_id=? AND idem_key=?', c.user.id, b.idempotencyKey)
  if (dupe) return { withdrawal: view(dupe) }
  if (setting('platform_paused') === 'true') throw new HttpError(503, 'Withdrawals are temporarily paused')

  if (b.asset === 'NGN') throw new HttpError(400, 'Naira leaves your wallet through Transfer > To bank, which needs your PIN.')
  assertOperational(c.user.id)
  verifyPin(c.user.id, b.pin)
  const isNgn = false
  const asset = isNgn ? null : getAsset(b.asset)
  if (!isNgn && !asset) throw new HttpError(400, 'Unknown asset')
  const units = toUnits(b.amount, isNgn ? 2 : (asset?.decimals ?? 6))
  if (units <= 0n) throw new HttpError(400, 'Enter an amount above zero')
  const valueKobo = isNgn ? units : (units * BigInt(asset?.sell_rate_kobo ?? '0')) / 10n ** BigInt(asset?.decimals ?? 0)
  if (valueKobo < MIN_NGN_KOBO) throw new HttpError(400, 'Minimum withdrawal is NGN 1,000 equivalent')

  let dest: string | null = null
  if (isNgn) {
    if (!b.bankAccountId || !get('SELECT 1 FROM bank_accounts WHERE id=? AND user_id=?', b.bankAccountId, c.user.id)) {
      throw new HttpError(400, 'Choose one of your saved bank accounts')
    }
  } else {
    if (c.user.kyc_tier < 2) throw new HttpError(403, 'Crypto withdrawals need verification tier 2')
    if (!b.destAddress || !validDestination(b.asset, b.destAddress)) throw new HttpError(400, `That is not a valid ${b.asset} address`)
    dest = b.destAddress
  }
  const limit = BigInt(setting('daily_withdraw_limit_kobo'))
  if (dailyWithdrawnKobo(c.user.id) + valueKobo > limit) {
    throw new HttpError(403, `Daily withdrawal limit is NGN ${fromUnits(limit, 2)}`)
  }

  const id = uid('wd')
  const reference = isNgn ? `SBX-WD-${id}` : null
  const txHash = isNgn ? null : `sim:0x${randomHex(32)}`
  db.transaction(() => {
    post({ owner: c.user.id, asset: b.asset, delta: -units, reason: 'withdrawal', idem: `wd:${id}:debit` })
    run(
      `INSERT INTO withdrawals(id,user_id,kind,asset,amount,value_kobo,dest,bank_account_id,status,idem_key,reference,tx_hash,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, c.user.id, isNgn ? 'ngn' : 'crypto', b.asset, units.toString(), valueKobo.toString(), dest, b.bankAccountId ?? null,
      isNgn ? 'processing' : 'completed', b.idempotencyKey, reference, txHash, now(), now(),
    )
    if (isNgn && reference) provider.sendPayout(id, units, reference)
    if (!isNgn && txHash) {
      run(
        `INSERT INTO chain_txs(id,chain,tx_hash,log_index,asset,from_addr,to_addr,amount,confirmations,status,verdict,simulated,first_seen_at,updated_at,settled_at)
         VALUES (?,?,?,0,?,?,?,?,1,'finalized','genuine',1,?,?,?)`,
        uid('ctx'), 'sandbox', txHash, b.asset, 'vault', dest, units.toString(), now(), now(), now(),
      )
    }
  })()
  audit(c.user.id, 'withdrawal.create', id, undefined, { asset: b.asset, valueKobo: valueKobo.toString() })
  notify(c.user.id, 'payout', 'Withdrawal started', isNgn ? `NGN ${fromUnits(units, 2)} is on its way to your bank (sandbox).` : `${b.amount} ${b.asset} sent (simulated).`)
  return { withdrawal: view(get<WithdrawalRow>('SELECT * FROM withdrawals WHERE id=?', id) as WithdrawalRow) }
}, [10, 60_000])

/** Called by the payment webhook handler for references starting with SBX-WD-. */
export function handleWithdrawalEvent(ev: PaymentEvent): string {
  const w = get<WithdrawalRow>('SELECT * FROM withdrawals WHERE reference=?', ev.reference)
  if (!w || w.status !== 'processing') return 'duplicate'
  const pay = get<{ id: string }>('SELECT id FROM payments WHERE reference=?', ev.reference)
  if (ev.type === 'payout.succeeded') {
    run("UPDATE withdrawals SET status='completed', updated_at=? WHERE id=?", now(), w.id)
    if (pay) run("UPDATE payments SET status='succeeded', updated_at=? WHERE id=?", now(), pay.id)
    notify(w.user_id, 'payout', 'Withdrawal complete', `NGN ${fromUnits(BigInt(w.amount), 2)} arrived (sandbox).`)
  } else {
    post({ owner: w.user_id, asset: 'NGN', delta: BigInt(w.amount), reason: 'failed withdrawal refunded', idem: `wd:${w.id}:refund` })
    run("UPDATE withdrawals SET status='failed', updated_at=? WHERE id=?", now(), w.id)
    if (pay) run("UPDATE payments SET status='failed', updated_at=? WHERE id=?", now(), pay.id)
    alert('warning', 'withdrawal_failed', 'Bank withdrawal failed', `Withdrawal ${w.id} was refunded to the wallet.`, w.user_id)
    notify(w.user_id, 'security', 'Withdrawal failed', 'The bank payout failed and your Naira was returned to your wallet.')
  }
  return 'ok'
}
