/**
 * Deterministic order engine. This is the ONLY code that moves money. The AI agent can request
 * actions, but every action re-checks policy here (limits, liquidity, state, idempotency).
 */
import { HttpError, type User } from './auth'
import { dailyVolumeKobo, getAsset, instantLimitKobo } from './assets'
import { alert, audit, db, get, now, notify, orderEvent, run, setting, settingNum, uid, all } from './db'
import { InsufficientFunds, SYS, balanceOf, move } from './ledger'
import { fromUnits } from './money'
import { provider, type PaymentEvent } from './providers'
import { enqueue } from './queue'
import { decrypt } from './security'
import { releaseCrypto, validDestination, vaultAddressArc } from './vault'
import { isAddress } from 'viem'
import { handleWithdrawalEvent } from './withdrawals'
import { createP2pRecord, markP2pReversed, recordP2pCredit, syncP2pOrder } from './naira/p2p'

export interface OrderRow {
  id: string
  user_id: string
  quote_id: string
  idem_key: string
  side: 'sell' | 'buy'
  asset: string
  crypto_amount: string
  gross_kobo: string
  fee_kobo: string
  net_kobo: string
  rate_kobo: string
  status: string
  mode: 'live' | 'sandbox'
  payout_type: string | null
  bank_account_id: string | null
  dest_address: string | null
  from_address: string | null
  deposit_address: string | null
  funding: string | null
  instant: number
  risk_score: number
  risk_flags: string
  tx_hash: string | null
  failure_reason: string | null
  created_at: number
  updated_at: number
  broadcast_at: number | null
  detected_at: number | null
  payout_at: number | null
  completed_at: number | null
  expires_at: number | null
}

export const getOrder = (id: string) => get<OrderRow>('SELECT * FROM orders WHERE id=?', id)

export function setStatus(id: string, status: string, kind: string, detail = '', extra: Record<string, number | string | null> = {}) {
  const sets = ['status=?', 'updated_at=?', ...Object.keys(extra).map((k) => `${k}=?`)]
  run(`UPDATE orders SET ${sets.join(', ')} WHERE id=?`, status, now(), ...Object.values(extra), id)
  orderEvent(id, kind, detail)
  syncP2pOrder(id)
}

const TERMINAL = ['completed', 'failed', 'expired', 'cancelled', 'rejected', 'reversed']

export interface CreateOrderInput {
  quoteId: string
  idempotencyKey: string
  payoutType?: 'bank' | 'wallet'
  bankAccountId?: string
  funding?: 'wallet' | 'bank_transfer'
  destAddress?: string
  fromAddress?: string
}

export function createOrder(user: User, input: CreateOrderInput): OrderRow {
  const dupe = get<OrderRow>('SELECT * FROM orders WHERE user_id=? AND idem_key=?', user.id, input.idempotencyKey)
  if (dupe) return dupe
  const q = get<Record<string, string | number>>('SELECT * FROM quotes WHERE id=? AND user_id=?', input.quoteId, user.id)
  if (!q) throw new HttpError(404, 'Quote not found')
  if (q.used) throw new HttpError(409, 'This quote was already used')
  if (Number(q.expires_at) < now()) throw new HttpError(410, 'Quote expired. Refresh to get the latest rate.')
  const asset = getAsset(String(q.asset))
  if (!asset || !asset.enabled) throw new HttpError(400, 'Asset is not available')
  if (asset.rate_version !== Number(q.rate_version)) throw new HttpError(409, 'Rate was updated. Refresh your quote.')
  if (setting('platform_paused') === 'true') throw new HttpError(503, 'Trading is temporarily paused')

  const gross = BigInt(String(q.gross_kobo))
  const dailyCap = BigInt(setting(user.kyc_tier >= 2 ? 'daily_limit_tier2_kobo' : 'daily_limit_tier1_kobo'))
  if (dailyVolumeKobo(user.id) + gross > dailyCap) {
    throw new HttpError(403, `Daily limit reached for KYC tier ${user.kyc_tier} (NGN ${fromUnits(dailyCap, 2)})`)
  }

  const side = q.side as 'sell' | 'buy'
  const id = uid('ord')
  let mode: 'live' | 'sandbox' = 'sandbox'
  let status = ''
  let depositAddress: string | null = null
  const row: Record<string, string | number | null> = { payout_type: null, bank_account_id: null, dest_address: null, from_address: null, funding: null }

  if (side === 'sell') {
    row.payout_type = input.payoutType ?? 'wallet'
    if (row.payout_type === 'bank') {
      const ba = get('SELECT id FROM bank_accounts WHERE id=? AND user_id=?', input.bankAccountId ?? '', user.id)
      if (!ba) throw new HttpError(400, 'Choose one of your saved bank accounts')
      row.bank_account_id = input.bankAccountId ?? null
    }
    const vault = vaultAddressArc()
    if (asset.monitoring === 'live' && vault && input.fromAddress && isAddress(input.fromAddress)) {
      mode = 'live'
      depositAddress = vault
      row.from_address = input.fromAddress.toLowerCase()
    }
    status = 'awaiting_deposit'
  } else {
    row.funding = input.funding ?? 'wallet'
    if (input.destAddress) {
      if (!validDestination(asset.symbol, input.destAddress)) throw new HttpError(400, `That is not a valid ${asset.symbol} address`)
      row.dest_address = input.destAddress
    }
    status = row.funding === 'wallet' ? 'payment_verified' : 'awaiting_payment'
  }

  const t = now()
  const expires = t + settingNum('order_expiry_min') * 60_000
  db.transaction(() => {
    run(
      `INSERT INTO orders(id,user_id,quote_id,idem_key,side,asset,crypto_amount,gross_kobo,fee_kobo,net_kobo,rate_kobo,status,mode,payout_type,bank_account_id,dest_address,from_address,deposit_address,funding,created_at,updated_at,expires_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, user.id, input.quoteId, input.idempotencyKey, side, asset.symbol, String(q.crypto_amount), String(q.gross_kobo), String(q.fee_kobo),
      String(q.net_kobo), String(q.rate_kobo), status, mode, row.payout_type, row.bank_account_id, row.dest_address, row.from_address,
      depositAddress, row.funding, t, t, expires,
    )
    run('UPDATE quotes SET used=1 WHERE id=?', input.quoteId)
    orderEvent(id, 'order.created', `${side} ${asset.symbol} (${mode})`)
    createP2pRecord(id)
    if (side === 'buy') {
      if (row.funding === 'wallet') {
        try {
          move({ from: user.id, to: 'house', asset: 'NGN', amount: gross, reason: 'buy order payment', idem: `buy:${id}:fund`, orderId: id })
        } catch (e) {
          if (e instanceof InsufficientFunds) throw new HttpError(400, 'Insufficient Naira balance')
          throw e
        }
        orderEvent(id, 'payment.verified', 'Authorized balance deduction')
      } else {
        const col = provider.createCollection(id, gross)
        orderEvent(id, 'payment.awaiting', col.reference)
      }
    }
  })()
  if (side === 'buy' && row.funding === 'wallet') enqueue(`order.release:${id}`, 'order.release', { orderId: id })
  return getOrder(id) as OrderRow
}

/** Deterministic payout. Re-checks every policy no matter who requested it. */
export function executeNgnPayout(orderId: string, instant: boolean): 'paid' | 'skipped' {
  const o = getOrder(orderId)
  if (!o || o.side !== 'sell') return 'skipped'
  if (!['detected', 'deposit_verified'].includes(o.status)) return 'skipped'
  const net = BigInt(o.net_kobo)
  if (instant) {
    if (setting('instant_payouts_enabled') !== 'true') throw new HttpError(403, 'Instant payouts are disabled')
    if (net > instantLimitKobo()) throw new HttpError(403, 'Above the instant payout limit')
  }
  if (balanceOf('house', 'NGN') < net) {
    alert('warning', 'liquidity', 'Naira liquidity too low for payout', `Order ${o.id} needs NGN ${fromUnits(net, 2)}`, o.user_id, o.id)
    throw new HttpError(503, 'Insufficient Naira liquidity')
  }
  db.transaction(() => {
    if (o.payout_type === 'bank') {
      move({ from: 'house', to: SYS.bank, asset: 'NGN', amount: net, reason: 'naira payout to bank', idem: `payout:${o.id}:house`, orderId: o.id })
      const ref = `SBX-OUT-${o.id}`
      provider.sendPayout(o.id, net, ref)
      setStatus(o.id, 'payout_processing', 'payout.initiated', `Bank payout ${ref} (sandbox)`, { instant: instant ? 1 : 0, payout_at: now() })
    } else {
      const ltx = move({ from: 'house', to: o.user_id, asset: 'NGN', amount: net, reason: 'crypto sale proceeds', idem: `payout:${o.id}:user`, orderId: o.id })
      recordP2pCredit(o.id, ltx)
      setStatus(o.id, 'payout_completed', 'payout.completed', 'Credited to Naira wallet', { instant: instant ? 1 : 0, payout_at: now() })
    }
  })()
  notify(o.user_id, 'payout', instant ? 'Instant payout sent' : 'Payout sent', `NGN ${fromUnits(net, 2)} for your ${o.asset} sale.`)
  maybeComplete(o.id)
  return 'paid'
}

/** Completion requires payout done AND the deposit finalized on its chain. Never from a prediction. */
export function maybeComplete(orderId: string) {
  const o = getOrder(orderId)
  if (!o || o.side !== 'sell' || !['payout_completed', 'awaiting_finality'].includes(o.status)) return
  const tx = get<{ status: string }>('SELECT status FROM chain_txs WHERE order_id=? ORDER BY first_seen_at DESC LIMIT 1', orderId)
  if (tx?.status === 'finalized') {
    setStatus(orderId, 'completed', 'order.completed', 'Payout done and deposit finalized', { completed_at: now() })
    notify(o.user_id, 'order', 'Exchange complete', `Your ${o.asset} to Naira exchange is complete.`)
  } else if (o.status === 'payout_completed') {
    setStatus(orderId, 'awaiting_finality', 'order.awaiting_finality', 'Payout sent, waiting for final confirmation')
  }
}

/** Buy order: releases crypto from the vault once payment is verified. */
export function executeRelease(orderId: string) {
  const o = getOrder(orderId)
  if (!o || o.side !== 'buy' || !['payment_verified', 'awaiting_liquidity'].includes(o.status)) return
  if (balanceOf('house', o.asset) < BigInt(o.crypto_amount)) {
    if (o.status !== 'awaiting_liquidity') {
      setStatus(o.id, 'awaiting_liquidity', 'liquidity.low', `${o.asset} vault below order size`)
      alert('warning', 'liquidity', `${o.asset} liquidity too low`, `Order ${o.id} is waiting for vault funds`, o.user_id, o.id)
    }
    return
  }
  db.transaction(() => {
    const hash = releaseCrypto(o)
    setStatus(o.id, 'completed', 'release.completed', hash ? `Simulated send ${hash}` : 'Credited to platform wallet', { completed_at: now(), tx_hash: hash })
  })()
  notify(o.user_id, 'order', 'Crypto delivered', `${fromUnits(BigInt(o.crypto_amount), getAsset(o.asset)?.decimals ?? 6)} ${o.asset} delivered (sandbox).`)
}

/** Sold crypto never finalized after an instant payout: recover from the user, alert the founder. */
export function reverseOrder(orderId: string, reason: string) {
  const o = getOrder(orderId)
  if (!o || TERMINAL.includes(o.status)) return
  const net = BigInt(o.net_kobo)
  const paid = ['payout_completed', 'payout_processing', 'awaiting_finality'].includes(o.status)
  if (paid) {
    move({ from: o.user_id, to: 'house', asset: 'NGN', amount: net, reason: 'payout reversal (deposit failed)', idem: `reverse:${o.id}`, orderId: o.id, allowNegativeFrom: true })
    markP2pReversed(o.id)
    alert('critical', 'reversal', 'Instant payout reversed', `${o.id}: ${reason}. User wallet debited NGN ${fromUnits(net, 2)}; may be negative if already spent.`, o.user_id, o.id)
  }
  setStatus(o.id, 'reversed', 'order.reversed', reason, { failure_reason: reason, completed_at: now() })
  notify(o.user_id, 'security', 'Exchange reversed', reason)
}

export function failOrder(orderId: string, status: 'failed' | 'rejected' | 'expired', reason: string) {
  const o = getOrder(orderId)
  if (!o || TERMINAL.includes(o.status)) return
  if (o.side === 'buy' && o.funding === 'wallet' && ['payment_verified', 'awaiting_liquidity'].includes(o.status)) {
    const gross = BigInt(o.gross_kobo)
    move({ from: 'house', to: o.user_id, asset: 'NGN', amount: gross, reason: 'refund', idem: `refund:${o.id}`, orderId: o.id })
  }
  setStatus(o.id, status, `order.${status}`, reason, { failure_reason: reason, completed_at: now() })
}

export function handlePaymentEvent(ev: PaymentEvent): string {
  if (ev.reference.startsWith('SBX-WD-')) return handleWithdrawalEvent(ev)
  const pay = get<{ id: string; order_id: string; direction: string; status: string; amount_kobo: string }>('SELECT * FROM payments WHERE reference=?', ev.reference)
  if (!pay) return 'unknown reference'
  const o = getOrder(pay.order_id)
  if (!o) return 'unknown order'
  if (ev.type === 'collection.succeeded') {
    if (pay.direction !== 'in' || pay.status === 'succeeded') return 'duplicate'
    if (ev.amountKobo !== pay.amount_kobo) {
      run("UPDATE payments SET status='mismatch', updated_at=? WHERE id=?", now(), pay.id)
      alert('critical', 'payment_mismatch', 'Naira payment amount mismatch', `Order ${o.id} expected ${pay.amount_kobo} received ${ev.amountKobo} kobo`, o.user_id, o.id)
      setStatus(o.id, 'flagged', 'payment.mismatch', 'Payment amount did not match')
      return 'mismatch'
    }
    db.transaction(() => {
      run("UPDATE payments SET status='succeeded', updated_at=? WHERE id=?", now(), pay.id)
      move({ from: SYS.external, to: 'house', asset: 'NGN', amount: BigInt(pay.amount_kobo), reason: 'bank transfer received (sandbox)', idem: `buy:${o.id}:house`, orderId: o.id })
      setStatus(o.id, 'payment_verified', 'payment.verified', 'Signed webhook verified')
    })()
    enqueue(`order.release:${o.id}`, 'order.release', { orderId: o.id })
    return 'ok'
  }
  if (pay.direction !== 'out' || pay.status === 'succeeded') return 'duplicate'
  if (ev.type === 'payout.succeeded') {
    run("UPDATE payments SET status='succeeded', updated_at=? WHERE id=?", now(), pay.id)
    setStatus(o.id, 'payout_completed', 'payout.completed', 'Bank payout confirmed by provider (sandbox)')
    maybeComplete(o.id)
  } else {
    run("UPDATE payments SET status='failed', updated_at=? WHERE id=?", now(), pay.id)
    const net = BigInt(o.net_kobo)
    const ltx = move({ from: SYS.bank, to: o.user_id, asset: 'NGN', amount: net, reason: 'failed bank payout, credited to wallet', idem: `payoutfail:${o.id}:user`, orderId: o.id })
    recordP2pCredit(o.id, ltx)
    alert('warning', 'payout_failed', 'Bank payout failed', `Order ${o.id}: credited to the user's Naira wallet instead`, o.user_id, o.id)
    setStatus(o.id, 'payout_completed', 'payout.failed', 'Bank payout failed; credited to wallet')
    maybeComplete(o.id)
  }
  return 'ok'
}

export function expireStaleOrders() {
  const stale = all<{ id: string }>(
    "SELECT id FROM orders WHERE status IN ('awaiting_deposit','awaiting_payment') AND expires_at<?", now(),
  )
  for (const s of stale) failOrder(s.id, 'expired', 'Order expired before payment was received')
}

export const bankDetails = (accountId: string) => {
  const r = get<{ account_enc: string; bank_name: string; account_name: string }>('SELECT * FROM bank_accounts WHERE id=?', accountId)
  return r ? { ...r, accountNumber: decrypt(r.account_enc) } : null
}

export { audit }
