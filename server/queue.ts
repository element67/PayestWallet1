/** Durable job queue (SQLite). Jobs are unique by key, retried with backoff, and dead-lettered with an alert. */
import { alert, all, now, run } from './db'

type Handler = (payload: Record<string, unknown>) => Promise<void> | void
const handlers = new Map<string, Handler>()
const MAX_ATTEMPTS = 5

export const registerJob = (kind: string, h: Handler) => handlers.set(kind, h)

/** Enqueue once per unique key. Re-enqueueing an existing key is a no-op (idempotency). */
export function enqueue(uniq: string, kind: string, payload: Record<string, unknown>, delayMs = 0) {
  run('INSERT OR IGNORE INTO jobs(uniq, kind, payload, run_at, created_at) VALUES (?,?,?,?,?)', uniq, kind, JSON.stringify(payload), now() + delayMs, now())
}

let busy = false
export async function tick() {
  if (busy) return
  busy = true
  try {
    const due = all<{ id: number; kind: string; payload: string; attempts: number }>(
      "SELECT id, kind, payload, attempts FROM jobs WHERE status='queued' AND run_at<=? ORDER BY run_at LIMIT 10",
      now(),
    )
    for (const job of due) {
      const h = handlers.get(job.kind)
      run("UPDATE jobs SET status='running' WHERE id=?", job.id)
      try {
        if (!h) throw new Error(`No handler for ${job.kind}`)
        await h(JSON.parse(job.payload) as Record<string, unknown>)
        run("UPDATE jobs SET status='done' WHERE id=?", job.id)
      } catch (err) {
        const attempts = job.attempts + 1
        const msg = err instanceof Error ? err.message : String(err)
        if (attempts >= MAX_ATTEMPTS) {
          run("UPDATE jobs SET status='dead', attempts=?, last_error=? WHERE id=?", attempts, msg, job.id)
          alert('critical', 'job_dead', `Job ${job.kind} failed permanently`, msg)
        } else {
          run("UPDATE jobs SET status='queued', attempts=?, last_error=?, run_at=? WHERE id=?", attempts, msg, now() + 2 ** attempts * 1000, job.id)
        }
      }
    }
  } finally {
    busy = false
  }
}

export function startQueue() {
  // Jobs interrupted by a restart are put back in the queue.
  run("UPDATE jobs SET status='queued' WHERE status='running'")
  setInterval(() => void tick(), 500)
}
