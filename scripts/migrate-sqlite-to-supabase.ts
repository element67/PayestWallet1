/**
 * Copies an existing NairaBridge SQLite database into Supabase Postgres (DATABASE_URL).
 *
 *   bun scripts/migrate-sqlite-to-supabase.ts --dry-run      # do everything, then roll back
 *   bun scripts/migrate-sqlite-to-supabase.ts                # copy for real
 *   bun scripts/migrate-sqlite-to-supabase.ts --file path/to/fintech.db
 *
 * The SQLite file is opened read-only and never changed. The copy is idempotent (rows that already exist are skipped, ids
 * and ledger idempotency keys are kept), runs in one transaction, and ends by checking row counts and every account's
 * ledger balance on both sides. If anything differs, nothing is saved.
 */
import { Database } from 'bun:sqlite'
import { existsSync } from 'node:fs'
import postgres from 'postgres'
import { applyMigrations } from '../server/migrate'

const args = process.argv.slice(2)
const dry = args.includes('--dry-run')
const file = args.includes('--file') ? args[args.indexOf('--file') + 1] : process.env.SQLITE_PATH || 'data/fintech.db'
const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set. Add your Supabase Postgres connection string to .env.')
if (!existsSync(file)) throw new Error(`SQLite file not found: ${file}`)

// Parents before children, so foreign keys hold at every step.
const ORDER = [
  'users', 'settings', 'assets', 'tokens', 'token_networks', 'sessions', 'user_settings', 'user_profiles', 'naira_wallets', 'wallets', 'wallet_addresses',
  'wallet_balances', 'wallet_tokens', 'wallet_cursors', 'wallet_txs', 'balances', 'ledger_entries', 'quotes', 'orders', 'order_events', 'chain_txs',
  'bank_accounts', 'payments', 'withdrawals', 'webhook_events', 'jobs', 'agent_decisions', 'alerts', 'notifications', 'audit_logs', 'transactions',
  'crypto_ops', 'beneficiaries', 'bills_orders', 'p2p_orders', 'provider_callbacks', 'devices', 'shop_products', 'flight_seats', 'inventory_holds', 'monitor_state',
]
const IDENTITY = ['ledger_entries', 'order_events', 'jobs', 'agent_decisions', 'alerts', 'notifications', 'audit_logs', 'token_networks', 'provider_callbacks', 'inventory_holds']

const local = /@(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url)
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {}, ssl: local || process.env.DATABASE_SSL === 'false' ? false : 'require' })
const lite = new Database(file, { readonly: true })
const check = lite.query('PRAGMA quick_check').get() as { quick_check: string } | null
if (check?.quick_check !== 'ok') throw new Error(`The SQLite file failed its integrity check (${check?.quick_check}). Not copying it.`)

await applyMigrations(sql)

const liteTables = new Set((lite.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((r) => r.name))
const unknown = [...liteTables].filter((t) => !ORDER.includes(t) && t !== 'ledger')
if (unknown.length) console.warn(`Skipping SQLite tables with no Postgres counterpart: ${unknown.join(', ')}`)

class Abort extends Error {}
const summary: string[] = []
try {
  await sql.begin(async (t) => {
    for (const table of ORDER) {
      if (!liteTables.has(table)) continue
      const pgCols = new Set((await t.unsafe('SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1', [table])).map((r) => String(r.column_name)))
      const rows = lite.query(`SELECT * FROM ${table}`).all() as Record<string, unknown>[]
      if (!rows.length) { summary.push(`${table}: 0`); continue }
      const cols = Object.keys(rows[0]).filter((c) => pgCols.has(c))
      const dropped = Object.keys(rows[0]).filter((c) => !pgCols.has(c))
      if (dropped.length) console.warn(`${table}: ignoring columns with no Postgres counterpart: ${dropped.join(', ')}`)
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200).map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])))
        await t`INSERT INTO ${t(table)} ${t(chunk as never[], ...cols)} ON CONFLICT DO NOTHING`
      }
      if (IDENTITY.includes(table)) {
        await t.unsafe(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1), (SELECT COUNT(*) > 0 FROM ${table}))`)
      }
      const [{ c }] = await t.unsafe(`SELECT COUNT(*)::int AS c FROM ${table}`) as unknown as { c: number }[]
      if (c < rows.length) throw new Abort(`${table}: SQLite has ${rows.length} rows but Postgres has only ${c}`)
      summary.push(`${table}: ${rows.length} copied, ${c} in Postgres`)
    }

    // Every account's confirmed ledger balance must match exactly, as BigInt on both sides.
    if (liteTables.has('ledger_entries')) {
      const mine = new Map<string, bigint>()
      for (const r of lite.query("SELECT owner, asset, delta FROM ledger_entries WHERE COALESCE(status,'confirmed')='confirmed'").all() as { owner: string; asset: string; delta: string }[]) {
        const k = `${r.owner}|${r.asset}`
        mine.set(k, (mine.get(k) ?? 0n) + BigInt(r.delta))
      }
      const theirs = new Map<string, bigint>()
      for (const r of await t.unsafe("SELECT owner, asset, SUM(delta) AS total FROM ledger_entries WHERE status='confirmed' GROUP BY owner, asset") as unknown as { owner: string; asset: string; total: string }[]) {
        theirs.set(`${r.owner}|${r.asset}`, BigInt(r.total))
      }
      for (const [k, v] of mine) if ((theirs.get(k) ?? 0n) !== v) throw new Abort(`Ledger balance differs for ${k}: SQLite ${v}, Postgres ${theirs.get(k) ?? 0n}`)
      summary.push(`ledger: ${mine.size} account balances match exactly`)
    }
    if (dry) throw new Abort('dry-run')
  })
} catch (e) {
  if (!(e instanceof Abort)) throw e
  if (e.message !== 'dry-run') {
    console.error(`Nothing was saved. ${e.message}`)
    process.exitCode = 1
  }
}
console.log(summary.join('\n'))
console.log(dry ? '\nDry run finished. Everything above was rolled back.' : process.exitCode ? '' : '\nDone. The SQLite file was not changed.')
await sql.end()
lite.close()
