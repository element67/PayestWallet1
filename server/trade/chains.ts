/**
 * Networks and tokens the trade module offers. Everything about a network (name, USDC contract, RPC, explorer) comes from
 * Circle's own chain definitions in the installed App Kit, so no contract address is typed by hand. A network the kit does not know
 * is left out, so the pickers can never offer a route that cannot run.
 */
import { AppKit } from '@circle-fin/app-kit'
import { createPublicClient, erc20Abi, getAddress, http, isAddress } from 'viem'
import { HttpError } from '../auth'
import { scrub } from '../rpc'
import type { Mode, TradeChain, TradeToken, Who } from './types'

/** Testnets, in the order they are shown. The ids of the first three match transfers saved before this module existed. */
const TESTNETS: [string, string][] = [
  ['arbitrum-sepolia', 'Arbitrum_Sepolia'], ['arc-testnet', 'Arc_Testnet'], ['avalanche-fuji', 'Avalanche_Fuji'], ['base-sepolia', 'Base_Sepolia'],
  ['codex-testnet', 'Codex_Testnet'], ['ethereum-sepolia', 'Ethereum_Sepolia'], ['edge-testnet', 'Edge_Testnet'], ['hyperevm-testnet', 'HyperEVM_Testnet'],
  ['linea-sepolia', 'Linea_Sepolia'], ['monad-testnet', 'Monad_Testnet'], ['optimism-sepolia', 'Optimism_Sepolia'], ['plume-testnet', 'Plume_Testnet'],
  ['polygon-amoy', 'Polygon_Amoy_Testnet'], ['solana-devnet', 'Solana_Devnet'], ['unichain-sepolia', 'Unichain_Sepolia'], ['sonic-testnet', 'Sonic_Testnet'],
]

interface KitChain {
  chain: string; name: string; type: string; chainId?: number; isTestnet?: boolean; usdcAddress?: string | null; eurcAddress?: string | null
  rpcEndpoints?: string[]; explorerUrl?: string; nativeCurrency?: { symbol?: string }
}

const GAS_OVERRIDE: Record<string, string> = { 'unichain-sepolia': 'ETH' }
const cache: Partial<Record<Mode, TradeChain[]>> = {}

function toChain(id: string, d: KitChain, testnet: boolean): TradeChain | null {
  if (!d.usdcAddress || !d.rpcEndpoints?.[0]) return null
  const family = d.type === 'solana' ? 'solana' : 'evm'
  if (family === 'evm' && (!isAddress(d.usdcAddress))) return null
  return {
    id, kit: d.chain, name: d.name, family, chainId: d.chainId, testnet, gasSymbol: GAS_OVERRIDE[id] ?? d.nativeCurrency?.symbol ?? 'gas token',
    usdc: d.usdcAddress, eurc: d.eurcAddress ?? null, rpc: d.rpcEndpoints[0], explorer: d.explorerUrl ?? '',
  }
}

export function tradeChains(mode: Mode): TradeChain[] {
  const hit = cache[mode]
  if (hit) return hit
  const defs = new AppKit().getSupportedChains() as unknown as KitChain[]
  const out: TradeChain[] = []
  if (mode === 'testnet') {
    const byName = new Map(defs.map((c) => [c.chain, c]))
    for (const [id, kit] of TESTNETS) { const d = byName.get(kit); const c = d && toChain(id, d, true); if (c) out.push(c) }
  } else {
    for (const d of defs) { if (d.isTestnet !== false) continue; const c = toChain(d.chain.toLowerCase().replace(/_/g, '-'), d, false); if (c) out.push(c) }
  }
  cache[mode] = out
  return out
}

export const findTradeChain = (mode: Mode, id: unknown): TradeChain | null => (typeof id === 'string' ? tradeChains(mode).find((c) => c.id === id) ?? null : null)

export const chainLabel = (id: string) => [...tradeChains('testnet'), ...tradeChains('mainnet')].find((c) => c.id === id)?.name ?? id

/** Decimals of the tokens whose symbol alone identifies them. */
const KNOWN: Record<string, { name: string; decimals: number; label: string }> = {
  USDC: { name: 'USD Coin', decimals: 6, label: 'USDC' },
  EURC: { name: 'Euro Coin', decimals: 6, label: 'EURC' },
  CIRBTC: { name: 'Circle Bitcoin', decimals: 8, label: 'cirBTC' },
}

/** The tokens a network offers for a kind of trade. On the Arc test network Circle's swap accepts USDC, EURC and cirBTC. */
export function tokensFor(chain: TradeChain, kind: 'swap' | 'bridge'): TradeToken[] {
  const t = (symbol: string, address: string | null): TradeToken => ({ symbol, ...KNOWN[symbol], address })
  const list: TradeToken[] = [t('USDC', chain.usdc)]
  if (chain.eurc) list.push(t('EURC', chain.eurc))
  if (kind === 'swap' && chain.id === 'arc-testnet') list.push(t('CIRBTC', null))
  return list
}

export function checkAddress(v: unknown): string {
  if (typeof v !== 'string' || !isAddress(v)) throw new HttpError(400, 'That is not a valid address')
  return getAddress(v)
}

const clients = new Map<string, ReturnType<typeof createPublicClient>>()
export const evmReader = (c: TradeChain) => {
  let cl = clients.get(c.id)
  if (!cl) { cl = createPublicClient({ transport: http(c.rpc, { timeout: 10_000, retryCount: 1 }) }); clients.set(c.id, cl) }
  return cl
}

async function solana<T>(c: TradeChain, method: string, params: unknown[]): Promise<T> {
  const r = await fetch(c.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(10_000) })
  const j = (await r.json()) as { result?: T; error?: { message?: string } }
  if (j.error || j.result === undefined) throw new Error(j.error?.message ?? 'No answer from the Solana network')
  return j.result
}

/** What an address holds of a token with a known contract, in the token's smallest unit. Null when the token has no known contract here. */
export async function tokenBalance(c: TradeChain, token: TradeToken, who: Who): Promise<bigint | null> {
  if (!token.address) return null
  try {
    if (c.family === 'solana') {
      const res = await solana<{ value: { account: { data: { parsed: { info: { tokenAmount: { amount: string } } } } } }[] }>(c, 'getTokenAccountsByOwner', [who.solana, { mint: token.address }, { encoding: 'jsonParsed', commitment: 'confirmed' }])
      return res.value.reduce((s, a) => s + BigInt(a.account.data.parsed.info.tokenAmount.amount), 0n)
    }
    return await evmReader(c).readContract({ address: token.address as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf', args: [who.evm as `0x${string}`] })
  } catch (e) {
    throw new HttpError(502, `Could not read your ${token.label} balance on ${c.name} (${scrub(e)}). Try again in a moment.`)
  }
}

/** Whether the address holds any of the coin that pays network fees. Arc pays fees in USDC, which is checked with the amount. */
export async function hasGas(c: TradeChain, who: Who): Promise<boolean> {
  try {
    if (c.gasSymbol === 'USDC') return true
    if (c.family === 'solana') return (await solana<{ value: number }>(c, 'getBalance', [who.solana, { commitment: 'confirmed' }])).value > 0
    return (await evmReader(c).getBalance({ address: who.evm as `0x${string}` })) > 0n
  } catch (e) {
    throw new HttpError(502, `Could not check your ${c.gasSymbol} balance on ${c.name} (${scrub(e)}). Try again in a moment.`)
  }
}
