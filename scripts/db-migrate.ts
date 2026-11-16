/** Applies the SQL files in supabase/migrations to DATABASE_URL (your Supabase Postgres). Safe to run repeatedly. */
import postgres from 'postgres'
import { applyMigrations } from '../server/migrate'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set. Add your Supabase Postgres connection string to .env, then run this again.')
  process.exit(1)
}
const local = /@(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url)
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {}, ssl: local || process.env.DATABASE_SSL === 'false' ? false : 'require' })
try {
  const applied = await applyMigrations(sql)
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.')
} finally {
  await sql.end()
}
