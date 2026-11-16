/** Real metrics computed from stored data. Nothing here is hard-coded or estimated. */
import { erc20Abi } from 'viem'
import { arcClient, scrub } from './rpc'
import { CONFIG } from './config'
import { all, get, now } from './db'
import { balancesFor, exchangeFeesBooked } from './ledger'
import { fromUnits } from './money'
import { listAssets } from './assets'
import { vaultAddressArc } from './vault'

const n = async (sql: string, ...p: (string | number)[]) => (await get<{ c: number }>(sql, ...p))?.c ?? 0
const avg = async (sql: string, ...p: (string | number)[]) => {
  const v = (await get<{ a: number | null }>(sql, ...p))?.a
  return v === null || v === undefined ? null : Math.round(v)
}

/** Awaits every promise inside plain objects and arrays, all at once. */
async function resolveDeep<T>(value: T): Promise<T> {
  const v = await value
  if (Array.isArray(v)) return (await Promise.all(v.map(resolveDeep))) as unknown as T
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    const entries = await Promise.all(Object.entries(v).map(async ([k, x]) => [k, await resolveDeep(x)] as const))
    return Object.fromEntries(entries) as T
  }
  return v
}

export async function agentMetrics() {
  const day = now() - 86_400_000
  const monitors = await all<Record<string, unknown>>('SELECT * FROM monitor_state')
  // The queries are independent: start them all, then wait for the whole set once (instead of one round trip each).
  return await resolveDeep({
    status: monitors.some((m) => m.status === 'live') ? 'active' : 'standby',
    monitors,
    monitoring: n("SELECT COUNT(*) c FROM chain_txs WHERE status IN ('pending','confirmed')"),
    detected: n('SELECT COUNT(*) c FROM chain_txs'),
    detected24h: n('SELECT COUNT(*) c FROM chain_txs WHERE first_seen_at>?', day),
    verified: n("SELECT COUNT(*) c FROM chain_txs WHERE verdict='genuine'"),
    finalized: n("SELECT COUNT(*) c FROM chain_txs WHERE status='finalized'"),
    pending: n("SELECT COUNT(*) c FROM orders WHERE status IN ('deposit_reported','detected','payout_processing','awaiting_finality','awaiting_payment','awaiting_deposit')"),
    failed: n("SELECT COUNT(*) c FROM chain_txs WHERE status IN ('failed','dropped','replaced')"),
    fakeTokens: n("SELECT COUNT(*) c FROM chain_txs WHERE verdict='fake_token'"),
    suspicious: n("SELECT COUNT(*) c FROM alerts WHERE severity IN ('warning','critical') AND resolved=0"),
    avgDetectionMs: avg('SELECT AVG(detect_latency_ms) a FROM chain_txs WHERE detect_latency_ms IS NOT NULL AND simulated=0'),
    avgDetectionMsSim: avg('SELECT AVG(detect_latency_ms) a FROM chain_txs WHERE detect_latency_ms IS NOT NULL AND simulated=1'),
    avgPayoutMs: avg('SELECT AVG(payout_at - detected_at) a FROM orders WHERE payout_at IS NOT NULL AND detected_at IS NOT NULL'),
    avgSettlementMs: avg("SELECT AVG(completed_at - created_at) a FROM orders WHERE status='completed' AND completed_at IS NOT NULL"),
    queue: {
      queued: n("SELECT COUNT(*) c FROM jobs WHERE status='queued'"),
      dead: n("SELECT COUNT(*) c FROM jobs WHERE status='dead'"),
    },
    wallet: {
      wallets: n('SELECT COUNT(*) c FROM wallets'),
      txs: n('SELECT COUNT(*) c FROM wallet_txs'),
      pending: n("SELECT COUNT(*) c FROM wallet_txs WHERE status IN ('pending','signing','confirmed')"),
      incoming: n("SELECT COUNT(*) c FROM wallet_txs WHERE type='received'"),
      outgoing: n("SELECT COUNT(*) c FROM wallet_txs WHERE type='sent'"),
      failed: n("SELECT COUNT(*) c FROM wallet_txs WHERE status IN ('failed','dropped')"),
      unverified: n("SELECT COUNT(*) c FROM wallet_txs WHERE verdict='unverified_token'"),
      recent: all('SELECT id, network, symbol, type, status, verdict, tx_hash, detected_at FROM wallet_txs ORDER BY detected_at DESC LIMIT 12'),
    },
    decisions: all('SELECT * FROM agent_decisions ORDER BY id DESC LIMIT 40'),
    txs: all('SELECT id, chain, tx_hash, asset, verdict, status, confirmations, simulated, detect_latency_ms, first_seen_at, order_id FROM chain_txs ORDER BY first_seen_at DESC LIMIT 25'),
    alerts: all('SELECT * FROM alerts ORDER BY id DESC LIMIT 25'),
  })
}

export async function onchainVaultBalance(): Promise<{ address: string | null; usdc: string | null; error?: string }> {
  const address = await vaultAddressArc()
  if (!address) return { address: null, usdc: null }
  try {
    const raw = await arcClient().readContract({ address: CONFIG.arc.usdcAddress as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf', args: [address as `0x${string}`] })
    return { address, usdc: fromUnits(raw, CONFIG.arc.usdcDecimals) }
  } catch (e) {
    return { address, usdc: null, error: scrub(e) }
  }
}

export async function adminOverview() {
  const sum = async (status: string) =>
    (await all<{ gross_kobo: string }>('SELECT gross_kobo FROM orders WHERE status=?', status)).reduce((s, r) => s + BigInt(r.gross_kobo), 0n)
  // The queries do not depend on each other, so they run together: one round trip of waiting instead of a dozen.
  const [
    completedRows, fees, house, assets, completedN, pendingN, failedN, flaggedN, usersN,
    awaitingFinality, payoutProcessing, onchainVault, openAlerts, daily,
  ] = await Promise.all([
    all<{ gross_kobo: string }>("SELECT gross_kobo FROM orders WHERE status='completed'"),
    // Fees come from the ledger (the books), not from a second tally of order rows, so the dashboard always matches the fee account.
    exchangeFeesBooked(),
    balancesFor('house'),
    listAssets(),
    n("SELECT COUNT(*) c FROM orders WHERE status='completed'"),
    n("SELECT COUNT(*) c FROM orders WHERE status NOT IN ('completed','failed','expired','cancelled','rejected','reversed','flagged')"),
    n("SELECT COUNT(*) c FROM orders WHERE status IN ('failed','reversed','rejected')"),
    n("SELECT COUNT(*) c FROM orders WHERE status='flagged'"),
    n('SELECT COUNT(*) c FROM users'),
    sum('awaiting_finality'),
    sum('payout_processing'),
    onchainVaultBalance(),
    n('SELECT COUNT(*) c FROM alerts WHERE resolved=0'),
    all<{ d: string; c: number }>(
      "SELECT to_char(to_timestamp(created_at/1000) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d, COUNT(*) AS c FROM orders WHERE created_at>? GROUP BY 1 ORDER BY 1", now() - 7
    ),
  ])
  const volume = completedRows.reduce((s, r) => s + BigInt(r.gross_kobo), 0n)
  return {
    volumeNgn: fromUnits(volume, 2),
    feesNgn: fromUnits(fees, 2),
    counts: { completed: completedN, pending: pendingN, failed: failedN, flagged: flaggedN, users: usersN },
    pendingVolumeNgn: fromUnits(awaitingFinality + payoutProcessing, 2),
    liquidity: {
      ngn: fromUnits(house.NGN ?? 0n, 2),
      crypto: assets.map((a) => ({ symbol: a.symbol, amount: fromUnits(house[a.symbol] ?? 0n, a.decimals), simulated: true })),
    },
    onchainVault,
    openAlerts,
    daily,
  }
}

export { erc20Abi }
