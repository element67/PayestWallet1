/**
 * Crypto withdrawals from the platform wallet to an external address (simulated send). Naira leaves through the
 * Naira wallet's transfer flow instead. Legacy Naira withdrawal rows are still settled by handleWithdrawalEvent. Deterministic checks only: status, tier, per-day limit, balance, idempotency.
 */
import { z } from 'zod'
import { dailyVolumeKobo, getAsset } from './assets'
import { HttpError } from './auth'
import { alert, all, audit, get, notify, now, run, setting, uid, tx } from './db'
import { body, route } from './http'
import { post } from './ledger'
import { assertOperational, verifyPin } from './naira/wallet'
import { fromUnits, toUnits } from './money'
import type { PaymentEvent } from './providers'
import { randomHex } from './security'
import { validDestination } from './vault'

const MIN_NGN_KOBO = 100_000n // NGN 1,000

interface WithdrawalRow {
  id: string; user_id: string; kind: 'ngn' | 'crypto'; asset: string; amount: string; value_kobo: string; dest: string | null
  bank_account_id: string | null; status: string; reference: string | null; tx_hash: string | null; created_at: number; updated_at: number
}

async function view(w: WithdrawalRow) {
  const decimals = w.kind === 'ngn' ? 2 : ((await getAsset(w.asset))?.decimals ?? 6)
  return {
    id: w.id, kind: w.kind, asset: w.asset, amount: fromUnits(BigInt(w.amount), decimals), valueNgn: fromUnits(BigInt(w.value_kobo), 2),
    dest: w.dest, status: w.status, txHash: w.tx_hash, reference: w.reference, simulated: true, createdAt: w.created_at, updatedAt: w.updated_at,
  }
}

const dailyWithdrawnKobo = async (userId: string) =>
  (await all<{ value_kobo: string }>("SELECT value_kobo FROM withdrawals WHERE user_id=? AND created_at>? AND status<>'failed'", userId, now() - 86_400_000))
    .reduce((s, r) => s + BigInt(r.value_kobo), 0n)

route('GET', '/api/withdrawals', 'user', async (c) => ({
  withdrawals: (await all<WithdrawalRow>('SELECT * FROM withdrawals WHERE user_id=? ORDER BY created_at DESC LIMIT 50', c.user.id)).map(view),
  dailyLimitNgn: fromUnits(BigInt(await setting('daily_withdraw_limit_kobo')), 2),
  usedTodayNgn: fromUnits(await dailyWithdrawnKobo(c.user.id), 2),
}))

route('POST', '/api/withdrawals', 'user', async (c) => {
  const b = body(c, z.object({
    idempotencyKey: z.string().min(8).max(80), asset: z.string().max(10), amount: z.string().regex(/^\d+(\.\d+)?$/).max(30),
    bankAccountId: z.string().max(40).optional(), destAddress: z.string().max(100).optional(), pin: z.string().regex(/^\d{4}$/),
  }))
  const dupe = await get<WithdrawalRow>('SELECT * FROM withdrawals WHERE user_id=? AND idem_key=?', c.user.id, b.idempotencyKey)
  if (dupe) return { withdrawal: await view(dupe) }
  if (await setting('platform_paused') === 'true') throw new HttpError(503, 'Withdrawals are temporarily paused')

  // Naira never leaves through this route: crypto withdrawals only (Naira goes through Transfer > To bank, with its PIN).
  if (b.asset === 'NGN') throw new HttpError(400, 'Naira leaves your wallet through Transfer > To bank, which needs your PIN.')
  await assertOperational(c.user.id)
  await verifyPin(c.user.id, b.pin)
  const asset = await getAsset(b.asset)
  if (!asset) throw new HttpError(400, 'Unknown asset')
  const units = toUnits(b.amount, asset.decimals)
  if (units <= 0n) throw new HttpError(400, 'Enter an amount above zero')
  const valueKobo = (units * BigInt(asset.sell_rate_kobo)) / 10n ** BigInt(asset.decimals)
  if (valueKobo < MIN_NGN_KOBO) throw new HttpError(400, 'Minimum withdrawal is NGN 1,000 equivalent')

  if (c.user.kyc_tier < 2) throw new HttpError(403, 'Crypto withdrawals need verification tier 2')
  if (!b.destAddress || !await validDestination(b.asset, b.destAddress)) throw new HttpError(400, `That is not a valid ${b.asset} address`)
  const dest = b.destAddress
  const id = uid('wd')
  const txHash = `sim:0x${randomHex(32)}`
  await tx(async () => {
    // Limits are checked under the write lock, in the same transaction as the debit, so parallel requests cannot both fit under them.
    const limit = BigInt(await setting('daily_withdraw_limit_kobo'))
    if (await dailyWithdrawnKobo(c.user.id) + valueKobo > limit) {
      throw new HttpError(403, `Daily withdrawal limit is NGN ${fromUnits(limit, 2)}`)
    }
    // Withdrawals also count toward the shared KYC tier volume (orders + swaps + withdrawals).
    const tierCap = BigInt(await setting(c.user.kyc_tier >= 2 ? 'daily_limit_tier2_kobo' : 'daily_limit_tier1_kobo'))
    if (await dailyVolumeKobo(c.user.id) + valueKobo > tierCap) {
      throw new HttpError(403, `Daily limit reached for KYC tier ${c.user.kyc_tier} (NGN ${fromUnits(tierCap, 2)})`)
    }
    await post({ owner: c.user.id, asset: b.asset, delta: -units, reason: 'withdrawal', idem: `wd:${id}:debit` })
    await run(
      `INSERT INTO withdrawals(id,user_id,kind,asset,amount,value_kobo,dest,bank_account_id,status,idem_key,reference,tx_hash,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, c.user.id, 'crypto', b.asset, units.toString(), valueKobo.toString(), dest, null,
      'completed', b.idempotencyKey, null, txHash, now(), now(),
    )
    await run(
      `INSERT INTO chain_txs(id,chain,tx_hash,log_index,asset,from_addr,to_addr,amount,confirmations,status,verdict,simulated,first_seen_at,updated_at,settled_at)
       VALUES (?,?,?,0,?,?,?,?,1,'finalized','genuine',1,?,?,?)`,
      uid('ctx'), 'sandbox', txHash, b.asset, 'vault', dest, units.toString(), now(), now(), now(),
    )
  })
  await audit(c.user.id, 'withdrawal.create', id, undefined, { asset: b.asset, valueKobo: valueKobo.toString() })
  await notify(c.user.id, 'payout', 'Withdrawal started', `${b.amount} ${b.asset} sent (simulated).`)
  return { withdrawal: await view(await get<WithdrawalRow>('SELECT * FROM withdrawals WHERE id=?', id) as WithdrawalRow) }
}, [10, 60_000])

/** Called by the payment webhook handler for references starting with SBX-WD-. */
export async function handleWithdrawalEvent(ev: PaymentEvent): Promise<string> {
  const w = await get<WithdrawalRow>('SELECT * FROM withdrawals WHERE reference=?', ev.reference)
  if (!w || w.status !== 'processing') return 'duplicate'
  const pay = await get<{ id: string }>('SELECT id FROM payments WHERE reference=?', ev.reference)
  if (ev.type === 'payout.succeeded') {
    await run("UPDATE withdrawals SET status='completed', updated_at=? WHERE id=?", now(), w.id)
    if (pay) await run("UPDATE payments SET status='succeeded', updated_at=? WHERE id=?", now(), pay.id)
    await notify(w.user_id, 'payout', 'Withdrawal complete', `NGN ${fromUnits(BigInt(w.amount), 2)} arrived (sandbox).`)
  } else {
    await post({ owner: w.user_id, asset: 'NGN', delta: BigInt(w.amount), reason: 'failed withdrawal refunded', idem: `wd:${w.id}:refund` })
    await run("UPDATE withdrawals SET status='failed', updated_at=? WHERE id=?", now(), w.id)
    if (pay) await run("UPDATE payments SET status='failed', updated_at=? WHERE id=?", now(), pay.id)
    await alert('warning', 'withdrawal_failed', 'Bank withdrawal failed', `Withdrawal ${w.id} was refunded to the wallet.`, w.user_id)
    await notify(w.user_id, 'security', 'Withdrawal failed', 'The bank payout failed and your Naira was returned to your wallet.')
  }
  return 'ok'
}
