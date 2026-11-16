/** Public and user-facing API routes. */
import { z } from 'zod'
import { CONFIG } from './config'
import { createQuote, getAsset, listAssets, price } from './assets'
import { HttpError, createSession, destroySession, devPreviewUser, login, publicUser, register } from './auth'
import { all, get, now, run, setting, uid, audit } from './db'
import { assertSameOrigin, body, route } from './http'
import { balancesFor } from './ledger'
import { fromUnits } from './money'
import { createOrder, getOrder, failOrder, handlePaymentEvent } from './orders'
import { simulateIncomingTransfer, verifyWebhook } from './providers'
import { encrypt, maskAccount, rateLimit } from './security'
import { reportBroadcast } from './chain/arc'
import { simulateDeposit } from './chain/sim'
import { assetView, orderView } from './views'
import { assertOrderConfirmed } from './orderGuards'
import { vaultAddressArc } from './vault'
import { rotateSession } from './auth'
import { isHash } from 'viem'

const amountStr = z.string().regex(/^\d+(\.\d+)?$/, 'Enter a valid amount').max(30)

route('GET', '/api/health', 'public', () => ({ ok: true, time: now() }))

route('GET', '/api/config', 'public', async () => ({
  devPreview: CONFIG.devPreview,
  realMoney: CONFIG.realMoney, paymentMode: CONFIG.paymentMode,
  realMoneyRequested: CONFIG.realMoneyRequested,
  sandbox: true,
  chainId: CONFIG.arc.chainId,
  usdcAddress: CONFIG.arc.usdcAddress,
  // The vault address is never sent to the browser. Signed-in customers get it only inside their own order's deposit instructions.
  vaultConfigured: Boolean(await vaultAddressArc()),
  feeBps: Number(await setting('fee_bps')),
  paused: await setting('platform_paused') === 'true',
}))

const creds = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) })
route('POST', '/api/auth/register', 'public', async (c) => {
  const b = body(c, creds.extend({ name: z.string().min(1).max(80) }))
  const u = await register(b.email, b.name, b.password)
  return { token: await createSession(u.id, c.ip, c.req.headers.get('user-agent') ?? ''), user: publicUser(u) }
}, [10, 3_600_000])

// Sign in with an email address or a username.
const loginCreds = z.object({ email: z.string().trim().min(2).max(200), password: z.string().min(1).max(200) })
route('POST', '/api/auth/login', 'public', async (c) => {
  const b = body(c, loginCreds)
  const per = rateLimit(`login:${b.email.toLowerCase()}`, 8, 900_000)
  if (!per.ok) throw new HttpError(429, 'Too many attempts for this account. Try again later.')
  const u = await login(b.email, b.password)
  return { token: await createSession(u.id, c.ip, c.req.headers.get('user-agent') ?? ''), user: publicUser(u) }
}, [20, 900_000])

route('POST', '/api/auth/dev-session', 'public', async (c) => {
  // A page on another site must never be able to mint a founder session for a developer's local instance.
  assertSameOrigin(c.req)
  const b = body(c, z.object({ role: z.enum(['user', 'founder']) }))
  const u = await devPreviewUser(b.role)
  await audit(u.id, 'auth.dev_preview_session', u.id)
  return { token: await createSession(u.id, c.ip, c.req.headers.get('user-agent') ?? ''), user: publicUser(u) }
}, [30, 60_000])

route('POST', '/api/auth/rotate', 'user', async (c) => {
  const token = await rotateSession(c.token, c.ip)
  if (!token) throw new HttpError(401, 'Session expired')
  return { token }
}, [10, 60_000])

route('POST', '/api/auth/logout', 'user', async (c) => {
  await destroySession(c.token)
  return { ok: true }
})
route('GET', '/api/me', 'user', (c) => ({ user: publicUser(c.user) }))

route('GET', '/api/assets', 'user', async () => ({ assets: (await listAssets()).map(assetView) }))

route('GET', '/api/balances', 'user', async (c) => {
  const b = await balancesFor(c.user.id)
  return {
    ngn: fromUnits(b.NGN ?? 0n, 2),
    simulated: true,
    assets: (await listAssets()).map((a) => ({ symbol: a.symbol, amount: fromUnits(b[a.symbol] ?? 0n, a.decimals), rate: fromUnits(BigInt(a.sell_rate_kobo), 2) })),
  }
})

route('POST', '/api/quotes', 'user', async (c) => {
  const b = body(c, z.object({ side: z.enum(['sell', 'buy']), asset: z.string().max(10), amount: amountStr }))
  const p = await price(b.side, b.asset, b.amount)
  const q = await createQuote(c.user.id, p)
  return {
    id: q.id, expiresAt: q.expiresAt, side: p.side, asset: p.asset.symbol,
    cryptoAmount: fromUnits(p.cryptoUnits, p.asset.decimals), grossNgn: fromUnits(p.grossKobo, 2),
    feeNgn: fromUnits(p.feeKobo, 2), netNgn: fromUnits(p.netKobo, 2), rate: fromUnits(p.rateKobo, 2), feeBps: p.feeBps, networkFeeNgn: fromUnits(p.gasKobo, 2), platformFeeNgn: fromUnits(p.feeKobo - p.gasKobo, 2),
    rateVersion: p.asset.rate_version, rateSource: p.asset.rate_source,
  }
}, [60, 60_000])

route('POST', '/api/orders', 'user', async (c) => {
  const b = body(c, z.object({
    quoteId: z.string().max(40), idempotencyKey: z.string().min(8).max(80),
    payoutType: z.enum(['bank', 'wallet']).optional(), bankAccountId: z.string().max(40).optional(),
    funding: z.enum(['wallet', 'bank_transfer']).optional(), destAddress: z.string().max(100).optional(), fromAddress: z.string().max(100).optional(),
    pin: z.string().regex(/^\d{4}$/).optional(),
  }))
  // PIN, frozen-wallet and large-order checks live in one place so no endpoint can skip them.
  await assertOrderConfirmed(c.user, b, b.idempotencyKey)
  return { order: await orderView(await createOrder(c.user, b), true) }
}, [20, 60_000])

route('GET', '/api/orders', 'user', async (c) => {
  const rows = await all<ReturnType<typeof getOrder> & object>('SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 100', c.user.id)
  return { orders: await Promise.all(rows.map(async (o) => await orderView(o as never))) }
})

async function ownOrder(id: string, userId: string) {
  const o = await getOrder(id)
  if (!o || o.user_id !== userId) throw new HttpError(404, 'Order not found')
  return o
}

route('GET', '/api/orders/:id', 'user', async (c) => ({ order: await orderView(await ownOrder(c.params.id, c.user.id), true) }))

route('POST', '/api/orders/:id/broadcast', 'user', async (c) => {
  const o = await ownOrder(c.params.id, c.user.id)
  const b = body(c, z.object({ txHash: z.string() }))
  if (!isHash(b.txHash)) throw new HttpError(400, 'That is not a valid transaction hash')
  if (o.mode !== 'live' || o.status !== 'awaiting_deposit') throw new HttpError(409, 'This order is not waiting for a live deposit')
  if (!await reportBroadcast(o.id, b.txHash)) throw new HttpError(409, 'That transaction hash is already attached to another order')
  return { order: await orderView(await ownOrder(o.id, c.user.id), true) }
}, [30, 60_000])

route('POST', '/api/orders/:id/cancel', 'user', async (c) => {
  const o = await ownOrder(c.params.id, c.user.id)
  // A reported or flagged order can still be cancelled while no genuine deposit has been matched to it.
  const holdsDeposit = await get("SELECT 1 FROM chain_txs WHERE order_id=? AND verdict='genuine' AND status IN ('pending','confirmed','finalized')", o.id)
  const cancellable = ['awaiting_deposit', 'awaiting_payment'].includes(o.status) || (['deposit_reported', 'flagged'].includes(o.status) && o.side === 'sell' && !holdsDeposit)
  if (!cancellable) throw new HttpError(409, 'This order can no longer be cancelled')
  await failOrder(o.id, 'expired', 'Cancelled by you')
  return { order: await orderView(await ownOrder(o.id, c.user.id), true) }
})

/* Sandbox-only helpers. Clearly simulated: they never touch a real chain or bank. */
route('POST', '/api/sandbox/deposit', 'user', async (c) => {
  const b = body(c, z.object({ orderId: z.string(), scenario: z.enum(['genuine', 'fake_token', 'underpay', 'dropped', 'duplicate']) }))
  return await simulateDeposit(b.orderId, c.user.id, b.scenario)
}, [20, 60_000])

route('POST', '/api/sandbox/pay', 'user', async (c) => {
  const b = body(c, z.object({ orderId: z.string() }))
  const o = await ownOrder(b.orderId, c.user.id)
  const pay = await get<{ reference: string; amount_kobo: string; status: string }>("SELECT * FROM payments WHERE order_id=? AND direction='in'", o.id)
  if (!pay || o.status !== 'awaiting_payment') throw new HttpError(409, 'No bank transfer is awaited for this order')
  await simulateIncomingTransfer(pay.reference, pay.amount_kobo)
  return { ok: true }
}, [20, 60_000])



route('POST', '/webhooks/payments', 'public', async (c) => {
  const v = await verifyWebhook(c.raw, c.req.headers.get('x-signature'))
  if (!v.ok) {
    await audit(null, 'webhook.rejected', 'payments', undefined, { reason: v.reason })
    return new Response(JSON.stringify({ error: v.reason }), { status: 401, headers: { 'content-type': 'application/json' } })
  }
  return { result: await handlePaymentEvent(v.event) }
}, [300, 60_000])

/* Bank accounts (account numbers are encrypted at rest). */
route('GET', '/api/bank-accounts', 'user', async (c) => ({
  accounts: (await all<{ id: string; bank_name: string; account_name: string; account_last4: string }>('SELECT * FROM bank_accounts WHERE user_id=?', c.user.id)).map((a) => ({
    id: a.id, bankName: a.bank_name, accountName: a.account_name, masked: maskAccount(`0000000000${a.account_last4}`.slice(-10)),
  })),
}))

route('POST', '/api/bank-accounts', 'user', async (c) => {
  const b = body(c, z.object({ bankName: z.string().min(2).max(60), accountName: z.string().min(2).max(80), accountNumber: z.string().regex(/^\d{10}$/, 'Nigerian account numbers have 10 digits') }))
  const id = uid('bank')
  await run('INSERT INTO bank_accounts(id,user_id,bank_name,account_name,account_last4,account_enc,created_at) VALUES (?,?,?,?,?,?,?)', id, c.user.id, b.bankName, b.accountName, b.accountNumber.slice(-4), encrypt(b.accountNumber), now())
  await audit(c.user.id, 'bank.add', id)
  return { id }
}, [10, 3_600_000])

route('DELETE', '/api/bank-accounts/:id', 'user', async (c) => {
  await run('DELETE FROM bank_accounts WHERE id=? AND user_id=?', c.params.id, c.user.id)
  await audit(c.user.id, 'bank.remove', c.params.id)
  return { ok: true }
})

route('GET', '/api/notifications', 'user', async (c) => ({
  notifications: await all('SELECT id, at, kind, title, body, read FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50', c.user.id),
}))
route('POST', '/api/notifications/read', 'user', async (c) => {
  await run('UPDATE notifications SET read=1 WHERE user_id=?', c.user.id)
  return { ok: true }
})

route('GET', '/api/ledger', 'user', async (c) => {
  const decimals = new Map((await listAssets()).map((a) => [a.symbol, a.decimals]))
  const rows = await all<{ asset: string; delta: string; reason: string; created_at: number }>(
    'SELECT asset, delta, reason, created_at FROM ledger_entries WHERE owner=? ORDER BY id DESC LIMIT 60', c.user.id,
  )
  return {
    entries: rows.map((r) => ({ asset: r.asset, amount: fromUnits(BigInt(r.delta), r.asset === 'NGN' ? 2 : (decimals.get(r.asset) ?? 6)), reason: r.reason, at: r.created_at })),
  }
})

export { getAsset }
