/** Token registry API. Users read; only founders can change the registry, enforced here on the server. */
import { z } from 'zod'
import { HttpError } from '../auth'
import { body, route } from '../http'
import { ensureWallet } from '../wallet/keys'
import { needsSync, syncUser } from '../wallet/service'
import { regNetwork } from './networks'
import { addDeployment, addToken, adminTokens, listNetworks, listTokens, setDeploymentActive, setTokenActive, setTokenMeta, userTokenBalances } from './service'

const networkId = z.string().regex(/^[a-z0-9-]{2,30}$/)
const symbol = z.string().regex(/^[A-Za-z0-9]{2,10}$/, 'Symbol must be 2 to 10 letters or digits')

route('GET', '/api/tokens', 'user', () => ({ tokens: listTokens(), networks: listNetworks() }), [60, 60_000])

route('GET', '/api/tokens/networks', 'user', () => ({ networks: listNetworks() }), [60, 60_000])

route('GET', '/api/tokens/by-network/:networkId', 'user', (c) => {
  const id = networkId.parse(c.params.networkId)
  if (!regNetwork(id)) throw new HttpError(404, 'Unknown network')
  return { networkId: id, tokens: listTokens(id) }
}, [60, 60_000])

/** The signed-in user's own balances only. The user id never comes from the request. */
route('GET', '/api/tokens/balances', 'user', (c) => {
  ensureWallet(c.user.id)
  if (needsSync(c.user.id)) void syncUser(c.user.id)
  return { balances: userTokenBalances(c.user.id), asOf: Date.now() }
}, [40, 60_000])

/* ---------------- founder only ---------------- */

route('GET', '/api/admin/tokens', 'founder', () => ({ tokens: adminTokens(), networks: listNetworks(true) }), [60, 60_000])

route('POST', '/api/admin/tokens', 'founder', (c) => {
  const b = body(c, z.object({ symbol, name: z.string().trim().min(2).max(40), decimals: z.number().int().min(0).max(36), logo: z.string().trim().max(40).optional(), popular: z.boolean().optional() }))
  addToken(c.user.id, b)
  return { ok: true }
}, [15, 60_000])

route('PATCH', '/api/admin/tokens/:symbol', 'founder', (c) => {
  const sym = symbol.parse(c.params.symbol)
  const b = body(c, z.object({ active: z.boolean().optional(), popular: z.boolean().optional(), name: z.string().trim().min(2).max(40).optional(), logo: z.string().trim().max(40).optional() }))
  if (b.active !== undefined) setTokenActive(c.user.id, sym, b.active)
  if (b.popular !== undefined || b.name !== undefined || b.logo !== undefined) setTokenMeta(c.user.id, sym, b)
  return { ok: true }
}, [30, 60_000])

route('POST', '/api/admin/tokens/:symbol/networks', 'founder', async (c) => {
  const b = body(c, z.object({ networkId, contract: z.string().trim().max(42).nullable().optional() }))
  await addDeployment(c.user.id, { symbol: symbol.parse(c.params.symbol), networkId: b.networkId, contract: b.contract ?? null })
  return { ok: true }
}, [15, 60_000])

route('PATCH', '/api/admin/tokens/:symbol/networks/:networkId', 'founder', (c) => {
  const b = body(c, z.object({ active: z.boolean() }))
  setDeploymentActive(c.user.id, symbol.parse(c.params.symbol), networkId.parse(c.params.networkId), b.active)
  return { ok: true }
}, [30, 60_000])
