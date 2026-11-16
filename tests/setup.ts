/**
 * Test environment. Runs before any test file: its own throwaway Postgres schema, dummy secrets and sandbox mode, so tests
 * never touch real data or a real chain. The values below are throwaway test secrets, not real credentials.
 *
 * Tests use TEST_DATABASE_URL (default: the local Postgres container) and never DATABASE_URL, so they can never run
 * against your Supabase project.
 */
import { afterAll } from 'bun:test'
import postgres from 'postgres'

const testUrl = process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/nairabridge'
process.env.DATABASE_URL = testUrl
process.env.DB_SCHEMA = `test_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
process.env.APP_ENCRYPTION_KEY = 'a'.repeat(64)
process.env.WEBHOOK_SECRET = 'b'.repeat(64)
process.env.WALLET_MASTER_KEY = 'c'.repeat(64)
process.env.DEV_PREVIEW = 'true'
process.env.PAYMENT_MODE = 'SANDBOX'
delete process.env.TRUST_PROXY
delete process.env.TRUSTED_PROXY_HOPS

afterAll(async () => {
  const admin = postgres(testUrl, { max: 1, onnotice: () => {}, ssl: /@(127\.0\.0\.1|localhost)[:/]/.test(testUrl) ? false : 'require' })
  try {
    await admin.unsafe(`DROP SCHEMA IF EXISTS "${process.env.DB_SCHEMA}" CASCADE`)
  } finally {
    await admin.end()
  }
})
