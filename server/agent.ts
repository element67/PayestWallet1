/**
 * Transaction Agent. Observes chain transactions, classifies them (genuine, fake token, mismatch,
 * duplicate), scores risk with deterministic rules, records every decision, and REQUESTS actions.
 * It holds no keys and moves no money: the order engine re-checks every policy before acting.
 */
import { listAssets, instantLimitKobo, type Asset } from './assets'
import { alert, all, get, now, notify, orderEvent, run, setting, settingNum, uid } from './db'
import { balanceOf, post } from './ledger'
import { failOrder, getOrder, maybeComplete, reverseOrder, setStatus, type OrderRow } from './orders'
import { enqueue, reviveDead } from './queue'
import { fromUnits } from './money'

export interface Observation {
  chain: string
  txHash: string
  tokenAddress: string | null
  from: string
  to: string
  amount: bigint
  blockNumber: number | null
  /** Position of the Transfer log in its transaction. Omitted for pending hints and simulated transfers. */
  logIndex?: number
  status: 'pending' | 'confirmed' | 'failed' | 'dropped'
  confirmations: number
  simulated: boolean
  /** Epoch ms of when the transaction became visible to the network (block time, or emit time). */
  visibleAtMs: number | null
  orderHint?: string
  /** True when the same transaction is deliberately reported again (duplicate drill). */
  replay?: boolean
}

interface TxRow {
  id: string
  status: string
  verdict: string
  order_id: string | null
  asset: string | null
  amount: string | null
  confirmations: number
  chain: string
  tx_hash: string
  log_index: number
}

export const approvedTokenId = (a: Asset) => (a.contract ?? `sim:${a.symbol}`).toLowerCase()

async function decide(kind: string, decision: string, o: { orderId?: string | null; txId?: string; score?: number; reasons?: string[] }) {
  await run(
    'INSERT INTO agent_decisions(at, order_id, tx_id, kind, decision, score, reasons) VALUES (?,?,?,?,?,?,?)',
    now(), o.orderId ?? null, o.txId ?? null, kind, decision, o.score ?? 0, JSON.stringify(o.reasons ?? []),
  )
}

async function assessRisk(order: OrderRow, tx: Observation): Promise<{ score: number; flags: string[] }> {
  const flags: string[] = []
  let score = 0
  const user = await get<{ created_at: number; kyc_tier: number; dev_preview: number }>('SELECT created_at, kyc_tier, dev_preview FROM users WHERE id=?', order.user_id)
  if (user && !user.dev_preview) {
    if (now() - user.created_at < 86_400_000) { score += 15; flags.push('new_account') }
    if (user.kyc_tier < 2) { score += 10; flags.push('kyc_tier_1') }
  }
  if (BigInt(order.net_kobo) * 10n >= await instantLimitKobo() * 8n) { score += 10; flags.push('near_instant_limit') }
  const recent = await get<{ c: number }>('SELECT COUNT(*) c FROM orders WHERE user_id=? AND created_at>?', order.user_id, now() - 3_600_000)
  if ((recent?.c ?? 0) >= 4) { score += 20; flags.push('high_velocity') }
  if (order.from_address) {
    const known = await get('SELECT 1 FROM orders WHERE user_id=? AND from_address=? AND status=\'completed\' LIMIT 1', order.user_id, order.from_address)
    if (!known) { score += 10; flags.push('new_source_address') }
  }
  if (tx.status === 'pending') { score += 5; flags.push('not_yet_in_block') }
  return { score, flags }
}

/**
 * The open sell order a transfer belongs to. It is matched by the order's own registered source address and asset only:
 * an unknown token, an unknown sender, or "any order with this amount" never matches. A reported-hash hint is honoured
 * only when the transfer really came from the order's source address.
 */
async function findOrder(obs: Observation, asset: Asset | undefined): Promise<OrderRow | null> {
  if (obs.orderHint) {
    const hinted = await getOrder(obs.orderHint)
    if (!hinted) return null
    if (hinted.from_address && hinted.from_address.toLowerCase() !== obs.from.toLowerCase()) return null
    return hinted
  }
  if (!asset) return null
  const byAddress = async (extra: string, ...p: string[]) =>
    await get<OrderRow>(
      `SELECT * FROM orders WHERE side='sell' AND mode='live' AND asset=? AND status IN ('awaiting_deposit','deposit_reported')
         AND from_address IS NOT NULL AND lower(from_address)=lower(?) ${extra} ORDER BY created_at DESC LIMIT 1`,
      asset.symbol, obs.from, ...p,
    )
  return await byAddress('AND crypto_amount=?', obs.amount.toString()) ?? await byAddress('')
}

/** The stored row of a transfer. Without a log index (pending hints, simulations) the transaction hash alone identifies it. */
async function findRow(chain: string, hash: string, logIndex: number | undefined): Promise<TxRow | null> {
  if (logIndex === undefined) return await get<TxRow>('SELECT * FROM chain_txs WHERE chain=? AND tx_hash=? ORDER BY log_index LIMIT 1', chain, hash)
  const exact = await get<TxRow>('SELECT * FROM chain_txs WHERE chain=? AND tx_hash=? AND log_index=?', chain, hash, logIndex)
  if (exact) return exact
  // A transfer first seen pending (no block, so no log yet) is adopted by the first mined log of the same transaction.
  const pending = await get<TxRow>("SELECT * FROM chain_txs WHERE chain=? AND tx_hash=? AND status='pending' AND block_number IS NULL ORDER BY log_index LIMIT 1", chain, hash)
  if (!pending) return null
  await run('UPDATE chain_txs SET log_index=? WHERE id=?', logIndex, pending.id)
  return { ...pending, log_index: logIndex }
}

export async function ingest(obs: Observation): Promise<void> {
  const assets = await listAssets()
  const hash = obs.txHash.toLowerCase()
  const existing = await findRow(obs.chain, hash, obs.logIndex)
  if (existing) return await updateExisting(existing, obs)

  const token = (obs.tokenAddress ?? '').toLowerCase()
  const asset = assets.find((a) => approvedTokenId(a) === token)
  const hinted = obs.orderHint ? (await getOrder(obs.orderHint))?.asset : undefined
  const claimedAsset = hinted ? assets.find((a) => a.symbol === hinted) : undefined
  const verdict = asset ? 'genuine' : 'fake_token'
  const id = uid('ctx')
  const latency = obs.visibleAtMs ? Math.max(0, now() - obs.visibleAtMs) : null
  await run(
    `INSERT INTO chain_txs(id,chain,tx_hash,log_index,token_address,asset,from_addr,to_addr,amount,block_number,confirmations,status,verdict,simulated,first_seen_at,detect_latency_ms,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, obs.chain, hash, obs.logIndex ?? 0, token || null, asset?.symbol ?? claimedAsset?.symbol ?? null, obs.from.toLowerCase(), obs.to.toLowerCase(), obs.amount.toString(),
    obs.blockNumber, obs.confirmations, obs.status, verdict, obs.simulated ? 1 : 0, now(), latency, now(),
  )
  await decide('detect', `Detected ${obs.status} transfer`, { txId: id, reasons: [`token ${token || 'native'}`, latency === null ? 'latency n/a' : `visible ${latency}ms before detection`] })

  const order = await findOrder(obs, asset ?? claimedAsset)

  if (verdict === 'fake_token') {
    // Anyone can deploy a token that emits a Transfer from any address, so a fake token is only recorded and alerted on.
    // It is never bound to an order: that would let a stranger lock somebody else's order out of its real deposit.
    await decide('verify', 'REJECT: token is not an approved contract/mint', { orderId: order?.id, txId: id, score: 100, reasons: ['unsupported_or_fake_token', `got ${token}`] })
    await alert('critical', 'fake_token', 'Fake or unsupported token sent to vault', `${obs.chain} tx ${hash} sent token ${token || 'unknown'}. Nobody was credited.${order ? ` It claimed order ${order.id}; the order was left untouched.` : ''}`)
    return
  }

  if (!order) {
    await decide('match', 'HOLD: genuine token but no matching open order', { txId: id, score: 30, reasons: ['unmatched_deposit'] })
    await alert('warning', 'unmatched_deposit', 'Deposit with no matching order', `${asset?.symbol} tx ${hash} from ${obs.from}. Not credited.`)
    return
  }
  // Only a deposit that was already accepted for the order blocks a second one. A hash the user merely reported is a claim, not a deposit.
  const ACCEPTED = ['detected', 'deposit_verified', 'payout_processing', 'payout_completed', 'awaiting_finality', 'completed']
  if (order.tx_hash && order.tx_hash !== hash && ACCEPTED.includes(order.status)) {
    await decide('match', 'REJECT: order already has a deposit', { orderId: order.id, txId: id, reasons: ['duplicate_deposit'] })
    await alert('warning', 'duplicate_deposit', 'Second deposit for the same order', `Order ${order.id} tx ${hash}. Not credited.`, order.user_id, order.id)
    return
  }

  if (obs.amount.toString() !== order.crypto_amount) {
    // Wrong amount: the funds sit in the vault for a person to review. The order stays open for its real deposit and is not locked.
    await decide('verify', 'HOLD: amount differs from quote, order left open', { orderId: order.id, txId: id, score: 80, reasons: [`expected ${order.crypto_amount}`, `got ${obs.amount}`] })
    await alert('critical', 'amount_mismatch', 'Deposit amount differs from quote', `Order ${order.id}: expected ${order.crypto_amount}, got ${obs.amount} (tx ${hash}). Not credited to the order; manual review needed.`, order.user_id, order.id)
    await notify(order.user_id, 'security', 'Deposit amount did not match', 'A transfer with a different amount than your quote was received. It was not used for this order. Send the exact quoted amount or cancel the order.')
    return
  }
  await run('UPDATE chain_txs SET order_id=? WHERE id=?', order.id, id)

  await setStatus(order.id, 'detected', 'deposit.detected', `${obs.status} on ${obs.chain}${latency !== null ? `, seen ${latency}ms after it was visible` : ''}`, {
    tx_hash: hash, detected_at: now(), broadcast_at: order.broadcast_at ?? now(),
  })
  const { score, flags } = await assessRisk(order, obs)
  await run('UPDATE orders SET risk_score=?, risk_flags=? WHERE id=?', score, JSON.stringify(flags), order.id)
  await routePayout(order.id, id, score, flags, obs.status)
}

async function routePayout(orderId: string, txId: string, score: number, flags: string[], txStatus: string) {
  const o = await getOrder(orderId)
  if (!o) return
  const block = await settingNum('risk_block_score')
  const review = await settingNum('risk_review_score')
  if (score >= block) {
    await decide('risk', 'BLOCK: risk score too high', { orderId, txId, score, reasons: flags })
    await setStatus(orderId, 'flagged', 'risk.blocked', `Risk score ${score}`)
    await alert('critical', 'high_risk', 'High-risk transaction blocked', `Order ${orderId} score ${score}: ${flags.join(', ')}`, o.user_id, orderId)
    return
  }
  const net = BigInt(o.net_kobo)
  const instantOk =
    score < review && await setting('instant_payouts_enabled') === 'true' && net <= await instantLimitKobo() && txStatus !== 'failed' &&
    await balanceOf('house', 'NGN') >= net
  if (instantOk) {
    await decide('payout', 'INSTANT payout requested (evidence verified, risk low, within limit, liquidity available)', { orderId, txId, score, reasons: flags })
    await enqueue(`order.payout:${orderId}`, 'order.payout', { orderId, instant: true })
  } else {
    const why = [
      ...(score >= review ? ['risk_review'] : []),
      ...(net > await instantLimitKobo() ? ['above_instant_limit'] : []),
      ...(await setting('instant_payouts_enabled') !== 'true' ? ['instant_disabled'] : []),
      ...(await balanceOf('house', 'NGN') < net ? ['low_liquidity'] : []),
    ]
    await decide('payout', 'HOLD until final confirmation', { orderId, txId, score, reasons: [...flags, ...why] })
    await orderEvent(orderId, 'agent.hold', `Waiting for final confirmation (${why.join(', ') || 'policy'})`)
  }
}

async function updateExisting(row: TxRow, obs: Observation) {
  if (row.status === 'finalized') return
  const terminalBad = ['failed', 'dropped', 'replaced']
  if (terminalBad.includes(row.status)) return
  if (obs.replay) {
    await decide('monitor', 'Duplicate observation ignored (same transaction seen again)', { orderId: row.order_id, txId: row.id, reasons: ['duplicate_tx'] })
    await alert('info', 'duplicate_tx', 'Duplicate transaction report ignored', `${row.chain} ${row.tx_hash} was reported twice. Only one payout is possible.`, undefined, row.order_id ?? undefined)
    return
  }
  const next = row.status === 'confirmed' && obs.status === 'pending' ? 'confirmed' : obs.status
  if (next === row.status && obs.confirmations <= row.confirmations) return
  await run('UPDATE chain_txs SET status=?, confirmations=?, block_number=COALESCE(?, block_number), updated_at=? WHERE id=?', next, Math.max(obs.confirmations, row.confirmations), obs.blockNumber, now(), row.id)
  if (next === 'failed' || next === 'dropped') await onBad(row, next)
}

async function onBad(row: TxRow, why: string) {
  await decide('monitor', `Transaction ${why}`, { orderId: row.order_id, txId: row.id, score: 60, reasons: [why] })
  await alert('warning', `tx_${why}`, `Transaction ${why}`, `${row.chain} ${row.tx_hash}`, undefined, row.order_id ?? undefined)
  if (!row.order_id) return
  const o = await getOrder(row.order_id)
  if (!o) return
  if (['payout_completed', 'payout_processing', 'awaiting_finality'].includes(o.status)) await reverseOrder(o.id, `Deposit transaction ${why} after instant payout`)
  else if (!['completed', 'reversed'].includes(o.status)) await failOrder(o.id, 'failed', `Deposit transaction ${why}`)
}

/** Called after a hint (user-reported hash) is seen on the network but not yet attributed. */
export async function markDropped(chain: string, txHash: string, why: 'dropped' | 'replaced' | 'failed') {
  for (const row of await all<TxRow>('SELECT * FROM chain_txs WHERE chain=? AND tx_hash=?', chain, txHash.toLowerCase())) {
    if (['finalized', 'failed', 'dropped', 'replaced'].includes(row.status)) continue
    await run('UPDATE chain_txs SET status=?, updated_at=? WHERE id=?', why, now(), row.id)
    await onBad(row, why)
  }
}

/** Reconcile loop: promote confirmed transactions to final, release held payouts, complete orders. */
export async function reconcile() {
  const required = await settingNum('confirmations_required')
  const open = await all<TxRow>("SELECT * FROM chain_txs WHERE status IN ('pending','confirmed')")
  for (const tx of open) {
    if (tx.status === 'confirmed' && tx.confirmations >= required && tx.verdict === 'genuine') {
      await run("UPDATE chain_txs SET status='finalized', settled_at=?, updated_at=? WHERE id=?", now(), now(), tx.id)
      if (tx.asset && tx.amount) {
        await post({ owner: 'house', asset: tx.asset, delta: BigInt(tx.amount), reason: 'deposit finalized into vault', idem: `deposit:${tx.id}`, orderId: tx.order_id ?? undefined })
      }
      await decide('settle', 'Deposit finalized', { orderId: tx.order_id, txId: tx.id, reasons: [`${tx.confirmations} confirmations`] })
      if (tx.order_id) {
        const o = await getOrder(tx.order_id)
        if (o?.status === 'detected') {
          // One canonical payout job per order: the instant and the final path share it, and a payout can only be dispatched once.
          await enqueue(`order.payout:${o.id}`, 'order.payout', { orderId: o.id, instant: false })
          await reviveDead(`order.payout:${o.id}`)
        }
        else await maybeComplete(tx.order_id)
      }
    }
  }
  for (const o of await all<OrderRow>("SELECT * FROM orders WHERE status='awaiting_liquidity'")) await enqueue(`order.release:${o.id}:${Math.floor(now() / 15000)}`, 'order.release', { orderId: o.id })
  for (const o of await all<OrderRow>("SELECT * FROM orders WHERE status IN ('payout_completed','awaiting_finality')")) await maybeComplete(o.id)
}

export function describeDeposit(o: OrderRow, decimals: number) {
  return `${fromUnits(BigInt(o.crypto_amount), decimals)} ${o.asset}`
}
