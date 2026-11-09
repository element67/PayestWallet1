/**
 * Wallet key management. Standards only: BIP-39 mnemonic, BIP-32/44 (EVM), BIP-84 (Bitcoin), SLIP-0010 (Solana).
 * The seed phrase is wrapped with AES-256-GCM under WALLET_MASTER_KEY, bound to the user id, and is only
 * decrypted inside withEvmAccount for the duration of a signing call. No API route returns it.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { ed25519 } from '@noble/curves/ed25519.js'
import { hmac } from '@noble/hashes/hmac.js'
import { sha512 } from '@noble/hashes/sha2.js'
import { base58 } from '@scure/base'
import { HDKey } from '@scure/bip32'
import { mnemonicToSeedSync } from '@scure/bip39'
import { p2wpkh, TEST_NETWORK } from '@scure/btc-signer'
import { english, generateMnemonic, mnemonicToAccount, type HDAccount } from 'viem/accounts'
import { CONFIG } from '../config'
import { audit, db, get, now, run, uid } from '../db'

export const PATHS = { evm: "m/44'/60'/0'/0/0", solana: "m/44'/501'/0'/0'", bitcoin: "m/84'/1'/0'/0/0" } as const

const KEY_VERSION = 1

function wrap(plain: string, aad: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', CONFIG.walletMasterKey, iv)
  c.setAAD(Buffer.from(aad))
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return `v${KEY_VERSION}.${[iv, c.getAuthTag(), ct].map((b) => b.toString('base64url')).join('.')}`
}

export function unwrap(blob: string, aad: string): string {
  const [, iv, tag, ct] = blob.split('.')
  const d = createDecipheriv('aes-256-gcm', CONFIG.walletMasterKey, Buffer.from(iv, 'base64url'))
  d.setAAD(Buffer.from(aad))
  d.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8')
}

/** SLIP-0010 ed25519 derivation (hardened-only), the scheme Solana wallets use. */
function slip10Ed25519(seed: Uint8Array, path: string): Uint8Array {
  let I = hmac(sha512, new TextEncoder().encode('ed25519 seed'), seed)
  let key = I.slice(0, 32)
  let chain = I.slice(32)
  for (const seg of path.replace(/^m\//, '').split('/')) {
    const index = (Number.parseInt(seg.replace("'", ''), 10) | 0x80000000) >>> 0
    const data = new Uint8Array(37)
    data.set(key, 1)
    new DataView(data.buffer).setUint32(33, index, false)
    I = hmac(sha512, chain, data)
    key = I.slice(0, 32)
    chain = I.slice(32)
  }
  return key
}

export function deriveAddresses(mnemonic: string) {
  const seed = mnemonicToSeedSync(mnemonic)
  const evm = mnemonicToAccount(mnemonic).address
  const solana = base58.encode(ed25519.getPublicKey(slip10Ed25519(seed, PATHS.solana)))
  const btcKey = HDKey.fromMasterSeed(seed).derive(PATHS.bitcoin)
  if (!btcKey.publicKey) throw new Error('Bitcoin key derivation failed')
  const bitcoin = p2wpkh(btcKey.publicKey, TEST_NETWORK).address
  if (!bitcoin) throw new Error('Bitcoin address derivation failed')
  return { evm, solana, bitcoin }
}

export interface WalletAddresses { evm: string; solana: string; bitcoin: string }

export function getAddresses(userId: string): WalletAddresses | null {
  const w = get<{ id: string }>('SELECT id FROM wallets WHERE user_id=?', userId)
  if (!w) return null
  const rows = db.query('SELECT family, address FROM wallet_addresses WHERE wallet_id=?').all(w.id) as { family: string; address: string }[]
  const m = Object.fromEntries(rows.map((r) => [r.family, r.address]))
  return { evm: m.evm, solana: m.solana, bitcoin: m.bitcoin }
}

/** Creates the user's wallet on first use. Real BIP-39 entropy; testnet networks only. */
export function ensureWallet(userId: string): WalletAddresses {
  const existing = getAddresses(userId)
  if (existing) return existing
  const mnemonic = generateMnemonic(english, 128)
  const addrs = deriveAddresses(mnemonic)
  const walletId = uid('wal')
  try {
    db.transaction(() => {
      run('INSERT INTO wallets(id,user_id,mnemonic_enc,key_version,environment,created_at) VALUES (?,?,?,?,?,?)', walletId, userId, wrap(mnemonic, userId), KEY_VERSION, 'testnet', now())
      for (const [family, address] of Object.entries(addrs)) {
        run('INSERT INTO wallet_addresses(id,wallet_id,family,derivation_path,address,created_at) VALUES (?,?,?,?,?,?)', uid('wad'), walletId, family, PATHS[family as keyof typeof PATHS], address, now())
      }
    })()
    audit(userId, 'wallet.create', walletId, undefined, { environment: 'testnet', families: Object.keys(addrs) })
  } catch {
    // Lost a creation race: the other request's wallet is the one that persisted.
  }
  const out = getAddresses(userId)
  if (!out) throw new Error('Wallet creation failed')
  return out
}

/** The only place a seed phrase is decrypted. The account never leaves the callback. */
export async function withEvmAccount<T>(userId: string, fn: (account: HDAccount) => Promise<T>): Promise<T> {
  const row = get<{ mnemonic_enc: string }>('SELECT mnemonic_enc FROM wallets WHERE user_id=?', userId)
  if (!row) throw new Error('Wallet not found')
  const account = mnemonicToAccount(unwrap(row.mnemonic_enc, userId))
  return fn(account)
}

export const allAddresses = (family: 'evm' | 'solana' | 'bitcoin') =>
  (db.query(
    `SELECT w.user_id, a.address FROM wallet_addresses a JOIN wallets w ON w.id=a.wallet_id WHERE a.family=?`,
  ).all(family) as { user_id: string; address: string }[])
