/** What Uniswap swaps share with their records: the per-swap limit, the saved record as the screen sees it, and the stale-swap sweep. */
import { HttpError, type User } from '../auth'
import { all, get, now, run } from '../db'
import { walletLimits } from '../wallet/service'

/** Spending limit for a token the founder's registry has no limit for yet, in whole tokens. */
const FALLBACK_CAP: Record<string, string> = { EURC: '500' }

export async function capFor(symbol: string): Promise<string> {
  const limits = await walletLimits()
  const cap = limits.perTx[symbol] ?? FALLBACK_CAP[symbol]
  if (!cap) throw new HttpError(403, `Swapping ${symbol} is not switched on yet: no limit has been set for it.`)
  return cap
}

const CHAIN_NAMES: Record<string, string> = { 'ethereum-sepolia': 'Ethereum Sepolia' }

export function opView(r: Record<string, unknown>) {
  return {
    id: r.id, chain: CHAIN_NAMES[String(r.chain)] ?? String(r.chain), tokenIn: r.token_in, tokenOut: r.token_out, labelIn: r.token_in, labelOut: r.token_out,
    amountIn: r.amount_in, amountOut: r.amount_out ?? null, slippageBps: r.slippage_bps, provider: r.provider ?? null, status: r.status as 'running' | 'completed' | 'failed',
    txHash: r.tx_hash ?? null, explorerUrl: r.explorer_url ?? null, fees: JSON.parse(String(r.fees)), error: r.error ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
  }
}

export async function getSwapOp(user: User, opId: string) {
  const row = await get<Record<string, unknown>>('SELECT * FROM swap_ops WHERE id=? AND user_id=?', opId, user.id)
  if (!row) throw new HttpError(404, 'Swap not found')
  return opView(row)
}

export const listSwapOps = async (user: User) => (await all<Record<string, unknown>>('SELECT * FROM swap_ops WHERE user_id=? ORDER BY created_at DESC LIMIT 30', user.id)).map(opView)

/** A swap whose heartbeat stopped (its process restarted) is marked failed with a plain instruction. Run by the worker. */
export async function sweepStaleSwapOps() {
  await run("UPDATE swap_ops SET status='failed', error='The server restarted during this swap. Check your balance and the transaction link before trying again.', updated_at=? WHERE status='running' AND updated_at<?", now(), now() - 180_000)
}
