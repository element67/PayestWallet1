/** Uniswap swap API (test networks): config with the user's balances, quote (no signing), start (PIN), status and history. */
import { z } from 'zod'
import { body, route } from '../http'
import { fromUnits } from '../money'
import { readBalance } from '../wallet/chains'
import { ensureWallet } from '../wallet/keys'
import { UNI_NETWORKS, uniNetwork } from './config'
import { getSwapOp, listSwapOps } from './shared'
import { quoteUni, startUni, uniTokens, UNI_DEFAULT_SLIPPAGE_BPS, UNI_MAX_SLIPPAGE_BPS } from './service'

const input = z.object({
  networkId: z.string().max(40),
  tokenIn: z.string().max(12), tokenOut: z.string().max(12),
  amount: z.string().regex(/^\d+(\.\d+)?$/, 'Enter a valid amount').max(40),
  slippageBps: z.number().int().optional(),
})
const pin = z.string().regex(/^\d{4}$/, 'PIN must be 4 digits')

route('GET', '/api/uniswap/config', 'user', async (c) => {
  const net = uniNetwork(c.url.searchParams.get('network') ?? UNI_NETWORKS[0].id)
  const addrs = await ensureWallet(c.user.id)
  const tokens = await Promise.all(uniTokens(net.id).map(async (t) => {
    // A balance that cannot be read shows as unknown, never as a made-up number.
    const raw = await readBalance(t, addrs.evm).then((r) => r.raw).catch(() => null)
    return { symbol: t.symbol.toUpperCase(), label: t.symbol, name: t.name, balance: raw === null ? null : fromUnits(raw, t.decimals) }
  }))
  return {
    chain: net.name, networkId: net.id, network: 'testnet', networks: UNI_NETWORKS.map((n) => ({ id: n.id, name: n.name })), tokens,
    slippage: { defaultBps: UNI_DEFAULT_SLIPPAGE_BPS, maxBps: UNI_MAX_SLIPPAGE_BPS },
  }
}, [30, 60_000])

route('POST', '/api/uniswap/quote', 'user', async (c) => ({ quote: await quoteUni(c.user, body(c, input)) }), [20, 60_000])

route('POST', '/api/uniswap/start', 'user', async (c) => {
  const b = body(c, input.extend({ feeTier: z.number().int(), minimumOutRaw: z.string().max(40), confirmToken: z.string().max(100), expiresAt: z.number(), pin, idempotencyKey: z.string().min(8).max(80) }))
  return { op: await startUni(c.user, b, b.feeTier, b.minimumOutRaw, b.confirmToken, b.expiresAt, b.pin, b.idempotencyKey) }
}, [6, 60_000])

route('GET', '/api/uniswap/ops/:id', 'user', async (c) => ({ op: await getSwapOp(c.user, c.params.id) }), [120, 60_000])
route('GET', '/api/uniswap/ops', 'user', async (c) => ({ ops: await listSwapOps(c.user) }))
