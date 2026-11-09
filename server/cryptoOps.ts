/**
 * Home dashboard data, token management and the dedicated crypto operations
 * (sell, buy, P2P exchange, swap, bridge). Every route is tied to the signed-in user,
 * validates its input on the server, is idempotent and leaves a record with a live status.
 */
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { HttpError } from './auth'
import { all, audit, db, get, notify, now, run, setting, settingNum, uid } from './db'
import { body, route } from './http'
import { cryptoTotals } from './balance'
import { balanceOf, balancesFor, InsufficientFunds, move } from './ledger'
import { MoneyError, ceilDiv, fromUnits, toUnits } from './money'
import { dailyVolumeKobo, gasFeeKobo, getAsset } from './assets'
import { createOrder, getOrder } from './orders'
import { orderView } from './views'
import { assertOperational, ensureNairaWallet, verifyPin } from './naira/wallet'
import { ensureWallet } from './wallet/keys'
import { ASSETS, NETWORKS, UNAVAILABLE, getAssetDef, getNetwork } from './wallet/networks'
import { addressForNetwork, assetRows, needsSync, portfolio, syncUser } from './wallet/service'

const idem = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'A valid idempotency key is required')
const pin = z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits')
const amountStr = z.string().regex(/^\d{1,12}(\.\d{1,9})?$/, 'Enter a valid amount')
const symbol = z.string().regex(/^[A-Z]{2,6}$/, 'Unknown asset')

/* ---------------- live status ---------------- */

const FAILED = new Set(['failed', 'rejected', 'expired', 'cancelled', 'reversed', 'flagged'])
const PENDING = new Set(['awaiting_deposit', 'awaiting_payment', 'awaiting_liquidity', 'quoted'])

/** Maps the detailed exchange status onto the four user-facing statuses. */
export function liveStatus(opStatus: string, orderStatus?: string | null): 'pending' | 'verifying' | 'completed' | 'failed' {
  const s = orderStatus ?? opStatus
  if (s === 'completed') return 'completed'
  if (FAILED.has(s)) return 'failed'
  if (PENDING.has(s)) return 'pending'
  if (s === 'pending' || s === 'verifying' || s === 'failed') return s
  return 'verifying'
}

interface OpRow {
  id: string; reference: string; user_id: string; kind: string; status: string; asset: string; to_asset: string | null; amount: string
  result_amount: string | null; value_kobo: string; fee_kobo: string; order_id: string | null; meta: string; reason: string | null
  idem_key: string; created_at: number; updated_at: number
}

const decimalsOf = (sym: string) => (sym === 'NGN' ? 2 : getAsset(sym)?.decimals ?? 6)

export function opView(o: OpRow) {
  const order = o.order_id ? getOrder(o.order_id) : undefined
  const status = liveStatus(o.status, order?.status)
  return {
    id: o.id, reference: o.reference, kind: o.kind, status, asset: o.asset, toAsset: o.to_asset,
    amount: fromUnits(BigInt(o.amount), decimalsOf(o.asset)),
    resultAmount: o.result_amount !== null ? fromUnits(BigInt(o.result_amount), decimalsOf(o.to_asset ?? 'NGN')) : null,
    valueNgn: fromUnits(BigInt(o.value_kobo), 2), feeNgn: fromUnits(BigInt(o.fee_kobo), 2),
    orderId: o.order_id, orderStatus: order?.status ?? null, reason: o.reason ?? order?.failure_reason ?? null,
    meta: JSON.parse(o.meta) as Record<string, unknown>, createdAt: o.created_at, updatedAt: o.updated_at, sandbox: true,
  }
}

function insertOp(userId: string, f: {
  kind: string; status: string; asset: string; toAsset?: string; amount: bigint; result?: bigint; value?: bigint; fee?: bigint
  orderId?: string; meta?: Record<string, unknown>; reason?: string; idem: string
}): OpRow {
  const t = now()
  const id = uid('op')
  const ref = `NB-${f.kind.toUpperCase().slice(0, 4)}-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${randomBytes(4).toString('hex').toUpperCase()}`
  run(
    `INSERT OR IGNORE INTO crypto_ops(id,reference,user_id,kind,status,asset,to_asset,amount,result_amount,value_kobo,fee_kobo,order_id,meta,reason,idem_key,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, ref, userId, f.kind, f.status, f.asset, f.toAsset ?? null, f.amount.toString(), f.result?.toString() ?? null, (f.value ?? 0n).toString(),
    (f.fee ?? 0n).toString(), f.orderId ?? null, JSON.stringify(f.meta ?? {}), f.reason ?? null, f.idem, t, t,
  )
  return get<OpRow>('SELECT * FROM crypto_ops WHERE id=?', id) as OpRow
}

/** Idempotent create: the same user and idempotency key always return the same record. */
function createOp(userId: string, f: Parameters<typeof insertOp>[1]): OpRow {
  const existing = get<OpRow>('SELECT * FROM crypto_ops WHERE user_id=? AND idem_key=?', userId, f.idem)
  if (existing) return existing
  return insertOp(userId, f)
}

/* ---------------- home dashboard ---------------- */

route('GET', '/api/home', 'user', (c) => {
  const userId = c.user.id
  ensureWallet(userId)
  if (needsSync(userId)) void syncUser(userId)
  const p = portfolio(userId)
  const wallet = ensureNairaWallet(userId)
  const bal = balancesFor(userId)
  let cryptoKobo = 0n
  const crypto: Array<Record<string, unknown>> = []
  for (const r of assetRows(userId)) {
    if (r.balance === null || !(Number(r.balance) > 0)) continue
    cryptoKobo += r.valueKobo ?? 0n
    crypto.push({
      id: r.key, symbol: r.symbol, name: r.name, kind: 'onchain', chain: getNetwork(r.network)?.name ?? r.network,
      amount: r.balance, valueNgn: r.valueNgn,
    })
  }
  let credits = 0n
  for (const a of all<{ symbol: string; name: string; decimals: number; sell_rate_kobo: string }>('SELECT symbol,name,decimals,sell_rate_kobo FROM assets')) {
    const raw = bal[a.symbol] ?? 0n
    if (raw <= 0n) continue
    const value = (raw * BigInt(a.sell_rate_kobo)) / 10n ** BigInt(a.decimals)
    credits += value
    crypto.push({
      id: `credit:${a.symbol}`, symbol: a.symbol, name: a.name, kind: 'credit', chain: 'Exchange wallet (sandbox)',
      amount: fromUnits(raw, a.decimals), valueNgn: fromUnits(value, 2),
    })
  }
  const naira = bal.NGN ?? 0n
  const totals = cryptoTotals(userId)
  return {
    crypto: { totalValueNgn: fromUnits(totals.onchain + totals.sandbox, 2), includesCredits: totals.sandbox > 0n, unpricedSymbols: p.unpricedSymbols, syncing: p.syncing, syncedAt: p.syncedAt },
    naira: { balance: fromUnits(naira, 2), accountNumber: wallet.account_number, status: wallet.status },
    assets: [
      { id: 'NGN', symbol: 'NGN', name: 'Naira', kind: 'naira', chain: 'NairaBridge wallet (sandbox)', amount: fromUnits(naira, 2), valueNgn: fromUnits(naira, 2) },
      ...crypto,
    ],
  }
}, [90, 60_000])

/* ---------------- tokens the user has added ---------------- */

function tokenLists(userId: string) {
  const addrs = ensureWallet(userId)
  const added = new Set(all<{ asset_key: string }>('SELECT asset_key FROM wallet_tokens WHERE user_id=?', userId).map((r) => r.asset_key))
  const rows = assetRows(userId)
  const view = (r: (typeof rows)[number]) => {
    const net = getNetwork(r.network)
    return {
      key: r.key, symbol: r.symbol, name: r.name, network: r.network, networkName: net?.name ?? r.network, kind: r.kind, contract: r.contract,
      decimals: r.decimals, info: r.info, balance: r.balance, valueNgn: r.valueNgn, verifiedAt: r.verifiedAt, error: r.error,
      address: net ? addressForNetwork(net, addrs) : null, added: added.has(r.key),
    }
  }
  const all_ = rows.map(view)
  return {
    mine: all_.filter((r) => r.added || (r.balance !== null && Number(r.balance) > 0)),
    more: all_.filter((r) => !r.added && !(r.balance !== null && Number(r.balance) > 0)),
    unavailable: UNAVAILABLE,
  }
}

route('GET', '/api/crypto/tokens', 'user', (c) => {
  if (needsSync(c.user.id)) void syncUser(c.user.id)
  return tokenLists(c.user.id)
}, [90, 60_000])

route('POST', '/api/crypto/tokens', 'user', (c) => {
  const b = body(c, z.object({ assetKey: z.string().max(60) }))
  if (!getAssetDef(b.assetKey)) throw new HttpError(404, 'That token is not supported')
  run('INSERT OR IGNORE INTO wallet_tokens(user_id, asset_key, added_at) VALUES (?,?,?)', c.user.id, b.assetKey, now())
  audit(c.user.id, 'crypto.token_add', b.assetKey)
  void syncUser(c.user.id)
  return tokenLists(c.user.id)
}, [30, 60_000])

/* ---------------- sell / buy / P2P (all run through the verified exchange engine) ---------------- */

function quoteFor(userId: string, quoteId: string, side: 'sell' | 'buy') {
  const q = get<{ side: string; asset: string; crypto_amount: string; gross_kobo: string; fee_kobo: string; net_kobo: string }>(
    'SELECT * FROM quotes WHERE id=? AND user_id=?', quoteId, userId,
  )
  if (!q) throw new HttpError(404, 'Quote not found. Request a new one.')
  if (q.side !== side) throw new HttpError(400, side === 'sell' ? 'That quote is for buying crypto, not selling it' : 'That quote is for selling crypto, not buying it')
  return q
}

function startExchange(c: { user: Parameters<typeof createOrder>[0] }, kind: 'sell' | 'buy' | 'p2p', side: 'sell' | 'buy', b: {
  quoteId: string; idempotencyKey: string; fromAddress?: string; destAddress?: string; funding?: 'wallet' | 'bank_transfer'; pin?: string
  payoutType?: 'bank' | 'wallet'; bankAccountId?: string
}) {
  const user = c.user
  const q = quoteFor(user.id, b.quoteId, side)
  const replay = get('SELECT 1 FROM orders WHERE user_id=? AND idem_key=?', user.id, b.idempotencyKey)
  if (side === 'buy' && (b.funding ?? 'wallet') === 'wallet' && !replay) {
    assertOperational(user.id)
    verifyPin(user.id, b.pin)
  }
  const order = createOrder(user, side === 'sell'
    ? { quoteId: b.quoteId, idempotencyKey: b.idempotencyKey, payoutType: b.payoutType ?? 'wallet', bankAccountId: b.bankAccountId, fromAddress: b.fromAddress }
    : { quoteId: b.quoteId, idempotencyKey: b.idempotencyKey, funding: b.funding ?? 'wallet', destAddress: b.destAddress })
  const op = createOp(user.id, {
    kind, status: 'pending', asset: q.asset, amount: BigInt(q.crypto_amount), result: side === 'sell' ? BigInt(q.net_kobo) : BigInt(q.crypto_amount),
    value: BigInt(q.gross_kobo), fee: BigInt(q.fee_kobo), orderId: order.id, idem: b.idempotencyKey,
    meta: { side, direction: side === 'sell' ? 'crypto_to_naira' : 'naira_to_crypto', mode: order.mode },
  })
  audit(user.id, `crypto.${kind}`, op.id, undefined, { orderId: order.id, asset: q.asset })
  return { op: opView(op), order: orderView(order, true) }
}

const exchangeBody = z.object({
  quoteId: z.string().max(40), idempotencyKey: idem, fromAddress: z.string().max(100).optional(), destAddress: z.string().max(100).optional(),
  funding: z.enum(['wallet', 'bank_transfer']).optional(), pin: pin.optional(),
  payoutType: z.enum(['bank', 'wallet']).optional(), bankAccountId: z.string().max(40).optional(),
})

route('POST', '/api/crypto/sell', 'user', (c) => startExchange(c, 'sell', 'sell', body(c, exchangeBody)), [15, 60_000])
route('POST', '/api/crypto/buy', 'user', (c) => startExchange(c, 'buy', 'buy', body(c, exchangeBody)), [15, 60_000])
route('POST', '/api/p2p/crypto-to-naira', 'user', (c) => startExchange(c, 'p2p', 'sell', body(c, exchangeBody)), [15, 60_000])
route('POST', '/api/p2p/naira-to-crypto', 'user', (c) => startExchange(c, 'p2p', 'buy', body(c, exchangeBody)), [15, 60_000])

/* ---------------- swap between exchange balances ---------------- */

function swapPricing(from: string, to: string, amount: string) {
  if (from === to) throw new MoneyError('Choose two different assets')
  const a = getAsset(from), b = getAsset(to)
  if (!a || !a.enabled || !b || !b.enabled) throw new MoneyError('One of these assets is not available')
  if (setting('platform_paused') === 'true') throw new MoneyError('Trading is temporarily paused')
  const sellRate = BigInt(a.sell_rate_kobo), buyRate = BigInt(b.buy_rate_kobo)
  if (sellRate <= 0n || buyRate <= 0n) throw new MoneyError('Rate not configured')
  const amt = toUnits(amount, a.decimals)
  const gross = (amt * sellRate) / 10n ** BigInt(a.decimals)
  const gas = gasFeeKobo(a.chain)
  const fee = ceilDiv(gross * BigInt(settingNum('fee_bps')), 10_000n) + gas
  const net = gross - fee
  if (amt <= 0n || net <= 0n) throw new MoneyError('Amount too small')
  if (gross < BigInt(a.min_ngn_kobo)) throw new MoneyError(`Minimum is NGN ${fromUnits(BigInt(a.min_ngn_kobo), 2)} equivalent`)
  if (gross > BigInt(a.max_ngn_kobo)) throw new MoneyError(`Maximum is NGN ${fromUnits(BigInt(a.max_ngn_kobo), 2)} equivalent`)
  const out = (net * 10n ** BigInt(b.decimals)) / buyRate
  if (out <= 0n) throw new MoneyError('Amount too small')
  return { a, b, amt, gross, fee, gas, net, out, sellRate, buyRate }
}

const swapBody = z.object({ from: symbol, to: symbol, amount: amountStr })

route('POST', '/api/crypto/swap/quote', 'user', (c) => {
  const b = body(c, swapBody)
  const p = swapPricing(b.from, b.to, b.amount)
  return {
    from: p.a.symbol, to: p.b.symbol, amount: b.amount, receive: fromUnits(p.out, p.b.decimals), valueNgn: fromUnits(p.gross, 2),
    feeNgn: fromUnits(p.fee, 2), platformFeeNgn: fromUnits(p.fee - p.gas, 2), networkFeeNgn: fromUnits(p.gas, 2), feeBps: settingNum('fee_bps'),
    fromRateNgn: fromUnits(p.sellRate, 2), toRateNgn: fromUnits(p.buyRate, 2),
    available: fromUnits(balanceOf(c.user.id, p.a.symbol), p.a.decimals), sandbox: true,
    note: 'Swaps move value between your exchange balances at the founder-set rates. On-chain swaps need a swap provider that is not connected yet.',
  }
}, [60, 60_000])

route('POST', '/api/crypto/swap', 'user', (c) => {
  const b = body(c, swapBody.extend({ idempotencyKey: idem, pin }))
  const userId = c.user.id
  const replay = get<OpRow>('SELECT * FROM crypto_ops WHERE user_id=? AND idem_key=?', userId, b.idempotencyKey)
  if (replay) return { op: opView(replay) }
  assertOperational(userId)
  verifyPin(userId, b.pin)
  const p = swapPricing(b.from, b.to, b.amount)
  const cap = BigInt(setting(c.user.kyc_tier >= 2 ? 'daily_limit_tier2_kobo' : 'daily_limit_tier1_kobo'))
  const swaps = all<{ value_kobo: string }>("SELECT value_kobo FROM crypto_ops WHERE user_id=? AND kind='swap' AND status!='failed' AND created_at>?", userId, now() - 86_400_000)
  const used = dailyVolumeKobo(userId) + swaps.reduce((s, r) => s + BigInt(r.value_kobo), 0n)
  if (used + p.gross > cap) throw new HttpError(403, `This would exceed your daily limit of NGN ${fromUnits(cap, 2)}`)
  if (balanceOf('house', p.b.symbol) < p.out) throw new HttpError(503, `${p.b.symbol} liquidity is low right now. Try a smaller amount.`)
  try {
    const op = db.transaction(() => {
      const o = createOp(userId, {
        kind: 'swap', status: 'verifying', asset: p.a.symbol, toAsset: p.b.symbol, amount: p.amt, result: p.out, value: p.gross, fee: p.fee, idem: b.idempotencyKey,
        meta: { fromRateNgn: fromUnits(p.sellRate, 2), toRateNgn: fromUnits(p.buyRate, 2), networkFeeNgn: fromUnits(p.gas, 2) },
      })
      const tx = `swap-${o.id}`
      move({ from: userId, to: 'house', asset: p.a.symbol, amount: p.amt, reason: `swap ${p.a.symbol} to ${p.b.symbol}`, idem: `swap:${o.id}:out`, txnId: tx })
      move({ from: 'house', to: userId, asset: p.b.symbol, amount: p.out, reason: `swap ${p.a.symbol} to ${p.b.symbol}`, idem: `swap:${o.id}:in`, txnId: tx })
      run("UPDATE crypto_ops SET status='completed', updated_at=? WHERE id=?", now(), o.id)
      return get<OpRow>('SELECT * FROM crypto_ops WHERE id=?', o.id) as OpRow
    })()
    audit(userId, 'crypto.swap', op.id, { from: p.a.symbol, amount: b.amount }, { to: p.b.symbol, receive: fromUnits(p.out, p.b.decimals) })
    notify(userId, 'swap', 'Swap completed', `${b.amount} ${p.a.symbol} swapped for ${fromUnits(p.out, p.b.decimals)} ${p.b.symbol}.`)
    return { op: opView(op) }
  } catch (e) {
    if (e instanceof InsufficientFunds) throw new HttpError(400, `You do not have enough ${p.a.symbol} in your exchange balance`)
    throw e
  }
}, [10, 60_000])

/* ---------------- bridge ---------------- */

route('POST', '/api/crypto/bridge', 'user', (c) => {
  const b = body(c, z.object({
    symbol, fromNetwork: z.string().max(40), toNetwork: z.string().max(40), amount: amountStr, idempotencyKey: idem,
  }))
  const userId = c.user.id
  const from = getNetwork(b.fromNetwork), to = getNetwork(b.toNetwork)
  if (!from || !to) throw new HttpError(400, 'Choose supported networks')
  if (from.id === to.id) throw new HttpError(400, 'Choose two different networks')
  const src = ASSETS.find((a) => a.symbol === b.symbol && a.network === from.id)
  const dst = ASSETS.find((a) => a.symbol === b.symbol && a.network === to.id)
  if (!src || !dst) throw new HttpError(400, `${b.symbol} is not available on both ${from.name} and ${to.name}`)
  const amt = toUnits(b.amount, src.decimals)
  if (amt <= 0n) throw new HttpError(400, 'Enter an amount above zero')
  const op = createOp(userId, {
    kind: 'bridge', status: 'failed', asset: b.symbol, amount: amt, idem: b.idempotencyKey,
    reason: 'No bridge provider is connected yet, so nothing was moved. Your balance is unchanged.',
    meta: { fromNetwork: from.id, toNetwork: to.id, fromName: from.name, toName: to.name },
  })
  audit(userId, 'crypto.bridge_rejected', op.id, undefined, { from: from.id, to: to.id })
  return { op: opView(op) }
}, [10, 60_000])

route('GET', '/api/crypto/bridge/options', 'user', () => ({
  networks: NETWORKS.map((n) => ({ id: n.id, name: n.name })),
  assets: ASSETS.map((a) => ({ symbol: a.symbol, network: a.network })),
  providerConnected: false,
}))

/* ---------------- records ---------------- */

route('GET', '/api/crypto/ops', 'user', (c) => {
  const kind = new URL(c.req.url).searchParams.get('kind')
  const rows = kind && /^[a-z0-9]{2,10}$/.test(kind)
    ? all<OpRow>('SELECT * FROM crypto_ops WHERE user_id=? AND kind=? ORDER BY created_at DESC LIMIT 100', c.user.id, kind)
    : all<OpRow>('SELECT * FROM crypto_ops WHERE user_id=? ORDER BY created_at DESC LIMIT 100', c.user.id)
  return { ops: rows.map(opView) }
}, [90, 60_000])

route('GET', '/api/crypto/ops/:id', 'user', (c) => {
  const row = get<OpRow>('SELECT * FROM crypto_ops WHERE id=? AND user_id=?', c.params.id, c.user.id)
  if (!row) throw new HttpError(404, 'Record not found')
  return { op: opView(row) }
}, [90, 60_000])
