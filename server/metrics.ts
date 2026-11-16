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

export async function agentMetrics() {
  const day = now() - 86_400_000
  const monitors = await all<Record<string, unknown>>('SELECT * FROM monitor_state')
  return {
    status: monitors.some((m) => m.status === 'live') ? 'active' : 'standby',
    monitors,
    monitoring: await n("SELECT COUNT(*) c FROM chain_txs WHERE status IN ('pending','confirmed')"),
    detected: await n('SELECT COUNT(*) c FROM chain_txs'),
    detected24h: await n('SELECT COUNT(*) c FROM chain_txs WHERE first_seen_at>?', day),
    verified: await n("SELECT COUNT(*) c FROM chain_txs WHERE verdict='genuine'"),
    finalized: await n("SELECT COUNT(*) c FROM chain_txs WHERE status='finalized'"),
    pending: await n("SELECT COUNT(*) c FROM orders WHERE status IN ('deposit_reported','detected','payout_processing','awaiting_finality','awaiting_payment','awaiting_deposit')"),
    failed: await n("SELECT COUNT(*) c FROM chain_txs WHERE status IN ('failed','dropped','replaced')"),
    fakeTokens: await n("SELECT COUNT(*) c FROM chain_txs WHERE verdict='fake_token'"),
    suspicious: await n("SELECT COUNT(*) c FROM alerts WHERE severity IN ('warning','critical') AND resolved=0"),
    avgDetectionMs: await avg('SELECT AVG(detect_latency_ms) a FROM chain_txs WHERE detect_latency_ms IS NOT NULL AND simulated=0'),
    avgDetectionMsSim: await avg('SELECT AVG(detect_latency_ms) a FROM chain_txs WHERE detect_latency_ms IS NOT NULL AND simulated=1'),
    avgPayoutMs: await avg('SELECT AVG(payout_at - detected_at) a FROM orders WHERE payout_at IS NOT NULL AND detected_at IS NOT NULL'),
    avgSettlementMs: await avg("SELECT AVG(completed_at - created_at) a FROM orders WHERE status='completed' AND completed_at IS NOT NULL"),
    queue: {
      queued: await n("SELECT COUNT(*) c FROM jobs WHERE status='queued'"),
      dead: await n("SELECT COUNT(*) c FROM jobs WHERE status='dead'"),
    },
    wallet: {
      wallets: await n('SELECT COUNT(*) c FROM wallets'),
      txs: await n('SELECT COUNT(*) c FROM wallet_txs'),
      pending: await n("SELECT COUNT(*) c FROM wallet_txs WHERE status IN ('pending','signing','confirmed')"),
      incoming: await n("SELECT COUNT(*) c FROM wallet_txs WHERE type='received'"),
      outgoing: await n("SELECT COUNT(*) c FROM wallet_txs WHERE type='sent'"),
      failed: await n("SELECT COUNT(*) c FROM wallet_txs WHERE status IN ('failed','dropped')"),
      unverified: await n("SELECT COUNT(*) c FROM wallet_txs WHERE verdict='unverified_token'"),
      recent: await all('SELECT id, network, symbol, type, status, verdict, tx_hash, detected_at FROM wallet_txs ORDER BY detected_at DESC LIMIT 12'),
    },
    decisions: await all('SELECT * FROM agent_decisions ORDER BY id DESC LIMIT 40'),
    txs: await all('SELECT id, chain, tx_hash, asset, verdict, status, confirmations, simulated, detect_latency_ms, first_seen_at, order_id FROM chain_txs ORDER BY first_seen_at DESC LIMIT 25'),
    alerts: await all('SELECT * FROM alerts ORDER BY id DESC LIMIT 25'),
  }
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
  const completed = await all<{ gross_kobo: string }>("SELECT gross_kobo FROM orders WHERE status='completed'")
  const volume = completed.reduce((s, r) => s + BigInt(r.gross_kobo), 0n)
  // Fees come from the ledger (the books), not from a second tally of order rows, so the dashboard always matches the fee account.
  const fees = await exchangeFeesBooked()
  const house = await balancesFor('house')
  const assets = await listAssets()
  return {
    volumeNgn: fromUnits(volume, 2),
    feesNgn: fromUnits(fees, 2),
    counts: {
      completed: await n("SELECT COUNT(*) c FROM orders WHERE status='completed'"),
      pending: await n("SELECT COUNT(*) c FROM orders WHERE status NOT IN ('completed','failed','expired','cancelled','rejected','reversed','flagged')"),
      failed: await n("SELECT COUNT(*) c FROM orders WHERE status IN ('failed','reversed','rejected')"),
      flagged: await n("SELECT COUNT(*) c FROM orders WHERE status='flagged'"),
      users: await n('SELECT COUNT(*) c FROM users'),
    },
    pendingVolumeNgn: fromUnits(await sum('awaiting_finality') + await sum('payout_processing'), 2),
    liquidity: {
      ngn: fromUnits(house.NGN ?? 0n, 2),
      crypto: assets.map((a) => ({ symbol: a.symbol, amount: fromUnits(house[a.symbol] ?? 0n, a.decimals), simulated: true })),
    },
    onchainVault: await onchainVaultBalance(),
    openAlerts: await n('SELECT COUNT(*) c FROM alerts WHERE resolved=0'),
    daily: await all<{ d: string; c: number }>(
      "SELECT to_char(to_timestamp(created_at/1000) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d, COUNT(*) AS c FROM orders WHERE created_at>? GROUP BY 1 ORDER BY 1", now() - 7 * 86_400_000,
    ),
  }
}

export { erc20Abi }
