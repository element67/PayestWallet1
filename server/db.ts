/**
 * Postgres persistence (Supabase). The server connects with DATABASE_URL, server side only.
 *
 * Every helper is async. Inside `tx(...)` the helpers automatically use that transaction's connection, so code reads
 * the same inside and outside a transaction. A transaction takes one global advisory lock first, which keeps the
 * "one writer at a time" guarantee the ledger and order flows were written against (web server and worker included).
 * Never `await` a network call (an RPC, a provider) inside `tx(...)`: it would hold that lock.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import postgres, { type Sql, type TransactionSql } from 'postgres'
import { DEFAULT_SETTINGS } from './config'
import { applyMigrations } from './migrate'

/** Tests set DB_SCHEMA so each run works in its own throwaway schema of the test database. */
export const DB_SCHEMA = process.env.DB_SCHEMA || ''
const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set. Add your Supabase Postgres connection string to .env (server side only).')

const local = /@(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url)
const WRITE_LOCK = 727_001

const options = {
  max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  idle_timeout: 20,
  connect_timeout: 15,
  prepare: false,
  onnotice: () => {},
  ssl: local || process.env.DATABASE_SSL === 'false' ? false : ('require' as const),
  // int8 (COUNT, SUM of integers, BIGINT timestamps) comes back as a number. NUMERIC (money, token amounts) stays an exact string.
  types: { bigint: { to: 20, from: [20], parse: (x: string) => Number(x), serialize: (x: unknown) => String(x) } },
  ...(DB_SCHEMA ? { connection: { search_path: DB_SCHEMA } } : {}),
}

const g = globalThis as unknown as { __nbSql?: Sql }
export const sql: Sql = (g.__nbSql ??= postgres(url, options))

if (DB_SCHEMA) {
  const admin = postgres(url, { max: 1, prepare: false, onnotice: () => {}, ssl: options.ssl })
  await admin.unsafe(`CREATE SCHEMA IF NOT EXISTS "${DB_SCHEMA}"`)
  await admin.end()
}
await applyMigrations(sql)

const store = new AsyncLocalStorage<TransactionSql>()
type Param = string | number | bigint | boolean | null | undefined

const cache = new Map<string, string>()
/** Converts the SQLite-style SQL this codebase is written in (`?`, INSERT OR IGNORE) to Postgres. */
function toPg(text: string): string {
  const hit = cache.get(text)
  if (hit) return hit
  let s = text.trim().replace(/;+\s*$/, '')
  const ignore = /^INSERT\s+OR\s+IGNORE\s+INTO/i.test(s)
  if (ignore) s = s.replace(/^INSERT\s+OR\s+IGNORE\s+INTO/i, 'INSERT INTO')
  s = s.replace(/AS INTEGER\)/g, 'AS NUMERIC)')
  let out = ''
  let n = 0
  let quote = false
  for (const ch of s) {
    if (ch === "'") quote = !quote
    out += ch === '?' && !quote ? `$${++n}` : ch
  }
  if (ignore) out += ' ON CONFLICT DO NOTHING'
  cache.set(text, out)
  return out
}

const arg = (p: Param) => (p === undefined ? null : typeof p === 'bigint' ? p.toString() : p)

async function exec(text: string, params: Param[]) {
  const q = store.getStore() ?? sql
  return q.unsafe(toPg(text), params.map(arg) as never[])
}

export async function all<T = Record<string, unknown>>(text: string, ...p: Param[]): Promise<T[]> {
  return (await exec(text, p)) as unknown as T[]
}
export async function get<T = Record<string, unknown>>(text: string, ...p: Param[]): Promise<T | null> {
  const rows = (await exec(text, p)) as unknown as T[]
  return rows[0] ?? null
}
export async function run(text: string, ...p: Param[]): Promise<{ changes: number }> {
  const r = await exec(text, p)
  return { changes: r.count }
}

/** Run `fn` in one transaction. Nested calls become savepoints. A thrown error rolls everything back. */
export async function tx<T>(fn: () => Promise<T>): Promise<T> {
  const cur = store.getStore()
  if (cur) return (await cur.savepoint(async (s) => await store.run(s, fn))) as T
  return (await sql.begin(async (t) => {
    await t.unsafe(`SELECT pg_advisory_xact_lock(${WRITE_LOCK})`)
    return await store.run(t, fn)
  })) as T
}

export async function closeDb() {
  await sql.end({ timeout: 5 })
  g.__nbSql = undefined
}

for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
  await run('INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)', k, v)
}

export const now = () => Date.now()
export const uid = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`

export async function setting(key: string): Promise<string> {
  return (await get<{ value: string }>('SELECT value FROM settings WHERE key=?', key))?.value ?? DEFAULT_SETTINGS[key] ?? ''
}
export const settingNum = async (key: string) => Number(await setting(key))
export const settingBig = async (key: string) => BigInt((await setting(key)) || '0')

export async function audit(actorId: string | null, action: string, target: string, before?: unknown, after?: unknown) {
  await run(
    'INSERT INTO audit_logs(at, actor_id, action, target, before, after) VALUES (?,?,?,?,?,?)',
    now(), actorId, action, target, before === undefined ? null : JSON.stringify(before), after === undefined ? null : JSON.stringify(after),
  )
}

export async function alert(severity: 'info' | 'warning' | 'critical', kind: string, title: string, detail = '', userId?: string, orderId?: string) {
  await run('INSERT INTO alerts(at, severity, kind, title, detail, user_id, order_id) VALUES (?,?,?,?,?,?,?)', now(), severity, kind, title, detail, userId ?? null, orderId ?? null)
}

export async function notify(userId: string, kind: string, title: string, body: string) {
  await run('INSERT INTO notifications(user_id, at, kind, title, body) VALUES (?,?,?,?,?)', userId, now(), kind, title, body)
}

export async function orderEvent(orderId: string, kind: string, detail = '') {
  await run('INSERT INTO order_events(order_id, at, kind, detail) VALUES (?,?,?,?)', orderId, now(), kind, detail)
}
