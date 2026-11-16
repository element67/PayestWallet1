/**
 * Background worker process (`bun run worker`). Takes a Postgres advisory lock before doing anything, so only one worker
 * ever runs the queue, monitors and agent, even if two are started by mistake. A second one waits and takes over if the
 * first stops.
 */
import { sql } from '../server/db'
import { startWorker } from './start'

const LOCK_KEY = 7_411_002 // arbitrary constant shared by every worker of this app

const conn = await sql.reserve() // a dedicated connection: a session lock lives as long as it does
let announced = false
for (;;) {
  const [row] = await conn<{ ok: boolean }[]>`SELECT pg_try_advisory_lock(${LOCK_KEY}) AS ok`
  if (row?.ok) break
  if (!announced) console.log('[worker] another worker holds the lock, waiting')
  announced = true
  await new Promise((r) => setTimeout(r, 5000))
}
await startWorker()
console.log('[worker] running: queue, chain monitors, transaction agent')

const stop = () => {
  void conn`SELECT pg_advisory_unlock(${LOCK_KEY})`.finally(() => process.exit(0))
}
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
