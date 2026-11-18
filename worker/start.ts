/**
 * Everything that runs in the background: seeding, the durable job queue, chain monitors, the transaction agent and the
 * reconcile loop. It serves no HTTP. The Next.js app and the standalone server both start it through worker/index.ts or
 * server/index.ts; only one process at a time should run it (worker/index.ts takes a database lock to guarantee that).
 */
import { startHoldSweeper } from '../server/holds'
import { seedAssets } from '../server/assets'
import { reconcile } from '../server/agent'
import { run, now } from '../server/db'
import { executeNgnPayout, executeRelease, expireStaleOrders } from '../server/orders'
import { registerJob, startQueue } from '../server/queue'
import { startArcMonitor } from '../server/chain/arc'
import { sweepStalePayments } from '../server/naira/pay'
import { removeStarterBalances } from '../server/maintenance'
import { seedFounder } from '../server/auth'
import { startWalletMonitors } from '../server/wallet/monitor'
import { seedTokens } from '../server/tokens/seed'
import { backfillBridgeHistory } from '../server/bridge/history'
import { backfillDexHistory } from '../server/wallet/history'
import { onRegistryChange } from '../server/tokens/service'
import { verifyPending } from '../server/tokens/verify'
import { sweepStaleBridgeOps } from '../server/bridge/service'
import { sweepStaleSwapOps } from '../server/swap/service'
import { every } from '../server/timers'
import '../server/app' // the queue and agent use code that registers API routes; keep one registry per process

export async function startWorker() {
  await seedAssets()
  await seedTokens()
  await onRegistryChange()
  // Check unverified contracts on-chain in the background, now and every six hours.
  void verifyPending(onRegistryChange).catch((e: unknown) => console.error('[verify-tokens]', e))
  every('verify-tokens', 6 * 3_600_000, () => verifyPending(onRegistryChange))
  await removeStarterBalances()
  void seedFounder().catch((e) => console.error('[seed founder]', e))

  registerJob('order.payout', async (p) => {
    await executeNgnPayout(String(p.orderId), Boolean(p.instant))
  })
  registerJob('order.release', async (p) => {
    await executeRelease(String(p.orderId))
  })

  await startQueue()
  startArcMonitor()
  startWalletMonitors()
  every('reconcile', 2000, async () => {
    await reconcile()
    await expireStaleOrders()
    await sweepStalePayments()
    await run('DELETE FROM sessions WHERE expires_at<?', now())
  })

  every('bridge-sweep', 60_000, sweepStaleBridgeOps)
  every('swap-sweep', 60_000, sweepStaleSwapOps)
  startHoldSweeper()
  // Swaps, liquidity changes and bridges made before History recorded them get their entries now. Each entry is written once, so
  // running it again after a restart, or a minute later when a chain endpoint was slow to answer, is harmless.
  const backfill = () => Promise.all([backfillDexHistory(), backfillBridgeHistory()]).then(([d, b]) => console.log(`[worker] history backfill: ${d} exchange entries, ${b} bridge transfers checked`)).catch((e) => console.warn('[worker] history backfill failed:', e instanceof Error ? e.message : e))
  setTimeout(() => void backfill(), 10_000)
  setTimeout(() => void backfill(), 120_000)

  // Non-Arc monitors run through the sandbox simulator (see chain/sim.ts).
  await run(
    `INSERT INTO monitor_state(chain,status,last_poll_at,mode,error) VALUES ('sandbox-sim','simulated',?,'simulated','Simulated chains: USDT, BTC, SOL')
     ON CONFLICT(chain) DO UPDATE SET last_poll_at=excluded.last_poll_at`,
    now(),
  )
}
