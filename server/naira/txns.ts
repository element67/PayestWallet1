/** Naira transaction records (one row per customer-visible money event) and their receipts. */
import { all, get, now, run, uid } from '../db'
import { fromUnits } from '../money'

export type TxnStatus = 'pending' | 'processing' | 'pending_review' | 'success' | 'failed' | 'reversed'

export interface TxnRow {
  id: string
  reference: string
  user_id: string
  type: string
  direction: 'credit' | 'debit'
  amount_kobo: string
  fee_kobo: string
  status: TxnStatus
  title: string
  counterparty: string | null
  note: string | null
  meta: string
  idem_key: string | null
  ledger_txn_id: string | null
  failure_reason: string | null
  reversed: number
  review_required: number
  created_at: number
  updated_at: number
  completed_at: number | null
}

export function newReference(prefix = 'NBT'): string {
  const d = new Date()
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
  return `${prefix}-${ymd}-${crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`
}

export function createTxn(t: {
  userId: string
  type: string
  direction: 'credit' | 'debit'
  amount: bigint
  fee?: bigint
  status: TxnStatus
  title: string
  counterparty?: string
  note?: string
  meta?: Record<string, unknown>
  idemKey?: string
  ledgerTxnId?: string | null
  reviewRequired?: boolean
  prefix?: string
}): TxnRow {
  const id = uid('txn')
  const t0 = now()
  run(
    `INSERT INTO transactions(id,reference,user_id,type,direction,amount_kobo,fee_kobo,status,title,counterparty,note,meta,idem_key,ledger_txn_id,review_required,created_at,updated_at,completed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, newReference(t.prefix), t.userId, t.type, t.direction, t.amount.toString(), (t.fee ?? 0n).toString(), t.status, t.title,
    t.counterparty ?? null, t.note ?? null, JSON.stringify(t.meta ?? {}), t.idemKey ?? null, t.ledgerTxnId ?? null, t.reviewRequired ? 1 : 0, t0, t0,
    t.status === 'success' ? t0 : null,
  )
  return getTxn(id) as TxnRow
}

export const getTxn = (id: string) => get<TxnRow>('SELECT * FROM transactions WHERE id=?', id)
export const findByIdem = (userId: string, idem: string) => get<TxnRow>('SELECT * FROM transactions WHERE user_id=? AND idem_key=?', userId, idem)

export function patchTxn(id: string, p: { status?: TxnStatus; failureReason?: string; ledgerTxnId?: string | null; meta?: Record<string, unknown>; reversed?: boolean; reviewRequired?: boolean; note?: string }) {
  const row = getTxn(id)
  if (!row) return
  const meta = p.meta ? JSON.stringify({ ...(JSON.parse(row.meta) as Record<string, unknown>), ...p.meta }) : row.meta
  const status = p.status ?? row.status
  const done = ['success', 'failed', 'reversed'].includes(status)
  run(
    'UPDATE transactions SET status=?, failure_reason=COALESCE(?, failure_reason), ledger_txn_id=COALESCE(?, ledger_txn_id), meta=?, reversed=?, review_required=?, note=COALESCE(?, note), updated_at=?, completed_at=COALESCE(completed_at, ?) WHERE id=?',
    status, p.failureReason ?? null, p.ledgerTxnId ?? null, meta, p.reversed ? 1 : row.reversed, p.reviewRequired === undefined ? row.review_required : p.reviewRequired ? 1 : 0,
    p.note ?? null, now(), done ? now() : null, id,
  )
}

export function txnView(r: TxnRow) {
  const amount = BigInt(r.amount_kobo)
  const fee = BigInt(r.fee_kobo)
  return {
    id: r.id,
    reference: r.reference,
    type: r.type,
    direction: r.direction,
    amount: fromUnits(amount, 2),
    fee: fromUnits(fee, 2),
    total: fromUnits(r.direction === 'debit' ? amount + fee : amount, 2),
    status: r.status,
    title: r.title,
    counterparty: r.counterparty,
    note: r.note,
    meta: JSON.parse(r.meta) as Record<string, unknown>,
    failureReason: r.failure_reason,
    reversed: Boolean(r.reversed),
    underReview: r.status === 'pending_review',
    ledgerTxnId: r.ledger_txn_id,
    createdAt: r.created_at,
    completedAt: r.completed_at,
    sandbox: true,
  }
}

export function listTxns(userId: string, o: { limit?: number; type?: string; status?: string; before?: number } = {}) {
  const where = ['user_id=?']
  const args: (string | number)[] = [userId]
  if (o.type) { where.push('type LIKE ?'); args.push(`${o.type}%`) }
  if (o.status) { where.push('status=?'); args.push(o.status) }
  if (o.before) { where.push('created_at<?'); args.push(o.before) }
  return all<TxnRow>(`SELECT * FROM transactions WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?`, ...args, Math.min(o.limit ?? 30, 100)).map(txnView)
}
