/**
 * Circle swaps on Arc Testnet. The chain and the tokens it accepts are fixed here; the chain itself is checked against the
 * installed App Kit so a swap can never be offered on a network the kit does not know. Mainnet is deliberately not offered.
 */
import { AppKit } from '@circle-fin/app-kit'
import { createPublicClient, erc20Abi, http } from 'viem'
import { HttpError } from '../auth'
import { scrub } from '../rpc'

export const SWAP_CHAIN = 'Arc_Testnet'
export const SWAP_CHAIN_NAME = 'Arc Testnet'
export const SWAP_EXPLORER_ID = 'arc-testnet'

/** On Arc, Circle swaps accept only these three tokens. The kit's own symbols are the keys. */
export const SWAP_TOKENS = [
  { symbol: 'USDC', label: 'USDC', name: 'USD Coin' },
  { symbol: 'EURC', label: 'EURC', name: 'Euro Coin' },
  { symbol: 'CIRBTC', label: 'cirBTC', name: 'Circle Bitcoin' },
] as const

/** Decimals of each token on Arc, so amounts can be checked against limits before any quote is requested. */
export const SWAP_DECIMALS: Record<string, number> = { USDC: 6, EURC: 6, CIRBTC: 8 }

export type SwapSymbol = (typeof SWAP_TOKENS)[number]['symbol']

export const normalizeToken = (v: unknown): SwapSymbol | null => {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  return SWAP_TOKENS.find((t) => t.symbol === s)?.symbol ?? null
}

export const labelOf = (symbol: string) => SWAP_TOKENS.find((t) => t.symbol === symbol)?.label ?? symbol

let rpc: string | null = null
function arcRpc(): string {
  if (rpc) return rpc
  const defs = new AppKit().getSupportedChains() as unknown as { chain: string; rpcEndpoints?: string[] }[]
  const def = defs.find((c) => c.chain === SWAP_CHAIN)
  if (!def?.rpcEndpoints?.[0]) throw new HttpError(503, 'Circle swaps are not available on this network right now')
  rpc = def.rpcEndpoints[0]
  return rpc
}

/** ERC-20 view of what an address holds. On Arc, USDC here is the same money that pays network fees. */
export async function tokenBalance(token: string, address: string): Promise<bigint> {
  try {
    const c = createPublicClient({ transport: http(arcRpc(), { timeout: 10_000, retryCount: 1 }) })
    return await c.readContract({ address: token as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf', args: [address as `0x${string}`] })
  } catch (e) {
    throw new HttpError(502, `Could not read your balance (${scrub(e)}). Try again in a moment.`)
  }
}
