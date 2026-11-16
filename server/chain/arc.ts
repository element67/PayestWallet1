/**
 * Live Arc Testnet monitor. Real RPC, no mocks.
 *  1. Block scan: every ERC-20 Transfer(to = vault) from any token contract, so fake tokens are caught too.
 *  2. Broadcast hints: when a user reports a hash, the pending transaction is read straight from the
 *     node (before it is mined) and its ERC-20 transfer calldata is decoded.
 */
import { decodeFunctionData, erc20Abi, getAbiItem, isHash, type Hash } from 'viem'
import { CONFIG } from '../config'
import { arcClient, rpcViaProxy, scrub } from '../rpc'
import { all, get, now, run, setting } from '../db'
import { ingest, markDropped, type Observation } from '../agent'
import { setStatus } from '../orders'
import { vaultAddressArc } from '../vault'
import { every } from '../timers'
import { confirmationsFor, lookup, registerMiss } from './receipts'

const transferEvent = getAbiItem({ abi: erc20Abi, name: 'Transfer' })
const CHAIN = 'arc-testnet'
const MAX_RANGE = 100n
const LOOKBACK = 10n

let lastBlock: bigint | null = null
let lastVault: string | null = null
const blockTimeCache = new Map<bigint, number>()

async function saveState(patch: { status: string; head?: bigint; pollMs?: number; error?: string | null }) {
  await run(
    `INSERT INTO monitor_state(chain,status,last_block,head_block,last_poll_at,poll_ms,error,mode) VALUES (?,?,?,?,?,?,?, 'live')
     ON CONFLICT(chain) DO UPDATE SET status=excluded.status,last_block=excluded.last_block,head_block=COALESCE(excluded.head_block,monitor_state.head_block),last_poll_at=excluded.last_poll_at,poll_ms=COALESCE(excluded.poll_ms,monitor_state.poll_ms),error=excluded.error`,
    CHAIN, patch.status, lastBlock === null ? null : Number(lastBlock), patch.head === undefined ? null : Number(patch.head), now(), patch.pollMs ?? null, patch.error ?? null,
  )
}

async function blockTimeMs(n: bigint): Promise<number> {
  const c = blockTimeCache.get(n)
  if (c) return c
  const b = await arcClient().getBlock({ blockNumber: n })
  const ms = Number(b.timestamp) * 1000
  blockTimeCache.set(n, ms)
  if (blockTimeCache.size > 500) blockTimeCache.delete(blockTimeCache.keys().next().value as bigint)
  return ms
}

async function scanBlocks(vault: `0x${string}`, head: bigint) {
  if (lastVault !== vault) {
    lastVault = vault
    lastBlock = head - LOOKBACK // start near the head, never block 0
  }
  const from = (lastBlock ?? head - LOOKBACK) + 1n
  if (from > head) return
  const to = head - from > MAX_RANGE ? from + MAX_RANGE : head
  const logs = await arcClient().getLogs({ fromBlock: from, toBlock: to, event: transferEvent, args: { to: vault } })
  for (const log of logs) {
    if (!log.transactionHash || log.blockNumber === null || log.blockNumber === undefined) continue
    const obs: Observation = {
      chain: CHAIN,
      txHash: log.transactionHash,
      tokenAddress: log.address,
      from: log.args.from as string,
      to: log.args.to as string,
      amount: log.args.value as bigint,
      logIndex: Number(log.logIndex ?? 0),
      blockNumber: Number(log.blockNumber),
      status: 'confirmed',
      confirmations: confirmationsFor(head, log.blockNumber),
      simulated: false,
      visibleAtMs: await blockTimeMs(log.blockNumber).catch(() => null),
    }
    await ingest(obs)
  }
  lastBlock = to
}

/** Pending-transaction path: decode transfer(to, amount) calldata from the node's view of the tx. */
async function trackHints(vault: `0x${string}`) {
  const hints = await all<{ id: string; tx_hash: string; broadcast_at: number | null; from_address: string | null }>(
    "SELECT id, tx_hash, broadcast_at, from_address FROM orders WHERE mode='live' AND status IN ('deposit_reported','detected') AND tx_hash IS NOT NULL",
  )
  for (const h of hints) {
    if (!isHash(h.tx_hash)) continue
    const found = await lookup(() => arcClient().getTransaction({ hash: h.tx_hash as Hash }))
    // A transport error says nothing about the transaction: wait for the next poll.
    if (found.kind === 'error') continue
    if (found.kind === 'missing') {
      if (now() - (h.broadcast_at ?? now()) > 90_000) await markDropped(CHAIN, h.tx_hash, 'dropped')
      continue
    }
    const tx = found.value
    if (tx.blockNumber === null) {
      try {
        const d = decodeFunctionData({ abi: erc20Abi, data: tx.input })
        if (d.functionName === 'transfer' && (d.args[0] as string).toLowerCase() === vault) {
          // The reported hash only attaches to the order when it really was sent by the order's own source address.
          // Anything else is recorded and alerted on without touching the order, so nobody can lock another user's order.
          const senderOk = !h.from_address || tx.from.toLowerCase() === h.from_address.toLowerCase()
          await ingest({
            chain: CHAIN, txHash: tx.hash, tokenAddress: tx.to ?? null, from: tx.from, to: vault, amount: d.args[1] as bigint,
            blockNumber: null, status: 'pending', confirmations: 0, simulated: false, visibleAtMs: h.broadcast_at, ...(senderOk ? { orderHint: h.id } : {}),
          })
        }
      } catch {
        // Not an ERC-20 transfer: ignored; the block scan classifies whatever lands onchain.
      }
      continue
    }
    const receipt = await lookup(() => arcClient().getTransactionReceipt({ hash: tx.hash }))
    if (receipt.kind === 'found' && receipt.value.status === 'reverted') await markDropped(CHAIN, tx.hash, 'failed')
  }
}

/** In-memory: the last chain head at which a transaction's receipt was missing, so one block counts once. */
const lastMissHead = new Map<string, bigint>()

/** Refresh confirmation counts of open transactions and catch reorged-out ones. */
async function refreshOpen(head: bigint) {
  const open = await all<{ id: string; tx_hash: string; log_index: number; block_number: number | null; confirmations: number; amount: string; token_address: string; from_addr: string; to_addr: string; missing_count: number }>(
    "SELECT * FROM chain_txs WHERE chain=? AND status='confirmed' AND simulated=0", CHAIN,
  )
  for (const t of open) {
    if (t.block_number === null) continue
    const got = await lookup(() => arcClient().getTransactionReceipt({ hash: t.tx_hash as Hash }))
    // Timeouts, rate limits and proxy errors must never reverse an order: skip until the next poll.
    if (got.kind === 'error') continue
    if (got.kind === 'missing') {
      const r = registerMiss({ misses: t.missing_count, lastHead: lastMissHead.get(t.id) ?? null }, head)
      lastMissHead.set(t.id, r.lastHead)
      if (r.misses !== t.missing_count) await run('UPDATE chain_txs SET missing_count=? WHERE id=?', r.misses, t.id)
      if (r.drop) await markDropped(CHAIN, t.tx_hash, 'dropped')
      continue
    }
    const receipt = got.value
    if (t.missing_count > 0) await run('UPDATE chain_txs SET missing_count=0 WHERE id=?', t.id)
    lastMissHead.delete(t.id)
    if (receipt.status === 'reverted') {
      await markDropped(CHAIN, t.tx_hash, 'failed')
      continue
    }
    await ingest({
      chain: CHAIN, txHash: t.tx_hash, logIndex: t.log_index, tokenAddress: t.token_address, from: t.from_addr, to: t.to_addr, amount: BigInt(t.amount),
      blockNumber: Number(receipt.blockNumber), status: 'confirmed', confirmations: confirmationsFor(head, receipt.blockNumber), simulated: false, visibleAtMs: null,
    })
  }
}

/** A user reports a hash right after broadcasting. */
export async function reportBroadcast(orderId: string, txHash: string) {
  const hash = txHash.toLowerCase()
  const dup = await get('SELECT 1 FROM orders WHERE tx_hash=? AND id<>?', hash, orderId)
  if (dup) return false
  await run('UPDATE orders SET tx_hash=?, broadcast_at=? WHERE id=? AND tx_hash IS NULL', hash, now(), orderId)
  await setStatus(orderId, 'deposit_reported', 'deposit.broadcast', `Transaction ${hash} reported by user. Watching the network.`)
  return true
}

let running = false
async function poll() {
  if (running) return
  running = true
  const started = now()
  try {
    const vault = await vaultAddressArc()
    if (!vault) {
      await saveState({ status: 'idle', error: 'No vault address configured' })
      return
    }
    const head = await arcClient().getBlockNumber()
    await scanBlocks(vault as `0x${string}`, head)
    await trackHints(vault as `0x${string}`)
    await refreshOpen(head)
    await saveState({ status: 'live', head, pollMs: now() - started, error: null })
  } catch (e) {
    await saveState({ status: 'degraded', error: scrub(e) })
  } finally {
    running = false
  }
}

export function startArcMonitor() {
  void poll()
  every('arc-monitor', 1000, poll)
  void setting
}

export const arcMonitorInfo = () => ({ rpc: rpcViaProxy() ? 'Arc Studio RPC proxy' : 'public RPC', chainId: CONFIG.arc.chainId })
