/**
 * Transaction Agent. Observes chain transactions, classifies them (genuine, fake token, mismatch,
 * duplicate), scores risk with deterministic rules, records every decision, and REQUESTS actions.
 * It holds no keys and moves no money: the order engine re-checks every policy before acting.
 */
import { listAssets, instantLimitKobo, type Asset } from './assets'
import { alert, all, get, now, notify, orderEvent, run, setting, settingNum, uid } from './db'
import { balanceOf, post } from './ledger'
import { failOrder, getOrder, maybeComplete, reverseOrder, setStatus, type OrderRow } from './orders'
import { enqueue } from './queue'
import { fromUnits } from './money'

export interface Observation {
  chain: string
  txHash: string
  tokenAddress: string | null
  from: string
  to: string
  amount: bigint
  blockNumber: number | null
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
}

export const approvedTokenId = (a: Asset) => (a.contract ?? `sim:${a.symbol}`).toLowerCase()

function decide(kind: string, decision: string, o: { orderId?: string | null; txId?: string; score?: number; reasons?: string[] }) {
  run(
    'INSERT INTO agent_decisions(at, order_id, tx_id, kind, decision, score, reasons) VALUES (?,?,?,?,?,?,?)',
    now(), o.orderId ?? null, o.txId ?? null, kind, decision, o.score ?? 0, JSON.stringify(o.reasons ?? []),
  )
}

function assessRisk(order: OrderRow, tx: Observation): { score: number; flags: string[] } {
  const flags: string[] = []
  let score = 0
  const user = get<{ created_at: number; kyc_tier: number; dev_preview: number }>('SELECT created_at, kyc_tier, dev_preview FROM users WHERE id=?', order.user_id)
  if (user && !user.dev_preview) {
    if (now() - user.created_at < 86_400_000) { score += 15; flags.push('new_account') }
    if (user.kyc_tier < 2) { score += 10; flags.push('kyc_tier_1') }
  }
  if (BigInt(order.net_kobo) * 10n >= instantLimitKobo() * 8n) { score += 10; flags.push('near_instant_limit') }
  const recent = get<{ c: number }>('SELECT COUNT(*) c FROM orders WHERE user_id=? AND created_at>?', order.user_id, now() - 3_600_000)
  if ((recent?.c ?? 0) >= 4) { score += 20; flags.push('high_velocity') }
  if (order.from_address) {
    const known = get('SELECT 1 FROM orders WHERE user_id=? AND from_address=? AND status=\'completed\' LIMIT 1', order.user_id, order.from_address)
    if (!known) { score += 10; flags.push('new_source_address') }
  }
  if (tx.status === 'pending') { score += 5; flags.push('not_yet_in_block') }
  return { score, flags }
}

function findOrder(obs: Observation, asset: Asset | undefined): OrderRow | null {
  if (obs.orderHint) return getOrder(obs.orderHint)
  if (!asset) {
    // Unknown token: still try to tell which user sent it, by their registered source address.
    return get<OrderRow>(
      `SELECT * FROM orders WHERE side='sell' AND mode='live' AND status IN ('awaiting_deposit','deposit_reported')
         AND lower(from_address)=lower(?) ORDER BY created_at DESC LIMIT 1`,
      obs.from,
    )
  }
  return get<OrderRow>(
    `SELECT * FROM orders WHERE side='sell' AND mode='live' AND asset=? AND status IN ('awaiting_deposit','deposit_reported')
       AND lower(from_address)=lower(?) AND crypto_amount=? ORDER BY created_at DESC LIMIT 1`,
    asset.symbol, obs.from, obs.amount.toString(),
  ) ?? get<OrderRow>(
    `SELECT * FROM orders WHERE side='sell' AND mode='live' AND asset=? AND status IN ('awaiting_deposit','deposit_reported')
       AND lower(from_address)=lower(?) ORDER BY created_at DESC LIMIT 1`,
    asset.symbol, obs.from,
  )
}

export function ingest(obs: Observation): void {
  const assets = listAssets()
  const hash = obs.txHash.toLowerCase()
  const existing = get<TxRow>('SELECT * FROM chain_txs WHERE chain=? AND tx_hash=?', obs.chain, hash)
  if (existing) return updateExisting(existing, obs)

  const token = (obs.tokenAddress ?? '').toLowerCase()
  const asset = assets.find((a) => approvedTokenId(a) === token)
  const claimedAsset = obs.orderHint ? assets.find((a) => a.symbol === getOrder(obs.orderHint as string)?.asset) : undefined
  const verdict = asset ? 'genuine' : 'fake_token'
  const id = uid('ctx')
  const latency = obs.visibleAtMs ? Math.max(0, now() - obs.visibleAtMs) : null
  run(
    `INSERT INTO chain_txs(id,chain,tx_hash,log_index,token_address,asset,from_addr,to_addr,amount,block_number,confirmations,status,verdict,simulated,first_seen_at,detect_latency_ms,updated_at)
     VALUES (?,?,?,0,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, obs.chain, hash, token || null, asset?.symbol ?? claimedAsset?.symbol ?? null, obs.from.toLowerCase(), obs.to.toLowerCase(), obs.amount.toString(),
    obs.blockNumber, obs.confirmations, obs.status, verdict, obs.simulated ? 1 : 0, now(), latency, now(),
  )
  decide('detect', `Detected ${obs.status} transfer`, { txId: id, reasons: [`token ${token || 'native'}`, latency === null ? 'latency n/a' : `visible ${latency}ms before detection`] })

  const order = findOrder(obs, asset ?? claimedAsset)

  if (verdict === 'fake_token') {
    decide('verify', 'REJECT: token is not an approved contract/mint', { orderId: order?.id, txId: id, score: 100, reasons: ['unsupported_or_fake_token', `got ${token}`] })
    alert('critical', 'fake_token', 'Fake or unsupported token sent to vault', `${obs.chain} tx ${hash} sent token ${token || 'unknown'}. Nobody was credited.`, order?.user_id, order?.id)
    if (order) {
      run('UPDATE chain_txs SET order_id=? WHERE id=?', order.id, id)
      setStatus(order.id, 'flagged', 'deposit.fake_token', `Unsupported token ${token} was sent. Not credited.`, { tx_hash: hash, failure_reason: 'fake_token' })
      notify(order.user_id, 'security', 'Fake token detected', 'The token you sent is not the approved asset. You were not credited. Contact support.')
    }
    return
  }

  if (!order) {
    decide('match', 'HOLD: genuine token but no matching open order', { txId: id, score: 30, reasons: ['unmatched_deposit'] })
    alert('warning', 'unmatched_deposit', 'Deposit with no matching order', `${asset?.symbol} tx ${hash} from ${obs.from}. Not credited.`)
    return
  }
  if (order.tx_hash && order.tx_hash !== hash && order.status !== 'awaiting_deposit') {
    decide('match', 'REJECT: order already has a deposit', { orderId: order.id, txId: id, reasons: ['duplicate_deposit'] })
    alert('warning', 'duplicate_deposit', 'Second deposit for the same order', `Order ${order.id} tx ${hash}. Not credited.`, order.user_id, order.id)
    return
  }
  run('UPDATE chain_txs SET order_id=? WHERE id=?', order.id, id)

  if (obs.amount.toString() !== order.crypto_amount) {
    decide('verify', 'FLAG: amount differs from quote', { orderId: order.id, txId: id, score: 80, reasons: [`expected ${order.crypto_amount}`, `got ${obs.amount}`] })
    setStatus(order.id, 'flagged', 'deposit.amount_mismatch', `Expected ${order.crypto_amount}, received ${obs.amount} base units`, { tx_hash: hash, detected_at: now() })
    alert('critical', 'amount_mismatch', 'Deposit amount differs from quote', `Order ${order.id}: expected ${order.crypto_amount}, got ${obs.amount}. Manual review needed.`, order.user_id, order.id)
    notify(order.user_id, 'security', 'Deposit needs review', 'The amount received did not match your quote, so the payout is on hold.')
    return
  }

  setStatus(order.id, 'detected', 'deposit.detected', `${obs.status} on ${obs.chain}${latency !== null ? `, seen ${latency}ms after it was visible` : ''}`, {
    tx_hash: hash, detected_at: now(), broadcast_at: order.broadcast_at ?? now(),
  })
  const { score, flags } = assessRisk(order, obs)
  run('UPDATE orders SET risk_score=?, risk_flags=? WHERE id=?', score, JSON.stringify(flags), order.id)
  routePayout(order.id, id, score, flags, obs.status)
}

function routePayout(orderId: string, txId: string, score: number, flags: string[], txStatus: string) {
  const o = getOrder(orderId)
  if (!o) return
  const block = settingNum('risk_block_score')
  const review = settingNum('risk_review_score')
  if (score >= block) {
    decide('risk', 'BLOCK: risk score too high', { orderId, txId, score, reasons: flags })
    setStatus(orderId, 'flagged', 'risk.blocked', `Risk score ${score}`)
    alert('critical', 'high_risk', 'High-risk transaction blocked', `Order ${orderId} score ${score}: ${flags.join(', ')}`, o.user_id, orderId)
    return
  }
  const net = BigInt(o.net_kobo)
  const instantOk =
    score < review && setting('instant_payouts_enabled') === 'true' && net <= instantLimitKobo() && txStatus !== 'failed' &&
    balanceOf('house', 'NGN') >= net
  if (instantOk) {
    decide('payout', 'INSTANT payout requested (evidence verified, risk low, within limit, liquidity available)', { orderId, txId, score, reasons: flags })
    enqueue(`order.payout:${orderId}:instant`, 'order.payout', { orderId, instant: true })
  } else {
    const why = [
      ...(score >= review ? ['risk_review'] : []),
      ...(net > instantLimitKobo() ? ['above_instant_limit'] : []),
      ...(setting('instant_payouts_enabled') !== 'true' ? ['instant_disabled'] : []),
      ...(balanceOf('house', 'NGN') < net ? ['low_liquidity'] : []),
    ]
    decide('payout', 'HOLD until final confirmation', { orderId, txId, score, reasons: [...flags, ...why] })
    orderEvent(orderId, 'agent.hold', `Waiting for final confirmation (${why.join(', ') || 'policy'})`)
  }
}

function updateExisting(row: TxRow, obs: Observation) {
  if (row.status === 'finalized') return
  const terminalBad = ['failed', 'dropped', 'replaced']
  if (terminalBad.includes(row.status)) return
  if (obs.replay) {
    decide('monitor', 'Duplicate observation ignored (same transaction seen again)', { orderId: row.order_id, txId: row.id, reasons: ['duplicate_tx'] })
    alert('info', 'duplicate_tx', 'Duplicate transaction report ignored', `${row.chain} ${row.tx_hash} was reported twice. Only one payout is possible.`, undefined, row.order_id ?? undefined)
    return
  }
  const next = row.status === 'confirmed' && obs.status === 'pending' ? 'confirmed' : obs.status
  if (next === row.status && obs.confirmations <= row.confirmations) return
  run('UPDATE chain_txs SET status=?, confirmations=?, block_number=COALESCE(?, block_number), updated_at=? WHERE id=?', next, Math.max(obs.confirmations, row.confirmations), obs.blockNumber, now(), row.id)
  if (next === 'failed' || next === 'dropped') onBad(row, next)
}

function onBad(row: TxRow, why: string) {
  decide('monitor', `Transaction ${why}`, { orderId: row.order_id, txId: row.id, score: 60, reasons: [why] })
  alert('warning', `tx_${why}`, `Transaction ${why}`, `${row.chain} ${row.tx_hash}`, undefined, row.order_id ?? undefined)
  if (!row.order_id) return
  const o = getOrder(row.order_id)
  if (!o) return
  if (['payout_completed', 'payout_processing', 'awaiting_finality'].includes(o.status)) reverseOrder(o.id, `Deposit transaction ${why} after instant payout`)
  else if (!['completed', 'reversed'].includes(o.status)) failOrder(o.id, 'failed', `Deposit transaction ${why}`)
}

/** Called after a hint (user-reported hash) is seen on the network but not yet attributed. */
export function markDropped(chain: string, txHash: string, why: 'dropped' | 'replaced' | 'failed') {
  const row = get<TxRow>('SELECT * FROM chain_txs WHERE chain=? AND tx_hash=?', chain, txHash.toLowerCase())
  if (!row || ['finalized', 'failed', 'dropped', 'replaced'].includes(row.status)) return
  run('UPDATE chain_txs SET status=?, updated_at=? WHERE id=?', why, now(), row.id)
  onBad(row, why)
}

/** Reconcile loop: promote confirmed transactions to final, release held payouts, complete orders. */
export function reconcile() {
  const required = settingNum('confirmations_required')
  const open = all<TxRow>("SELECT * FROM chain_txs WHERE status IN ('pending','confirmed')")
  for (const tx of open) {
    if (tx.status === 'confirmed' && tx.confirmations >= required && tx.verdict === 'genuine') {
      run("UPDATE chain_txs SET status='finalized', settled_at=?, updated_at=? WHERE id=?", now(), now(), tx.id)
      if (tx.asset && tx.amount) {
        post({ owner: 'house', asset: tx.asset, delta: BigInt(tx.amount), reason: 'deposit finalized into vault', idem: `deposit:${tx.id}`, orderId: tx.order_id ?? undefined })
      }
      decide('settle', 'Deposit finalized', { orderId: tx.order_id, txId: tx.id, reasons: [`${tx.confirmations} confirmations`] })
      if (tx.order_id) {
        const o = getOrder(tx.order_id)
        if (o?.status === 'detected') enqueue(`order.payout:${o.id}:final`, 'order.payout', { orderId: o.id, instant: false })
        else maybeComplete(tx.order_id)
      }
    }
  }
  for (const o of all<OrderRow>("SELECT * FROM orders WHERE status='awaiting_liquidity'")) enqueue(`order.release:${o.id}:${Math.floor(now() / 15000)}`, 'order.release', { orderId: o.id })
  for (const o of all<OrderRow>("SELECT * FROM orders WHERE status IN ('payout_completed','awaiting_finality')")) maybeComplete(o.id)
}

export function describeDeposit(o: OrderRow, decimals: number) {
  return `${fromUnits(BigInt(o.crypto_amount), decimals)} ${o.asset}`
}
