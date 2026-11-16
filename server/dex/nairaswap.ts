/**
 * NairaSwap: the exchange you own (factory, pair pools, router) on Arc Testnet and Base Sepolia.
 *
 * This module only builds and checks transactions. Signing happens elsewhere, in one of two ways:
 *  - the in-app wallet (nairaswapService.executeInApp), after a PIN check, or
 *  - the user's own browser wallet, which receives the same steps and signs them itself.
 * Tokens must be in the verified asset registry for the network, recipients are always the signer's own address, and every
 * operation carries a slippage bound and a deadline that the router enforces onchain.
 */
import { encodeFunctionData, erc20Abi, getAddress, isAddress, parseAbi, type Address, type Hex } from 'viem'
import { HttpError } from '../auth'
import { toUnits } from '../money'
import { evmClient } from '../wallet/chains'
import { ASSETS, getAssetDef, getNetwork, type AssetDef } from '../wallet/networks'
import { amountOut as v2AmountOut, priceImpactBps } from './achswap'

const NETWORKS = { 'arc-testnet': { env: 'ARC', chainId: 5042002 }, 'ethereum-sepolia': { env: 'ETH', chainId: 11155111 }, 'base-sepolia': { env: 'BASE', chainId: 84532 } } as const
export type DexNetworkId = keyof typeof NETWORKS
export const DEX_NETWORKS = Object.keys(NETWORKS) as DexNetworkId[]

export const MAX_SLIPPAGE_BPS = 500
export const MAX_IMPACT_BPS = 1000
const DEADLINE_SECONDS = 600

export const routerAbi = parseAbi([
  'function factory() view returns (address)',
  'function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)',
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)',
  'function addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)',
  'function removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB)',
  'function paused() view returns (bool)',
])
const factoryAbi = parseAbi(['function getPair(address a, address b) view returns (address)', 'function allPairs(uint256) view returns (address)', 'function allPairsLength() view returns (uint256)'])
const pairAbi = parseAbi([
  'function token0() view returns (address)', 'function token1() view returns (address)',
  'function getReserves() view returns (uint112, uint112, uint32)', 'function totalSupply() view returns (uint256)', 'function balanceOf(address) view returns (uint256)',
])

export interface DexConfig { networkId: DexNetworkId; chainId: number; router: Address; factory: Address; treasury: Address }

export function dexConfig(networkId: string): DexConfig {
  const n = NETWORKS[networkId as DexNetworkId]
  if (!n) throw new HttpError(400, 'The exchange is available on Arc Testnet and Base Sepolia')
  const read = (k: string): Address => {
    const v = process.env[`NAIRASWAP_${n.env}_${k}`]
    if (!v || !isAddress(v)) throw new HttpError(503, `The exchange is not configured for this network yet (${k.toLowerCase()})`)
    return getAddress(v)
  }
  return { networkId: networkId as DexNetworkId, chainId: n.chainId, router: read('ROUTER'), factory: read('FACTORY'), treasury: read('TREASURY') }
}

export function dexTokens(networkId: string): AssetDef[] {
  return ASSETS.filter((a) => a.network === networkId && a.kind === 'token' && a.contract && isAddress(a.contract))
}

/** Only tokens in the verified registry for that network can be traded or pooled. */
export function resolveToken(networkId: string, assetKey: string): AssetDef & { contract: Address } {
  const def = getAssetDef(assetKey)
  if (!def || def.network !== networkId || def.kind !== 'token' || !def.contract || !isAddress(def.contract)) {
    throw new HttpError(400, 'That token is not available for the exchange on this network')
  }
  return { ...def, contract: getAddress(def.contract) }
}

const withSlippage = (v: bigint, bps: number) => (v * BigInt(10_000 - bps)) / 10_000n

export function parseSlippage(bps: unknown): number {
  const n = Number(bps ?? 50)
  if (!Number.isInteger(n) || n < 1 || n > MAX_SLIPPAGE_BPS) throw new HttpError(400, `Slippage must be between 0.01% and ${MAX_SLIPPAGE_BPS / 100}%`)
  return n
}

/* ---------- fixed, signed-over parameters ---------- */
export interface SwapParams { kind: 'swap'; tokenIn: Address; tokenOut: Address; amountIn: string; minOut: string; deadline: number }
export interface AddParams { kind: 'add'; tokenA: Address; tokenB: Address; amountA: string; amountB: string; minA: string; minB: string; deadline: number }
export interface RemoveParams { kind: 'remove'; tokenA: Address; tokenB: Address; liquidity: string; minA: string; minB: string; deadline: number }
export type DexParams = SwapParams | AddParams | RemoveParams

export interface PlanStep { label: string; to: Address; data: Hex; value: '0' }

const approveStep = (token: Address, spender: Address, amount: bigint, symbol: string): PlanStep => ({
  label: `Approve ${symbol}`, to: token, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spender, amount] }), value: '0',
})

/** Steps for fully fixed parameters. Approvals are for the exact amount, and only when the current allowance is short. */
export async function buildSteps(cfg: DexConfig, from: Address, p: DexParams): Promise<PlanStep[]> {
  const client = evmClient(cfg.networkId)
  const steps: PlanStep[] = []
  const need = async (token: Address, amount: bigint) => {
    const allowance = await client.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [from, cfg.router] })
    if (allowance < amount) {
      const sym = ASSETS.find((a) => a.contract?.toLowerCase() === token.toLowerCase())?.symbol ?? 'token'
      steps.push(approveStep(token, cfg.router, amount, sym))
    }
  }
  if (p.kind === 'swap') {
    await need(p.tokenIn, BigInt(p.amountIn))
    steps.push({ label: 'Swap', to: cfg.router, value: '0', data: encodeFunctionData({ abi: routerAbi, functionName: 'swapExactTokensForTokens', args: [BigInt(p.amountIn), BigInt(p.minOut), [p.tokenIn, p.tokenOut], from, BigInt(p.deadline)] }) })
  } else if (p.kind === 'add') {
    await need(p.tokenA, BigInt(p.amountA))
    await need(p.tokenB, BigInt(p.amountB))
    steps.push({ label: 'Add liquidity', to: cfg.router, value: '0', data: encodeFunctionData({ abi: routerAbi, functionName: 'addLiquidity', args: [p.tokenA, p.tokenB, BigInt(p.amountA), BigInt(p.amountB), BigInt(p.minA), BigInt(p.minB), from, BigInt(p.deadline)] }) })
  } else {
    const pair = await client.readContract({ address: cfg.factory, abi: factoryAbi, functionName: 'getPair', args: [p.tokenA, p.tokenB] })
    await need(pair, BigInt(p.liquidity))
    steps.push({ label: 'Remove liquidity', to: cfg.router, value: '0', data: encodeFunctionData({ abi: routerAbi, functionName: 'removeLiquidity', args: [p.tokenA, p.tokenB, BigInt(p.liquidity), BigInt(p.minA), BigInt(p.minB), from, BigInt(p.deadline)] }) })
  }
  return steps
}

interface PoolState { pair: Address; reserveA: bigint; reserveB: bigint; supply: bigint }

async function poolState(cfg: DexConfig, a: Address, b: Address): Promise<PoolState | null> {
  const client = evmClient(cfg.networkId)
  const pair = await client.readContract({ address: cfg.factory, abi: factoryAbi, functionName: 'getPair', args: [a, b] })
  if (BigInt(pair) === 0n) return null
  const [token0, [r0, r1], supply] = await Promise.all([
    client.readContract({ address: pair, abi: pairAbi, functionName: 'token0' }),
    client.readContract({ address: pair, abi: pairAbi, functionName: 'getReserves' }),
    client.readContract({ address: pair, abi: pairAbi, functionName: 'totalSupply' }),
  ])
  const aIs0 = token0.toLowerCase() === a.toLowerCase()
  return { pair, reserveA: aIs0 ? BigInt(r0) : BigInt(r1), reserveB: aIs0 ? BigInt(r1) : BigInt(r0), supply }
}

async function assertNotPaused(cfg: DexConfig, kind: DexParams['kind']) {
  if (kind === 'remove') return // liquidity can always be withdrawn
  const paused = await evmClient(cfg.networkId).readContract({ address: cfg.router, abi: routerAbi, functionName: 'paused' })
  if (paused) throw new HttpError(503, 'The exchange is paused by its owner. You can still remove liquidity.')
}

async function assertBalance(cfg: DexConfig, owner: Address, token: Address, amount: bigint, symbol: string) {
  const bal = await evmClient(cfg.networkId).readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [owner] })
  if (bal < amount) throw new HttpError(400, `Not enough ${symbol} in this wallet on ${getNetwork(cfg.networkId)?.name ?? cfg.networkId}`)
}

export interface Preview {
  kind: DexParams['kind']; networkId: DexNetworkId; chainId: number; from: Address; params: DexParams; steps: PlanStep[]
  summary: Record<string, string | number>; warnings: string[]
}

const rawText = (v: bigint, d: number) => {
  const s = v.toString().padStart(d + 1, '0')
  const i = s.slice(0, s.length - d), f = s.slice(s.length - d).replace(/0+$/, '')
  return f ? `${i}.${f}` : i
}

/** Quote and build a swap. Throws a plain-language 400 for every unsafe or impossible request. */
export async function previewSwap(networkId: string, from: Address, i: { tokenIn: string; tokenOut: string; amount: string; slippageBps?: unknown }): Promise<Preview> {
  const cfg = dexConfig(networkId)
  const tin = resolveToken(networkId, i.tokenIn), tout = resolveToken(networkId, i.tokenOut)
  if (tin.contract === tout.contract) throw new HttpError(400, 'Choose two different tokens')
  const slip = parseSlippage(i.slippageBps)
  const amountIn = toUnits(i.amount, tin.decimals)
  if (amountIn <= 0n) throw new HttpError(400, 'Enter an amount above zero')
  await assertNotPaused(cfg, 'swap')
  const pool = await poolState(cfg, tin.contract, tout.contract)
  if (!pool || pool.supply === 0n) throw new HttpError(400, `No ${tin.symbol}/${tout.symbol} pool exists yet. Add liquidity to create it.`)
  if (pool.reserveA === 0n || pool.reserveB === 0n) throw new HttpError(400, 'This pool has no liquidity')
  const amounts = await evmClient(cfg.networkId).readContract({ address: cfg.router, abi: routerAbi, functionName: 'getAmountsOut', args: [amountIn, [tin.contract, tout.contract]] })
  const out = amounts[1]
  if (out !== v2AmountOut(amountIn, pool.reserveA, pool.reserveB)) throw new HttpError(502, 'The quote did not match the pool. Try again in a moment.')
  if (out <= 0n) throw new HttpError(400, 'Amount too small for this pool')
  if (out >= pool.reserveB) throw new HttpError(400, 'Amount is larger than the pool can fill')
  const impact = priceImpactBps(amountIn, out, pool.reserveA, pool.reserveB)
  if (impact > MAX_IMPACT_BPS) throw new HttpError(400, `Price impact would be ${(impact / 100).toFixed(1)}%, above the ${MAX_IMPACT_BPS / 100}% safety limit. Try a smaller amount.`)
  await assertBalance(cfg, from, tin.contract, amountIn, tin.symbol)
  const minOut = withSlippage(out, slip)
  const params: SwapParams = { kind: 'swap', tokenIn: tin.contract, tokenOut: tout.contract, amountIn: amountIn.toString(), minOut: minOut.toString(), deadline: Math.floor(Date.now() / 1000) + DEADLINE_SECONDS }
  return {
    kind: 'swap', networkId: cfg.networkId, chainId: cfg.chainId, from, params, steps: await buildSteps(cfg, from, params),
    summary: { pay: `${rawText(amountIn, tin.decimals)} ${tin.symbol}`, receive: `${rawText(out, tout.decimals)} ${tout.symbol}`, minimumReceived: `${rawText(minOut, tout.decimals)} ${tout.symbol}`, priceImpactBps: impact, feeBps: 30, slippageBps: slip },
    warnings: [...(impact > 300 ? [`High price impact (${(impact / 100).toFixed(1)}%). Testnet pools are small.`] : []), 'You receive the tokens in this same wallet.'],
  }
}

export async function previewAdd(networkId: string, from: Address, i: { tokenA: string; tokenB: string; amountA: string; amountB: string; slippageBps?: unknown }): Promise<Preview> {
  const cfg = dexConfig(networkId)
  const a = resolveToken(networkId, i.tokenA), b = resolveToken(networkId, i.tokenB)
  if (a.contract === b.contract) throw new HttpError(400, 'Choose two different tokens')
  const slip = parseSlippage(i.slippageBps)
  let amountA = toUnits(i.amountA, a.decimals), amountB = toUnits(i.amountB, b.decimals)
  if (amountA <= 0n || amountB <= 0n) throw new HttpError(400, 'Enter an amount for both tokens')
  await assertNotPaused(cfg, 'add')
  const pool = await poolState(cfg, a.contract, b.contract)
  const warnings: string[] = []
  if (pool && pool.supply > 0n) {
    // Mirror the router: use the pool's ratio and never take more than the amounts entered.
    const optimalB = (amountA * pool.reserveB) / pool.reserveA
    if (optimalB <= amountB) amountB = optimalB
    else amountA = (amountB * pool.reserveA) / pool.reserveB
    if (amountA <= 0n || amountB <= 0n) throw new HttpError(400, 'Amount too small for this pool')
  } else warnings.push(pool ? 'This pool is empty. The first deposit sets its starting price.' : 'This pool does not exist yet. Your deposit creates it and sets its starting price.')
  await Promise.all([assertBalance(cfg, from, a.contract, amountA, a.symbol), assertBalance(cfg, from, b.contract, amountB, b.symbol)])
  const params: AddParams = {
    kind: 'add', tokenA: a.contract, tokenB: b.contract, amountA: amountA.toString(), amountB: amountB.toString(),
    minA: withSlippage(amountA, slip).toString(), minB: withSlippage(amountB, slip).toString(), deadline: Math.floor(Date.now() / 1000) + DEADLINE_SECONDS,
  }
  return {
    kind: 'add', networkId: cfg.networkId, chainId: cfg.chainId, from, params, steps: await buildSteps(cfg, from, params),
    summary: { depositA: `${rawText(amountA, a.decimals)} ${a.symbol}`, depositB: `${rawText(amountB, b.decimals)} ${b.symbol}`, slippageBps: slip },
    warnings: [...warnings, 'Liquidity earns 0.25% of every trade in this pool. Its value can change against holding the tokens.'],
  }
}

export async function previewRemove(networkId: string, from: Address, i: { tokenA: string; tokenB: string; percent: number; slippageBps?: unknown }): Promise<Preview> {
  const cfg = dexConfig(networkId)
  const a = resolveToken(networkId, i.tokenA), b = resolveToken(networkId, i.tokenB)
  const slip = parseSlippage(i.slippageBps)
  if (!Number.isInteger(i.percent) || i.percent < 1 || i.percent > 100) throw new HttpError(400, 'Choose between 1% and 100% of your position')
  const pool = await poolState(cfg, a.contract, b.contract)
  if (!pool || pool.supply === 0n) throw new HttpError(400, 'There is no pool for this pair')
  const held = await evmClient(cfg.networkId).readContract({ address: pool.pair, abi: pairAbi, functionName: 'balanceOf', args: [from] })
  const liquidity = (held * BigInt(i.percent)) / 100n
  if (liquidity <= 0n) throw new HttpError(400, 'You have no liquidity in this pool')
  const outA = (liquidity * pool.reserveA) / pool.supply, outB = (liquidity * pool.reserveB) / pool.supply
  const params: RemoveParams = { kind: 'remove', tokenA: a.contract, tokenB: b.contract, liquidity: liquidity.toString(), minA: withSlippage(outA, slip).toString(), minB: withSlippage(outB, slip).toString(), deadline: Math.floor(Date.now() / 1000) + DEADLINE_SECONDS }
  return {
    kind: 'remove', networkId: cfg.networkId, chainId: cfg.chainId, from, params, steps: await buildSteps(cfg, from, params),
    summary: { receiveA: `${rawText(outA, a.decimals)} ${a.symbol}`, receiveB: `${rawText(outB, b.decimals)} ${b.symbol}`, share: `${i.percent}% of your position`, slippageBps: slip },
    warnings: ['Removing liquidity always works, even if the exchange is paused.'],
  }
}

/* ---------- read views ---------- */
export async function listPools(networkId: string, owner?: Address) {
  const cfg = dexConfig(networkId)
  const client = evmClient(cfg.networkId)
  const count = Number(await client.readContract({ address: cfg.factory, abi: factoryAbi, functionName: 'allPairsLength' }))
  const tokens = dexTokens(networkId)
  const info = (addr: Address) => tokens.find((t) => t.contract?.toLowerCase() === addr.toLowerCase())
  const rows = await Promise.all(Array.from({ length: Math.min(count, 50) }, (_, i) => i).map(async (i) => {
    const pair = await client.readContract({ address: cfg.factory, abi: factoryAbi, functionName: 'allPairs', args: [BigInt(i)] })
    const [t0, t1, [r0, r1], supply, mine] = await Promise.all([
      client.readContract({ address: pair, abi: pairAbi, functionName: 'token0' }), client.readContract({ address: pair, abi: pairAbi, functionName: 'token1' }),
      client.readContract({ address: pair, abi: pairAbi, functionName: 'getReserves' }), client.readContract({ address: pair, abi: pairAbi, functionName: 'totalSupply' }),
      owner ? client.readContract({ address: pair, abi: pairAbi, functionName: 'balanceOf', args: [owner] }) : Promise.resolve(0n),
    ])
    const a = info(t0), b = info(t1)
    const part = (t: typeof a, r: bigint) => (t ? rawText(r, t.decimals) : null)
    return {
      pair, token0: { address: t0, symbol: a?.symbol ?? null, key: a?.key ?? null }, token1: { address: t1, symbol: b?.symbol ?? null, key: b?.key ?? null },
      reserve0: part(a, BigInt(r0)), reserve1: part(b, BigInt(r1)), verified: Boolean(a && b), lpSupply: supply.toString(),
      yourShareBps: supply > 0n ? Number((mine * 10_000n) / supply) : 0, yourLp: mine.toString(),
    }
  }))
  return { network: cfg.networkId, chainId: cfg.chainId, router: cfg.router, factory: cfg.factory, pools: rows.filter((r) => r.verified) }
}
