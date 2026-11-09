/** Serializers: turn DB rows into client-safe JSON with decimal strings (never floats). */
import { buildTxExplorerUrl } from '../src/onchain-facts'
import { CONFIG } from './config'
import { all, get } from './db'
import { getAsset, type Asset } from './assets'
import { fromUnits } from './money'
import type { OrderRow } from './orders'

const ngn = (v: string | bigint) => fromUnits(BigInt(v), 2)

export function assetView(a: Asset) {
  return {
    symbol: a.symbol, name: a.name, chain: a.chain, decimals: a.decimals, enabled: Boolean(a.enabled), monitoring: a.monitoring,
    contract: a.contract, buyRate: ngn(a.buy_rate_kobo), sellRate: ngn(a.sell_rate_kobo), minNgn: ngn(a.min_ngn_kobo), maxNgn: ngn(a.max_ngn_kobo),
    rateVersion: a.rate_version, rateSource: a.rate_source, updatedAt: a.updated_at,
  }
}

export function orderView(o: OrderRow, detail = false) {
  const asset = getAsset(o.asset)
  const decimals = asset?.decimals ?? 6
  const tx = get<{ tx_hash: string; status: string; verdict: string; confirmations: number; simulated: number; chain: string; detect_latency_ms: number | null }>(
    'SELECT * FROM chain_txs WHERE order_id=? ORDER BY first_seen_at DESC LIMIT 1', o.id,
  )
  const payment = get<{ reference: string; status: string; direction: string; simulated: number }>(
    'SELECT reference, status, direction, simulated FROM payments WHERE order_id=? ORDER BY created_at DESC LIMIT 1', o.id,
  )
  const hash = tx?.tx_hash ?? o.tx_hash
  const view = {
    id: o.id, side: o.side, asset: o.asset, status: o.status, mode: o.mode,
    cryptoAmount: fromUnits(BigInt(o.crypto_amount), decimals), grossNgn: ngn(o.gross_kobo), feeNgn: ngn(o.fee_kobo), netNgn: ngn(o.net_kobo),
    rate: ngn(o.rate_kobo), payoutType: o.payout_type, funding: o.funding, destAddress: o.dest_address, fromAddress: o.from_address,
    depositAddress: o.deposit_address, instant: Boolean(o.instant), riskScore: o.risk_score, riskFlags: JSON.parse(o.risk_flags) as string[],
    txHash: hash, txUrl: hash && !hash.startsWith('sim:') && tx && !tx.simulated ? buildTxExplorerUrl(CONFIG.arc.chainId, hash) : null,
    chainTx: tx ? { status: tx.status, verdict: tx.verdict, confirmations: tx.confirmations, simulated: Boolean(tx.simulated), detectLatencyMs: tx.detect_latency_ms } : null,
    payment: payment ? { reference: payment.reference, status: payment.status, direction: payment.direction, simulated: Boolean(payment.simulated) } : null,
    failureReason: o.failure_reason, createdAt: o.created_at, updatedAt: o.updated_at, expiresAt: o.expires_at, detectedAt: o.detected_at,
    payoutAt: o.payout_at, completedAt: o.completed_at, userId: o.user_id,
  }
  if (!detail) return view
  const events = all<{ at: number; kind: string; detail: string }>('SELECT at, kind, detail FROM order_events WHERE order_id=? ORDER BY id', o.id)
  return { ...view, events }
}
