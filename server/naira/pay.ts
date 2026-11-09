/**
 * Payment engine shared by bank transfers, bills, flights and shopping:
 *   validate -> PIN -> limits/fraud -> reserve funds (ledger move to the holding account) -> provider -> settle or reverse.
 * Funds are reserved atomically with the transaction record. If the provider fails, a compensating ledger move
 * returns the money and the transaction is marked failed. Nothing is reported successful before the provider confirms.
 */
import { HttpError, type User } from '../auth'
import { alert, audit, db, get, notify, now, run } from '../db'
import { InsufficientFunds, SYS, move } from '../ledger'
import { fromUnits } from '../money'
import { enqueue, registerJob } from '../queue'
import { assertOperational, assertWithinDailyLimit, assessMovement, verifyPin } from './wallet'
import { createTxn, findByIdem, getTxn, patchTxn, txnView, type TxnRow } from './txns'

export type PayType = 'bank_transfer' | 'bill' | 'flight' | 'shopping'

export interface FulfillResult {
  ok: boolean
  reason?: string
  providerRef?: string
  meta?: Record<string, unknown>
}
type Fulfiller = (txn: TxnRow, meta: Record<string, unknown>) => FulfillResult

const fulfillers = new Map<PayType, Fulfiller>()
export const registerFulfiller = (type: PayType, f: Fulfiller) => fulfillers.set(type, f)

/** Where settled money goes: the bank settlement account for transfers, bill payables for everything else. */
export const destinationAccount = (type: string) => (type === 'bank_transfer' ? SYS.bank : SYS.bills)

export interface PayRequest {
  user: User
  pin: unknown
  idem: string
  type: PayType
  title: string
  amount: bigint
  fee: bigint
  counterparty?: string
  note?: string
  meta: Record<string, unknown>
  /** Runs inside the same database transaction as the reservation (create bills_orders rows etc). */
  onCreate?: (txn: TxnRow) => void
}

export function startPayment(req: PayRequest) {
  const { user } = req
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(req.idem)) throw new HttpError(400, 'A valid idempotency key is required')
  // A retry of the same request returns the original transaction: never a second charge.
  const prior = findByIdem(user.id, req.idem)
  if (prior) return { txn: txnView(prior), replay: true }

  assertOperational(user.id)
  verifyPin(user.id, req.pin)
  const total = req.amount + req.fee
  if (req.amount <= 0n) throw new HttpError(400, 'Enter an amount greater than zero')

  // Everything below is synchronous (no awaits), so limit check + reservation cannot interleave with another request.
  assertWithinDailyLimit(user.id, total)
  const risk = assessMovement(user.id, req.amount, req.type)
  try {
    const txn = db.transaction(() => {
      const t = createTxn({
        userId: user.id, type: req.type, direction: 'debit', amount: req.amount, fee: req.fee, status: risk.review ? 'pending_review' : 'processing',
        title: req.title, counterparty: req.counterparty, note: req.note, idemKey: req.idem, reviewRequired: risk.review,
        meta: { ...req.meta, riskFlags: risk.flags },
      })
      const ltx = move({ from: user.id, to: SYS.holding, asset: 'NGN', amount: total, reason: `reserve: ${req.title}`, idem: `txn:${t.id}:reserve` })
      patchTxn(t.id, { ledgerTxnId: ltx })
      req.onCreate?.(t)
      return t
    })()
    if (risk.review) {
      alert('warning', 'naira_review', 'Transfer waiting for review', `${txn.reference}: NGN ${fromUnits(req.amount, 2)} by ${user.email}`, user.id)
      notify(user.id, 'order', 'Transfer under review', `${txn.reference} is above the automatic limit and is waiting for review. Your funds are reserved.`)
    } else {
      enqueue(`naira.settle:${txn.id}`, 'naira.settle', { txnId: txn.id }, 1200)
    }
    return { txn: txnView(getTxn(txn.id) as TxnRow), replay: false }
  } catch (e) {
    if (e instanceof InsufficientFunds) throw new HttpError(400, 'Insufficient Naira balance')
    // A concurrent duplicate request that raced past the idempotency check lands here via the unique index.
    const again = findByIdem(user.id, req.idem)
    if (again) return { txn: txnView(again), replay: true }
    throw e
  }
}

/** Runs the provider step for a reserved transaction, then settles or reverses. Safe to call twice. */
export function settle(txnId: string) {
  const t = getTxn(txnId)
  if (!t || t.status !== 'processing') return
  const fulfil = fulfillers.get(t.type as PayType)
  let result: FulfillResult
  try {
    result = fulfil ? fulfil(t, JSON.parse(t.meta) as Record<string, unknown>) : { ok: false, reason: 'No provider is configured for this payment type.' }
  } catch (e) {
    result = { ok: false, reason: e instanceof Error ? e.message : 'Provider error' }
  }
  const amount = BigInt(t.amount_kobo)
  const fee = BigInt(t.fee_kobo)
  if (result.ok) {
    db.transaction(() => {
      move({ from: SYS.holding, to: destinationAccount(t.type), asset: 'NGN', amount, reason: `settled: ${t.title}`, idem: `txn:${t.id}:settle` })
      if (fee > 0n) move({ from: SYS.holding, to: SYS.fees, asset: 'NGN', amount: fee, reason: `fee: ${t.title}`, idem: `txn:${t.id}:fee` })
      patchTxn(t.id, { status: 'success', meta: { ...(result.meta ?? {}), providerRef: result.providerRef } })
      run("UPDATE bills_orders SET status='success', provider_ref=?, token=?, updated_at=? WHERE transaction_id=?", result.providerRef ?? null, (result.meta?.token as string | undefined) ?? null, now(), t.id)
    })()
    notify(t.user_id, 'payout', `${t.title} successful`, `Reference ${t.reference}. NGN ${fromUnits(amount, 2)}.`)
    return
  }
  reverseReservation(t, result.reason ?? 'The provider declined the payment.')
}

/** Compensating ledger entries: the reserved funds go back to the customer and the transaction is marked failed. */
export function reverseReservation(t: TxnRow, reason: string) {
  const total = BigInt(t.amount_kobo) + BigInt(t.fee_kobo)
  db.transaction(() => {
    move({ from: SYS.holding, to: t.user_id, asset: 'NGN', amount: total, reason: `reversal: ${t.title}`, idem: `txn:${t.id}:reverse` })
    patchTxn(t.id, { status: 'failed', failureReason: reason, reversed: true, meta: { refunded: true } })
    run("UPDATE bills_orders SET status='failed', updated_at=? WHERE transaction_id=?", now(), t.id)
  })()
  audit(null, 'payment.reversed', t.reference, undefined, { reason, total: total.toString() })
  notify(t.user_id, 'security', `${t.title} failed`, `${reason} NGN ${fromUnits(total, 2)} was returned to your wallet.`)
}

registerJob('naira.settle', (p) => {
  settle(String(p.txnId))
})

/** Safety net: anything still "processing" long after the job should have run is settled now. */
export function sweepStalePayments() {
  for (const r of db.query("SELECT id FROM transactions WHERE status='processing' AND created_at<?").all(now() - 5 * 60_000) as { id: string }[]) {
    settle(r.id)
  }
}

/** Founder decision on a transfer held for review. */
export function decideReview(txnId: string, approve: boolean, actorId: string) {
  const t = getTxn(txnId)
  if (!t || t.status !== 'pending_review') throw new HttpError(409, 'That transaction is not waiting for review')
  audit(actorId, approve ? 'review.approved' : 'review.rejected', t.reference)
  if (approve) {
    patchTxn(t.id, { status: 'processing', reviewRequired: false })
    enqueue(`naira.settle:${t.id}`, 'naira.settle', { txnId: t.id }, 500)
  } else {
    reverseReservation(t, 'The transfer was declined during review.')
  }
}

export const hasTxn = (id: string) => Boolean(get('SELECT 1 FROM transactions WHERE id=?', id))
