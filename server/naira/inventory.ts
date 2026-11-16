/**
 * Stock and seat reservations for shopping and flights. A reservation is taken in the same database transaction as the
 * payment reservation, and given back if the payment is reversed. Counters only move through guarded UPDATEs, so two
 * buyers can never take the last unit.
 */
import { HttpError } from '../auth'
import { all, get, now, run } from '../db'

interface SeatOffer { id: string; seats: number }

const HOLD = 'INSERT INTO inventory_holds(txn_id, kind, item_id, qty, created_at) VALUES (?,?,?,?,?)'

export async function reserveStock(txnId: string, productId: string, productName: string, qty: number) {
  const r = await run('UPDATE shop_products SET stock=stock-? WHERE id=? AND active=1 AND stock>=?', qty, productId, qty)
  if (r.changes !== 1) {
    const left = (await get<{ stock: number }>('SELECT stock FROM shop_products WHERE id=?', productId))?.stock ?? 0
    throw new HttpError(400, `Only ${left} of ${productName} left`)
  }
  await run(HOLD, txnId, 'stock', productId, qty, now())
}

/** Seats still free on an offer. Offers are generated, so the first look records the capacity. */
export async function availableSeats(offer: SeatOffer): Promise<number> {
  const row = await get<{ capacity: number; taken: number }>('SELECT capacity, taken FROM flight_seats WHERE offer_id=?', offer.id)
  return row ? Math.max(0, row.capacity - row.taken) : offer.seats
}

export async function reserveSeats(txnId: string, offer: SeatOffer, n: number) {
  await run('INSERT OR IGNORE INTO flight_seats(offer_id, capacity, taken) VALUES (?,?,0)', offer.id, offer.seats)
  const r = await run('UPDATE flight_seats SET taken=taken+? WHERE offer_id=? AND taken+?<=capacity', n, offer.id, n)
  if (r.changes !== 1) throw new HttpError(400, 'Not enough seats on that flight')
  await run(HOLD, txnId, 'seat', offer.id, n, now())
}

/** Gives back everything a payment reserved. Safe to call twice. */
export async function releaseHolds(txnId: string) {
  for (const h of await all<{ id: number; kind: string; item_id: string; qty: number }>('SELECT id, kind, item_id, qty FROM inventory_holds WHERE txn_id=? AND released=0', txnId)) {
    if (h.kind === 'stock') await run('UPDATE shop_products SET stock=stock+? WHERE id=?', h.qty, h.item_id)
    else await run('UPDATE flight_seats SET taken=GREATEST(0, taken-?) WHERE offer_id=?', h.qty, h.item_id)
    await run('UPDATE inventory_holds SET released=1 WHERE id=?', h.id)
  }
}
