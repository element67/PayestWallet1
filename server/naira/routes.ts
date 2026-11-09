/** Naira wallet API. Every route is tied to the signed-in user; no user id is ever read from the request. */
import { z } from 'zod'
import { HttpError } from '../auth'
import { all, audit, get, run, setting } from '../db'
import { body, route } from '../http'
import { fromUnits, toUnits } from '../money'
import { AIRPORTS, CATEGORIES } from './catalog'
import { deviceList } from './devices'
import { flightSearch, listProducts, startBill, startCheckout, startFlight, verifyCustomer } from './bills'
import { BANKS, PAYMENT_MODE } from './providers'
import { confirmPinReset, ensureNairaWallet, requestPinReset, setPin, walletView } from './wallet'
import { MIN_KOBO, deleteBeneficiary, internalTransfer, listBeneficiaries, searchRecipient, startBankTransfer, verifyBankAccount } from './transfers'
import { getTxn, listTxns, txnView } from './txns'

const idem = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'A valid idempotency key is required')
const pin = z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits')
const ngn = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, 'Enter a valid amount').transform((s) => toUnits(s, 2))
const text = (max: number) => z.string().trim().max(max)

/* ---------------- dashboard ---------------- */

route('GET', '/api/naira/overview', 'user', (c) => ({
  wallet: walletView(c.user.id),
  recent: listTxns(c.user.id, { limit: 6 }),
  pending: get<{ n: number }>("SELECT COUNT(*) n FROM transactions WHERE user_id=? AND status IN ('pending','processing','pending_review')", c.user.id)?.n ?? 0,
}), [90, 60_000])

route('GET', '/api/naira/config', 'user', () => ({
  mode: PAYMENT_MODE,
  minTransferNgn: fromUnits(MIN_KOBO, 2),
  banks: BANKS,
  categories: CATEGORIES,
  airports: AIRPORTS,
  hints: { notFound: 'Numbers ending in 0000 are not found', providerFailure: 'Numbers ending in 9999 fail at the provider and are refunded automatically' },
}))

/* ---------------- PIN, profile, devices ---------------- */

route('POST', '/api/naira/pin', 'user', (c) => {
  const b = body(c, z.object({ pin, currentPin: pin.optional() }))
  setPin(c.user.id, b.pin, b.currentPin)
  return { ok: true }
}, [6, 60_000])

route('POST', '/api/naira/pin/reset/request', 'user', (c) => {
  requestPinReset(c.user.id)
  return { ok: true, note: 'In the sandbox the code appears in your notifications. Production sends it by SMS or email.' }
}, [3, 60_000])

route('POST', '/api/naira/pin/reset/confirm', 'user', (c) => {
  const b = body(c, z.object({ otp: z.string().regex(/^\d{6}$/), pin }))
  confirmPinReset(c.user.id, b.otp, b.pin)
  return { ok: true }
}, [6, 60_000])

route('PUT', '/api/naira/profile', 'user', (c) => {
  const b = body(c, z.object({
    username: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]{2,19}$/, 'Username: 3 to 20 letters, numbers or underscores, starting with a letter').optional(),
    phone: z.string().trim().regex(/^0[789][01]\d{8}$/, 'Enter an 11-digit Nigerian phone number').optional(),
  }))
  try {
    if (b.username) run('UPDATE users SET username=? WHERE id=?', b.username, c.user.id)
    if (b.phone) run('UPDATE users SET phone=? WHERE id=?', b.phone, c.user.id)
  } catch {
    throw new HttpError(409, 'That username or phone number is already taken')
  }
  audit(c.user.id, 'profile.update', c.user.id)
  return walletView(c.user.id).profile
}, [6, 60_000])

route('GET', '/api/naira/devices', 'user', (c) => ({ devices: deviceList(c.user.id) }))

/* ---------------- funding (P2P only) ---------------- */

route('GET', '/api/naira/fund/options', 'user', () => {
  const gas = JSON.parse(setting('gas_fee_estimates') || '{}') as Record<string, string>
  return {
    method: 'p2p',
    note: 'The only way to fund your wallet is to sell crypto for Naira. Testnet assets only: nothing here has real value.',
    assets: all<{ symbol: string; name: string; chain: string; enabled: number; monitoring: string; sell_rate_kobo: string; min_ngn_kobo: string; max_ngn_kobo: string; decimals: number; rate_source: string }>(
      'SELECT * FROM assets WHERE enabled=1 ORDER BY COALESCE((SELECT sort FROM tokens WHERE tokens.symbol=assets.symbol), 999), symbol',
    ).map((a) => ({
      symbol: a.symbol, name: a.name, network: a.chain, enabled: Boolean(a.enabled), monitoring: a.monitoring, decimals: a.decimals,
      rate: fromUnits(BigInt(a.sell_rate_kobo), 2), minNgn: fromUnits(BigInt(a.min_ngn_kobo), 2), maxNgn: fromUnits(BigInt(a.max_ngn_kobo), 2),
      feeBps: Number(setting('fee_bps')), gasEstimate: gas[a.symbol] ?? null, rateSource: a.rate_source,
      testnet: true,
      chainMode: a.monitoring === 'live' ? 'Live testnet monitoring' : 'Sandbox network (simulated, not a real blockchain)',
    })),
  }
})

route('GET', '/api/naira/p2p', 'user', (c) => ({
  orders: all<{ id: string; exchange_order_id: string; asset: string; crypto_amount: string; expected_kobo: string; status: string; transaction_id: string | null; created_at: number }>(
    'SELECT * FROM p2p_orders WHERE user_id=? ORDER BY created_at DESC LIMIT 20', c.user.id,
  ).map((p) => ({ id: p.id, orderId: p.exchange_order_id, asset: p.asset, expected: fromUnits(BigInt(p.expected_kobo), 2), status: p.status, transactionId: p.transaction_id, createdAt: p.created_at })),
}))

/* ---------------- transfers ---------------- */

route('POST', '/api/naira/transfer/bank/verify', 'user', (c) => {
  const b = body(c, z.object({ bankCode: text(6), accountNumber: z.string().regex(/^\d{10}$/, 'Account number must be 10 digits') }))
  return verifyBankAccount(b.bankCode, b.accountNumber)
}, [20, 60_000])

route('POST', '/api/naira/transfer/bank', 'user', (c) => {
  const b = body(c, z.object({ bankCode: text(6), accountNumber: z.string().regex(/^\d{10}$/), amount: ngn, note: text(100).optional(), pin, idempotencyKey: idem, saveBeneficiary: z.boolean().optional() }))
  return startBankTransfer(c.user, { bankCode: b.bankCode, accountNumber: b.accountNumber, amount: b.amount, note: b.note, pin: b.pin, idem: b.idempotencyKey, save: b.saveBeneficiary })
}, [20, 60_000])

route('GET', '/api/naira/recipients/search', 'user', (c) => ({ recipient: searchRecipient(c.user, c.url.searchParams.get('q') ?? '') }), [15, 60_000])

route('POST', '/api/naira/transfer/internal', 'user', (c) => {
  const b = body(c, z.object({ recipientId: text(40), amount: ngn, note: text(100).optional(), pin, idempotencyKey: idem, saveBeneficiary: z.boolean().optional() }))
  return internalTransfer(c.user, { recipientId: b.recipientId, amount: b.amount, note: b.note, pin: b.pin, idem: b.idempotencyKey, save: b.saveBeneficiary })
}, [10, 60_000])

route('GET', '/api/naira/beneficiaries', 'user', (c) => ({ beneficiaries: listBeneficiaries(c.user.id) }))
route('DELETE', '/api/naira/beneficiaries/:id', 'user', (c) => {
  deleteBeneficiary(c.user.id, c.params.id)
  return { ok: true }
})

/* ---------------- bills & services ---------------- */

const billBase = z.object({ provider: text(40), customerRef: z.string().trim().min(3).max(20), variant: text(20).optional() })

route('POST', '/api/naira/bills/:category/verify', 'user', (c) => verifyCustomer(c.params.category, body(c, billBase)), [20, 60_000])

route('POST', '/api/naira/bills/:category/pay', 'user', (c) => {
  const b = body(c, billBase.extend({ packageId: text(40).optional(), amount: ngn.optional(), pin, idempotencyKey: idem }))
  return startBill(c.user, c.params.category, { provider: b.provider, customerRef: b.customerRef, variant: b.variant, packageId: b.packageId, amount: b.amount, pin: b.pin, idem: b.idempotencyKey })
}, [20, 60_000])

route('POST', '/api/naira/flights/search', 'user', (c) => {
  const b = body(c, z.object({ from: z.string().length(3), to: z.string().length(3), date: z.string(), returnDate: z.string().optional(), passengers: z.number().int().min(1).max(6) }))
  return flightSearch(b)
}, [20, 60_000])

route('POST', '/api/naira/flights/book', 'user', (c) => {
  const b = body(c, z.object({
    offerId: text(40), returnOfferId: text(40).optional(),
    passengers: z.array(z.object({ firstName: text(40).min(2), lastName: text(40).min(2) })).min(1).max(6),
    contactPhone: z.string().regex(/^0[789][01]\d{8}$/, 'Enter a valid contact phone number'), pin, idempotencyKey: idem,
  }))
  return startFlight(c.user, { offerId: b.offerId, returnOfferId: b.returnOfferId, passengers: b.passengers, contactPhone: b.contactPhone, pin: b.pin, idem: b.idempotencyKey })
}, [8, 60_000])

route('GET', '/api/naira/shop/products', 'user', (c) => listProducts(c.url.searchParams.get('category') ?? undefined))

route('POST', '/api/naira/shop/checkout', 'user', (c) => {
  const b = body(c, z.object({
    items: z.array(z.object({ productId: text(40), qty: z.number().int().min(1).max(10) })).min(1).max(20),
    delivery: z.object({ name: text(60).min(2), phone: z.string().regex(/^0[789][01]\d{8}$/), address: text(160).min(5), city: text(60).min(2) }).optional(),
    pin, idempotencyKey: idem,
  }))
  return startCheckout(c.user, { items: b.items, delivery: b.delivery, pin: b.pin, idem: b.idempotencyKey })
}, [8, 60_000])

/* ---------------- transactions & receipts ---------------- */

route('GET', '/api/naira/transactions', 'user', (c) => {
  const q = c.url.searchParams
  const before = Number(q.get('before'))
  return { transactions: listTxns(c.user.id, { limit: Number(q.get('limit')) || 30, type: q.get('type') ?? undefined, status: q.get('status') ?? undefined, before: Number.isFinite(before) && before > 0 ? before : undefined }) }
})

route('GET', '/api/naira/transactions/:id', 'user', (c) => {
  const t = getTxn(c.params.id)
  if (!t || t.user_id !== c.user.id) throw new HttpError(404, 'Transaction not found')
  const order = get<{ category: string; status: string; token: string | null; provider_ref: string | null }>('SELECT * FROM bills_orders WHERE transaction_id=?', t.id)
  return { transaction: { ...txnView(t), account: ensureNairaWallet(c.user.id).account_number.slice(-4), bill: order ? { category: order.category, status: order.status, providerRef: order.provider_ref } : null } }
})
