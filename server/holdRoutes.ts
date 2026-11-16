import { z } from 'zod'
import { HttpError } from './auth'
import { all, get } from './db'
import { cancelHold, holdView, listHolds, releaseHold, type HoldRow } from './holds'
import { body, route } from './http'
import { verifyPin } from './naira/wallet'

/** The customer's own held payouts. */
route('GET', '/api/holds', 'user', async (c) => ({ holds: await listHolds(c.user.id) }))

/** Cancel with the PIN. Nobody can release early from the customer side. */
route('POST', '/api/holds/:id/cancel', 'user', async (c) => {
  const b = body(c, z.object({ pin: z.string().regex(/^\d{4}$/) }))
  const h = await get<HoldRow>('SELECT * FROM payout_holds WHERE id=? AND user_id=?', c.params.id, c.user.id)
  if (!h) throw new HttpError(404, 'Held payout not found')
  if (h.status !== 'held') throw new HttpError(409, 'That payout is no longer on hold')
  await verifyPin(c.user.id, b.pin)
  const done = await cancelHold(h.id, c.user.id, 'You cancelled it.')
  return { hold: holdView(done) }
}, [10, 60_000])

/* ---------------- founder ---------------- */

route('GET', '/api/admin/holds', 'founder', async (c) => {
  const status = c.url.searchParams.get('status')
  const rows = await all<HoldRow & { email: string; name: string }>(
    `SELECT h.*, u.email, u.name FROM payout_holds h JOIN users u ON u.id=h.user_id
     ${status ? 'WHERE h.status=?' : ''} ORDER BY (h.status='held') DESC, h.created_at DESC LIMIT 100`,
    ...(status ? [status] : []),
  )
  return { holds: rows.map((r) => ({ ...holdView(r), userId: r.user_id, email: r.email, name: r.name, resolvedBy: r.resolved_by, ref: r.ref_id })) }
})

route('POST', '/api/admin/holds/:id/release', 'founder', async (c) => ({ hold: holdView(await releaseHold(c.params.id, c.user.id)) }), [30, 60_000])

route('POST', '/api/admin/holds/:id/cancel', 'founder', async (c) => {
  const b = body(c, z.object({ reason: z.string().trim().min(3).max(200) }))
  return { hold: holdView(await cancelHold(c.params.id, c.user.id, `Cancelled by a founder: ${b.reason}`)) }
}, [30, 60_000])
