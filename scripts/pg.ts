/** Direct Postgres access for the operator and integration scripts (reads DATABASE_URL, never printed). */
import postgres from 'postgres'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set. Add your Supabase Postgres connection string to .env.')
const local = /@(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url)
export const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {}, ssl: local || process.env.DATABASE_SSL === 'false' ? false : 'require' })
