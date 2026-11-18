/**
 * The testnets USDC can be bridged between. The list of ids and their order is fixed here; everything else (name, USDC contract,
 * RPC, explorer, gas symbol) comes from Circle's own chain definitions in the installed App Kit, so an address is never typed by hand.
 * A chain the kit does not know is simply left out, so the picker can never offer a route that cannot run.
 */
import { AppKit } from '@circle-fin/app-kit'
import { createPublicClient, erc20Abi, http } from 'viem'
import { HttpError } from '../auth'
import { scrub } from '../rpc'
import { readBalance } from '../wallet/chains'
import { getAssetDef } from '../wallet/networks'

/** Our id, the kit's chain name, in the order they are shown. The first three keep the ids earlier transfers were saved with. */
const TABLE: [string, string][] = [
  ['arbitrum-sepolia', 'Arbitrum_Sepolia'],
  ['arc-testnet', 'Arc_Testnet'],
  ['avalanche-fuji', 'Avalanche_Fuji'],
  ['base-sepolia', 'Base_Sepolia'],
  ['codex-testnet', 'Codex_Testnet'],
  ['ethereum-sepolia', 'Ethereum_Sepolia'],
  ['edge-testnet', 'Edge_Testnet'],
  ['hyperevm-testnet', 'HyperEVM_Testnet'],
  ['linea-sepolia', 'Linea_Sepolia'],
  ['monad-testnet', 'Monad_Testnet'],
  ['optimism-sepolia', 'Optimism_Sepolia'],
  ['plume-testnet', 'Plume_Testnet'],
  ['polygon-amoy', 'Polygon_Amoy_Testnet'],
  ['solana-devnet', 'Solana_Devnet'],
  ['unichain-sepolia', 'Unichain_Sepolia'],
  ['sonic-testnet', 'Sonic_Testnet'],
]

export interface BridgeChain {
  id: string
  /** The name the App Kit uses for this chain. */
  kit: string
  name: string
  family: 'evm' | 'solana'
  /** EVM chain id (the browser wallet switches to it); absent on Solana. */
  chainId?: number
  /** What the network fee is paid in. On Arc it is USDC itself. */
  gasSymbol: string
  usdc: string
  rpc: string
  /** Transaction link with {hash} in place of the hash. */
  explorer: string
}

interface KitChain {
  chain: string; name: string; type: string; chainId?: number; usdcAddress?: string | null
  rpcEndpoints?: string[]; explorerUrl?: string; nativeCurrency?: { symbol?: string }
}

// Where the kit's own label is not the coin people use for fees.
const GAS_OVERRIDE: Record<string, string> = { 'unichain-sepolia': 'ETH' }

let cached: BridgeChain[] | null = null

export function bridgeChains(): BridgeChain[] {
  if (cached) return cached
  const defs = new Map((new AppKit().getSupportedChains() as unknown as KitChain[]).map((c) => [c.chain, c]))
  const out: BridgeChain[] = []
  for (const [id, kit] of TABLE) {
    const d = defs.get(kit)
    if (!d || !d.usdcAddress || !d.rpcEndpoints?.[0]) continue
    out.push({
      id, kit, name: d.name, family: d.type === 'solana' ? 'solana' : 'evm', chainId: d.chainId,
      gasSymbol: GAS_OVERRIDE[id] ?? d.nativeCurrency?.symbol ?? 'gas token', usdc: d.usdcAddress, rpc: d.rpcEndpoints[0], explorer: d.explorerUrl ?? '',
    })
  }
  cached = out
  return out
}

export const findChain = (id: unknown): BridgeChain | null => (typeof id === 'string' ? bridgeChains().find((c) => c.id === id) ?? null : null)

export function chainName(id: unknown): string {
  return findChain(id)?.name ?? String(id)
}

const clients = new Map<string, ReturnType<typeof createPublicClient>>()
const evm = (c: BridgeChain) => {
  let cl = clients.get(c.id)
  if (!cl) {
    cl = createPublicClient({ transport: http(c.rpc, { timeout: 10_000, retryCount: 1 }) })
    clients.set(c.id, cl)
  }
  return cl
}

async function solanaCall<T>(c: BridgeChain, method: string, params: unknown[]): Promise<T> {
  const r = await fetch(c.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(10_000) })
  const j = (await r.json()) as { result?: T; error?: { message?: string } }
  if (j.error || j.result === undefined) throw new Error(j.error?.message ?? 'No answer from the Solana network')
  return j.result
}

/** USDC the address holds on a chain, in 6-decimal units. Arc, Ethereum Sepolia and Base Sepolia use the app's own balance reader. */
export async function usdcBalance(c: BridgeChain, address: string): Promise<bigint> {
  try {
    if (c.family === 'solana') {
      const res = await solanaCall<{ value: { account: { data: { parsed: { info: { tokenAmount: { amount: string } } } } } }[] }>(c, 'getTokenAccountsByOwner', [address, { mint: c.usdc }, { encoding: 'jsonParsed', commitment: 'confirmed' }])
      return res.value.reduce((sum, a) => sum + BigInt(a.account.data.parsed.info.tokenAmount.amount), 0n)
    }
    const def = getAssetDef(`USDC@${c.id}`)
    if (def) return (await readBalance(def, address)).raw
    return await evm(c).readContract({ address: c.usdc as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf', args: [address as `0x${string}`] })
  } catch (e) {
    throw new HttpError(502, `Could not read your USDC balance on ${c.name} (${scrub(e)}). Try again in a moment.`)
  }
}

/** Whether the address holds any of the coin that pays network fees on a chain. Arc pays fees in USDC, which is checked separately. */
export async function hasGas(c: BridgeChain, address: string): Promise<boolean> {
  try {
    if (c.id === 'arc-testnet') return true
    if (c.family === 'solana') return (await solanaCall<{ value: number }>(c, 'getBalance', [address, { commitment: 'confirmed' }])).value > 0
    return (await evm(c).getBalance({ address: address as `0x${string}` })) > 0n
  } catch (e) {
    throw new HttpError(502, `Could not check your ${c.gasSymbol} balance on ${c.name} (${scrub(e)}). Try again in a moment.`)
  }
}
