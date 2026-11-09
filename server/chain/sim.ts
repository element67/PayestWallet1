/**
 * Sandbox chain simulator for assets without a live adapter (USDT, BTC, SOL) and for failure drills.
 * Everything here is SIMULATED: transactions carry a "sim:" hash prefix and are labelled in the UI.
 */
import { getAsset } from '../assets'
import { approvedTokenId, ingest, markDropped, type Observation } from '../agent'
import { HttpError } from '../auth'
import { get, now, run, settingNum } from '../db'
import { getOrder, setStatus } from '../orders'
import { randomHex } from '../security'

export type Scenario = 'genuine' | 'fake_token' | 'underpay' | 'dropped' | 'duplicate'

export function simulateDeposit(orderId: string, userId: string, scenario: Scenario) {
  const o = getOrder(orderId)
  if (!o || o.user_id !== userId || o.side !== 'sell') throw new HttpError(404, 'Order not found')
  if (o.mode !== 'sandbox') throw new HttpError(400, 'This order uses the live chain. Send a real transaction instead.')
  if (o.status !== 'awaiting_deposit') throw new HttpError(409, 'This order is not waiting for a deposit')
  const asset = getAsset(o.asset)
  if (!asset) throw new HttpError(400, 'Unknown asset')
  const hash = `sim:0x${randomHex(32)}`
  const chain = `sim-${asset.chain}`
  const amount = scenario === 'underpay' ? BigInt(o.crypto_amount) - BigInt(o.crypto_amount) / 10n : BigInt(o.crypto_amount)
  const token = scenario === 'fake_token' ? `sim:fake-${asset.symbol.toLowerCase()}` : approvedTokenId(asset)
  const base: Observation = {
    chain, txHash: hash, tokenAddress: token, from: 'sim-sender', to: 'sim-vault', amount, blockNumber: null,
    status: 'pending', confirmations: 0, simulated: true, visibleAtMs: now(), orderHint: o.id,
  }
  run('UPDATE orders SET tx_hash=?, broadcast_at=? WHERE id=?', hash, now(), o.id)
  setStatus(o.id, 'deposit_reported', 'deposit.broadcast', `Simulated ${asset.chain} transaction broadcast (${scenario})`)
  const required = settingNum('confirmations_required')
  setTimeout(() => ingest(base), 700)
  if (scenario === 'duplicate') setTimeout(() => ingest({ ...base, replay: true }), 1100)
  if (scenario === 'dropped') {
    setTimeout(() => markDropped(chain, hash, 'dropped'), 4500)
    return { hash, scenario }
  }
  setTimeout(() => ingest({ ...base, status: 'confirmed', confirmations: 1, blockNumber: 1 }), 2500)
  setTimeout(() => ingest({ ...base, status: 'confirmed', confirmations: required, blockNumber: 1 }), 5000)
  return { hash, scenario }
}

export const simChainStatus = () => get<{ c: number }>("SELECT COUNT(*) c FROM chain_txs WHERE simulated=1")?.c ?? 0
