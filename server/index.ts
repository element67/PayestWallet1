/**
 * Server entry. One process runs the API, durable job queue, blockchain monitors and the transaction agent,
 * so a single process owns the SQLite file.
 */
import { CONFIG } from './config'
import { seedAssets } from './assets'
import { reconcile } from './agent'
import { handle } from './http'
import { executeNgnPayout, executeRelease, expireStaleOrders } from './orders'
import { registerJob, startQueue } from './queue'
import { startArcMonitor } from './chain/arc'
import { run, now } from './db'
import './routes'
import './admin'
import './withdrawals'
import './naira/routes'
import './naira/admin'
import './naira/bills'
import './naira/transfers'
import { sweepStalePayments } from './naira/pay'
import './wallet/routes'
import './tokens/routes'
import './cryptoOps'
import './balance'
import './testCredit'
import { removeStarterBalances } from './maintenance'
import { startWalletMonitors } from './wallet/monitor'
import { seedTokens } from './tokens/seed'
import { onRegistryChange } from './tokens/service'
import { verifyPending } from './tokens/verify'

// Bind the port first: if another instance already owns it, exit before any worker touches the database.
Bun.serve({
  port: CONFIG.port,
  hostname: '127.0.0.1',
  maxRequestBodySize: 128 * 1024,
  idleTimeout: 60,
  async fetch(req, server) {
    const hops = req.headers.get('x-forwarded-for')?.split(',') ?? []
    const fwd = hops[hops.length - 1]?.trim()
    const ip = fwd || server.requestIP(req)?.address || 'unknown'
    return handle(req, ip)
  },
  error(err) {
    console.error('[server]', err)
    return new Response(JSON.stringify({ error: 'Something went wrong on our side' }), { status: 500, headers: { 'content-type': 'application/json' } })
  },
})

seedAssets()
seedTokens()
onRegistryChange()
// Check unverified contracts on-chain in the background, now and every six hours.
void verifyPending(onRegistryChange)
setInterval(() => void verifyPending(onRegistryChange), 6 * 3_600_000)
removeStarterBalances()

registerJob('order.payout', (p) => {
  executeNgnPayout(String(p.orderId), Boolean(p.instant))
})
registerJob('order.release', (p) => {
  executeRelease(String(p.orderId))
})

startQueue()
startArcMonitor()
startWalletMonitors()
setInterval(() => {
  try {
    reconcile()
    expireStaleOrders()
    sweepStalePayments()
    run('DELETE FROM sessions WHERE expires_at<?', now())
  } catch (e) {
    console.error('[reconcile]', e)
  }
}, 2000)

// Non-Arc monitors run through the sandbox simulator (see chain/sim.ts).
run(
  `INSERT INTO monitor_state(chain,status,last_poll_at,mode,error) VALUES ('sandbox-sim','simulated',?,'simulated','Simulated chains: USDT, BTC, SOL')
   ON CONFLICT(chain) DO UPDATE SET last_poll_at=excluded.last_poll_at`,
  now(),
)

console.log(
  `[fintech] API on :${CONFIG.port} | dev preview: ${CONFIG.devPreview} | real money: ${CONFIG.realMoney} | arc rpc: ${CONFIG.arc.usingProxy ? 'proxy' : 'public'}`,
)
