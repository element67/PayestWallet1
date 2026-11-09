/** On-chain verification of a token contract: code exists at the address, and symbol and decimals match the registry. */
import { createPublicClient, erc20Abi, http, type PublicClient } from 'viem'
import { getChain } from '../../src/onchain-facts'
import { all, now, run } from '../db'
import { arcClient, scrub } from '../rpc'
import { regNetwork } from './networks'

const clients = new Map<string, PublicClient>()
function clientFor(networkId: string): PublicClient {
  if (networkId === 'arc-testnet') return arcClient() as PublicClient
  const hit = clients.get(networkId)
  if (hit) return hit
  const net = regNetwork(networkId)
  const chain = net?.chainId ? getChain(net.chainId) : undefined
  if (!chain) throw new Error(`No RPC for ${networkId}`)
  // A provider you control can be set per chain, for example RPC_URL_Arbitrum_Sepolia. The default is the chain registry's public RPC.
  const key = `RPC_URL_${networkId.split('-').map((p) => p[0].toUpperCase() + p.slice(1)).join('_')}`
  const c = createPublicClient({ transport: http(process.env[key] || chain.rpcUrls[0], { timeout: 8000, retryCount: 1 }) }) as PublicClient
  clients.set(networkId, c)
  return c
}

export interface VerifyResult { ok: boolean; note: string; transient?: boolean }

export async function verifyOnChain(networkId: string, contract: string, symbol: string, decimals: number): Promise<VerifyResult> {
  try {
    const c = clientFor(networkId)
    const address = contract as `0x${string}`
    const code = await c.getCode({ address })
    if (!code || code === '0x') return { ok: false, note: 'No contract exists at this address on this chain' }
    const [sym, dec] = await Promise.all([
      c.readContract({ address, abi: erc20Abi, functionName: 'symbol' }),
      c.readContract({ address, abi: erc20Abi, functionName: 'decimals' }),
    ])
    if (Number(dec) !== decimals) return { ok: false, note: `Decimals on-chain are ${dec}, not ${decimals}` }
    const a = sym.toLowerCase()
    const b = symbol.toLowerCase()
    if (a !== b && !a.includes(b)) return { ok: false, note: `On-chain symbol is "${sym}", not "${symbol}"` }
    return { ok: true, note: `Verified on-chain: code present, symbol ${sym}, ${dec} decimals` }
  } catch (e) {
    return { ok: false, transient: true, note: `Could not reach the chain to verify (${scrub(e).slice(0, 80)}). It will be retried.` }
  }
}

/** Checks every unverified contract in the background. Testnet seed rows are switched on once they pass; nothing else changes. */
export async function verifyPending(onChange: () => void) {
  const rows = all<{ id: number; symbol: string; network_id: string; contract: string; decimals: number; is_testnet: number; source: string }>(
    "SELECT id, symbol, network_id, contract, decimals, is_testnet, source FROM token_networks WHERE verified=0 AND contract IS NOT NULL AND source IN ('seed','admin')",
  )
  let changed = false
  // Networks run side by side; within one network contracts go one at a time, and a network that cannot be reached is skipped.
  const byNet = new Map<string, typeof rows>()
  for (const r of rows) byNet.set(r.network_id, [...(byNet.get(r.network_id) ?? []), r])
  await Promise.all([...byNet.values()].map(async (list) => {
    for (const r of list) {
      const res = await verifyOnChain(r.network_id, r.contract, r.symbol, r.decimals)
      if (res.ok) {
        // Only untouched seed rows are switched on automatically, and only on testnets (sandbox mode).
        run('UPDATE token_networks SET verified=1, verified_at=?, verify_note=?, is_active=CASE WHEN source=? AND is_testnet=1 THEN 1 ELSE is_active END WHERE id=?', now(), res.note, 'seed', r.id)
        changed = true
        onChange()
      } else {
        run('UPDATE token_networks SET verify_note=? WHERE id=?', res.note, r.id)
        if (res.transient) break
      }
    }
  }))
  if (changed) onChange()
}
