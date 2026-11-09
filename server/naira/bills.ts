/** Bills & services: airtime, data, electricity, cable TV, water, internet, education, flights and shopping. */
import { createHash } from 'node:crypto'
import { HttpError, type User } from '../auth'
import { all, get, now, run, setting, uid } from '../db'
import { toUnits } from '../money'
import { AIRPORTS, SHOP_SEED, getCategory, getOffer, packagesFor, searchFlights, type Category } from './catalog'
import { registerFulfiller, startPayment } from './pay'
import { billProvider } from './providers'

for (const p of SHOP_SEED) {
  run('INSERT OR IGNORE INTO shop_products(id,category,name,description,price_kobo,kind) VALUES (?,?,?,?,?,?)', p.id, p.category, p.name, p.description, String(p.price), p.kind)
}

const billFee = () => BigInt(setting('bill_fee_kobo'))
const sha = (s: string) => createHash('sha256').update(s).digest('hex')

function insertOrder(txnId: string, userId: string, o: { category: string; provider: string; product?: string; customerRef?: string; customerName?: string; amount: bigint; fee: bigint; payload: Record<string, unknown> }) {
  run(
    `INSERT INTO bills_orders(id,user_id,transaction_id,category,provider,product,customer_ref,customer_name,amount_kobo,fee_kobo,status,payload,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,'processing',?,?,?)`,
    uid('bill'), userId, txnId, o.category, o.provider, o.product ?? null, o.customerRef ?? null, o.customerName ?? null, o.amount.toString(), o.fee.toString(), JSON.stringify(o.payload), now(), now(),
  )
}

/* ---------------- standard bills ---------------- */

function checkBillInput(cat: Category, b: { provider: string; customerRef: string; variant?: string }) {
  if (!cat.providers.some((p) => p.id === b.provider)) throw new HttpError(400, 'Choose a provider')
  if (cat.variants && !cat.variants.some((v) => v.id === b.variant)) throw new HttpError(400, 'Choose an account type')
  if (!new RegExp(cat.customerPattern).test(b.customerRef)) throw new HttpError(400, `Enter a valid ${cat.customerLabel.toLowerCase()}`)
}

export function verifyCustomer(categoryId: string, b: { provider: string; customerRef: string; variant?: string }) {
  const cat = getCategory(categoryId)
  if (!cat) throw new HttpError(404, 'Unknown service')
  checkBillInput(cat, b)
  if (!cat.verify) return { verified: false, customerName: null, detail: null, sandbox: true }
  const r = billProvider.validate(cat.id, b.provider, b.customerRef)
  if (!r) throw new HttpError(404, `We could not verify this ${cat.customerLabel.toLowerCase()}. Check it and try again.`)
  return { verified: true, customerName: r.name, detail: r.detail ?? null, sandbox: true, provider: billProvider.label }
}

export function startBill(user: User, categoryId: string, b: { provider: string; customerRef: string; variant?: string; packageId?: string; amount?: bigint; pin: unknown; idem: string }) {
  const cat = getCategory(categoryId)
  if (!cat) throw new HttpError(404, 'Unknown service')
  checkBillInput(cat, b)
  const v = verifyCustomer(categoryId, b) // re-verified on the server at payment time
  let amount: bigint
  let product: string | undefined = b.variant
  if (cat.mode === 'package') {
    const pkg = packagesFor(cat, b.provider).find((p) => p.id === b.packageId)
    if (!pkg) throw new HttpError(400, 'Choose a package')
    amount = BigInt(pkg.priceKobo)
    product = `${pkg.label}${pkg.validity ? ` · ${pkg.validity}` : ''}`
  } else {
    if (b.amount === undefined) throw new HttpError(400, 'Enter an amount')
    amount = b.amount
    if (amount < BigInt(cat.minKobo ?? 0) || amount > BigInt(cat.maxKobo ?? 0)) {
      throw new HttpError(400, `Amount must be between NGN ${(cat.minKobo ?? 0) / 100} and NGN ${(cat.maxKobo ?? 0) / 100}`)
    }
  }
  const providerLabel = cat.providers.find((p) => p.id === b.provider)?.label ?? b.provider
  const fee = billFee()
  return startPayment({
    user, pin: b.pin, idem: b.idem, type: 'bill', title: `${cat.label}: ${providerLabel}`, amount, fee,
    counterparty: v.customerName ? `${v.customerName} · ${b.customerRef}` : b.customerRef,
    meta: { category: cat.id, categoryLabel: cat.label, provider: b.provider, providerLabel, customerRef: b.customerRef, customerName: v.customerName, address: v.detail, variant: b.variant, product, packageId: b.packageId },
    onCreate: (t) => insertOrder(t.id, user.id, { category: cat.id, provider: b.provider, product, customerRef: b.customerRef, customerName: v.customerName ?? undefined, amount, fee, payload: { variant: b.variant, packageId: b.packageId } }),
  })
}

registerFulfiller('bill', (t, m) => {
  const r = billProvider.purchase(t.reference, String(m.category), String(m.provider), String(m.customerRef), BigInt(t.amount_kobo), m.variant ? String(m.variant) : undefined)
  run(
    'INSERT OR IGNORE INTO provider_callbacks(provider, event_id, kind, payload, received_at, processed_at, result) VALUES (?,?,?,?,?,?,?)',
    billProvider.id, `${r.providerRef ?? t.reference}:${t.id}`, r.ok ? 'bill.completed' : 'bill.failed', JSON.stringify({ reference: t.reference, category: m.category }), now(), now(), r.ok ? 'ok' : (r.reason ?? 'failed'),
  )
  return r.ok ? { ok: true, providerRef: r.providerRef, meta: { token: r.token, units: r.units } } : { ok: false, reason: r.reason }
})

/* ---------------- flights (simulated inventory) ---------------- */

const AIRPORT_CODES = AIRPORTS.map((a) => a.code as string)

export function flightSearch(b: { from: string; to: string; date: string; returnDate?: string; passengers: number }) {
  if (!AIRPORT_CODES.includes(b.from) || !AIRPORT_CODES.includes(b.to)) throw new HttpError(400, 'Choose an origin and a destination')
  if (b.from === b.to) throw new HttpError(400, 'Origin and destination must differ')
  const today = new Date().toISOString().slice(0, 10)
  const max = new Date(Date.now() + 330 * 86_400_000).toISOString().slice(0, 10)
  for (const d of [b.date, b.returnDate].filter(Boolean) as string[]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d < today || d > max) throw new HttpError(400, 'Choose dates from today up to 11 months ahead')
  }
  if (b.returnDate && b.returnDate < b.date) throw new HttpError(400, 'The return date cannot be before departure')
  const price = (o: ReturnType<typeof searchFlights>[number]) => ({ ...o, priceEach: o.priceKobo / 100, total: (o.priceKobo * b.passengers) / 100 })
  return {
    outbound: searchFlights(b.from, b.to, b.date).map(price),
    inbound: b.returnDate ? searchFlights(b.to, b.from, b.returnDate).map(price) : [],
    passengers: b.passengers,
    simulated: true,
    note: 'Simulated inventory and prices (no airline is contacted).',
  }
}

export function startFlight(user: User, b: { offerId: string; returnOfferId?: string; passengers: { firstName: string; lastName: string }[]; contactPhone: string; pin: unknown; idem: string }) {
  const out = getOffer(b.offerId)
  const back = b.returnOfferId ? getOffer(b.returnOfferId) : undefined
  if (!out || (b.returnOfferId && !back)) throw new HttpError(400, 'That fare is no longer available. Search again.')
  if (out.date < new Date().toISOString().slice(0, 10)) throw new HttpError(400, 'That flight has already departed')
  const n = b.passengers.length
  if (n < 1 || n > 6) throw new HttpError(400, 'Between 1 and 6 passengers')
  if (out.seats < n) throw new HttpError(400, 'Not enough seats on that flight')
  const amount = BigInt(out.priceKobo + (back?.priceKobo ?? 0)) * BigInt(n)
  const fee = billFee()
  const route = `${out.from} to ${out.to}${back ? ' and back' : ''}`
  return startPayment({
    user, pin: b.pin, idem: b.idem, type: 'flight', title: `Flight ${route}`, amount, fee, counterparty: `${out.airline} ${out.flightNo}`,
    meta: { category: 'flight', route, outbound: out, inbound: back ?? null, passengers: b.passengers, contactPhone: b.contactPhone, simulated: true },
    onCreate: (t) => insertOrder(t.id, user.id, { category: 'flight', provider: out.airline, product: route, customerRef: b.contactPhone, customerName: `${b.passengers[0].firstName} ${b.passengers[0].lastName}`, amount, fee, payload: { offerId: b.offerId, returnOfferId: b.returnOfferId, passengers: b.passengers } }),
  })
}

registerFulfiller('flight', (t, m) => {
  if (String(m.contactPhone).endsWith('9999')) return { ok: false, reason: 'The airline rejected the booking (sandbox failure test).' }
  const pnr = sha(t.reference).slice(0, 6).toUpperCase()
  const pax = m.passengers as { firstName: string; lastName: string }[]
  return { ok: true, providerRef: `SBX-AIR-${pnr}`, meta: { pnr, tickets: pax.map((p, i) => ({ passenger: `${p.firstName} ${p.lastName}`, ticketNo: `SBX${sha(`${t.reference}${i}`).slice(0, 10).toUpperCase()}` })) } }
})

/* ---------------- shopping ---------------- */

export function listProducts(category?: string) {
  const rows = all<{ id: string; category: string; name: string; description: string; price_kobo: string; kind: string }>(
    category ? 'SELECT * FROM shop_products WHERE active=1 AND category=? ORDER BY price_kobo' : 'SELECT * FROM shop_products WHERE active=1 ORDER BY category, price_kobo', ...(category ? [category] : []),
  )
  return {
    categories: [...new Set(all<{ category: string }>('SELECT category FROM shop_products WHERE active=1 ORDER BY category').map((r) => r.category))],
    products: rows.map((r) => ({ id: r.id, category: r.category, name: r.name, description: r.description, price: Number(r.price_kobo) / 100, kind: r.kind })),
    simulated: true,
  }
}

export function startCheckout(user: User, b: { items: { productId: string; qty: number }[]; delivery?: { name: string; phone: string; address: string; city: string }; pin: unknown; idem: string }) {
  const lines = b.items.map((i) => {
    const p = get<{ id: string; name: string; price_kobo: string; kind: string; stock: number }>('SELECT * FROM shop_products WHERE id=? AND active=1', i.productId)
    if (!p) throw new HttpError(400, 'An item in your cart is no longer available')
    if (p.stock < i.qty) throw new HttpError(400, `Only ${p.stock} of ${p.name} left`)
    return { productId: p.id, name: p.name, kind: p.kind, qty: i.qty, unitKobo: BigInt(p.price_kobo) }
  })
  if (lines.some((l) => l.kind === 'physical') && !b.delivery) throw new HttpError(400, 'Add a delivery address for physical items')
  const amount = lines.reduce((s, l) => s + l.unitKobo * BigInt(l.qty), 0n) // always priced by the server
  const fee = billFee()
  return startPayment({
    user, pin: b.pin, idem: b.idem, type: 'shopping', title: `Shopping order (${lines.reduce((s, l) => s + l.qty, 0)} items)`, amount, fee,
    meta: { category: 'shopping', lines: lines.map((l) => ({ ...l, unitKobo: undefined, unit: Number(l.unitKobo) / 100 })), delivery: b.delivery ?? null, simulated: true },
    onCreate: (t) => insertOrder(t.id, user.id, { category: 'shopping', provider: 'Sandbox store', product: lines.map((l) => `${l.qty}× ${l.name}`).join(', '), amount, fee, payload: { items: b.items } }),
  })
}

registerFulfiller('shopping', (t, m) => {
  const lines = m.lines as { productId: string; name: string; kind: string; qty: number }[]
  const giftCodes = lines.filter((l) => l.kind === 'giftcard').flatMap((l) =>
    Array.from({ length: l.qty }, (_, i) => ({ product: l.name, code: sha(`${t.reference}${l.productId}${i}`).slice(0, 16).toUpperCase().match(/.{4}/g)?.join('-') })),
  )
  return { ok: true, providerRef: `SBX-SHOP-${sha(t.reference).slice(0, 8).toUpperCase()}`, meta: { giftCodes, shippingNote: lines.some((l) => l.kind === 'physical') ? 'Sandbox order: nothing is shipped.' : undefined } }
})

export { toUnits }
