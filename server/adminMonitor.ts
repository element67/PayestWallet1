/**
 * Founder-only monitoring for the separate admin dashboard: system health (ledger integrity, job queue, chain monitors) and
 * onchain activity (exchange pool operations and bridge transfers signed from app wallets). Read-only: nothing here moves money.
 */
import { all, get, now, setting } from './db'
import { route } from './http'
import { verifyLedger } from './ledger'
import { scrub } from './rpc'
import { providerStatus, tradeMode } from './trade/config'

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
  const ops = await all<Record<string, unknown>>(
    `SELECT o.id, o.kind, o.provider, o.mode, o.from_chain, o.to_chain, o.token_in, o.token_out, o.amount_in, o.amount_out, o.status, o.error, o.steps, o.tx_hashes, o.created_at, u.email
       FROM trade_ops o JOIN users u ON u.id=o.user_id ORDER BY o.created_at DESC LIMIT 100`,
  )
  const stats = await all<{ kind: string; provider: string; status: string; c: number }>('SELECT kind, provider, status, COUNT(*) c FROM trade_ops WHERE created_at>? GROUP BY kind, provider, status', since)
  const uni = await all<Record<string, unknown>>(
    `SELECT o.id, o.chain, o.token_in, o.token_out, o.amount_in, o.amount_out, o.status, o.error, o.tx_hash, o.created_at, u.email FROM swap_ops o JOIN users u ON u.id=o.user_id ORDER BY o.created_at DESC LIMIT 50`,
  )
  const list = <T,>(v: unknown, fallback: T): T => { try { return JSON.parse(String(v)) as T } catch { return fallback } }
  return {
    mode: await tradeMode(), providers: providerStatus(),
    last24h: stats.map((r) => ({ kind: r.kind, provider: r.provider, status: r.status, count: num(r.c) })),
    ops: ops.map((o) => ({
      id: o.id, email: o.email, kind: o.kind, provider: o.provider, mode: o.mode, from: o.from_chain, to: o.to_chain, tokenIn: o.token_in, tokenOut: o.token_out, amountIn: o.amount_in,
      amountOut: o.amount_out ?? null, status: o.status, error: o.error ? scrub(o.error) : null, steps: list<{ name: string; state: string }[]>(o.steps, []).map((s) => `${s.name}:${s.state}`),
      hashes: list<string[]>(o.tx_hashes, []), createdAt: num(o.created_at),
    })),
    uniswap: uni.map((o) => ({ id: o.id, email: o.email, chain: o.chain, tokenIn: o.token_in, tokenOut: o.token_out, amountIn: o.amount_in, amountOut: o.amount_out ?? null, status: o.status, error: o.error ? scrub(o.error) : null, hash: o.tx_hash ?? null, createdAt: num(o.created_at) })),
  }
})
