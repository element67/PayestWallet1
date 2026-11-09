/**
 * Double-entry ledger. Entries are immutable (database triggers reject UPDATE and DELETE).
 * Every movement writes balanced entries that share a txn_id and sum to zero per asset, so money is never
 * created or destroyed. The `balances` table is a derived cache that is updated in the same database
 * transaction as the entries, and `verifyLedger()` recomputes it from the entries.
 * Owners: a user id, 'house' (platform liquidity) or a 'sys:*' account.
 */
import { db, get, now, run, uid } from './db'

export const SYS = {
  suspense: 'sys:suspense', // counter-account for legacy single-sided postings
  holding: 'sys:holding', // funds reserved while a provider call is in flight
  fees: 'sys:fees', // platform fee revenue
  bank: 'sys:bank-settlement', // paid out to banks (sandbox)
  bills: 'sys:bill-payables', // paid to bill providers (sandbox)
  external: 'sys:external', // sandbox inbound bank money
  adjustments: 'sys:adjustments', // audited founder adjustments
  mint: 'sys:sandbox-mint', // sandbox starter and top-up funds
} as const

const isSystem = (owner: string) => owner === 'house' || owner.startsWith('sys:')

export class InsufficientFunds extends Error {
  constructor(public owner: string, public asset: string) {
    super(`Insufficient ${asset} balance for ${isSystem(owner) ? 'platform liquidity' : 'account'}`)
  }
}

/**
 * A balance is never stored or edited: it is the sum of the account's CONFIRMED ledger entries, read straight from
 * the immutable ledger. Nothing can change a balance without writing a ledger entry.
 */
export function balanceOf(owner: string, asset: string): bigint {
  const r = get<{ total: number | null }>(
    "SELECT SUM(CAST(delta AS INTEGER)) AS total FROM ledger_entries WHERE owner=? AND asset=? AND status='confirmed'",
    owner, asset,
  )
  return BigInt(r?.total ?? 0)
}

interface Entry {
  owner: string
  asset: string
  delta: bigint
  reason: string
  idemKey: string
  txnId: string
  orderId?: string
  allowNegative?: boolean
}

function writeEntry(e: Entry) {
  const next = balanceOf(e.owner, e.asset) + e.delta
  if (next < 0n && !e.allowNegative && !isSystem(e.owner)) throw new InsufficientFunds(e.owner, e.asset)
  run(
    "INSERT INTO ledger_entries(owner, asset, delta, balance_after, reason, order_id, idem_key, created_at, txn_id, side, status) VALUES (?,?,?,?,?,?,?,?,?,?,'confirmed')",
    e.owner, e.asset, e.delta.toString(), next.toString(), e.reason, e.orderId ?? null, e.idemKey, now(), e.txnId, e.delta >= 0n ? 'credit' : 'debit',
  )
}

/**
 * Move `amount` from one account to another as two balanced entries.
 * Returns the ledger txn id, or null when this idempotency key was already applied (nothing happens).
 */
export function move(m: {
  from: string
  to: string
  asset: string
  amount: bigint
  reason: string
  idem: string
  txnId?: string
  orderId?: string
  allowNegativeFrom?: boolean
}): string | null {
  if (m.amount <= 0n) throw new Error('Ledger amount must be positive')
  if (m.from === m.to) throw new Error('Ledger accounts must differ')
  return db.transaction(() => {
    if (get('SELECT 1 FROM ledger_entries WHERE idem_key=?', `${m.idem}:dr`)) return null
    const txnId = m.txnId ?? uid('ltx')
    writeEntry({ owner: m.from, asset: m.asset, delta: -m.amount, reason: m.reason, idemKey: `${m.idem}:dr`, txnId, orderId: m.orderId, allowNegative: m.allowNegativeFrom })
    writeEntry({ owner: m.to, asset: m.asset, delta: m.amount, reason: m.reason, idemKey: `${m.idem}:cr`, txnId, orderId: m.orderId })
    return txnId
  })()
}

/**
 * Single-sided convenience for flows that are not yet modelled with an explicit counter-party
 * (seeding, crypto vault releases). The other side is always the suspense account, so entries still balance.
 */
export function post(e: {
  owner: string
  asset: string
  delta: bigint
  reason: string
  idem: string
  orderId?: string
  allowNegative?: boolean
}): boolean {
  if (e.delta === 0n) return false
  return db.transaction(() => {
    if (get('SELECT 1 FROM ledger_entries WHERE idem_key=?', e.idem)) return false
    const txnId = uid('ltx')
    writeEntry({ owner: e.owner, asset: e.asset, delta: e.delta, reason: e.reason, idemKey: e.idem, txnId, orderId: e.orderId, allowNegative: e.allowNegative })
    writeEntry({ owner: SYS.suspense, asset: e.asset, delta: -e.delta, reason: `mirror: ${e.reason}`, idemKey: `${e.idem}#cp`, txnId, orderId: e.orderId })
    return true
  })()
}

export function balancesFor(owner: string): Record<string, bigint> {
  const out: Record<string, bigint> = {}
  for (const r of db
    .query("SELECT asset, SUM(CAST(delta AS INTEGER)) AS total FROM ledger_entries WHERE owner=? AND status='confirmed' GROUP BY asset")
    .all(owner) as { asset: string; total: number }[]) {
    out[r.asset] = BigInt(r.total)
  }
  return out
}

/** Integrity report: every txn must net to zero per asset, and cached balances must equal the sum of their entries. */
export function verifyLedger() {
  const unbalanced = db
    .query('SELECT txn_id, asset, SUM(CAST(delta AS INTEGER)) AS net FROM ledger_entries GROUP BY txn_id, asset HAVING net != 0')
    .all() as { txn_id: string; asset: string; net: number }[]
  // The running balance written on each entry must equal the sum of confirmed entries up to it.
  const mismatched = db
    .query(
      `SELECT l.owner, l.asset, SUM(CAST(l.delta AS INTEGER)) AS computed,
              CAST((SELECT balance_after FROM ledger_entries x WHERE x.owner=l.owner AND x.asset=l.asset AND x.status='confirmed' ORDER BY x.id DESC LIMIT 1) AS INTEGER) AS cached
         FROM ledger_entries l WHERE l.status='confirmed'
        GROUP BY l.owner, l.asset HAVING computed != cached`,
    )
    .all() as { owner: string; asset: string; computed: number; cached: number }[]
  const entries = (db.query('SELECT COUNT(*) c FROM ledger_entries').get() as { c: number }).c
  return { ok: unbalanced.length === 0 && mismatched.length === 0, entries, unbalanced, mismatched }
}
