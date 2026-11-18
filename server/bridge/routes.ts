/** Bridge API: preview, start (PIN), status, resume (PIN), history. The wallet key never leaves the server. */
import { z } from 'zod'
import { body, route } from '../http'
import { bridgeChains } from './chains'
import { getBridgeOp, listBridgeOps, previewBridge, retryBridge, startBridge } from './service'

const input = z.object({ from: z.string().max(40), to: z.string().max(40), amount: z.string().regex(/^\d+(\.\d+)?$/, 'Enter a valid amount').max(20) })
const pin = z.string().regex(/^\d{4}$/, 'PIN must be 4 digits')

route('GET', '/api/bridge/config', 'user', () => ({
  chains: bridgeChains().map((c) => ({ id: c.id, name: c.name, family: c.family, kit: c.kit, chainId: c.chainId ?? null, gasSymbol: c.gasSymbol })),
  token: 'USDC',
}))

route('POST', '/api/bridge/preview', 'user', async (c) => ({ preview: await previewBridge(c.user, body(c, input) as never) }), [20, 60_000])

route('POST', '/api/bridge/start', 'user', async (c) => {
  const b = body(c, input.extend({ confirmToken: z.string().max(100), expiresAt: z.number(), pin, idempotencyKey: z.string().min(8).max(80) }))
  return { op: await startBridge(c.user, b as never, b.confirmToken, b.expiresAt, b.pin, b.idempotencyKey) }
}, [6, 60_000])

route('POST', '/api/bridge/ops/:id/retry', 'user', async (c) => ({ op: await retryBridge(c.user, c.params.id, body(c, z.object({ pin })).pin) }), [6, 60_000])
route('GET', '/api/bridge/ops/:id', 'user', async (c) => ({ op: await getBridgeOp(c.user, c.params.id) }), [120, 60_000])
route('GET', '/api/bridge/ops', 'user', async (c) => ({ ops: await listBridgeOps(c.user) }))
