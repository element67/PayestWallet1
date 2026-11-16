/** Applies the numbered SQL files in supabase/migrations once each, in order, under an advisory lock. Safe to run repeatedly. */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { Sql } from 'postgres'

const MIGRATION_LOCK = 727_000

export async function applyMigrations(sql: Sql): Promise<string[]> {
  const dir = path.join(process.cwd(), 'supabase', 'migrations')
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  const applied: string[] = []
  await sql.begin(async (t) => {
    await t.unsafe(`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK})`)
    await t.unsafe('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at BIGINT NOT NULL)')
    const done = new Set((await t.unsafe('SELECT name FROM schema_migrations')).map((r) => String(r.name)))
    for (const f of files) {
      if (done.has(f)) continue
      await t.unsafe(readFileSync(path.join(dir, f), 'utf8'))
      await t.unsafe('INSERT INTO schema_migrations(name, applied_at) VALUES ($1, $2)', [f, Date.now()])
      applied.push(f)
    }
  })
  return applied
}
