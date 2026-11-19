/**
 * Crypto history entries for activity that is not an incoming or outgoing wallet transfer: Circle swaps and bridge transfers.
 * They are written to the same wallet_txs table the History tab reads, so a swap shows both sides (what was paid and what was
 * received) and a bridge shows the burn and the mint. Each entry is written once: the table's unique key covers
 * (network, transaction hash, leg, user, type), so recording the same event twice does nothing.
 */
import { audit, get, now, run, uid } from '../db'
import { getAssetDef } from './networks'

export interface HistoryLeg {
  userId: string
  networkId: string
  /** Display symbol, e.g. USDC, EURC, cirBTC. */
  symbol: string
  type: 'swapped' | 'bridged'
  /** Amount in the token's smallest unit. */
  amountRaw: bigint
  from: string
  to: string
  hash: string
  /** 0 for the paid side, 1 for the received side. Entries read from a receipt use the log's own index. */
  leg: number
  /** Plain-words description, starting with "Paid" or "Received" so the screen can tell the direction. */
  note: string
}

/** Records one side of a swap or bridge. Safe to call more than once. */
export async function recordHistoryLeg(l: HistoryLeg): Promise<void> {
  const assetKey = getAssetDef(`${l.symbol}@${l.networkId}`)?.key ?? null
  const exists = await get('SELECT 1 FROM wallet_txs WHERE network=? AND tx_hash=? AND log_index=? AND user_id=? AND type=?', l.networkId, l.hash, l.leg, l.userId, l.type)
  if (exists) return
  const t = now()
  await run(
    `INSERT INTO wallet_txs(id,user_id,network,asset_key,token_ref,symbol,type,amount,from_addr,to_addr,tx_hash,status,verdict,confirmations,risk_score,risk_flags,note,detected_at,created_at,updated_at,finalized_at,log_index)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    uid('wtx'), l.userId, l.networkId, assetKey, null, l.symbol, l.type, l.amountRaw.toString(), l.from, l.to, l.hash, 'finalized', 'genuine', 1, 0, '[]', l.note, t, t, t, t, l.leg,
  )
  await audit(l.userId, `history.${l.type}`, l.hash, undefined, { symbol: l.symbol, network: l.networkId, leg: l.leg })
}

/** Decimals for tokens that are not in the wallet's asset list (cirBTC), so their amounts read correctly in History. */
export const EXTRA_DECIMALS: Record<string, number> = { CIRBTC: 8, USDC: 6, EURC: 6 }

/** A decimal string such as "1.3357289999" in the token's smallest unit. Extra digits beyond the token's decimals are cut off. */
export function unitsOf(amount: string, decimals: number): bigint {
  const [whole, frac = ''] = amount.trim().split('.')
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(frac)) return 0n
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.slice(0, decimals).padEnd(decimals, '0') || '0')
}
