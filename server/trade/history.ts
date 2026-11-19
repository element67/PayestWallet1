/** History entries for a finished trade: what was paid and what was received, each with its transaction link. */
import { recordHistoryLeg, unitsOf } from '../wallet/history'
import type { ExecResult, TradeRequest, Who } from './types'

export async function recordTradeHistory(userId: string, req: TradeRequest, who: Who, result: ExecResult, provider: string, steps: { name: string; txHash?: string }[]): Promise<void> {
  const mine = (family: string) => (family === 'solana' ? who.solana : who.evm)
  if (req.kind === 'swap') {
    const hash = result.txHashes[result.txHashes.length - 1]
    if (!hash) return
    await recordHistoryLeg({ userId, networkId: req.from.id, symbol: req.tokenIn.label, type: 'swapped', amountRaw: req.amountRaw, from: mine(req.from.family), to: provider, hash, leg: 0, note: `Paid in a swap for ${req.tokenOut.label}` })
    if (result.amountOut) await recordHistoryLeg({ userId, networkId: req.from.id, symbol: req.tokenOut.label, type: 'swapped', amountRaw: unitsOf(result.amountOut, req.tokenOut.decimals), from: provider, to: mine(req.from.family), hash, leg: 1, note: `Received in a swap for ${req.tokenIn.label}` })
    return
  }
  // A bridge: the burn is on the source network. The mint is a second entry when the provider reported its transaction.
  const burn = steps.find((s) => s.name === 'burn' && s.txHash)?.txHash ?? result.txHashes[result.txHashes.length - 1]
  const mint = steps.find((s) => s.name === 'mint' && s.txHash)?.txHash
  if (burn) await recordHistoryLeg({ userId, networkId: req.from.id, symbol: req.tokenIn.label, type: 'bridged', amountRaw: req.amountRaw, from: mine(req.from.family), to: `${req.to.name} (bridge)`, hash: burn, leg: 0, note: `Paid out to bridge to ${req.to.name}` })
  if (mint && result.amountOut) await recordHistoryLeg({ userId, networkId: req.to.id, symbol: req.tokenOut.label, type: 'bridged', amountRaw: unitsOf(result.amountOut, req.tokenOut.decimals), from: `${req.from.name} (bridge)`, to: mine(req.to.family), hash: mint, leg: 1, note: `Received from a bridge from ${req.from.name}` })
}
