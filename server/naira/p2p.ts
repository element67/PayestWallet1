/** P2P funding records: the Naira side of a crypto-to-Naira exchange order that pays out to the wallet. */
import { get, now, run, uid } from '../db'
import { fromUnits } from '../money'
import { createTxn, patchTxn } from './txns'

interface OrderLite {
  id: string
  user_id: string
  side: string
  asset: string
  crypto_amount: string
  net_kobo: string
  fee_kobo: string
  rate_kobo: string
  status: string
  mode: string
  payout_type: string | null
  tx_hash: string | null
}

const order = (id: string) => get<OrderLite>('SELECT * FROM orders WHERE id=?', id)

export function createP2pRecord(orderId: string) {
  const o = order(orderId)
  if (!o || o.side !== 'sell' || o.payout_type !== 'wallet') return
  const t = now()
  run(
    "INSERT OR IGNORE INTO p2p_orders(id,user_id,exchange_order_id,asset,crypto_amount,expected_kobo,status,created_at,updated_at) VALUES (?,?,?,?,?,?,'pending',?,?)",
    uid('p2p'), o.user_id, o.id, o.asset, o.crypto_amount, o.net_kobo, t, t,
  )
}

const MAP: Record<string, string> = {
  completed: 'confirmed', payout_completed: 'confirmed', awaiting_finality: 'confirmed', expired: 'expired', cancelled: 'expired',
  failed: 'failed', rejected: 'failed', flagged: 'failed', reversed: 'failed',
}

/** Keeps the P2P order status in step with the exchange order, which is driven by the monitor and the order engine. */
export function syncP2pOrder(orderId: string) {
  const o = order(orderId)
  if (!o) return
  const status = MAP[o.status] ?? 'pending'
  run('UPDATE p2p_orders SET status=?, updated_at=? WHERE exchange_order_id=?', status, now(), orderId)
}

/** The wallet was credited through the ledger: write the customer-visible transaction once. */
export function recordP2pCredit(orderId: string, ledgerTxnId: string | null) {
  const o = order(orderId)
  if (!o || !ledgerTxnId) return
  const p = get<{ id: string; transaction_id: string | null }>('SELECT id, transaction_id FROM p2p_orders WHERE exchange_order_id=?', orderId)
  if (p?.transaction_id) return
  const dec = get<{ decimals: number }>('SELECT decimals FROM assets WHERE symbol=?', o.asset)?.decimals ?? 6
  const t = createTxn({
    userId: o.user_id,
    type: 'p2p_deposit',
    direction: 'credit',
    amount: BigInt(o.net_kobo),
    fee: 0n,
    status: 'success',
    title: `Deposit via ${o.asset}`,
    counterparty: `${o.asset} (${o.mode === 'live' ? 'Arc Testnet' : 'sandbox network'})`,
    ledgerTxnId,
    idemKey: `p2p:${o.id}`,
    prefix: 'NBP',
    meta: {
      orderId: o.id, asset: o.asset, cryptoAmount: fromUnits(BigInt(o.crypto_amount), dec), rateNgn: fromUnits(BigInt(o.rate_kobo), 2),
      platformFee: fromUnits(BigInt(o.fee_kobo), 2), txHash: o.tx_hash, simulatedChain: o.mode !== 'live',
    },
  })
  run('UPDATE p2p_orders SET transaction_id=?, updated_at=? WHERE exchange_order_id=?', t.id, now(), orderId)
}

/** The deposit later failed on-chain and the credit was clawed back through the ledger. */
export function markP2pReversed(orderId: string) {
  const p = get<{ transaction_id: string | null }>('SELECT transaction_id FROM p2p_orders WHERE exchange_order_id=?', orderId)
  if (p?.transaction_id) patchTxn(p.transaction_id, { status: 'reversed', reversed: true, failureReason: 'The crypto deposit failed after the credit; the credit was reversed.' })
}
