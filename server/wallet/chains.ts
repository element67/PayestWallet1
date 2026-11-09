/** Chain readers: balances, heads and transactions straight from RPC / explorer APIs. No cached guesses. */
import { createPublicClient, erc20Abi, http, type PublicClient } from 'viem'
import { arbitrumSepolia, arcTestnet, baseSepolia, optimismSepolia, polygonAmoy, sepolia } from 'viem/chains'
import { getChain } from '../../src/onchain-facts'
import { arcClient, arcRpcUrl, scrub } from '../rpc'
import { getNetwork, type AssetDef } from './networks'

const evmChains = {
  'arc-testnet': arcTestnet, 'ethereum-sepolia': sepolia, 'base-sepolia': baseSepolia,
  'arbitrum-sepolia': arbitrumSepolia, 'optimism-sepolia': optimismSepolia, 'polygon-amoy': polygonAmoy,
} as const
const publicClients = new Map<string, PublicClient>()

export function evmClient(networkId: string): PublicClient {
  if (networkId === 'arc-testnet') return arcClient() as PublicClient
  const existing = publicClients.get(networkId)
  if (existing) return existing
  const client = createPublicClient({ chain: evmChains[networkId as keyof typeof evmChains], transport: http(evmRpcUrl(networkId), { timeout: 10_000 }) }) as PublicClient
  publicClients.set(networkId, client)
  return client
}

/** RPC URL for a signing wallet client. Server-side only. */
export function evmRpcUrl(networkId: string): string {
  if (networkId === 'arc-testnet') return arcRpcUrl()
  const chain = getChain(getNetwork(networkId)?.chainId ?? 0)
  if (!chain) throw new Error(`Unknown EVM network ${networkId}`)
  // Per-chain override, e.g. RPC_URL_Ethereum_Sepolia, for a provider you control. Falls back to the registry's public RPC.
  const key = `RPC_URL_${networkId.split('-').map((p) => p[0].toUpperCase() + p.slice(1)).join('_')}`
  return process.env[key] || chain.rpcUrls[0]
}

export const evmChain = (networkId: string) => evmChains[networkId as keyof typeof evmChains]

const SOLANA_RPC = 'https://api.devnet.solana.com'
const BTC_API = 'https://mempool.space/testnet4/api'

export async function solanaRpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(SOLANA_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Solana RPC HTTP ${res.status}`)
  const j = (await res.json()) as { result?: T; error?: { message: string } }
  if (j.error) throw new Error(`Solana RPC: ${j.error.message}`)
  return j.result as T
}

export async function btcApi<T>(path: string): Promise<T> {
  const res = await fetch(`${BTC_API}${path}`, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`Bitcoin API HTTP ${res.status}`)
  return (await res.json()) as T
}

export interface BalanceReading { raw: bigint; ref: string }

/** Reads one asset balance from its own chain. Throws on any RPC failure so callers never show a guess. */
/** One block-number lookup per network every 3 seconds, shared by every balance read, so many tokens do not multiply RPC calls. */
const heads = new Map<string, { at: number; block: Promise<bigint> }>()
function headOf(networkId: string, client: PublicClient): Promise<bigint> {
  const hit = heads.get(networkId)
  if (hit && Date.now() - hit.at < 3000) return hit.block
  const block = client.getBlockNumber()
  heads.set(networkId, { at: Date.now(), block })
  block.catch(() => heads.delete(networkId))
  return block
}

export async function readBalance(asset: AssetDef, address: string): Promise<BalanceReading> {
  const net = getNetwork(asset.network)
  if (!net) throw new Error('Unknown network')
  try {
    if (net.family === 'evm') {
      const client = evmClient(net.id)
      const block = await headOf(net.id, client)
      if (asset.kind === 'token') {
        const raw = await client.readContract({ address: asset.contract as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf', args: [address as `0x${string}`] })
        return { raw, ref: `block ${block}` }
      }
      return { raw: await client.getBalance({ address: address as `0x${string}` }), ref: `block ${block}` }
    }
    if (net.family === 'solana') {
      const r = await solanaRpc<{ context: { slot: number }; value: number }>('getBalance', [address, { commitment: 'confirmed' }])
      return { raw: BigInt(r.value), ref: `slot ${r.context.slot}` }
    }
    const a = await btcApi<{ chain_stats: { funded_txo_sum: number; spent_txo_sum: number } }>(`/address/${address}`)
    return { raw: BigInt(a.chain_stats.funded_txo_sum - a.chain_stats.spent_txo_sum), ref: 'confirmed' }
  } catch (e) {
    throw new Error(scrub(e))
  }
}
