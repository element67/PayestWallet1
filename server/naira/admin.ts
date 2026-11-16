/** Founder-only Naira administration. No endpoint edits a balance: every correction is a balanced, audited ledger movement. */
import { z } from 'zod'
import { HttpError } from '../auth'
import { all, audit, get, notify, now, run, setting, tx } from '../db'
import { body, route } from '../http'
import { REG_NETWORKS } from '../tokens/networks'
import { InsufficientFunds, SYS, balanceOf, move, verifyLedger } from '../ledger'
import { fromUnits, toUnits } from '../money'
import { decideReview, destinationAccount, reverseReservation } from './pay'
import { createTxn, getTxn, patchTxn, txnView } from './txns'
import { ensureNairaWallet, spentLast24h } from './wallet'

const ngn = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/).transform((s) => toUnits(s, 2))
const note = z.string().trim().min(5, 'Write a reason of at least 5 characters').max(300)

route('GET', '/api/admin/naira/users', 'founder', async () => ({
  users: await Promise.all((await all<{ id: string; email: string; name: string; username: string | null; status: string; role: string; last_login_at: number | null; created_at: number }>(
    'SELECT id,email,name,username,status,role,last_login_at,created_at FROM users ORDER BY created_at DESC LIMIT 200',
  )).map(async (u) => {
    const w = await get<{ status: string; account_number: string; pin_locked_until: number | null; pin_hash: string | null; freeze_reason: string | null }>('SELECT * FROM naira_wallets WHERE user_id=?', u.id)
    return {
      id: u.id, email: u.email, name: u.name, username: u.username, role: u.role, accountStatus: u.status, lastLoginAt: u.last_login_at, createdAt: u.created_at,
      balance: fromUnits(await balanceOf(u.id, 'NGN'), 2), spent24h: fromUnits(await spentLast24h(u.id), 2),
      wallet: w ? { status: w.status, accountNumber: w.account_number, pinSet: Boolean(w.pin_hash), pinLocked: Boolean(w.pin_locked_until && w.pin_locked_until > now()), freezeReason: w.freeze_reason } : null,
    }
  })),
}))

/** A user's ledger. NGN by default; `?asset=ALL` (or a symbol) shows crypto entries too. Newest first. */
route('GET', '/api/admin/naira/users/:id/ledger', 'founder', async (c) => {
  const asset = (c.url.searchParams.get('asset') ?? 'NGN').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6) || 'NGN'
  const rows = await all<{ id: number; txn_id: string; asset: string; delta: string; balance_after: string; reason: string; side: string; status: string; created_at: number }>(
    `SELECT id, txn_id, asset, delta, balance_after, reason, side, status, created_at FROM ledger_entries WHERE owner=? ${asset === 'ALL' ? '' : 'AND asset=?'} ORDER BY id DESC LIMIT 100`,
    ...(asset === 'ALL' ? [c.params.id] : [c.params.id, asset]),
  )
  const decimals = new Map((await all<{ symbol: string; decimals: number }>('SELECT symbol, decimals FROM assets')).map((a) => [a.symbol, a.decimals]))
  const dp = (sym: string) => (sym === 'NGN' ? 2 : decimals.get(sym) ?? 2)
  return {
    entries: rows.map((e) => ({
      id: e.id, txnId: e.txn_id, asset: e.asset, side: e.side, status: e.status, amount: fromUnits(BigInt(e.delta), dp(e.asset)),
      balanceAfter: fromUnits(BigInt(e.balance_after), dp(e.asset)), reason: e.reason, at: e.created_at,
    })),
  }
})

route('POST', '/api/admin/naira/users/:id/freeze', 'founder', async (c) => {
  const b = body(c, z.object({ frozen: z.boolean(), reason: note.optional() }))
  const target = await get<{ id: string }>('SELECT id FROM users WHERE id=?', c.params.id)
  if (!target) throw new HttpError(404, 'User not found')
  if (b.frozen && !b.reason) throw new HttpError(400, 'A reason is required to freeze an account')
  await ensureNairaWallet(target.id)
  await run('UPDATE naira_wallets SET status=?, freeze_reason=? WHERE user_id=?', b.frozen ? 'frozen' : 'active', b.frozen ? b.reason! : null, target.id)
  await audit(c.user.id, b.frozen ? 'admin.freeze' : 'admin.unfreeze', target.id, undefined, { reason: b.reason })
  await notify(target.id, 'security', b.frozen ? 'Wallet frozen' : 'Wallet unfrozen', b.frozen ? 'Your wallet was frozen for review. Contact support.' : 'Your wallet is active again.')
  return { ok: true }
})

route('POST', '/api/admin/naira/users/:id/unlock-pin', 'founder', async (c) => {
  await run('UPDATE naira_wallets SET pin_attempts=0, pin_locked_until=NULL WHERE user_id=?', c.params.id)
  await audit(c.user.id, 'admin.pin_unlock', c.params.id)
  return { ok: true }
})

/* ---------------- transactions ---------------- */

route('GET', '/api/admin/naira/transactions', 'founder', async (c) => {
  const q = c.url.searchParams
  const where: string[] = ['1=1']
  const args: (string | number)[] = []
  if (q.get('status')) { where.push('t.status=?'); args.push(q.get('status')!) }
  if (q.get('type')) { where.push('t.type LIKE ?'); args.push(`${q.get('type')}%`) }
  if (q.get('userId')) { where.push('t.user_id=?'); args.push(q.get('userId')!) }
  const rows = await all<Record<string, unknown>>(
    `SELECT t.*, u.email FROM transactions t JOIN users u ON u.id=t.user_id WHERE ${where.join(' AND ')} ORDER BY t.created_at DESC LIMIT 150`, ...args,
  )
  return { transactions: rows.map((r) => ({ ...txnView(r as never), email: r.email as string, userId: r.user_id as string })) }
})

route('GET', '/api/admin/naira/transactions/:id', 'founder', async (c) => {
  const t = await getTxn(c.params.id)
  if (!t) throw new HttpError(404, 'Transaction not found')
  const entries = await all<{ owner: string; delta: string; reason: string; idem_key: string; created_at: number; txn_id: string }>(
    "SELECT owner, delta, reason, idem_key, created_at, txn_id FROM ledger_entries WHERE idem_key LIKE ? OR txn_id=? ORDER BY id", `txn:${t.id}:%`, t.ledger_txn_id ?? '',
  )
  return { transaction: txnView(t), ledger: entries.map((e) => ({ account: e.owner, amount: fromUnits(BigInt(e.delta), 2), reason: e.reason, txnId: e.txn_id, at: e.created_at })) }
})

/** Review decisions, refunds of settled payments, reversal of stuck ones. Always audited, always through the ledger. */
route('POST', '/api/admin/naira/transactions/:id/resolve', 'founder', async (c) => {
  const b = body(c, z.object({ action: z.enum(['approve', 'reject', 'refund']), note }))
  const t = await getTxn(c.params.id)
  if (!t) throw new HttpError(404, 'Transaction not found')
  if (b.action === 'approve' || b.action === 'reject') {
    await decideReview(t.id, b.action === 'approve', c.user.id)
  } else if (t.status === 'processing') {
    await reverseReservation(t, `Reversed by the founder: ${b.note}`)
  } else if (t.status === 'success' && !t.reversed && t.direction === 'debit') {
    const amount = BigInt(t.amount_kobo)
    const fee = BigInt(t.fee_kobo)
    await tx(async () => {
      await move({ from: destinationAccount(t.type), to: t.user_id, asset: 'NGN', amount, reason: `admin refund: ${t.title}`, idem: `txn:${t.id}:adminrefund` })
      if (fee > 0n) await move({ from: SYS.fees, to: t.user_id, asset: 'NGN', amount: fee, reason: `admin fee refund: ${t.title}`, idem: `txn:${t.id}:adminrefundfee`, allowNegativeFrom: true })
      await patchTxn(t.id, { status: 'reversed', reversed: true, failureReason: `Refunded by the founder: ${b.note}` })
    })
    await notify(t.user_id, 'order', 'Payment refunded', `${t.title} (${t.reference}) was refunded to your wallet.`)
  } else {
    throw new HttpError(409, `A ${t.status} transaction cannot be ${b.action === 'refund' ? 'refunded' : 'decided'} this way`)
  }
  await audit(c.user.id, `admin.${b.action}`, t.reference, { status: t.status }, { note: b.note })
  return { transaction: txnView((await getTxn(t.id))!) }
}, [30, 60_000])

/** Corrections that are not tied to one payment: a balanced movement against the adjustments account. */
route('POST', '/api/admin/naira/users/:id/adjust', 'founder', async (c) => {
  const b = body(c, z.object({ direction: z.enum(['credit', 'debit']), amount: ngn, note, idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/) }))
  if (b.amount <= 0n) throw new HttpError(400, 'Enter an amount greater than zero')
  const user = await get<{ id: string }>('SELECT id FROM users WHERE id=?', c.params.id)
  if (!user) throw new HttpError(404, 'User not found')
  try {
    const out = await tx(async () => {
      const ltx = b.direction === 'credit'
        ? await move({ from: SYS.adjustments, to: user.id, asset: 'NGN', amount: b.amount, reason: `admin adjustment: ${b.note}`, idem: `adj:${b.idempotencyKey}` })
        : await move({ from: user.id, to: SYS.adjustments, asset: 'NGN', amount: b.amount, reason: `admin adjustment: ${b.note}`, idem: `adj:${b.idempotencyKey}` })
      if (!ltx) return null // same key already applied
      return await createTxn({ userId: user.id, type: 'adjustment', direction: b.direction, amount: b.amount, status: 'success', title: 'Account adjustment', note: b.note, ledgerTxnId: ltx, prefix: 'NBA', idemKey: `adj:${b.idempotencyKey}` })
    })
    await audit(c.user.id, `admin.adjust_${b.direction}`, user.id, undefined, { amount: b.amount.toString(), note: b.note })
    return { applied: Boolean(out), transaction: out ? txnView(out) : null }
  } catch (e) {
    if (e instanceof InsufficientFunds) throw new HttpError(400, 'That debit is larger than the customer balance')
    throw e
  }
}, [20, 60_000])

/* ---------------- monitoring ---------------- */

route('GET', '/api/admin/naira/p2p', 'founder', async (c) => {
  const status = c.url.searchParams.get('status')
  return {
    orders: (await all<Record<string, unknown>>(
      `SELECT p.*, u.email, o.status AS order_status, o.mode, o.tx_hash, o.expires_at FROM p2p_orders p JOIN users u ON u.id=p.user_id JOIN orders o ON o.id=p.exchange_order_id
        ${status ? 'WHERE p.status=?' : ''} ORDER BY p.created_at DESC LIMIT 100`, ...(status ? [status] : []),
    )).map((r) => ({
      id: r.id, orderId: r.exchange_order_id, email: r.email, asset: r.asset, expected: fromUnits(BigInt(r.expected_kobo as string), 2), status: r.status, orderStatus: r.order_status,
      mode: r.mode, txHash: r.tx_hash, createdAt: r.created_at, expiresAt: r.expires_at,
    })),
  }
})

route('GET', '/api/admin/naira/bills', 'founder', async () => ({
  orders: (await all<Record<string, unknown>>('SELECT b.*, u.email, t.reference FROM bills_orders b JOIN users u ON u.id=b.user_id JOIN transactions t ON t.id=b.transaction_id ORDER BY b.created_at DESC LIMIT 100')).map((r) => ({
    id: r.id, reference: r.reference, email: r.email, category: r.category, provider: r.provider, product: r.product, customerRef: r.customer_ref, customerName: r.customer_name,
    amount: fromUnits(BigInt(r.amount_kobo as string), 2), fee: fromUnits(BigInt(r.fee_kobo as string), 2), status: r.status, providerRef: r.provider_ref, createdAt: r.created_at,
  })),
}))

route('GET', '/api/admin/naira/security', 'founder', async () => ({
  events: await all<{ id: number; at: number; actor_id: string | null; action: string; target: string | null; after: string | null }>(
    "SELECT id, at, actor_id, action, target, after FROM audit_logs WHERE action LIKE 'security.%' OR action LIKE 'admin.%' OR action LIKE 'payment.%' OR action LIKE 'review.%' ORDER BY id DESC LIMIT 100",
  ),
  alerts: await all("SELECT * FROM alerts WHERE kind IN ('naira_fraud_flag','naira_review','new_device','pin_lockout','rbac') ORDER BY id DESC LIMIT 50"),
  ledger: await verifyLedger(),
}))

/* ---------------- fees, limits, gas estimates ---------------- */

const KEYS = {
  bankTransferFee: 'bank_transfer_fee_kobo', billFee: 'bill_fee_kobo', dailySpendLimit: 'daily_spend_limit_kobo',
  reviewThreshold: 'review_threshold_kobo', largeFlag: 'large_flag_kobo',
} as const

route('GET', '/api/admin/naira/config', 'founder', async () => ({
  config: {
    ...Object.fromEntries(await Promise.all(Object.entries(KEYS).map(async ([k, key]) => [k, fromUnits(BigInt(await setting(key)), 2)] as const))),
    pinLockMinutes: Number(await setting('pin_lock_minutes')),
    velocityBlock: Number(await setting('velocity_block_count')),
    velocityFlag: Number(await setting('velocity_flag_count')),
    gasEstimates: JSON.parse(await setting('gas_fee_estimates') || '{}') as Record<string, string>,
    gasFeeNgn: JSON.parse(await setting('gas_fee_ngn') || '{}') as Record<string, string>,
    feeBps: Number(await setting('fee_bps')),
  },
}))

route('PUT', '/api/admin/naira/config', 'founder', async (c) => {
  const b = body(c, z.object({
    bankTransferFee: ngn.optional(), billFee: ngn.optional(), dailySpendLimit: ngn.optional(), reviewThreshold: ngn.optional(), largeFlag: ngn.optional(),
    pinLockMinutes: z.number().int().min(1).max(1440).optional(),
    velocityBlock: z.number().int().min(1).max(10000).optional(),
    velocityFlag: z.number().int().min(1).max(10000).optional(),
    gasEstimates: z.record(z.string().regex(/^[A-Za-z0-9]{2,10}$/), z.string().regex(/^\d+(\.\d+)?$/)).optional(),
    gasFeeNgn: z.partialRecord(z.enum(REG_NETWORKS.filter((n) => n.testnet).map((n) => n.id) as [string, ...string[]]), z.string().regex(/^\d{1,8}(\.\d{1,2})?$/)).optional(),
  }))
  const before: Record<string, string> = {}
  const after: Record<string, string> = {}
  const set = async (key: string, value: string) => {
    before[key] = await setting(key)
    after[key] = value
    await run('UPDATE settings SET value=? WHERE key=?', value, key)
  }
  for (const [k, key] of Object.entries(KEYS)) {
    const v = (b as Record<string, bigint | undefined>)[k]
    if (v !== undefined) await set(key, v.toString())
  }
  if (b.pinLockMinutes !== undefined) await set('pin_lock_minutes', String(b.pinLockMinutes))
  if (b.velocityBlock !== undefined) await set('velocity_block_count', String(b.velocityBlock))
  if (b.velocityFlag !== undefined) await set('velocity_flag_count', String(b.velocityFlag))
  if (b.gasEstimates) await set('gas_fee_estimates', JSON.stringify({ ...JSON.parse(await setting('gas_fee_estimates') || '{}'), ...b.gasEstimates }))
  if (b.gasFeeNgn) await set('gas_fee_ngn', JSON.stringify({ ...JSON.parse(await setting('gas_fee_ngn') || '{}'), ...b.gasFeeNgn }))
  await audit(c.user.id, 'admin.naira_config', 'settings', before, after)
  return { ok: true }
})

route('GET', '/api/admin/naira/ledger/verify', 'founder', async () => await verifyLedger())
