/* oxlint-disable */
/**
 * Operator-only seed recovery. Run in a trusted terminal, never through the app or an AI agent:
 *   bun scripts/wallet-recovery.ts <userId> --i-understand
 * Reads the database read-only, decrypts with WALLET_MASTER_KEY from the environment, prints the phrase to
 * this terminal only, and appends a line to data/recovery-audit.log. Keep the master key in a secrets manager
 * and back it up separately from the database: without it no seed phrase can be recovered.
 */
import { Database } from 'bun:sqlite'
import { appendFileSync } from 'node:fs'
import { createDecipheriv } from 'node:crypto'

const [userId, flag] = process.argv.slice(2)
if (!userId || flag !== '--i-understand') {
  console.error('Usage: bun scripts/wallet-recovery.ts <userId> --i-understand')
  process.exit(1)
}
const hex = process.env.WALLET_MASTER_KEY
if (!hex || hex.length < 64) throw new Error('WALLET_MASTER_KEY is not set')
const db = new Database('data/fintech.db', { readonly: true })
const row = db.query('SELECT mnemonic_enc, key_version FROM wallets WHERE user_id=?').get(userId) as { mnemonic_enc: string; key_version: number } | null
if (!row) throw new Error('No wallet for that user')
const [, iv, tag, ct] = row.mnemonic_enc.split('.')
const d = createDecipheriv('aes-256-gcm', Buffer.from(hex.slice(0, 64), 'hex'), Buffer.from(iv, 'base64url'))
d.setAAD(Buffer.from(userId))
d.setAuthTag(Buffer.from(tag, 'base64url'))
const phrase = Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8')
appendFileSync('data/recovery-audit.log', `${new Date().toISOString()} recovery of wallet for ${userId} (key v${row.key_version})\n`)
console.log(`Recovery phrase for ${userId}:\n\n${phrase}\n\nClear your terminal history after copying it.`)
