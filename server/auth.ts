/** Sessions, password auth and the development preview sign-in (sandbox only). */
import { CONFIG } from './config'
import { audit, get, now, run, uid } from './db'
import { trackDevice } from './naira/devices'
import { randomToken, sha256 } from './security'

export interface User {
  id: string
  email: string
  name: string
  role: 'user' | 'founder'
  kyc_tier: number
  status: string
  dev_preview: number
  created_at: number
  username?: string | null
  phone?: string | null
  display_currency?: 'USD' | 'NGN'
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) {
    super(message)
  }
}

export async function createSession(userId: string, ip: string, userAgent = ''): Promise<string> {
  const token = randomToken(32)
  const fp = await trackDevice(userId, userAgent, ip)
  await run('INSERT INTO sessions(token_hash, user_id, expires_at, created_at, ip, device_fp, user_agent) VALUES (?,?,?,?,?,?,?)', sha256(token), userId, now() + CONFIG.sessionTtlMs, now(), ip, fp, userAgent.slice(0, 200))
  await run('UPDATE users SET last_login_at=? WHERE id=?', now(), userId)
  return token
}

/** Token rotation: the old token stops working the moment the new one is issued. */
export async function rotateSession(oldToken: string, ip: string): Promise<string | null> {
  const row = await get<{ user_id: string; device_fp: string | null; user_agent: string | null; expires_at: number }>('SELECT * FROM sessions WHERE token_hash=?', sha256(oldToken))
  if (!row || row.expires_at < now()) return null
  const token = randomToken(32)
  await run('DELETE FROM sessions WHERE token_hash=?', sha256(oldToken))
  await run('INSERT INTO sessions(token_hash, user_id, expires_at, created_at, ip, device_fp, user_agent) VALUES (?,?,?,?,?,?,?)', sha256(token), row.user_id, now() + CONFIG.sessionTtlMs, now(), ip, row.device_fp, row.user_agent)
  return token
}

export async function userFromToken(token: string | null): Promise<User | null> {
  if (!token) return null
  const row = await get<User & { expires_at: number }>(
    `SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?`,
    sha256(token),
  )
  if (!row) return null
  if (row.expires_at < now()) {
    await run('DELETE FROM sessions WHERE token_hash=?', sha256(token))
    return null
  }
  if (row.status !== 'active') return null
  return row
}

export const destroySession = async (token: string) => await run('DELETE FROM sessions WHERE token_hash=?', sha256(token))

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export async function register(email: string, name: string, password: string): Promise<User> {
  email = email.trim().toLowerCase()
  if (!EMAIL.test(email)) throw new HttpError(400, 'Enter a valid email address')
  if (password.length < 10) throw new HttpError(400, 'Password must be at least 10 characters')
  if (await get('SELECT 1 FROM users WHERE email=?', email)) throw new HttpError(409, 'An account with this email already exists')
  const founderEmail = (process.env.FOUNDER_EMAIL ?? '').trim().toLowerCase()
  const role = founderEmail && founderEmail === email ? 'founder' : 'user'
  const id = uid('usr')
  const hash = await Bun.password.hash(password, { algorithm: 'argon2id' })
  await run('INSERT INTO users(id,email,name,password_hash,role,kyc_tier,created_at) VALUES (?,?,?,?,?,1,?)', id, email, name.trim().slice(0, 80), hash, role, now())
  await audit(id, 'user.register', id)
  return await get<User>('SELECT * FROM users WHERE id=?', id) as User
}

export async function login(email: string, password: string): Promise<User> {
  const id = email.trim().toLowerCase()
  const row = await get<User & { password_hash: string | null }>(id.includes('@') ? 'SELECT * FROM users WHERE email=?' : 'SELECT * FROM users WHERE username=?', id)
  // Always verify against some hash to keep timing similar for unknown accounts.
  const ok = row?.password_hash ? await Bun.password.verify(password, row.password_hash) : false
  if (!row || !ok || row.status !== 'active') throw new HttpError(401, 'Invalid email or password')
  return row
}

/**
 * Makes sure the founder account exists. The email comes from FOUNDER_EMAIL and the password from FOUNDER_PASSWORD
 * (at least 10 characters). Only creates the account when it is missing: it never overwrites a password that was changed.
 */
export async function seedFounder(): Promise<void> {
  const password = process.env.FOUNDER_PASSWORD ?? ''
  if (password.length < 10) return
  const email = (process.env.FOUNDER_EMAIL ?? 'founder@nairabridge.app').trim().toLowerCase()
  const existing = await get<User & { password_hash: string | null }>('SELECT * FROM users WHERE email=?', email)
  if (existing) {
    if (existing.role !== 'founder') await run("UPDATE users SET role='founder' WHERE id=?", existing.id)
    if (!existing.password_hash) await run('UPDATE users SET password_hash=? WHERE id=?', await Bun.password.hash(password, { algorithm: 'argon2id' }), existing.id)
    if (!existing.username && !(await get('SELECT 1 FROM users WHERE username=?', 'founder'))) await run("UPDATE users SET username='founder' WHERE id=?", existing.id)
    return
  }
  const id = uid('usr')
  const hash = await Bun.password.hash(password, { algorithm: 'argon2id' })
  const taken = Boolean(await get('SELECT 1 FROM users WHERE username=?', 'founder'))
  await run(
    'INSERT INTO users(id,email,name,password_hash,role,kyc_tier,username,created_at) VALUES (?,?,?,?,?,2,?,?)',
    id, email, 'Founder', hash, 'founder', taken ? null : 'founder', now(),
  )
  await audit(id, 'user.seed_founder', id)
}

/** Development preview identities. Disabled unless DEV_PREVIEW=true and refused if real money is ever enabled. */
export async function devPreviewUser(role: 'user' | 'founder'): Promise<User> {
  if (!CONFIG.devPreview || CONFIG.realMoney) throw new HttpError(403, 'Development preview is disabled')
  const email = role === 'founder' ? 'preview-founder@dev.local' : 'preview-user@dev.local'
  let u = await get<User>('SELECT * FROM users WHERE email=?', email)
  if (!u) {
    const id = uid('usr')
    await run(
      'INSERT INTO users(id,email,name,password_hash,role,kyc_tier,dev_preview,created_at) VALUES (?,?,?,NULL,?,2,1,?)',
      id, email, role === 'founder' ? 'Preview Founder' : 'Preview User', role, now(),
    )
    // No starter balance: every new wallet starts at zero. Test funds come only from the founder's audited "Test credit".
    u = await get<User>('SELECT * FROM users WHERE email=?', email) as User
  }
  if (!u.username) {
    // Sandbox identities so internal transfers can be tried between the two preview accounts.
    await run('UPDATE users SET username=?, phone=? WHERE id=? AND username IS NULL', role === 'founder' ? 'demo_founder' : 'demo_user', role === 'founder' ? '08000000002' : '08000000001', u.id)
    u = await get<User>('SELECT * FROM users WHERE id=?', u.id) as User
  }
  return u
}

export const publicUser = (u: User) => ({ id: u.id, email: u.email, name: u.name, role: u.role, kycTier: u.kyc_tier, devPreview: Boolean(u.dev_preview), username: u.username ?? null, phone: u.phone ?? null })
