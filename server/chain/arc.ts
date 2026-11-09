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

const transferEvent = getAbiItem({ abi: erc20Abi, name: 'Transfer' })
const CHAIN = 'arc-testnet'
const MAX_RANGE = 100n
const LOOKBACK = 10n

let lastBlock: bigint | null = null
let lastVault: string | null = null
const blockTimeCache = new Map<bigint, number>()

function saveState(patch: { status: string; head?: bigint; pollMs?: number; error?: string | null }) {
  run(
    `INSERT INTO monitor_state(chain,status,last_block,head_block,last_poll_at,poll_ms,error,mode) VALUES (?,?,?,?,?,?,?, 'live')
     ON CONFLICT(chain) DO UPDATE SET status=excluded.status,last_block=excluded.last_block,head_block=COALESCE(excluded.head_block,head_block),last_poll_at=excluded.last_poll_at,poll_ms=COALESCE(excluded.poll_ms,poll_ms),error=excluded.error`,
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
      blockNumber: Number(log.blockNumber),
      status: 'confirmed',
      confirmations: Number(head - log.blockNumber + 1n),
      simulated: false,
      visibleAtMs: await blockTimeMs(log.blockNumber).catch(() => null),
    }
    ingest(obs)
  }
  lastBlock = to
}

/** Pending-transaction path: decode transfer(to, amount) calldata from the node's view of the tx. */
async function trackHints(vault: `0x${string}`) {
  const hints = all<{ id: string; tx_hash: string; broadcast_at: number | null; from_address: string | null }>(
    "SELECT id, tx_hash, broadcast_at, from_address FROM orders WHERE mode='live' AND status IN ('deposit_reported','detected') AND tx_hash IS NOT NULL",
  )
  for (const h of hints) {
    if (!isHash(h.tx_hash)) continue
    const tx = await arcClient().getTransaction({ hash: h.tx_hash as Hash }).catch(() => null)
    if (!tx) {
      if (now() - (h.broadcast_at ?? now()) > 90_000) markDropped(CHAIN, h.tx_hash, 'dropped')
      continue
    }
    if (tx.blockNumber === null) {
      try {
        const d = decodeFunctionData({ abi: erc20Abi, data: tx.input })
        if (d.functionName === 'transfer' && (d.args[0] as string).toLowerCase() === vault) {
          ingest({
            chain: CHAIN, txHash: tx.hash, tokenAddress: tx.to ?? null, from: tx.from, to: vault, amount: d.args[1] as bigint,
            blockNumber: null, status: 'pending', confirmations: 0, simulated: false, visibleAtMs: h.broadcast_at, orderHint: h.id,
          })
        }
      } catch {
        // Not an ERC-20 transfer: ignored; the block scan classifies whatever lands onchain.
      }
      continue
    }
    const receipt = await arcClient().getTransactionReceipt({ hash: tx.hash }).catch(() => null)
    if (receipt?.status === 'reverted') markDropped(CHAIN, tx.hash, 'failed')
  }
}

/** Refresh confirmation counts of open transactions and catch reorged-out ones. */
async function refreshOpen(head: bigint) {
  const open = all<{ tx_hash: string; block_number: number | null; confirmations: number; amount: string; token_address: string; from_addr: string; to_addr: string }>(
    "SELECT * FROM chain_txs WHERE chain=? AND status='confirmed' AND simulated=0", CHAIN,
  )
  for (const t of open) {
    if (t.block_number === null) continue
    const receipt = await arcClient().getTransactionReceipt({ hash: t.tx_hash as Hash }).catch(() => null)
    if (!receipt) {
      markDropped(CHAIN, t.tx_hash, 'dropped')
      continue
    }
    if (receipt.status === 'reverted') {
      markDropped(CHAIN, t.tx_hash, 'failed')
      continue
    }
    ingest({
      chain: CHAIN, txHash: t.tx_hash, tokenAddress: t.token_address, from: t.from_addr, to: t.to_addr, amount: BigInt(t.amount),
      blockNumber: Number(receipt.blockNumber), status: 'confirmed', confirmations: Number(head - receipt.blockNumber + 1n), simulated: false, visibleAtMs: null,
    })
  }
}

/** A user reports a hash right after broadcasting. */
export function reportBroadcast(orderId: string, txHash: string) {
  const hash = txHash.toLowerCase()
  const dup = get('SELECT 1 FROM orders WHERE tx_hash=? AND id<>?', hash, orderId)
  if (dup) return false
  run('UPDATE orders SET tx_hash=?, broadcast_at=? WHERE id=? AND tx_hash IS NULL', hash, now(), orderId)
  setStatus(orderId, 'deposit_reported', 'deposit.broadcast', `Transaction ${hash} reported by user. Watching the network.`)
  return true
}

let running = false
async function poll() {
  if (running) return
  running = true
  const started = now()
  try {
    const vault = vaultAddressArc()
    if (!vault) {
      saveState({ status: 'idle', error: 'No vault address configured' })
      return
    }
    const head = await arcClient().getBlockNumber()
    await scanBlocks(vault as `0x${string}`, head)
    await trackHints(vault as `0x${string}`)
    await refreshOpen(head)
    saveState({ status: 'live', head, pollMs: now() - started, error: null })
  } catch (e) {
    saveState({ status: 'degraded', error: scrub(e) })
  } finally {
    running = false
  }
}

export function startArcMonitor() {
  void poll()
  setInterval(() => void poll(), 1000)
  void setting
}

export const arcMonitorInfo = () => ({ rpc: rpcViaProxy() ? 'Arc Studio RPC proxy' : 'public RPC', chainId: CONFIG.arc.chainId })
