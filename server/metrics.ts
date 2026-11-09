/** Real metrics computed from stored data. Nothing here is hard-coded or estimated. */
import { erc20Abi } from 'viem'
import { arcClient, scrub } from './rpc'
import { CONFIG } from './config'
import { all, get, now } from './db'
import { balancesFor } from './ledger'
import { fromUnits } from './money'
import { listAssets } from './assets'
import { vaultAddressArc } from './vault'

const n = (sql: string, ...p: (string | number)[]) => get<{ c: number }>(sql, ...p)?.c ?? 0
const avg = (sql: string, ...p: (string | number)[]) => {
  const v = get<{ a: number | null }>(sql, ...p)?.a
  return v === null || v === undefined ? null : Math.round(v)
}

export function agentMetrics() {
  const day = now() - 86_400_000
  const monitors = all<Record<string, unknown>>('SELECT * FROM monitor_state')
  return {
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
  }
}

export async function onchainVaultBalance(): Promise<{ address: string | null; usdc: string | null; error?: string }> {
  const address = vaultAddressArc()
  if (!address) return { address: null, usdc: null }
  try {
    const raw = await arcClient().readContract({ address: CONFIG.arc.usdcAddress as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf', args: [address as `0x${string}`] })
    return { address, usdc: fromUnits(raw, CONFIG.arc.usdcDecimals) }
  } catch (e) {
    return { address, usdc: null, error: scrub(e) }
  }
}

export async function adminOverview() {
  const sum = (status: string) =>
    all<{ gross_kobo: string }>('SELECT gross_kobo FROM orders WHERE status=?', status).reduce((s, r) => s + BigInt(r.gross_kobo), 0n)
  const completed = all<{ gross_kobo: string; fee_kobo: string }>("SELECT gross_kobo, fee_kobo FROM orders WHERE status='completed'")
  const volume = completed.reduce((s, r) => s + BigInt(r.gross_kobo), 0n)
  const fees = completed.reduce((s, r) => s + BigInt(r.fee_kobo), 0n)
  const house = balancesFor('house')
  const assets = listAssets()
  return {
    volumeNgn: fromUnits(volume, 2),
    feesNgn: fromUnits(fees, 2),
    counts: {
      completed: n("SELECT COUNT(*) c FROM orders WHERE status='completed'"),
      pending: n("SELECT COUNT(*) c FROM orders WHERE status NOT IN ('completed','failed','expired','cancelled','rejected','reversed','flagged')"),
      failed: n("SELECT COUNT(*) c FROM orders WHERE status IN ('failed','reversed','rejected')"),
      flagged: n("SELECT COUNT(*) c FROM orders WHERE status='flagged'"),
      users: n('SELECT COUNT(*) c FROM users'),
    },
    pendingVolumeNgn: fromUnits(sum('awaiting_finality') + sum('payout_processing'), 2),
    liquidity: {
      ngn: fromUnits(house.NGN ?? 0n, 2),
      crypto: assets.map((a) => ({ symbol: a.symbol, amount: fromUnits(house[a.symbol] ?? 0n, a.decimals), simulated: true })),
    },
    onchainVault: await onchainVaultBalance(),
    openAlerts: n('SELECT COUNT(*) c FROM alerts WHERE resolved=0'),
    daily: all<{ d: string; c: number }>(
      "SELECT strftime('%Y-%m-%d', created_at/1000, 'unixepoch') d, COUNT(*) c FROM orders WHERE created_at>? GROUP BY d ORDER BY d", now() - 7 * 86_400_000,
    ),
  }
}

export { erc20Abi }
