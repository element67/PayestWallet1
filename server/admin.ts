/** Founder-only API routes. Every change is validated and written to the audit log. */
import { ADDRESS_CHECK } from './vault'
import { z } from 'zod'
import { isAddress } from 'viem'
import { getAsset, listAssets } from './assets'
import { HttpError } from './auth'
import { all, audit, get, now, run, setting, uid } from './db'
import { body, route } from './http'
import { balanceOf, post } from './ledger'
import { agentMetrics, adminOverview } from './metrics'
import { fromUnits, toUnits } from './money'
import { failOrder, getOrder, setStatus } from './orders'
import { enqueue } from './queue'
import { assetView, orderView } from './views'
import { balancesFor } from './ledger'
import type { OrderRow } from './orders'

route('GET', '/api/admin/overview', 'founder', async () => await adminOverview())
route('GET', '/api/admin/agent', 'founder', async () => await agentMetrics())

const dec = z.string().regex(/^\d+(\.\d{1,2})?$/, 'Use a number with up to 2 decimals')

/* ---- settings ---- */
const SETTING_MAP = {
  feeBps: { key: 'fee_bps', schema: z.number().int().min(0).max(1000) },
  quoteTtlSec: { key: 'quote_ttl_sec', schema: z.number().int().min(15).max(300) },
  riskBlockScore: { key: 'risk_block_score', schema: z.number().int().min(10).max(100) },
  riskReviewScore: { key: 'risk_review_score', schema: z.number().int().min(5).max(100) },
  confirmationsRequired: { key: 'confirmations_required', schema: z.number().int().min(1).max(30) },
  orderExpiryMin: { key: 'order_expiry_min', schema: z.number().int().min(5).max(240) },
  instantPayoutsEnabled: { key: 'instant_payouts_enabled', schema: z.boolean() },
  platformPaused: { key: 'platform_paused', schema: z.boolean() },
} as const
const NGN_SETTINGS = { instantLimitNgn: 'instant_payout_limit_kobo', dailyLimitTier1Ngn: 'daily_limit_tier1_kobo', dailyLimitTier2Ngn: 'daily_limit_tier2_kobo', dailyWithdrawLimitNgn: 'daily_withdraw_limit_kobo' } as const

async function readSettings() {
  const out: Record<string, unknown> = {}
  for (const [name, def] of Object.entries(SETTING_MAP)) {
    const v = await setting(def.key)
    out[name] = v === 'true' || v === 'false' ? v === 'true' : Number(v)
  }
  for (const [name, key] of Object.entries(NGN_SETTINGS)) out[name] = fromUnits(BigInt(await setting(key)), 2)
  out.vaultAddressArc = await setting('vault_address_arc')
  out.vaultAddressSolana = await setting('vault_address_solana')
  out.vaultAddressBitcoin = await setting('vault_address_bitcoin')
  return out
}

route('GET', '/api/admin/settings', 'founder', async () => ({ settings: await readSettings() }))

route('PUT', '/api/admin/settings', 'founder', async (c) => {
  const schema = z.object({
    ...Object.fromEntries(Object.entries(SETTING_MAP).map(([k, d]) => [k, d.schema.optional()])),
    ...Object.fromEntries(Object.keys(NGN_SETTINGS).map((k) => [k, dec.optional()])),
    vaultAddressArc: z.string().max(50).optional(),
    vaultAddressSolana: z.string().max(60).optional(),
    vaultAddressBitcoin: z.string().max(100).optional(),
  })
  const b = body(c, schema) as Record<string, string | number | boolean | undefined>
  const before = await readSettings()
  for (const [name, val] of Object.entries(b)) {
    if (val === undefined) continue
    if (name === 'vaultAddressArc') {
      if (val !== '' && !isAddress(String(val))) throw new HttpError(400, 'Vault address is not a valid EVM address')
      await run('UPDATE settings SET value=? WHERE key=?', String(val).toLowerCase(), 'vault_address_arc')
    } else if (name === 'vaultAddressSolana' || name === 'vaultAddressBitcoin') {
      const family = name === 'vaultAddressSolana' ? 'solana' : 'bitcoin'
      if (val !== '' && !ADDRESS_CHECK[family](String(val).trim())) throw new HttpError(400, `That is not a valid ${family === 'solana' ? 'Solana' : 'Bitcoin'} address. Enter a public address, never a private key.`)
      await run('UPDATE settings SET value=? WHERE key=?', String(val).trim(), family === 'solana' ? 'vault_address_solana' : 'vault_address_bitcoin')
    } else if (name in NGN_SETTINGS) {
      await run('UPDATE settings SET value=? WHERE key=?', toUnits(String(val), 2).toString(), NGN_SETTINGS[name as keyof typeof NGN_SETTINGS])
    } else {
      await run('UPDATE settings SET value=? WHERE key=?', String(val), SETTING_MAP[name as keyof typeof SETTING_MAP].key)
    }
  }
  if (Number(await setting('risk_review_score')) > Number(await setting('risk_block_score'))) {
    for (const k of ['risk_review_score', 'risk_block_score']) await run('UPDATE settings SET value=? WHERE key=?', String(before[k === 'risk_review_score' ? 'riskReviewScore' : 'riskBlockScore']), k)
    throw new HttpError(400, 'Review score cannot exceed the block score')
  }
  await audit(c.user.id, 'settings.update', 'settings', before, await readSettings())
  return { settings: await readSettings() }
})

/* ---- assets and rates ---- */
route('GET', '/api/admin/assets', 'founder', async () => ({ assets: (await listAssets()).map(assetView) }))

route('PUT', '/api/admin/assets/:symbol', 'founder', async (c) => {
  const a = await getAsset(c.params.symbol)
  if (!a) throw new HttpError(404, 'Unknown asset')
  const b = body(c, z.object({ buyRate: dec, sellRate: dec, minNgn: dec, maxNgn: dec, enabled: z.boolean() }))
  const buy = toUnits(b.buyRate, 2), sell = toUnits(b.sellRate, 2)
  if (buy <= 0n || sell <= 0n) throw new HttpError(400, 'Rates must be above zero')
  if (buy < sell) throw new HttpError(400, 'Buy rate must be at least the sell rate (otherwise every round trip loses money)')
  const min = toUnits(b.minNgn, 2), max = toUnits(b.maxNgn, 2)
  if (min >= max) throw new HttpError(400, 'Minimum must be below maximum')
  const before = assetView(a)
  await run(
    `UPDATE assets SET buy_rate_kobo=?, sell_rate_kobo=?, min_ngn_kobo=?, max_ngn_kobo=?, enabled=?, rate_version=rate_version+1, rate_source='founder', updated_at=? WHERE symbol=?`,
    buy.toString(), sell.toString(), min.toString(), max.toString(), b.enabled ? 1 : 0, now(), a.symbol,
  )
  const after = assetView(await getAsset(a.symbol) as typeof a)
  await audit(c.user.id, 'asset.update', a.symbol, before, after)
  return { asset: after }
})

/* ---- users ---- */
route('GET', '/api/admin/users', 'founder', async () => ({
  users: await Promise.all((await all<{ id: string; email: string; name: string; role: string; kyc_tier: number; status: string; dev_preview: number; created_at: number }>('SELECT * FROM users ORDER BY created_at DESC LIMIT 200')).map(async (u) => ({
    id: u.id, email: u.email, name: u.name, role: u.role, kycTier: u.kyc_tier, status: u.status, devPreview: Boolean(u.dev_preview), createdAt: u.created_at,
    ngn: fromUnits((await balancesFor(u.id)).NGN ?? 0n, 2),
    orders: (await get<{ c: number }>('SELECT COUNT(*) c FROM orders WHERE user_id=?', u.id))?.c ?? 0,
  }))),
}))

route('PATCH', '/api/admin/users/:id', 'founder', async (c) => {
  const b = body(c, z.object({ status: z.enum(['active', 'suspended']).optional(), kycTier: z.number().int().min(1).max(3).optional() }))
  const u = await get<{ id: string; role: string; status: string; kyc_tier: number }>('SELECT * FROM users WHERE id=?', c.params.id)
  if (!u) throw new HttpError(404, 'User not found')
  if (u.role === 'founder' && b.status) throw new HttpError(400, 'Founder accounts cannot be suspended')
  if (b.status) await run('UPDATE users SET status=? WHERE id=?', b.status, u.id)
  if (b.status === 'suspended') await run('DELETE FROM sessions WHERE user_id=?', u.id)
  if (b.kycTier) await run('UPDATE users SET kyc_tier=? WHERE id=?', b.kycTier, u.id)
  await audit(c.user.id, 'user.update', u.id, { status: u.status, kycTier: u.kyc_tier }, b)
  return { ok: true }
})

/* ---- orders, alerts, audit ---- */
route('GET', '/api/admin/orders', 'founder', async (c) => {
  const status = c.url.searchParams.get('status')
  const rows = status
    ? await all<OrderRow>('SELECT * FROM orders WHERE status=? ORDER BY created_at DESC LIMIT 100', status)
    : await all<OrderRow>('SELECT * FROM orders ORDER BY created_at DESC LIMIT 100')
  return { orders: await Promise.all(rows.map(async (o) => ({ ...await orderView(o), userEmail: (await get<{ email: string }>('SELECT email FROM users WHERE id=?', o.user_id))?.email }))) }
})

route('POST', '/api/admin/orders/:id/review', 'founder', async (c) => {
  const b = body(c, z.object({ action: z.enum(['approve', 'reject']) }))
  const o = await getOrder(c.params.id)
  if (!o || o.status !== 'flagged') throw new HttpError(409, 'Only flagged orders can be reviewed')
  if (b.action === 'reject') {
    await failOrder(o.id, 'rejected', 'Rejected by founder review')
  } else {
    const tx = await get<{ verdict: string; status: string; amount: string }>('SELECT * FROM chain_txs WHERE order_id=? ORDER BY first_seen_at DESC LIMIT 1', o.id)
    if (o.side !== 'sell' || !tx || tx.verdict !== 'genuine' || tx.amount !== o.crypto_amount || tx.status !== 'finalized') {
      throw new HttpError(400, 'Approval needs a finalized, genuine deposit that matches the quote exactly. Reject instead.')
    }
    await setStatus(o.id, 'detected', 'review.approved', 'Founder approved after review')
    await enqueue(`order.payout:${o.id}:review`, 'order.payout', { orderId: o.id, instant: false })
  }
  await audit(c.user.id, `order.review.${b.action}`, o.id)
  return { ok: true }
})

route('GET', '/api/admin/alerts', 'founder', async () => ({ alerts: await all('SELECT * FROM alerts ORDER BY id DESC LIMIT 100') }))
route('POST', '/api/admin/alerts/:id/resolve', 'founder', async (c) => {
  await run('UPDATE alerts SET resolved=1 WHERE id=?', c.params.id)
  await audit(c.user.id, 'alert.resolve', c.params.id)
  return { ok: true }
})
route('GET', '/api/admin/audit', 'founder', async () => ({ logs: await all('SELECT a.*, u.email actor FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 100') }))

/* ---- sandbox liquidity ---- */
route('POST', '/api/admin/liquidity', 'founder', async (c) => {
  const b = body(c, z.object({ asset: z.string().max(10), direction: z.enum(['add', 'remove']), amount: z.string().regex(/^\d+(\.\d+)?$/) }))
  const decimals = b.asset === 'NGN' ? 2 : (await getAsset(b.asset))?.decimals
  if (decimals === undefined) throw new HttpError(404, 'Unknown asset')
  const units = toUnits(b.amount, decimals)
  const before = await balanceOf('house', b.asset)
  await post({ owner: 'house', asset: b.asset, delta: b.direction === 'add' ? units : -units, reason: `founder ${b.direction} (sandbox liquidity)`, idem: `liq:${uid('l')}` })
  await audit(c.user.id, 'liquidity.adjust', b.asset, fromUnits(before, decimals), fromUnits(await balanceOf('house', b.asset), decimals))
  return { ok: true }
})
