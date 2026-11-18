/** Circle swap API (Arc Testnet): config, quote (no signing), start (PIN), status, history. The wallet key never leaves the server. */
import { z } from 'zod'
import { body, route } from '../http'
import { SWAP_CHAIN_NAME, SWAP_TOKENS } from './chains'
import { DEFAULT_SLIPPAGE_BPS, MAX_SLIPPAGE_BPS, getSwapOp, listSwapOps, quoteSwap, startSwap } from './service'

const input = z.object({
  tokenIn: z.string().max(12), tokenOut: z.string().max(12),
  amount: z.string().regex(/^\d+(\.\d+)?$/, 'Enter a valid amount').max(24),
  slippageBps: z.number().int().optional(),
})
const pin = z.string().regex(/^\d{4}$/, 'PIN must be 4 digits')

route('GET', '/api/swap/config', 'user', () => ({
  chain: SWAP_CHAIN_NAME, network: 'testnet',
  tokens: SWAP_TOKENS.map((t) => ({ symbol: t.symbol, label: t.label, name: t.name })),
  slippage: { defaultBps: DEFAULT_SLIPPAGE_BPS, maxBps: MAX_SLIPPAGE_BPS },
}))

route('POST', '/api/swap/quote', 'user', async (c) => ({ quote: await quoteSwap(c.user, body(c, input)) }), [20, 60_000])

route('POST', '/api/swap/start', 'user', async (c) => {
  const b = body(c, input.extend({ confirmToken: z.string().max(100), expiresAt: z.number(), pin, idempotencyKey: z.string().min(8).max(80) }))
  return { op: await startSwap(c.user, b, b.confirmToken, b.expiresAt, b.pin, b.idempotencyKey) }
}, [6, 60_000])

route('GET', '/api/swap/ops/:id', 'user', async (c) => ({ op: await getSwapOp(c.user, c.params.id) }), [120, 60_000])
route('GET', '/api/swap/ops', 'user', async (c) => ({ ops: await listSwapOps(c.user) }))
