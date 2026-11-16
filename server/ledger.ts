/**
 * Double-entry ledger. Entries are immutable (database triggers reject UPDATE and DELETE).
 * Every movement writes balanced entries that share a txn_id and sum to zero per asset, so money is never
 * created or destroyed. The `balances` table is a derived cache that is updated in the same database
 * transaction as the entries, and `verifyLedger()` recomputes it from the entries.
 * Owners: a user id, 'house' (platform liquidity) or a 'sys:*' account.
 */
import { all, get, now, run, uid, tx } from './db'

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
export async function balanceOf(owner: string, asset: string): Promise<bigint> {
  // NUMERIC sums are exact at any size (18-decimal token amounts exceed 64-bit integers).
  const r = await get<{ total: string }>("SELECT COALESCE(SUM(delta), 0) AS total FROM ledger_entries WHERE owner=? AND asset=? AND status='confirmed'", owner, asset)
  return BigInt(r?.total ?? '0')
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

async function writeEntry(e: Entry) {
  const next = await balanceOf(e.owner, e.asset) + e.delta
  if (next < 0n && !e.allowNegative && !isSystem(e.owner)) throw new InsufficientFunds(e.owner, e.asset)
  await run(
    "INSERT INTO ledger_entries(owner, asset, delta, balance_after, reason, order_id, idem_key, created_at, txn_id, side, status) VALUES (?,?,?,?,?,?,?,?,?,?,'confirmed')",
    e.owner, e.asset, e.delta.toString(), next.toString(), e.reason, e.orderId ?? null, e.idemKey, now(), e.txnId, e.delta >= 0n ? 'credit' : 'debit',
  )
}

/**
 * Move `amount` from one account to another as two balanced entries.
 * Returns the ledger txn id, or null when this idempotency key was already applied (nothing happens).
 */
export async function move(m: {
  from: string
  to: string
  asset: string
  amount: bigint
  reason: string
  idem: string
  txnId?: string
  orderId?: string
  allowNegativeFrom?: boolean
}): Promise<string | null> {
  if (m.amount <= 0n) throw new Error('Ledger amount must be positive')
  if (m.from === m.to) throw new Error('Ledger accounts must differ')
  return await tx(async () => {
    if (await get('SELECT 1 FROM ledger_entries WHERE idem_key=?', `${m.idem}:dr`)) return null
    const txnId = m.txnId ?? uid('ltx')
    await writeEntry({ owner: m.from, asset: m.asset, delta: -m.amount, reason: m.reason, idemKey: `${m.idem}:dr`, txnId, orderId: m.orderId, allowNegative: m.allowNegativeFrom })
    await writeEntry({ owner: m.to, asset: m.asset, delta: m.amount, reason: m.reason, idemKey: `${m.idem}:cr`, txnId, orderId: m.orderId })
    return txnId
  })
}

/**
 * Single-sided convenience for flows that are not yet modelled with an explicit counter-party
 * (seeding, crypto vault releases). The other side is always the suspense account, so entries still balance.
 */
export async function post(e: {
  owner: string
  asset: string
  delta: bigint
  reason: string
  idem: string
  orderId?: string
  allowNegative?: boolean
}): Promise<boolean> {
  if (e.delta === 0n) return false
  return await tx(async () => {
    if (await get('SELECT 1 FROM ledger_entries WHERE idem_key=?', e.idem)) return false
    const txnId = uid('ltx')
    await writeEntry({ owner: e.owner, asset: e.asset, delta: e.delta, reason: e.reason, idemKey: e.idem, txnId, orderId: e.orderId, allowNegative: e.allowNegative })
    await writeEntry({ owner: SYS.suspense, asset: e.asset, delta: -e.delta, reason: `mirror: ${e.reason}`, idemKey: `${e.idem}#cp`, txnId, orderId: e.orderId })
    return true
  })
}

export async function balancesFor(owner: string): Promise<Record<string, bigint>> {
  const out: Record<string, bigint> = {}
  for (const r of await all<{ asset: string; total: string }>("SELECT asset, SUM(delta) AS total FROM ledger_entries WHERE owner=? AND status='confirmed' GROUP BY asset", owner)) {
    out[r.asset] = BigInt(r.total)
  }
  return out
}

/** Books a platform fee from the liquidity pool to the fee account. Idempotent per key; skipped for a zero fee. */
export async function bookFee(m: { asset: string; amount: bigint; idem: string; orderId?: string; reason?: string }): Promise<string | null> {
  if (m.amount <= 0n) return null
  return await move({ from: 'house', to: SYS.fees, asset: m.asset, amount: m.amount, reason: m.reason ?? 'exchange fee', idem: m.idem, orderId: m.orderId, allowNegativeFrom: true })
}

/** Exchange and swap fees booked so far (credits to the fee account whose key starts with `fee:`), straight from the ledger. */
export async function exchangeFeesBooked(): Promise<bigint> {
  const r = await get<{ total: string }>("SELECT COALESCE(SUM(delta), 0) AS total FROM ledger_entries WHERE owner=? AND status='confirmed' AND idem_key LIKE 'fee:%'", SYS.fees)
  return BigInt(r?.total ?? '0')
}

/** Integrity report: every txn must net to zero per asset, and the running balance on each account's last entry must equal the sum of its entries. */
export async function verifyLedger() {
  const unbalanced = (await all<{ txn_id: string; asset: string; net: string }>(
    'SELECT txn_id, asset, SUM(delta) AS net FROM ledger_entries GROUP BY txn_id, asset HAVING SUM(delta) <> 0',
  )).map((r) => ({ txn_id: String(r.txn_id), asset: r.asset, net: BigInt(r.net).toString() }))
  const mismatched = (await all<{ owner: string; asset: string; computed: string; cached: string }>(
    `SELECT owner, asset, computed, cached FROM (
       SELECT l.owner, l.asset, SUM(l.delta) AS computed,
              (SELECT x.balance_after FROM ledger_entries x WHERE x.owner=l.owner AND x.asset=l.asset AND x.status='confirmed' ORDER BY x.id DESC LIMIT 1) AS cached
         FROM ledger_entries l WHERE l.status='confirmed' GROUP BY l.owner, l.asset) t
      WHERE computed <> cached`,
  )).map((r) => ({ owner: r.owner, asset: r.asset, computed: BigInt(r.computed).toString(), cached: BigInt(r.cached).toString() }))
  const entries = ((await get<{ c: number }>('SELECT COUNT(*) c FROM ledger_entries'))?.c) ?? 0
  return { ok: unbalanced.length === 0 && mismatched.length === 0, entries, unbalanced, mismatched }
}
