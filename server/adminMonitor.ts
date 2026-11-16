/**
 * Founder-only monitoring for the separate admin dashboard: system health (ledger integrity, job queue, chain monitors) and
 * onchain activity (exchange pool operations and bridge transfers signed from app wallets). Read-only: nothing here moves money.
 */
import { all, get, now, setting } from './db'
import { route } from './http'
import { verifyLedger } from './ledger'
import { scrub } from './rpc'

const DAY = 86_400_000
const num = (v: unknown) => Number(v ?? 0)

route('GET', '/api/admin/system', 'founder', async () => {
  const t0 = Date.now()
  await get('SELECT 1')
  const dbMs = Date.now() - t0
  const ledger = await verifyLedger()
  const queueRows = await all<{ status: string; c: number }>('SELECT status, COUNT(*) c FROM jobs GROUP BY status')
  const oldest = await get<{ run_at: number }>("SELECT MIN(run_at) run_at FROM jobs WHERE status='queued'")
  const failed = await all<{ id: number; kind: string; attempts: number; last_error: string | null; created_at: number }>(
    "SELECT id, kind, attempts, last_error, created_at FROM jobs WHERE status='failed' ORDER BY id DESC LIMIT 10",
  )
  const monitors = await all<{ chain: string; status: string; last_block: number | null; head_block: number | null; last_poll_at: number | null; poll_ms: number | null; error: string | null; mode: string }>(
    'SELECT * FROM monitor_state ORDER BY chain',
  )
  const t = now()
  return {
    checkedAt: t,
    db: { ok: true, latencyMs: dbMs },
    uptimeSec: Math.round(process.uptime()),
    platform: {
      paused: await setting('platform_paused') === 'true',
      instantPayouts: await setting('instant_payouts_enabled') === 'true',
      vaults: {
        arc: Boolean((await setting('vault_address_arc')).trim()),
        solana: Boolean((await setting('vault_address_solana')).trim()),
        bitcoin: Boolean((await setting('vault_address_bitcoin')).trim()),
      },
    },
    ledger: { ok: ledger.ok, entries: ledger.entries, unbalanced: ledger.unbalanced.length, mismatched: ledger.mismatched.length },
    queue: {
      counts: Object.fromEntries(queueRows.map((r) => [r.status, num(r.c)])),
      oldestQueuedAgeMs: oldest?.run_at ? Math.max(0, t - num(oldest.run_at)) : 0,
      failed: failed.map((j) => ({ id: j.id, kind: j.kind, attempts: j.attempts, error: j.last_error ? scrub(j.last_error) : null, createdAt: num(j.created_at) })),
    },
    monitors: monitors.map((m) => ({
      chain: m.chain, status: m.status, mode: m.mode, lastBlock: m.last_block === null ? null : num(m.last_block), headBlock: m.head_block === null ? null : num(m.head_block),
      lastPollAt: m.last_poll_at === null ? null : num(m.last_poll_at), pollMs: m.poll_ms === null ? null : num(m.poll_ms), error: m.error ? scrub(m.error) : null,
      stale: m.last_poll_at !== null && t - num(m.last_poll_at) > Math.max(60_000, num(m.poll_ms) * 5),
    })),
  }
})

route('GET', '/api/admin/onchain', 'founder', async () => {
  const since = now() - DAY
  const dex = await all<Record<string, unknown>>(
    `SELECT o.id, o.network, o.kind, o.summary, o.status, o.note, o.hashes, o.created_at, u.email FROM dex_ops o JOIN users u ON u.id=o.user_id ORDER BY o.created_at DESC LIMIT 100`,
  )
  const bridge = await all<Record<string, unknown>>(
    `SELECT o.id, o.from_chain, o.to_chain, o.amount, o.recipient, o.status, o.error, o.steps, o.created_at, u.email FROM bridge_ops o JOIN users u ON u.id=o.user_id ORDER BY o.created_at DESC LIMIT 100`,
  )
  const dexStats = await all<{ kind: string; status: string; c: number }>('SELECT kind, status, COUNT(*) c FROM dex_ops WHERE created_at>? GROUP BY kind, status', since)
  const bridgeStats = await all<{ status: string; c: number; vol: string | null }>(
    'SELECT status, COUNT(*) c, SUM(CAST(amount AS NUMERIC)) vol FROM bridge_ops WHERE created_at>? GROUP BY status', since,
  )
  const hashes = (v: unknown): string[] => { try { return JSON.parse(String(v)) as string[] } catch { return [] } }
  const steps = (v: unknown): { name: string; state: string }[] => { try { return JSON.parse(String(v)) as { name: string; state: string }[] } catch { return [] } }
  return {
    contracts: ['ARC', 'ETH', 'BASE'].map((k) => ({
      network: ({ ARC: 'arc-testnet', ETH: 'ethereum-sepolia', BASE: 'base-sepolia' } as Record<string, string>)[k],
      router: process.env[`NAIRASWAP_${k}_ROUTER`] ?? null, factory: process.env[`NAIRASWAP_${k}_FACTORY`] ?? null, treasury: process.env[`NAIRASWAP_${k}_TREASURY`] ?? null,
    })),
    dex: {
      last24h: dexStats.map((r) => ({ kind: r.kind, status: r.status, count: num(r.c) })),
      ops: dex.map((o) => ({ id: o.id, email: o.email, network: o.network, kind: o.kind, summary: o.summary, status: o.status, note: o.note ? scrub(o.note) : null, hashes: hashes(o.hashes), createdAt: num(o.created_at) })),
    },
    bridge: {
      last24h: bridgeStats.map((r) => ({ status: r.status, count: num(r.c), usdc: r.vol ?? '0' })),
      ops: bridge.map((o) => ({
        id: o.id, email: o.email, from: o.from_chain, to: o.to_chain, amount: o.amount, recipient: o.recipient, status: o.status,
        error: o.error ? scrub(o.error) : null, steps: steps(o.steps).map((s) => `${s.name}:${s.state}`), createdAt: num(o.created_at),
      })),
    },
  }
})
