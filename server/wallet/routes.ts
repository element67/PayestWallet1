/** Crypto wallet API. No route ever returns a seed phrase or private key. */
import { z } from 'zod'
import { HttpError } from '../auth'
import { all, audit, get, run, setting } from '../db'
import { body, route } from '../http'
import { ensureWallet } from './keys'
import { ASSETS, getAssetDef, getNetwork } from './networks'
import { executeSend, hasBalances, needsSync, networksView, portfolio, prepareSend, recordSimulated, syncUser, txView, walletLimits } from './service'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * One request for everything Overview shows. Served from stored, chain-verified balances; a stale wallet is re-read in the
 * background. Only a brand-new wallet (nothing stored yet) waits for the first read, and for at most 5 seconds.
 */
route('GET', '/api/crypto/overview', 'user', async (c) => {
  await ensureWallet(c.user.id)
  if (needsSync(c.user.id)) {
    const pass = syncUser(c.user.id)
    if (!await hasBalances(c.user.id)) await Promise.race([pass, sleep(5000)])
  }
  return await portfolio(c.user.id)
}, [90, 60_000])

route('POST', '/api/crypto/refresh', 'user', async (c) => {
  await syncUser(c.user.id)
  return await portfolio(c.user.id)
}, [12, 60_000])

route('GET', '/api/crypto/addresses', 'user', async (c) => ({ networks: await networksView(await ensureWallet(c.user.id)) }))

const sendSchema = z.object({
  networkId: z.string().max(40), assetKey: z.string().max(60), to: z.string().min(10).max(100), amount: z.string().regex(/^\d+(\.\d+)?$/, 'Enter a valid amount').max(40),
})

route('POST', '/api/crypto/send/prepare', 'user', async (c) => ({ preview: await prepareSend(c.user, body(c, sendSchema)) }), [30, 60_000])

route('POST', '/api/crypto/send', 'user', async (c) => {
  const b = body(c, sendSchema.extend({ confirmToken: z.string().max(100), expiresAt: z.number(), idempotencyKey: z.string().min(8).max(80) }))
  return { tx: await executeSend(c.user, b, b.confirmToken, b.expiresAt, b.idempotencyKey) }
}, [10, 60_000])

route('GET', '/api/crypto/txs', 'user', async (c) => {
  const type = c.url.searchParams.get('type')
  const asset = c.url.searchParams.get('asset')
  const rows = await all<Record<string, unknown>>(
    // A swap or bridge is shown as its own "paid" and "received" entries, so the plain deposit the monitor also saw for the same
    // transaction is left out instead of listing the same money twice.
    `SELECT * FROM wallet_txs w WHERE w.user_id=? ${type ? 'AND w.type=?' : ''} ${asset ? 'AND w.symbol=?' : ''}
       AND NOT (w.type='received' AND EXISTS (SELECT 1 FROM wallet_txs s WHERE s.user_id=w.user_id AND s.tx_hash=w.tx_hash AND s.type IN ('swapped','bridged')))
     ORDER BY w.created_at DESC LIMIT 200`,
    c.user.id, ...(type ? [type] : []), ...(asset ? [asset] : []),
  )
  return { txs: rows.map(txView) }
})

route('GET', '/api/crypto/txs/:id', 'user', async (c) => {
  const t = await get<Record<string, unknown>>('SELECT * FROM wallet_txs WHERE id=? AND user_id=?', c.params.id, c.user.id)
  if (!t) throw new HttpError(404, 'Transaction not found')
  const decisions = await all<{ at: number; decision: string; reasons: string }>('SELECT at, decision, reasons FROM agent_decisions WHERE tx_id=? ORDER BY id', c.params.id)
  return { tx: txView(t), decisions: decisions.map((d) => ({ at: d.at, decision: d.decision, reasons: JSON.parse(d.reasons) as string[] })) }
})

route('GET', '/api/crypto/limits', 'user', async () => ({ limits: await walletLimits() }))

route('POST', '/api/crypto/sandbox/simulate', 'user', async (c) => {
  const b = body(c, z.object({ kind: z.enum(['unverified_token', 'failed_send']) }))
  return await recordSimulated(c.user, b.kind)
}, [10, 60_000])

/** Honest status of the external providers that swap, bridge and buy need. */
route('GET', '/api/crypto/integrations', 'user', () => ({
  integrations: [
    { id: 'swap', label: 'Swap', provider: 'Circle Swap Kit or a DEX router (for example Uniswap on Arc mainnet)', requires: 'Circle API key and mainnet routes. Testnet tokens have no liquidity pools.', status: 'not_connected', live: 'Swaps between your exchange balances work today (sandbox ledger, founder rates).' },
    { id: 'bridge', label: 'Bridge', provider: 'Circle Bridge Kit (CCTP)', requires: 'No API key. Needs the signing adapter wired to the wallet service.', status: 'not_connected' },
    { id: 'buy', label: 'Buy with card or bank', provider: 'Circle Onramp', requires: 'Onramp API key and, for production, KYB approval.', status: 'not_connected', live: 'Buying crypto with your Naira wallet works today through the P2P exchange (sandbox).' },
  ],
}))

/* ---- founder: wallet policy ---- */
route('GET', '/api/admin/wallet-config', 'founder', async () => ({
  limits: await walletLimits(), ethRateNgn: await setting('eth_rate_ngn') || '',
  wallets: (await get<{ c: number }>('SELECT COUNT(*) c FROM wallets'))?.c ?? 0,
  assets: ASSETS.map((a) => ({ key: a.key, network: getNetwork(a.network)?.name })),
}))

const amountMap = z.record(z.string().max(10), z.string().regex(/^\d+(\.\d+)?$/).max(20))
route('PUT', '/api/admin/wallet-config', 'founder', async (c) => {
  const b = body(c, z.object({ perTx: amountMap, daily: amountMap, ethRateNgn: z.string().regex(/^(\d+(\.\d{1,2})?)?$/).max(20) }))
  const before = { limits: await walletLimits(), ethRateNgn: await setting('eth_rate_ngn') }
  await run('UPDATE settings SET value=? WHERE key=?', JSON.stringify({ perTx: b.perTx, daily: b.daily }), 'wallet_limits')
  await run('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', 'eth_rate_ngn', b.ethRateNgn)
  await audit(c.user.id, 'wallet.config.update', 'wallet', before, b)
  return { ok: true }
})

export { getAssetDef }
