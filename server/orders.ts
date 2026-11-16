/**
 * Deterministic order engine. This is the ONLY code that moves money. The AI agent can request
 * actions, but every action re-checks policy here (limits, liquidity, state, idempotency).
 */
import { HttpError, type User } from './auth'
import { dailyVolumeKobo, getAsset, instantLimitKobo } from './assets'
import { alert, audit, get, now, notify, orderEvent, run, setting, settingNum, uid, all, tx } from './db'
import { InsufficientFunds, SYS, balanceOf, bookFee, move } from './ledger'
import { announceHold, assessHold, bankKey, bankLabel, cryptoKey, cryptoLabel, markPaid, registerHold } from './holds'
import { assertOperational } from './naira/wallet'
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

export const getOrder = async (id: string) => await get<OrderRow>('SELECT * FROM orders WHERE id=?', id)

export async function setStatus(id: string, status: string, kind: string, detail = '', extra: Record<string, number | string | null> = {}) {
  const sets = ['status=?', 'updated_at=?', ...Object.keys(extra).map((k) => `${k}=?`)]
  await run(`UPDATE orders SET ${sets.join(', ')} WHERE id=?`, status, now(), ...Object.values(extra), id)
  await orderEvent(id, kind, detail)
  await syncP2pOrder(id)
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

export async function createOrder(user: User, input: CreateOrderInput): Promise<OrderRow> {
  const dupe = await get<OrderRow>('SELECT * FROM orders WHERE user_id=? AND idem_key=?', user.id, input.idempotencyKey)
  if (dupe) return dupe
  const q = await get<Record<string, string | number>>('SELECT * FROM quotes WHERE id=? AND user_id=?', input.quoteId, user.id)
  if (!q) throw new HttpError(404, 'Quote not found')
  if (q.used) throw new HttpError(409, 'This quote was already used')
  if (Number(q.expires_at) < now()) throw new HttpError(410, 'Quote expired. Refresh to get the latest rate.')
  const asset = await getAsset(String(q.asset))
  if (!asset || !asset.enabled) throw new HttpError(400, 'Asset is not available')
  if (asset.rate_version !== Number(q.rate_version)) throw new HttpError(409, 'Rate was updated. Refresh your quote.')
  if (await setting('platform_paused') === 'true') throw new HttpError(503, 'Trading is temporarily paused')

  const gross = BigInt(String(q.gross_kobo))
  const dailyCap = BigInt(await setting(user.kyc_tier >= 2 ? 'daily_limit_tier2_kobo' : 'daily_limit_tier1_kobo'))
  if (await dailyVolumeKobo(user.id) + gross > dailyCap) {
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
      const ba = await get('SELECT id FROM bank_accounts WHERE id=? AND user_id=?', input.bankAccountId ?? '', user.id)
      if (!ba) throw new HttpError(400, 'Choose one of your saved bank accounts')
      row.bank_account_id = input.bankAccountId ?? null
    }
    const vault = await vaultAddressArc()
    if (asset.monitoring === 'live' && vault && input.fromAddress && isAddress(input.fromAddress)) {
      mode = 'live'
      depositAddress = vault
      row.from_address = input.fromAddress.toLowerCase()
    }
    status = 'awaiting_deposit'
  } else {
    row.funding = input.funding ?? 'wallet'
    // Paying from the Naira wallet always needs an operational (not frozen) wallet, whichever route created the order.
    if (row.funding === 'wallet') await assertOperational(user.id)
    if (input.destAddress) {
      if (!await validDestination(asset.symbol, input.destAddress)) throw new HttpError(400, `That is not a valid ${asset.symbol} address`)
      row.dest_address = input.destAddress
    }
    status = row.funding === 'wallet' ? 'payment_verified' : 'awaiting_payment'
  }

  const t = now()
  const expires = t + await settingNum('order_expiry_min') * 60_000
  const createdId = await tx(async () => {
    // Everything below runs under the write lock, so two requests racing on one quote, one idempotency key or the daily cap cannot both win.
    const again = await get<OrderRow>('SELECT * FROM orders WHERE user_id=? AND idem_key=?', user.id, input.idempotencyKey)
    if (again) return again.id
    if (await dailyVolumeKobo(user.id) + gross > dailyCap) {
      throw new HttpError(403, `Daily limit reached for KYC tier ${user.kyc_tier} (NGN ${fromUnits(dailyCap, 2)})`)
    }
    const claimed = await run('UPDATE quotes SET used=1 WHERE id=? AND user_id=? AND used=0', input.quoteId, user.id)
    if (claimed.changes !== 1) throw new HttpError(409, 'This quote was already used')
    await run(
      `INSERT INTO orders(id,user_id,quote_id,idem_key,side,asset,crypto_amount,gross_kobo,fee_kobo,net_kobo,rate_kobo,status,mode,payout_type,bank_account_id,dest_address,from_address,deposit_address,funding,created_at,updated_at,expires_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, user.id, input.quoteId, input.idempotencyKey, side, asset.symbol, String(q.crypto_amount), String(q.gross_kobo), String(q.fee_kobo),
      String(q.net_kobo), String(q.rate_kobo), status, mode, row.payout_type, row.bank_account_id, row.dest_address, row.from_address,
      depositAddress, row.funding, t, t, expires,
    )
    await orderEvent(id, 'order.created', `${side} ${asset.symbol} (${mode})`)
    await createP2pRecord(id)
    if (side === 'buy') {
      if (row.funding === 'wallet') {
        try {
          await move({ from: user.id, to: 'house', asset: 'NGN', amount: gross, reason: 'buy order payment', idem: `buy:${id}:fund`, orderId: id })
        } catch (e) {
          if (e instanceof InsufficientFunds) throw new HttpError(400, 'Insufficient Naira balance')
          throw e
        }
        await orderEvent(id, 'payment.verified', 'Authorized balance deduction')
      } else {
        const col = await provider.createCollection(id, gross)
        await orderEvent(id, 'payment.awaiting', col.reference)
      }
    }
    return id
  })
  if (createdId !== id) return await getOrder(createdId) as OrderRow
  if (side === 'buy' && row.funding === 'wallet') await enqueue(`order.release:${id}`, 'order.release', { orderId: id })
  return await getOrder(id) as OrderRow
}

/** Deterministic payout. Re-checks every policy no matter who requested it. */
export async function executeNgnPayout(orderId: string, instant: boolean): Promise<'paid' | 'skipped'> {
  const o = await getOrder(orderId)
  if (!o || o.side !== 'sell') return 'skipped'
  if (!['detected', 'deposit_verified'].includes(o.status)) return 'skipped'
  const net = BigInt(o.net_kobo)
  if (instant) {
    if (await setting('instant_payouts_enabled') !== 'true') throw new HttpError(403, 'Instant payouts are disabled')
    if (net > await instantLimitKobo()) throw new HttpError(403, 'Above the instant payout limit')
  }
  if (await balanceOf('house', 'NGN') < net) {
    await alert('warning', 'liquidity', 'Naira liquidity too low for payout', `Order ${o.id} needs NGN ${fromUnits(net, 2)}`, o.user_id, o.id)
    throw new HttpError(503, 'Insufficient Naira liquidity')
  }
  let heldInfo: { until: number; label: string } | null = null
  let paidKey: string | null = null
  const dispatched = await tx(async () => {
    if (o.payout_type === 'bank') {
      // First-time bank account above the threshold: the payout waits out the hold. The sold crypto is already with us; nothing is paid yet.
      const ba = o.bank_account_id ? await bankDetails(o.bank_account_id) : null
      if (ba) {
        const tier = (await get<{ kyc_tier: number }>('SELECT kyc_tier FROM users WHERE id=?', o.user_id))?.kyc_tier ?? 1
        const label = bankLabel(ba.bank_name, ba.accountNumber.slice(-4))
        const key = bankKey(ba.bank_name, ba.accountNumber)
        const hold = await assessHold({ userId: o.user_id, kycTier: tier, kind: 'bank_payout', refId: o.id, cpKey: key, cpLabel: label, cpKind: 'bank', amountKobo: net })
        if (hold.held) {
          await setStatus(o.id, 'payout_held', 'payout.held', `Bank payout to ${label} is held for a first-time destination`)
          heldInfo = { until: hold.releaseAt, label }
          return false
        }
        paidKey = key
      }
      const ltx = await move({ from: 'house', to: SYS.bank, asset: 'NGN', amount: net, reason: 'naira payout to bank', idem: `payout:${o.id}:house`, orderId: o.id })
      // The ledger refused a second movement for this order, so the payout was already dispatched: never call the provider twice.
      if (ltx === null) return false
      const ref = `SBX-OUT-${o.id}`
      await provider.sendPayout(o.id, net, ref)
      await setStatus(o.id, 'payout_processing', 'payout.initiated', `Bank payout ${ref} (sandbox)`, { instant: instant ? 1 : 0, payout_at: now() })
    } else {
      const ltx = await move({ from: 'house', to: o.user_id, asset: 'NGN', amount: net, reason: 'crypto sale proceeds', idem: `payout:${o.id}:user`, orderId: o.id })
      if (ltx === null) return false
      await recordP2pCredit(o.id, ltx)
      await setStatus(o.id, 'payout_completed', 'payout.completed', 'Credited to Naira wallet', { instant: instant ? 1 : 0, payout_at: now() })
    }
    return true
  })
  if (heldInfo) {
    const h = heldInfo as { until: number; label: string }
    await announceHold(o.user_id, h.label, net, h.until)
    return 'skipped'
  }
  if (!dispatched) return 'skipped'
  if (paidKey) await markPaid(o.user_id, paidKey)
  await notify(o.user_id, 'payout', instant ? 'Instant payout sent' : 'Payout sent', `NGN ${fromUnits(net, 2)} for your ${o.asset} sale.`)
  await maybeComplete(o.id)
  return 'paid'
}

/** Completion requires payout done AND the deposit finalized on its chain. Never from a prediction. */
export async function maybeComplete(orderId: string) {
  const o = await getOrder(orderId)
  if (!o || o.side !== 'sell' || !['payout_completed', 'awaiting_finality'].includes(o.status)) return
  const tx = await get<{ status: string }>('SELECT status FROM chain_txs WHERE order_id=? ORDER BY first_seen_at DESC LIMIT 1', orderId)
  if (tx?.status === 'finalized') {
    await setStatus(orderId, 'completed', 'order.completed', 'Payout done and deposit finalized', { completed_at: now() })
    await bookFee({ asset: 'NGN', amount: BigInt(o.fee_kobo), idem: `fee:${o.id}`, orderId: o.id })
    await notify(o.user_id, 'order', 'Exchange complete', `Your ${o.asset} to Naira exchange is complete.`)
  } else if (o.status === 'payout_completed') {
    await setStatus(orderId, 'awaiting_finality', 'order.awaiting_finality', 'Payout sent, waiting for final confirmation')
  }
}

/** Buy order: releases crypto from the vault once payment is verified. */
export async function executeRelease(orderId: string) {
  const o = await getOrder(orderId)
  if (!o || o.side !== 'buy' || !['payment_verified', 'awaiting_liquidity'].includes(o.status)) return
  if (await balanceOf('house', o.asset) < BigInt(o.crypto_amount)) {
    if (o.status !== 'awaiting_liquidity') {
      await setStatus(o.id, 'awaiting_liquidity', 'liquidity.low', `${o.asset} vault below order size`)
      await alert('warning', 'liquidity', `${o.asset} liquidity too low`, `Order ${o.id} is waiting for vault funds`, o.user_id, o.id)
    }
    return
  }
  let heldUntil: number | null = null
  await tx(async () => {
    // First-time outside address above the threshold: the Naira is already paid, the crypto waits out the hold.
    if (o.dest_address) {
      const tier = (await get<{ kyc_tier: number }>('SELECT kyc_tier FROM users WHERE id=?', o.user_id))?.kyc_tier ?? 1
      const hold = await assessHold({ userId: o.user_id, kycTier: tier, kind: 'buy_release', refId: o.id, cpKey: cryptoKey(o.dest_address), cpLabel: cryptoLabel(o.asset, o.dest_address), cpKind: 'crypto', amountKobo: BigInt(o.gross_kobo) })
      if (hold.held) {
        await setStatus(o.id, 'release_held', 'release.held', `Delivery to ${cryptoLabel(o.asset, o.dest_address)} is held for a first-time address`)
        heldUntil = hold.releaseAt
        return
      }
      await markPaid(o.user_id, cryptoKey(o.dest_address))
    }
    const hash = await releaseCrypto(o)
    await setStatus(o.id, 'completed', 'release.completed', hash ? `Simulated send ${hash}` : 'Credited to platform wallet', { completed_at: now(), tx_hash: hash })
    await bookFee({ asset: 'NGN', amount: BigInt(o.fee_kobo), idem: `fee:${o.id}`, orderId: o.id })
  })
  if (heldUntil !== null) {
    await announceHold(o.user_id, cryptoLabel(o.asset, o.dest_address ?? ''), BigInt(o.gross_kobo), heldUntil)
    return
  }
  await notify(o.user_id, 'order', 'Crypto delivered', `${fromUnits(BigInt(o.crypto_amount), (await getAsset(o.asset))?.decimals ?? 6)} ${o.asset} delivered (sandbox).`)
}

/** Sold crypto never finalized after an instant payout: recover from the user, alert the founder. */
export async function reverseOrder(orderId: string, reason: string) {
  const o = await getOrder(orderId)
  if (!o || TERMINAL.includes(o.status)) return
  const net = BigInt(o.net_kobo)
  const paid = ['payout_completed', 'payout_processing', 'awaiting_finality'].includes(o.status)
  if (paid) {
    const out = o.payout_type === 'bank' ? await get<{ id: string; status: string }>("SELECT id, status FROM payments WHERE order_id=? AND direction='out' ORDER BY created_at DESC LIMIT 1", o.id) : null
    if (o.payout_type === 'bank' && (!out || ['processing', 'awaiting'].includes(out.status))) {
      // The Naira went house -> bank settlement, never to the user's wallet. Cancel the unsettled payout and return it to the house; the user is not debited.
      if (out) await run("UPDATE payments SET status='cancelled', updated_at=? WHERE id=?", now(), out.id)
      await move({ from: SYS.bank, to: 'house', asset: 'NGN', amount: net, reason: 'bank payout cancelled (deposit failed)', idem: `reverse:${o.id}:bank`, orderId: o.id })
      await alert('critical', 'reversal', 'Bank payout cancelled', `${o.id}: ${reason}. The unsettled bank payout was cancelled and returned to platform liquidity.`, o.user_id, o.id)
    } else if (o.payout_type === 'bank' && out?.status === 'succeeded') {
      // Money already reached the bank and cannot be recalled here. Nothing is taken from the user's wallet; a person must recover it.
      await alert('critical', 'reversal_manual', 'Bank payout already settled: manual recovery needed', `${o.id}: ${reason}. NGN ${fromUnits(net, 2)} was paid to the user's bank and cannot be reversed automatically.`, o.user_id, o.id)
    } else {
      // Wallet payout (or a failed bank payout that was credited back to the wallet): claw back from the wallet that was credited.
      await move({ from: o.user_id, to: 'house', asset: 'NGN', amount: net, reason: 'payout reversal (deposit failed)', idem: `reverse:${o.id}`, orderId: o.id, allowNegativeFrom: true })
      await markP2pReversed(o.id)
      await alert('critical', 'reversal', 'Instant payout reversed', `${o.id}: ${reason}. User wallet debited NGN ${fromUnits(net, 2)}; may be negative if already spent.`, o.user_id, o.id)
    }
  }
  await setStatus(o.id, 'reversed', 'order.reversed', reason, { failure_reason: reason, completed_at: now() })
  await notify(o.user_id, 'security', 'Exchange reversed', reason)
}

export async function failOrder(orderId: string, status: 'failed' | 'rejected' | 'expired', reason: string) {
  const o = await getOrder(orderId)
  if (!o || TERMINAL.includes(o.status)) return
  if (o.side === 'buy' && o.funding === 'wallet' && ['payment_verified', 'awaiting_liquidity'].includes(o.status)) {
    const gross = BigInt(o.gross_kobo)
    await move({ from: 'house', to: o.user_id, asset: 'NGN', amount: gross, reason: 'refund', idem: `refund:${o.id}`, orderId: o.id })
  }
  await setStatus(o.id, status, `order.${status}`, reason, { failure_reason: reason, completed_at: now() })
}

export async function handlePaymentEvent(ev: PaymentEvent): Promise<string> {
  if (ev.reference.startsWith('SBX-WD-')) return await handleWithdrawalEvent(ev)
  const pay = await get<{ id: string; order_id: string; direction: string; status: string; amount_kobo: string }>('SELECT * FROM payments WHERE reference=?', ev.reference)
  if (!pay) return 'unknown reference'
  const o = await getOrder(pay.order_id)
  if (!o) return 'unknown order'
  // A closed order (reversed, failed, expired, completed...) is never reopened by a late provider event.
  if (TERMINAL.includes(o.status)) {
    if (ev.type === 'collection.succeeded' && pay.direction === 'in' && pay.status !== 'succeeded') {
      await run("UPDATE payments SET status='late', updated_at=? WHERE id=?", now(), pay.id)
      await alert('warning', 'late_payment', 'Payment arrived for a closed order', `Order ${o.id} is ${o.status}. NGN ${ev.amountKobo} kobo needs manual review.`, o.user_id, o.id)
    }
    return 'ignored: order closed'
  }
  if (ev.type === 'collection.succeeded') {
    if (pay.direction !== 'in' || pay.status === 'succeeded') return 'duplicate'
    if (ev.amountKobo !== pay.amount_kobo) {
      await run("UPDATE payments SET status='mismatch', updated_at=? WHERE id=?", now(), pay.id)
      await alert('critical', 'payment_mismatch', 'Naira payment amount mismatch', `Order ${o.id} expected ${pay.amount_kobo} received ${ev.amountKobo} kobo`, o.user_id, o.id)
      await setStatus(o.id, 'flagged', 'payment.mismatch', 'Payment amount did not match')
      return 'mismatch'
    }
    await tx(async () => {
      await run("UPDATE payments SET status='succeeded', updated_at=? WHERE id=?", now(), pay.id)
      await move({ from: SYS.external, to: 'house', asset: 'NGN', amount: BigInt(pay.amount_kobo), reason: 'bank transfer received (sandbox)', idem: `buy:${o.id}:house`, orderId: o.id })
      await setStatus(o.id, 'payment_verified', 'payment.verified', 'Signed webhook verified')
    })
    await enqueue(`order.release:${o.id}`, 'order.release', { orderId: o.id })
    return 'ok'
  }
  if (pay.direction !== 'out' || ['succeeded', 'failed', 'cancelled'].includes(pay.status)) return 'duplicate'
  if (ev.type === 'payout.succeeded') {
    await run("UPDATE payments SET status='succeeded', updated_at=? WHERE id=?", now(), pay.id)
    await setStatus(o.id, 'payout_completed', 'payout.completed', 'Bank payout confirmed by provider (sandbox)')
    await maybeComplete(o.id)
  } else {
    await run("UPDATE payments SET status='failed', updated_at=? WHERE id=?", now(), pay.id)
    const net = BigInt(o.net_kobo)
    const ltx = await move({ from: SYS.bank, to: o.user_id, asset: 'NGN', amount: net, reason: 'failed bank payout, credited to wallet', idem: `payoutfail:${o.id}:user`, orderId: o.id })
    await recordP2pCredit(o.id, ltx)
    await alert('warning', 'payout_failed', 'Bank payout failed', `Order ${o.id}: credited to the user's Naira wallet instead`, o.user_id, o.id)
    await setStatus(o.id, 'payout_completed', 'payout.failed', 'Bank payout failed; credited to wallet')
    await maybeComplete(o.id)
  }
  return 'ok'
}

export async function expireStaleOrders() {
  const stale = await all<{ id: string }>(
    "SELECT id FROM orders WHERE status IN ('awaiting_deposit','awaiting_payment') AND expires_at<?", now(),
  )
  for (const s of stale) await failOrder(s.id, 'expired', 'Order expired before payment was received')
}

registerHold('bank_payout', {
  onRelease: async (h) => {
    const o = await getOrder(h.ref_id)
    if (!o || o.status !== 'payout_held') return
    await setStatus(o.id, 'deposit_verified', 'payout.released', 'Hold ended: paying out')
    await enqueue(`order.payout:${o.id}:released`, 'order.payout', { orderId: o.id, instant: false })
  },
  // Cancelling a held bank payout never sends the money anywhere new: it is paid to the customer's own Naira wallet instead.
  onCancel: async (h) => {
    const o = await getOrder(h.ref_id)
    if (!o || o.status !== 'payout_held') return
    await run("UPDATE orders SET payout_type='wallet', bank_account_id=NULL WHERE id=?", o.id)
    await setStatus(o.id, 'deposit_verified', 'payout.redirected', 'Held bank payout cancelled: paying to the Naira wallet instead')
    await enqueue(`order.payout:${o.id}:wallet`, 'order.payout', { orderId: o.id, instant: false })
  },
})

registerHold('buy_release', {
  onRelease: async (h) => {
    const o = await getOrder(h.ref_id)
    if (!o || o.status !== 'release_held') return
    await setStatus(o.id, 'payment_verified', 'release.hold_ended', 'Hold ended: delivering')
    await enqueue(`order.release:${o.id}:released`, 'order.release', { orderId: o.id })
  },
  onCancel: async (h, reason) => {
    const o = await getOrder(h.ref_id)
    if (!o || o.status !== 'release_held') return
    try {
      await move({ from: 'house', to: o.user_id, asset: 'NGN', amount: BigInt(o.gross_kobo), reason: 'held delivery cancelled: refund', idem: `refund:${o.id}`, orderId: o.id })
    } catch {
      await alert('critical', 'refund_manual', 'Refund needs a person', `${o.id}: a held delivery was cancelled but the refund could not be booked.`, o.user_id, o.id)
    }
    await setStatus(o.id, 'cancelled', 'order.cancelled', reason || 'Held delivery cancelled', { failure_reason: reason, completed_at: now() })
  },
})

export const bankDetails = async (accountId: string) => {
  const r = await get<{ account_enc: string; bank_name: string; account_name: string }>('SELECT * FROM bank_accounts WHERE id=?', accountId)
  return r ? { ...r, accountNumber: decrypt(r.account_enc) } : null
}

export { audit }
