/**
 * NairaSwap API: previews for both signing methods, and in-app signing after a PIN.
 * Browser-wallet users get the checked steps and sign them in their own wallet. Nothing here ever returns a key.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { createWalletClient, getAddress, http, isAddress, type Address } from 'viem'
import { z } from 'zod'
import { CONFIG } from '../config'
import { HttpError, type User } from '../auth'
import { all, alert, audit, get, notify, now, run, setting, uid } from '../db'
import { body, route } from '../http'
import { assertOperational, verifyPin } from '../naira/wallet'
import { scrub } from '../rpc'
import { evmBroadcastUrl, evmChain, evmClient } from '../wallet/chains'
import { ensureWallet, withEvmAccount } from '../wallet/keys'
import { ASSETS } from '../wallet/networks'
import { recordDexHistory } from '../wallet/history'
import { syncUser, walletLimits } from '../wallet/service'
import { toUnits } from '../money'
import {
  DEX_NETWORKS, buildSteps, dexConfig, dexTokens, listPools, previewAdd, previewRemove, previewSwap, routerAbi,
  type DexParams, type Preview,
} from './nairaswap'

const addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/)
const uint = z.string().regex(/^\d{1,40}$/)
const net = z.string().max(40)
const amount = z.string().regex(/^\d+(\.\d+)?$/, 'Enter a valid amount').max(40)

const paramsSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('swap'), tokenIn: addr, tokenOut: addr, amountIn: uint, minOut: uint, deadline: z.number().int() }).strict(),
  z.object({ kind: z.literal('add'), tokenA: addr, tokenB: addr, amountA: uint, amountB: uint, minA: uint, minB: uint, deadline: z.number().int() }).strict(),
  z.object({ kind: z.literal('remove'), tokenA: addr, tokenB: addr, liquidity: uint, minA: uint, minB: uint, deadline: z.number().int() }).strict(),
])

const previewSchema = z.object({
  networkId: net, signer: z.enum(['app', 'browser']), address: addr.optional(), slippageBps: z.number().int().optional(),
  action: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('swap'), tokenIn: z.string().max(60), tokenOut: z.string().max(60), amount }),
    z.object({ kind: z.literal('add'), tokenA: z.string().max(60), tokenB: z.string().max(60), amountA: amount, amountB: amount }),
    z.object({ kind: z.literal('remove'), tokenA: z.string().max(60), tokenB: z.string().max(60), percent: z.number().int() }),
  ]),
})

const bindingSig = (userId: string, networkId: string, from: string, params: DexParams, exp: number) =>
  createHmac('sha256', CONFIG.walletMasterKey).update(JSON.stringify(['nairaswap', userId, networkId, from.toLowerCase(), params, exp])).digest('base64url')

const safeEq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

route('GET', '/api/nairaswap/config', 'user', () => ({
  networks: DEX_NETWORKS.map((id) => {
    const c = dexConfig(id)
    return { id, chainId: c.chainId, router: c.router, factory: c.factory, treasury: c.treasury, tokens: dexTokens(id).map((t) => ({ key: t.key, symbol: t.symbol, name: t.name, decimals: t.decimals, contract: t.contract })) }
  }),
}))

route('GET', '/api/nairaswap/pools', 'user', async (c) => {
  const networkId = z.string().parse(c.url.searchParams.get('networkId'))
  const wallet = await ensureWallet(c.user.id)
  return await listPools(networkId, wallet.evm as Address)
}, [40, 60_000])

route('POST', '/api/nairaswap/preview', 'user', async (c) => {
  const b = body(c, previewSchema)
  let from: Address
  if (b.signer === 'app') from = (await ensureWallet(c.user.id)).evm as Address
  else {
    if (!b.address || !isAddress(b.address)) throw new HttpError(400, 'Connect your wallet first')
    from = getAddress(b.address)
  }
  const a = b.action
  let preview: Preview
  try {
    preview = a.kind === 'swap' ? await previewSwap(b.networkId, from, { ...a, tokenIn: a.tokenIn, tokenOut: a.tokenOut, slippageBps: b.slippageBps })
      : a.kind === 'add' ? await previewAdd(b.networkId, from, { ...a, slippageBps: b.slippageBps })
      : await previewRemove(b.networkId, from, { ...a, slippageBps: b.slippageBps })
  } catch (e) {
    if (e instanceof HttpError) throw e
    throw new HttpError(502, `Could not read the exchange right now: ${scrub(e)}`)
  }
  const expiresAt = now() + 120_000
  return { preview, expiresAt, confirmToken: b.signer === 'app' ? bindingSig(c.user.id, preview.networkId, from, preview.params, expiresAt) : null }
}, [30, 60_000])

/** Per-transaction send limit for the token being spent, set by the founder. A token with no limit cannot be traded in-app. */
async function checkLimit(p: DexParams) {
  const limits = await walletLimits()
  const spend: Array<[string, bigint]> = p.kind === 'swap' ? [[p.tokenIn, BigInt(p.amountIn)]] : p.kind === 'add' ? [[p.tokenA, BigInt(p.amountA)], [p.tokenB, BigInt(p.amountB)]] : []
  for (const [token, raw] of spend) {
    const def = ASSETS.find((x) => x.contract?.toLowerCase() === token.toLowerCase())
    if (!def) throw new HttpError(400, 'That token is not available for the exchange')
    const cap = limits.perTx[def.symbol]
    if (!cap) throw new HttpError(403, `Trading ${def.symbol} is not switched on yet: no limit has been set for it.`)
    if (raw > toUnits(cap, def.decimals)) throw new HttpError(403, `Per-transaction limit is ${cap} ${def.symbol}`)
  }
}

const locks = new Map<string, Promise<unknown>>()
const serial = <T>(key: string, fn: () => Promise<T>): Promise<T> => {
  const next = (locks.get(key) ?? Promise.resolve()).catch(() => undefined).then(fn)
  locks.set(key, next)
  return next
}

const labels = { swap: 'Swap', add: 'Add liquidity', remove: 'Remove liquidity' } as const

async function executeInApp(user: User, networkId: string, params: DexParams, idemKey: string) {
  const existing = await get<Record<string, unknown>>('SELECT * FROM dex_ops WHERE user_id=? AND idem_key=?', user.id, idemKey)
  if (existing) return opView(existing)
  const cfg = dexConfig(networkId)
  const from = (await ensureWallet(user.id)).evm as Address
  const id = uid('dex')
  try {
    await run('INSERT INTO dex_ops(id,user_id,network,kind,summary,hashes,status,idem_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      id, user.id, cfg.networkId, params.kind, labels[params.kind], '[]', 'signing', idemKey, now(), now())
  } catch {
    const dupe = await get<Record<string, unknown>>('SELECT * FROM dex_ops WHERE user_id=? AND idem_key=?', user.id, idemKey)
    if (dupe) return opView(dupe)
    throw new HttpError(409, 'Could not record this operation')
  }
  const hashes: string[] = []
  const fail = async (status: 'failed' | 'rejected', msg: string, http = 502): Promise<never> => {
    await run('UPDATE dex_ops SET status=?, note=?, hashes=?, updated_at=? WHERE id=?', status, msg, JSON.stringify(hashes), now(), id)
    if (hashes.length) await alert('warning', 'dex_op_failed', `${labels[params.kind]} did not finish`, msg, user.id)
    throw new HttpError(http, msg)
  }
  if (params.deadline * 1000 < now()) return await fail('rejected', 'This confirmation expired. Review the details again.', 410)
  const client = evmClient(cfg.networkId)
  if (params.kind === 'swap') {
    // Last look before signing: if the pool moved past the confirmed minimum, do not send anything.
    const out = (await client.readContract({ address: cfg.router, abi: routerAbi, functionName: 'getAmountsOut', args: [BigInt(params.amountIn), [params.tokenIn as Address, params.tokenOut as Address]] }))[1]
    if (out < BigInt(params.minOut)) return await fail('rejected', 'The price moved past your limit. Nothing was sent. Get a new quote.', 409)
  }
  try {
    const steps = await buildSteps(cfg, from, params)
    await withEvmAccount(user.id, async (account) => {
      const wc = createWalletClient({ account, chain: evmChain(cfg.networkId), transport: http(evmBroadcastUrl(cfg.networkId), { timeout: 20_000 }) })
      for (const s of steps) {
        const hash = await wc.sendTransaction({ to: s.to, data: s.data, value: 0n })
        hashes.push(hash)
        await run('UPDATE dex_ops SET hashes=?, updated_at=? WHERE id=?', JSON.stringify(hashes), now(), id)
        const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000 })
        if (receipt.status !== 'success') throw new Error(`${s.label} failed onchain`)
      }
    })
  } catch (e) {
    return await fail('failed', `The network rejected it: ${scrub(e)}`)
  }
  await run("UPDATE dex_ops SET status='confirmed', hashes=?, updated_at=? WHERE id=?", JSON.stringify(hashes), now(), id)
  await audit(user.id, `dex.${params.kind}`, id, undefined, { network: cfg.networkId, params, hashes })
  await recordDexHistory(user.id, cfg.networkId, hashes, params.kind).catch(() => undefined) // History is best effort: the swap itself is done
  void syncUser(user.id).catch(() => undefined)
  await notify(user.id, 'order', `${labels[params.kind]} complete`, `Confirmed on ${cfg.networkId === 'arc-testnet' ? 'Arc Testnet' : 'Base Sepolia'}.`)
  return opView(await get<Record<string, unknown>>('SELECT * FROM dex_ops WHERE id=?', id) as Record<string, unknown>)
}

route('POST', '/api/nairaswap/execute', 'user', async (c) => {
  const b = body(c, z.object({ networkId: net, params: paramsSchema, expiresAt: z.number(), confirmToken: z.string().max(100), pin: z.string().max(12), idempotencyKey: z.string().min(8).max(80) }))
  const from = (await ensureWallet(c.user.id)).evm
  const params = b.params as DexParams
  if (b.expiresAt < now()) throw new HttpError(410, 'This confirmation expired. Review the details again.')
  if (!safeEq(bindingSig(c.user.id, b.networkId, from, params, b.expiresAt), b.confirmToken)) throw new HttpError(400, 'The details changed after confirmation. Review them again.')
  if (await setting('platform_paused') === 'true') throw new HttpError(503, 'Onchain trading is temporarily paused')
  await assertOperational(c.user.id)
  await verifyPin(c.user.id, b.pin)
  await checkLimit(params)
  return { op: await serial(c.user.id, () => executeInApp(c.user, b.networkId, params, b.idempotencyKey)) }
}, [10, 60_000])

function opView(r: Record<string, unknown>) {
  const network = String(r.network)
  const base = ({ 'arc-testnet': 'https://explorer.testnet.arc.io/tx/', 'ethereum-sepolia': 'https://sepolia.etherscan.io/tx/' } as Record<string, string>)[network] ?? 'https://sepolia.basescan.org/tx/'
  const hashes = JSON.parse(String(r.hashes)) as string[]
  return { id: r.id, network, kind: r.kind, summary: r.summary, status: r.status, note: r.note, hashes, links: hashes.map((h) => base + h), createdAt: r.created_at }
}

route('GET', '/api/nairaswap/ops', 'user', async (c) => {
  const rows = await all<Record<string, unknown>>('SELECT * FROM dex_ops WHERE user_id=? ORDER BY created_at DESC LIMIT 50', c.user.id)
  return { ops: rows.map(opView) }
})
