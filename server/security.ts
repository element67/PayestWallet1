/** Cryptographic helpers, rate limiting, replay protection primitives. */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { CONFIG } from './config'

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url')
export const randomHex = (bytes: number) => randomBytes(bytes).toString('hex')

/** AES-256-GCM envelope: iv.tag.ciphertext (base64url). */
export function encrypt(plain: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', CONFIG.encryptionKey, iv)
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return [iv, c.getAuthTag(), ct].map((b) => b.toString('base64url')).join('.')
}

export function decrypt(blob: string): string {
  const [iv, tag, ct] = blob.split('.').map((p) => Buffer.from(p, 'base64url'))
  const d = createDecipheriv('aes-256-gcm', CONFIG.encryptionKey, iv)
  d.setAuthTag(tag)
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8')
}

export function hmacHex(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

/** Sliding-window rate limiter (in-memory, single process). */
const buckets = new Map<string, number[]>()
export function rateLimit(key: string, max: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const now = Date.now()
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs)
  if (hits.length >= max) {
    buckets.set(key, hits)
    return { ok: false, retryAfterSec: Math.ceil((windowMs - (now - hits[0])) / 1000) }
  }
  hits.push(now)
  buckets.set(key, hits)
  return { ok: true, retryAfterSec: 0 }
}
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of buckets) if (v.every((t) => now - t > 3_600_000)) buckets.delete(k)
}, 60_000).unref()

export const maskAccount = (n: string) => (n.length > 4 ? `${'*'.repeat(n.length - 4)}${n.slice(-4)}` : n)
