/**
 * AchSwap (a Uniswap V2 style exchange) on Arc Testnet, read only.
 *
 * What it is good for here: real onchain prices and pool depth for tokens that live on Arc Testnet, to show next to the
 * exchange-balance Swap screen. What it is not: a bridge. A constant-product pool swaps two tokens on ONE chain; it
 * never moves value to another chain, so cross-chain transfers still need a bridge protocol (Circle's CCTP).
 *
 * Addresses come from the environment (ACHSWAP_FACTORY, ACHSWAP_ROUTER, ACHSWAP_WRAPPED). They were checked onchain:
 * the router's factory() returns the factory, and both are verified on the Arc Testnet explorer. Pools on the testnet
 * hold small test balances with no market value, so quotes are for display and testing.
 */
import { getAddress, isAddress, parseAbi, type Address } from 'viem'
import { arcClient } from '../rpc'

export class DexError extends Error {}

export const ARC_TESTNET_CHAIN_ID = 5042002

/** Contract addresses for this deployment, read from the environment when needed. */
export function achswapConfig(): { factory: Address; router: Address; wrapped: Address } {
  const read = (name: string): Address => {
    const v = process.env[name]
    if (!v || !isAddress(v)) throw new DexError(`${name} is not set to a valid address`)
    return getAddress(v)
  }
  return { factory: read('ACHSWAP_FACTORY'), router: read('ACHSWAP_ROUTER'), wrapped: read('ACHSWAP_WRAPPED') }
}

export const factoryAbi = parseAbi([
  'event PairCreated(address indexed token0, address indexed token1, address pair, uint256)',
  'function getPair(address tokenA, address tokenB) view returns (address pair)',
  'function allPairs(uint256) view returns (address pair)',
  'function allPairsLength() view returns (uint256)',
])

export const pairAbi = parseAbi([
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function totalSupply() view returns (uint256)',
  'event Sync(uint112 reserve0, uint112 reserve1)',
  'event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)',
])

/** Views from the file you shared, plus the swap call of the verified Router02 (needed only when executing a swap). */
export const routerAbi = parseAbi([
  'function factory() view returns (address)',
  'function WETH() view returns (address)',
  'function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)',
  'function getAmountsIn(uint256 amountOut, address[] path) view returns (uint256[] amounts)',
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)',
])

export const erc20Abi = parseAbi([
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
])

const FEE_NUM = 997n
const FEE_DEN = 1000n

/** The pair contract's own formula: amountIn * 997 * reserveOut / (reserveIn * 1000 + amountIn * 997). Exact integers. */
export function amountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n
  const withFee = amountIn * FEE_NUM
  return (withFee * reserveOut) / (reserveIn * FEE_DEN + withFee)
}

/** Price impact in basis points versus the pool's mid price (about the 0.30% fee for a tiny trade, growing with size). */
export function priceImpactBps(amountIn: bigint, out: bigint, reserveIn: bigint, reserveOut: bigint): number {
  if (amountIn <= 0n || reserveIn <= 0n) return 0
  const ideal = (amountIn * reserveOut) / reserveIn
  if (ideal <= 0n) return 0
  const bps = ((ideal - out) * 10_000n) / ideal
  return Number(bps < 0n ? 0n : bps)
}

export interface DexQuote {
  source: 'achswap-v2'
  chainId: number
  path: Address[]
  amountIn: string
  amountOut: string
  priceImpactBps: number
  reserveIn: string
  reserveOut: string
  pair: Address
  testnet: true
}

const NO_PAIR = BigInt(0)

/** Quote an exact-input swap through the direct pool. Throws DexError when no pool exists or it is empty. */
export async function quoteDirect(tokenIn: string, tokenOut: string, amountIn: bigint): Promise<DexQuote> {
  if (!isAddress(tokenIn) || !isAddress(tokenOut)) throw new DexError('Token addresses must be valid')
  if (tokenIn.toLowerCase() === tokenOut.toLowerCase()) throw new DexError('Choose two different tokens')
  if (amountIn <= 0n) throw new DexError('Enter an amount above zero')
  const a = getAddress(tokenIn), b = getAddress(tokenOut)
  const { factory } = achswapConfig()
  const client = arcClient()
  const pair = await client.readContract({ address: factory, abi: factoryAbi, functionName: 'getPair', args: [a, b] })
  if (BigInt(pair) === NO_PAIR) throw new DexError('No AchSwap pool exists for this pair on Arc Testnet')
  const [token0, reserves] = await Promise.all([
    client.readContract({ address: pair, abi: pairAbi, functionName: 'token0' }),
    client.readContract({ address: pair, abi: pairAbi, functionName: 'getReserves' }),
  ])
  const [r0, r1] = reserves
  const [reserveIn, reserveOut] = token0.toLowerCase() === a.toLowerCase() ? [BigInt(r0), BigInt(r1)] : [BigInt(r1), BigInt(r0)]
  if (reserveIn === 0n || reserveOut === 0n) throw new DexError('This pool has no liquidity')
  const out = amountOut(amountIn, reserveIn, reserveOut)
  if (out <= 0n) throw new DexError('Amount too small for this pool')
  if (out >= reserveOut) throw new DexError('Amount is larger than the pool can fill')
  return {
    source: 'achswap-v2', chainId: ARC_TESTNET_CHAIN_ID, path: [a, b], amountIn: amountIn.toString(), amountOut: out.toString(),
    priceImpactBps: priceImpactBps(amountIn, out, reserveIn, reserveOut), reserveIn: reserveIn.toString(), reserveOut: reserveOut.toString(), pair, testnet: true,
  }
}
