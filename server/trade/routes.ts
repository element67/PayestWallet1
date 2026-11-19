/** Trade API: config, balances, quote (no signing), start (PIN), status, resume, history, bridged balances, and the founder's settings. */
import { isAddress } from 'viem'
import { z } from 'zod'
import { HttpError } from '../auth'
import { audit } from '../db'
import { body, route } from '../http'
import { fromUnits } from '../money'
import { ensureWallet } from '../wallet/keys'
import { findTradeChain, tokenBalance, tokensFor, tradeChains } from './chains'
import { DEFAULT_SLIPPAGE_BPS, MAX_FEE_BPS, MAX_SLIPPAGE_BPS, providerStatus, readTradeSettings, saveTradeFee, saveTradeMode, tradeMode } from './config'
import { bridgedHoldings } from './holdings'
import { PROVIDERS } from './router'
import { buildRequest, getTradeOp, listTradeOps, quoteTrade, resumeTrade, startTrade } from './service'

const input = z.object({
  kind: z.enum(['swap', 'bridge']), from: z.string().max(40), to: z.string().max(40), tokenIn: z.string().max(12), tokenOut: z.string().max(12).optional(),
  amount: z.string().regex(/^\d+(\.\d+)?$/, 'Enter a valid amount').max(24), slippageBps: z.number().int().optional(), speed: z.enum(['fast', 'slow']).optional(),
})
const pin = z.string().regex(/^\d{4}$/, 'PIN must be 4 digits')

route('GET', '/api/trade/config', 'user', async () => {
  const mode = await tradeMode()
  const chains = tradeChains(mode)
  // A network is offered for swaps only when some provider can run a swap there.
  const swapOk = (c: (typeof chains)[number]) => {
    const toks = tokensFor(c, 'swap')
    if (toks.length < 2) return false
    try {
      const req = buildRequest(mode, { kind: 'swap', from: c.id, to: c.id, tokenIn: toks[0].symbol, tokenOut: toks[1].symbol, amount: '1' })
      return Object.values(PROVIDERS).some((p) => p.unsupported(req, mode) === null)
    } catch { return false }
  }
  return {
    mode, testnet: mode === 'testnet', slippage: { defaultBps: DEFAULT_SLIPPAGE_BPS, maxBps: MAX_SLIPPAGE_BPS }, providers: providerStatus(),
    chains: chains.map((c) => ({ id: c.id, name: c.name, family: c.family, gasSymbol: c.gasSymbol, swap: swapOk(c), swapTokens: swapOk(c) ? tokensFor(c, 'swap').map((t) => ({ symbol: t.symbol, label: t.label, name: t.name })) : [], bridgeTokens: tokensFor(c, 'bridge').map((t) => ({ symbol: t.symbol, label: t.label, name: t.name })) })),
  }
}, [60, 60_000])

/** The user's real balance of every token a network offers. A balance that cannot be read is null, never a made-up number. */
route('GET', '/api/trade/balances', 'user', async (c) => {
  const mode = await tradeMode()
  const chain = findTradeChain(mode, c.url.searchParams.get('chain'))
  if (!chain) throw new HttpError(400, 'Choose a supported network')
  const a = await ensureWallet(c.user.id)
  const who = { userId: c.user.id, evm: a.evm, solana: a.solana }
  const kinds = new Map([...tokensFor(chain, 'swap'), ...tokensFor(chain, 'bridge')].map((t) => [t.symbol, t]))
  const balances: Record<string, string | null> = {}
  await Promise.all([...kinds.values()].map(async (t) => { balances[t.symbol] = await tokenBalance(chain, t, who).then((r) => (r === null ? null : fromUnits(r, t.decimals))).catch(() => null) }))
  return { chain: chain.id, balances }
}, [60, 60_000])

/** The user's balance of one token on every network that offers it, for the network list. A network that is slow or cannot be read is null. */
const chainBalanceCache = new Map<string, { at: number; balances: Record<string, string | null> }>()
route('GET', '/api/trade/chain-balances', 'user', async (c) => {
  const mode = await tradeMode()
  const symbol = String(c.url.searchParams.get('token') ?? '').toUpperCase()
  if (!/^[A-Z0-9]{2,12}$/.test(symbol)) throw new HttpError(400, 'Choose a token')
  const key = `${c.user.id}:${mode}:${symbol}`
  const hit = chainBalanceCache.get(key)
  if (hit && Date.now() - hit.at < 15_000) return { token: symbol, balances: hit.balances }
  const a = await ensureWallet(c.user.id)
  const who = { userId: c.user.id, evm: a.evm, solana: a.solana }
  const balances: Record<string, string | null> = {}
  await Promise.all(tradeChains(mode).map(async (chain) => {
    const token = tokensFor(chain, 'bridge').find((t) => t.symbol === symbol)
    if (!token) return
    const read = tokenBalance(chain, token, who).then((r) => (r === null ? null : fromUnits(r, token.decimals))).catch(() => null)
    balances[chain.id] = await Promise.race([read, new Promise<null>((res) => setTimeout(() => res(null), 5000))])
  }))
  chainBalanceCache.set(key, { at: Date.now(), balances })
  return { token: symbol, balances }
}, [30, 60_000])

route('POST', '/api/trade/quote', 'user', async (c) => ({ quote: await quoteTrade(c.user, body(c, input)) }), [20, 60_000])

route('POST', '/api/trade/start', 'user', async (c) => {
  const b = body(c, input.extend({ provider: z.string().max(20), confirmToken: z.string().max(100), expiresAt: z.number(), pin, idempotencyKey: z.string().min(8).max(80) }))
  return { op: await startTrade(c.user, b, b.provider, b.confirmToken, b.expiresAt, b.pin, b.idempotencyKey) }
}, [6, 60_000])

route('POST', '/api/trade/ops/:id/resume', 'user', async (c) => ({ op: await resumeTrade(c.user, c.params.id, body(c, z.object({ pin })).pin) }), [6, 60_000])
route('GET', '/api/trade/ops/:id', 'user', async (c) => ({ op: await getTradeOp(c.user, c.params.id) }), [120, 60_000])
route('GET', '/api/trade/ops', 'user', async (c) => ({ ops: await listTradeOps(c.user) }))

route('GET', '/api/trade/holdings', 'user', async (c) => {
  const a = await ensureWallet(c.user.id)
  return { holdings: await bridgedHoldings({ userId: c.user.id, evm: a.evm, solana: a.solana }) }
}, [30, 60_000])

/* ---------------- founder settings ---------------- */

route('GET', '/api/admin/trade-settings', 'founder', async () => ({ ...(await readTradeSettings()), maxFeeBps: MAX_FEE_BPS, providers: providerStatus() }))

route('PUT', '/api/admin/trade-settings', 'founder', async (c) => {
  const b = body(c, z.object({ mode: z.enum(['testnet', 'mainnet']).optional(), confirmMode: z.boolean().optional(), feeBps: z.number().int().min(0).max(MAX_FEE_BPS).optional(), feeWallet: z.string().max(60).optional() }))
  const before = await readTradeSettings()
  if (b.mode !== undefined && b.mode !== before.mode) {
    // Switching networks moves real money when the target is mainnet, so the request must say the confirmation was shown and accepted.
    if (b.confirmMode !== true) throw new HttpError(400, 'Confirm the network switch first')
    await saveTradeMode(b.mode)
    await audit(c.user.id, 'trade.mode_changed', b.mode, undefined, { from: before.mode, to: b.mode })
  }
  if (b.feeBps !== undefined || b.feeWallet !== undefined) {
    const wallet = (b.feeWallet ?? before.feeWallet).trim()
    const bps = b.feeBps ?? before.feeBps
    if (wallet !== '' && !isAddress(wallet)) throw new HttpError(400, 'The fee wallet is not a valid address')
    if (bps > 0 && wallet === '') throw new HttpError(400, 'Set a fee wallet before setting a fee above 0')
    await saveTradeFee(bps, wallet)
    await audit(c.user.id, 'trade.fee_changed', 'fee', undefined, { bps, wallet })
  }
  return { ...(await readTradeSettings()), maxFeeBps: MAX_FEE_BPS, providers: providerStatus() }
})
