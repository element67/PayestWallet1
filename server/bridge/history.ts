/** History entries for a finished bridge transfer: the burn on the source network and the mint on the destination network. */
import { all } from '../db'
import { toUnits } from '../money'
import { recordHistoryLeg } from '../wallet/history'
import { ensureWallet } from '../wallet/keys'
import { findChain, type BridgeChain } from './chains'

export interface BridgeStep { name: string; txHash?: string | null }

export async function recordBridgeHistory(userId: string, src: BridgeChain, dst: BridgeChain, amount: string, steps: BridgeStep[]): Promise<void> {
  const addrs = await ensureWallet(userId)
  const mine = (c: BridgeChain) => (c.family === 'solana' ? addrs.solana : addrs.evm)
  const raw = toUnits(amount, 6)
  const burn = steps.find((s) => s.name === 'burn' && s.txHash)
  const mint = steps.find((s) => s.name === 'mint' && s.txHash)
  if (burn?.txHash) await recordHistoryLeg({ userId, networkId: src.id, symbol: 'USDC', type: 'bridged', amountRaw: raw, from: mine(src), to: `${dst.name} (bridge)`, hash: burn.txHash, leg: 0, note: `Paid out to bridge to ${dst.name}` })
  if (mint?.txHash) await recordHistoryLeg({ userId, networkId: dst.id, symbol: 'USDC', type: 'bridged', amountRaw: raw, from: `${src.name} (bridge)`, to: mine(dst), hash: mint.txHash, leg: 1, note: `Received from a bridge from ${src.name}` })
}

/** Adds History entries for bridge transfers that finished before History recorded them. Safe to repeat: each entry is written once. */
export async function backfillBridgeHistory(): Promise<number> {
  const ops = await all<{ user_id: string; from_chain: string; to_chain: string; amount: string; steps: string }>("SELECT user_id, from_chain, to_chain, amount, steps FROM bridge_ops WHERE status='completed' ORDER BY created_at DESC LIMIT 500")
  let n = 0
  for (const o of ops) {
    const src = findChain(o.from_chain), dst = findChain(o.to_chain)
    if (!src || !dst) continue
    try {
      await recordBridgeHistory(o.user_id, src, dst, o.amount, JSON.parse(o.steps) as BridgeStep[])
      n++
    } catch { /* retried the next time the worker starts */ }
  }
  return n
}
