/**
 * Crypto history entries for activity that is not an incoming or outgoing wallet transfer: Circle swaps and bridge transfers.
 * They are written to the same wallet_txs table the History tab reads, so a swap shows both sides (what was paid and what was
 * received) and a bridge shows the burn and the mint. Each entry is written once: the table's unique key covers
 * (network, transaction hash, leg, user, type), so recording the same event twice does nothing.
 */
import { all, audit, get, now, run, uid } from '../db'
import { evmClient } from './chains'
import { ensureWallet } from './keys'
import { ASSETS, getAssetDef } from './networks'

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

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const KIND_WORDS = { swap: 'a swap', add: 'adding liquidity', remove: 'removing liquidity' } as const

/**
 * Writes History entries for an onchain exchange operation (a NairaSwap swap or liquidity change) by reading its transaction
 * receipts: every transfer of a wallet token out of the user's wallet is a "Paid" entry and every transfer into it a "Received"
 * entry. Pool share tokens are not wallet assets, so they are left out. Safe to run again: each entry is written once.
 */
export type ReceiptLike = { status: string; logs: { address: string; topics: readonly (string | null | undefined)[]; data: string; logIndex?: number | null }[] }

export async function recordDexHistory(
  userId: string, networkId: string, hashes: string[], kind: keyof typeof KIND_WORDS,
  /** Where receipts come from. Tests pass their own; the app reads the chain. */
  readReceipt: (hash: string) => Promise<ReceiptLike | null> = (h) => evmClient(networkId).getTransactionReceipt({ hash: h as `0x${string}` }).catch(() => null),
): Promise<number> {
  const me = (await ensureWallet(userId)).evm.toLowerCase()
  let written = 0
  for (const hash of hashes) {
    const receipt = await readReceipt(hash)
    if (!receipt || receipt.status !== 'success') continue
    for (const log of receipt.logs) {
      if (log.topics[0] !== TRANSFER_TOPIC || log.topics.length !== 3) continue
      const from = `0x${log.topics[1]?.slice(26)}`.toLowerCase()
      const to = `0x${log.topics[2]?.slice(26)}`.toLowerCase()
      const def = ASSETS.find((a) => a.network === networkId && a.contract?.toLowerCase() === log.address.toLowerCase())
      if (!def || from === to || (from !== me && to !== me)) continue
      const paid = from === me
      await recordHistoryLeg({
        userId, networkId, symbol: def.symbol, type: 'swapped', amountRaw: BigInt(log.data), from, to, hash, leg: Number(log.logIndex ?? 0),
        note: `${paid ? 'Paid in' : 'Received from'} ${KIND_WORDS[kind]}`,
      })
      written++
    }
  }
  return written
}

/** Adds History entries for exchange operations made before History recorded them. Runs once at worker start and is safe to repeat. */
export async function backfillDexHistory(): Promise<number> {
  const ops = await all<{ user_id: string; network: string; kind: string; hashes: string }>("SELECT user_id, network, kind, hashes FROM dex_ops WHERE status='confirmed' AND hashes<>'[]' ORDER BY created_at DESC LIMIT 500")
  let total = 0
  for (const o of ops) {
    const hashes = JSON.parse(o.hashes) as string[]
    if (!hashes.length) continue
    const kind = (o.kind === 'add' || o.kind === 'remove' ? o.kind : 'swap') as keyof typeof KIND_WORDS
    try {
      total += await recordDexHistory(o.user_id, o.network, hashes, kind)
    } catch { /* an unreachable endpoint is retried the next time the worker starts */ }
  }
  return total
}
