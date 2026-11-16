import { describe, expect, test } from 'bun:test'
import { PIN, fundNgn, makeUser, mustReject } from '../helpers'
import { AIRPORTS, searchFlights } from '../../server/naira/catalog'
import { startCheckout, startFlight } from '../../server/naira/bills'
import { availableSeats } from '../../server/naira/inventory'
import { reverseReservation } from '../../server/naira/pay'
import { getTxn } from '../../server/naira/txns'
import { get, run, uid } from '../../server/db'
import { balanceOf } from '../../server/ledger'

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)
const stock = async (id: string) => (await get<{ stock: number }>('SELECT stock FROM shop_products WHERE id=?', id))?.stock ?? -1
const product = async () => (await get<{ id: string }>("SELECT id FROM shop_products WHERE kind<>'physical' AND active=1 ORDER BY id LIMIT 1"))?.id as string
const rich = async () => {
  const u = await makeUser({ pin: true })
  await fundNgn(u.id, 500_000_000n)
  return u
}

describe('NB-17 shop stock is taken at checkout and returned on reversal', () => {
  test('stock goes down by the quantity bought and comes back when the payment is reversed', async () => {
    const u = await rich()
    const pid = await product()
    const before = await stock(pid)
    const r = await startCheckout(u, { items: [{ productId: pid, qty: 3 }], pin: PIN, idem: uid('idem') + 'xxxx' })
    expect(await stock(pid)).toBe(before - 3)
    await reverseReservation(await getTxn(r.txn.id) as NonNullable<Awaited<ReturnType<typeof getTxn>>>, 'test reversal')
    expect(await stock(pid)).toBe(before)
    await reverseReservation(await getTxn(r.txn.id) as NonNullable<Awaited<ReturnType<typeof getTxn>>>, 'twice')
  })

  test('the last units cannot be sold twice, and a refused order leaves stock and money alone', async () => {
    const u = await rich()
    const pid = await product()
    const left = await stock(pid)
    await startCheckout(u, { items: [{ productId: pid, qty: left }], pin: PIN, idem: uid('idem') + 'aaaa' })
    expect(await stock(pid)).toBe(0)
    const ngn = await balanceOf(u.id, 'NGN')
    await mustReject(startCheckout(u, { items: [{ productId: pid, qty: 1 }], pin: PIN, idem: uid('idem') + 'bbbb' }))
    expect(await stock(pid)).toBe(0)
    expect(await balanceOf(u.id, 'NGN')).toBe(ngn)
  })
})

describe('NB-17 flights: return leg checks and seat counts', () => {
  const [a, b] = [AIRPORTS[0].code as string, AIRPORTS[1].code as string]
  const pax = [{ firstName: 'Ada', lastName: 'Obi' }]
  const book = async (u: Awaited<ReturnType<typeof makeUser>>, offerId: string, returnOfferId?: string) =>
    await startFlight(u, { offerId, returnOfferId, passengers: pax, contactPhone: '08012345678', pin: PIN, idem: uid('idem') + 'ffff' })

  test('the return flight must be the reverse route, on or after the outbound date', async () => {
    const u = await rich()
    const out = searchFlights(a, b, day(10))[0]
    await mustReject(book(u, out.id, searchFlights(a, b, day(12))[0].id)) // same direction
    await mustReject(book(u, out.id, searchFlights(b, a, day(5))[0].id)) // before outbound
    await mustReject(book(u, out.id, out.id))
  })

  test('both legs lose a seat, and both get it back on reversal', async () => {
    const u = await rich()
    const out = searchFlights(a, b, day(10))[0]
    const back = searchFlights(b, a, day(14))[0]
    const [o0, b0] = [await availableSeats(out), await availableSeats(back)]
    const r = await book(u, out.id, back.id)
    expect(await availableSeats(out)).toBe(o0 - 1)
    expect(await availableSeats(back)).toBe(b0 - 1)
    await reverseReservation(await getTxn(r.txn.id) as NonNullable<Awaited<ReturnType<typeof getTxn>>>, 'test reversal')
    expect(await availableSeats(out)).toBe(o0)
    expect(await availableSeats(back)).toBe(b0)
  })

  test('a sold-out return flight refuses the booking and takes no money or outbound seat', async () => {
    const u = await rich()
    const out = searchFlights(a, b, day(20))[0]
    const back = searchFlights(b, a, day(24))[0]
    await run('INSERT OR IGNORE INTO flight_seats(offer_id, capacity, taken) VALUES (?,?,0)', back.id, back.seats)
    await run('UPDATE flight_seats SET taken=capacity WHERE offer_id=?', back.id)
    expect(await availableSeats(back)).toBe(0)
    const [seats, ngn] = [await availableSeats(out), await balanceOf(u.id, 'NGN')]
    await mustReject(book(u, out.id, back.id))
    expect(await availableSeats(out)).toBe(seats)
    expect(await balanceOf(u.id, 'NGN')).toBe(ngn)
  })
})
