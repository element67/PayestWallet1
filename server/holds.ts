/**
 * First-time counterparty hold. A payout that leaves the platform (crypto withdrawal, buy delivered to an outside address,
 * sell paid to a bank account, Naira bank transfer) to a destination this user has not used before waits out a cooling period
 * when it is at or above a threshold. The customer can cancel with their PIN; a founder can release or cancel in the admin area.
 * There is no early release by the customer.
 *
 * A destination is trusted only after a payout to it completed AND it has existed for longer than the hold window, so a tiny first
 * payment cannot be used to launder a destination in a single session.
 */
import { createHash } from 'node:crypto'
import { HttpError } from './auth'
import { all, audit, get, notify, now, run, setting, tx, uid } from './db'
import { fromUnits } from './money'
import { every } from './timers'

export type HoldKind = 'withdrawal' | 'naira_bank' | 'bank_payout' | 'buy_release'
export type HoldStatus = 'held' | 'released' | 'cancelled'

export interface HoldRow {
  id: string
  user_id: string
  kind: HoldKind
  ref_id: string
  cp_key: string
  cp_label: string
  amount_kobo: string
  status: HoldStatus
  release_at: string
  created_at: string
  resolved_at: string | null
  resolved_by: string | null
  note: string | null
}

interface HoldHandlers {
  /** Continue the payout (and call markPaid once money has really gone out). Runs after the hold row is marked released. */
  onRelease: (hold: HoldRow) => Promise<void>
  /** Undo the payout and give the customer their money or their choice back. Runs after the hold row is marked cancelled. */
  onCancel: (hold: HoldRow, reason: string) => Promise<void>
}
const handlers = new Map<HoldKind, HoldHandlers>()
export const registerHold = (kind: HoldKind, h: HoldHandlers) => handlers.set(kind, h)

const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 40)

/** Destination keys are hashed so the table never holds a full account number. Crypto addresses are matched case-insensitively for EVM. */
export const cryptoKey = (addr: string) => `crypto:${sha(addr.startsWith('0x') ? addr.toLowerCase() : addr)}`
export const bankKey = (bankName: string, accountNumber: string) => `bank:${sha(`${bankName.trim().toLowerCase()}:${accountNumber.replace(/\D/g, '')}`)}`
export const cryptoLabel = (asset: string, addr: string) => `${asset} ${addr.slice(0, 6)}…${addr.slice(-4)}`
export const bankLabel = (bankName: string, last4: string) => `${bankName} ••${last4}`

export async function holdWindowMs(kycTier: number): Promise<number> {
  const hours = Number(await setting(kycTier >= 2 ? 'hold_hours_tier2' : 'hold_hours_default'))
  return (Number.isFinite(hours) && hours > 0 ? hours : 24) * 3_600_000
}

export interface HoldInput {
  userId: string
  kycTier: number
  kind: HoldKind
  refId: string
  cpKey: string
  cpLabel: string
  cpKind: 'crypto' | 'bank'
  amountKobo: bigint
}

/**
 * Decides whether this payout must wait. Call it inside the same database transaction that records the payout, so the hold and the
 * payout state can never disagree. Returns the release time when it was held.
 */
export async function assessHold(i: HoldInput): Promise<{ held: false } | { held: true; releaseAt: number; id: string }> {
  // A payout that was already held and then released is cleared for good: never hold it a second time.
  const prior = await get<{ id: string; status: string; release_at: string }>('SELECT id, status, release_at FROM payout_holds WHERE kind=? AND ref_id=?', i.kind, i.refId)
  if (prior) return prior.status === 'held' ? { held: true, releaseAt: Number(prior.release_at), id: prior.id } : { held: false }
  // Remember every destination the first time it is seen. Seeing it is not trust: trust needs a completed payout plus time.
  await run(
    'INSERT OR IGNORE INTO counterparties(user_id, cp_key, kind, label, first_seen_at, paid_count) VALUES (?,?,?,?,?,0)',
    i.userId, i.cpKey, i.cpKind, i.cpLabel, now(),
  )
  if (await setting('holds_enabled') !== 'true') return { held: false }
  if (i.amountKobo < BigInt(await setting('hold_threshold_kobo'))) return { held: false }
  const window = await holdWindowMs(i.kycTier)
  const cp = await get<{ first_seen_at: string; paid_count: number }>('SELECT first_seen_at, paid_count FROM counterparties WHERE user_id=? AND cp_key=?', i.userId, i.cpKey)
  if (cp && cp.paid_count > 0 && now() - Number(cp.first_seen_at) >= window) return { held: false }
  const id = uid('hold')
  const releaseAt = now() + window
  await run(
    `INSERT INTO payout_holds(id,user_id,kind,ref_id,cp_key,cp_label,amount_kobo,status,release_at,created_at) VALUES (?,?,?,?,?,?,?,'held',?,?)`,
    id, i.userId, i.kind, i.refId, i.cpKey, i.cpLabel, i.amountKobo.toString(), releaseAt, now(),
  )
  return { held: true, releaseAt, id }
}

/** Call when a payout to this destination actually went out. */
export async function markPaid(userId: string, cpKey: string) {
  await run('UPDATE counterparties SET paid_count = paid_count + 1, last_paid_at=? WHERE user_id=? AND cp_key=?', now(), userId, cpKey)
}

/** Tells the customer a payout is waiting. Call after the transaction that created the hold has committed. */
export async function announceHold(userId: string, label: string, amountKobo: bigint, releaseAt: number) {
  const when = new Date(releaseAt).toUTCString().replace(' GMT', ' UTC')
  await notify(userId, 'security', 'Payout on hold for your safety', `NGN ${fromUnits(amountKobo, 2)} to ${label} is a first-time destination, so it is held until ${when}. You can cancel it with your PIN before then.`)
}

async function resolve(id: string, status: 'released' | 'cancelled', by: string, note: string): Promise<HoldRow> {
  const claimed = await run("UPDATE payout_holds SET status=?, resolved_at=?, resolved_by=?, note=? WHERE id=? AND status='held'", status, now(), by, note, id)
  if (claimed.changes !== 1) throw new HttpError(409, 'That payout is no longer on hold')
  return await get<HoldRow>('SELECT * FROM payout_holds WHERE id=?', id) as HoldRow
}

export async function releaseHold(id: string, by: string): Promise<HoldRow> {
  const h = await tx(async () => {
    const row = await resolve(id, 'released', by, by === 'system' ? 'Hold period ended' : 'Released by a founder')
    await handlers.get(row.kind)?.onRelease(row)
    return row
  })
  await audit(by === 'system' ? null : by, 'hold.released', h.id, undefined, { kind: h.kind, ref: h.ref_id })
  return h
}

export async function cancelHold(id: string, by: string, reason: string): Promise<HoldRow> {
  const h = await tx(async () => {
    const row = await resolve(id, 'cancelled', by, reason)
    await handlers.get(row.kind)?.onCancel(row, reason)
    return row
  })
  await audit(by === 'system' ? null : by, 'hold.cancelled', h.id, undefined, { kind: h.kind, ref: h.ref_id, reason })
  await notify(h.user_id, 'security', 'Held payout cancelled', `The payout to ${h.cp_label} was cancelled. ${reason}`)
  return h
}

/** Releases every hold whose time is up, unless the account is frozen or the wallet is under review. */
export async function releaseDueHolds() {
  const due = await all<{ id: string; user_id: string }>("SELECT id, user_id FROM payout_holds WHERE status='held' AND release_at<=? ORDER BY release_at LIMIT 25", now())
  for (const d of due) {
    const u = await get<{ status: string }>('SELECT status FROM users WHERE id=?', d.user_id)
    const w = await get<{ status: string }>('SELECT status FROM naira_wallets WHERE user_id=?', d.user_id)
    if (!u || u.status !== 'active' || w?.status === 'frozen') continue // stays held until a person looks at it
    try {
      await releaseHold(d.id, 'system')
    } catch (e) {
      if (!(e instanceof HttpError)) console.error('[holds] release failed', d.id, e instanceof Error ? e.message : e)
    }
  }
}

export const startHoldSweeper = () => every('release-holds', 30_000, releaseDueHolds)

export async function listHolds(userId: string) {
  const rows = await all<HoldRow>("SELECT * FROM payout_holds WHERE user_id=? AND (status='held' OR resolved_at>?) ORDER BY created_at DESC LIMIT 20", userId, now() - 7 * 86_400_000)
  return rows.map(holdView)
}

export const holdView = (h: HoldRow) => ({
  id: h.id, kind: h.kind, label: h.cp_label, amountKobo: h.amount_kobo, status: h.status,
  releaseAt: Number(h.release_at), createdAt: Number(h.created_at), resolvedAt: h.resolved_at ? Number(h.resolved_at) : null, note: h.note,
})
