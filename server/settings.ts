/**
 * Appearance (colour theme) and profile. Every route needs the signed-in user and reads or changes only that user's own row.
 * A missing row is created on first read, so a new account always has the default theme and a profile built from the account.
 */
import { z } from 'zod'
import { DEFAULT_TEXT_SIZE, isTextSizeId, TEXT_SIZE_IDS } from '../src/lib/textSizeIds'
import { DEFAULT_THEME, isThemeId, normalizeThemeId, THEME_IDS } from '../src/lib/themeIds'
import { HttpError, type User } from './auth'
import { audit, get, now, run, tx } from './db'
import { body, route } from './http'

/* ---------------- appearance ---------------- */

async function themeFor(userId: string): Promise<string> {
  const row = await get<{ theme_id: string }>('SELECT theme_id FROM user_settings WHERE user_id=?', userId)
  if (row) return normalizeThemeId(row.theme_id)
  await run('INSERT OR IGNORE INTO user_settings(user_id, theme_id, updated_at) VALUES (?,?,?)', userId, DEFAULT_THEME, now())
  return DEFAULT_THEME
}

route('GET', '/api/settings/appearance', 'user', async (c) => ({ themeId: await themeFor(c.user.id) }), [120, 60_000])

route('PUT', '/api/settings/appearance', 'user', async (c) => {
  const b = body(c, z.object({ themeId: z.unknown() }))
  if (!isThemeId(b.themeId)) throw new HttpError(400, `Unknown theme. Choose one of: ${THEME_IDS.join(', ')}`)
  await run(
    'INSERT INTO user_settings(user_id, theme_id, updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET theme_id=excluded.theme_id, updated_at=excluded.updated_at',
    c.user.id, b.themeId, now(),
  )
  return { themeId: b.themeId }
}, [60, 60_000])

/* ---------------- text size ---------------- */

// The text size lives in the same user_settings row as the theme. A missing row is created with the defaults on first read.
async function textSizeFor(userId: string): Promise<string> {
  const row = await get<{ text_scale: string }>('SELECT text_scale FROM user_settings WHERE user_id=?', userId)
  if (row) return isTextSizeId(row.text_scale) ? row.text_scale : DEFAULT_TEXT_SIZE
  await run('INSERT OR IGNORE INTO user_settings(user_id, theme_id, text_scale, updated_at) VALUES (?,?,?,?)', userId, DEFAULT_THEME, DEFAULT_TEXT_SIZE, now())
  return DEFAULT_TEXT_SIZE
}

route('GET', '/api/settings/text-size', 'user', async (c) => ({ textScale: await textSizeFor(c.user.id) }), [120, 60_000])

route('PUT', '/api/settings/text-size', 'user', async (c) => {
  const b = body(c, z.object({ textScale: z.unknown() }))
  if (!isTextSizeId(b.textScale)) throw new HttpError(400, `Unknown text size. Choose one of: ${TEXT_SIZE_IDS.join(', ')}`)
  await run(
    'INSERT INTO user_settings(user_id, theme_id, text_scale, updated_at) VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET text_scale=excluded.text_scale, updated_at=excluded.updated_at',
    c.user.id, DEFAULT_THEME, b.textScale, now(),
  )
  return { textScale: b.textScale }
}, [60, 60_000])

/* ---------------- profile ---------------- */

interface ProfileRow {
  user_id: string; full_name: string; email: string; phone: string | null; avatar_url: string | null
  verification_status: string; created_at: number; updated_at: number
}

const verificationFor = (u: User) => (u.kyc_tier >= 2 ? 'verified' : 'unverified')

async function profileFor(u: User) {
  let row = await get<ProfileRow>('SELECT * FROM user_profiles WHERE user_id=?', u.id)
  if (!row) {
    // Built from the account the first time it is asked for.
    await run(
      'INSERT OR IGNORE INTO user_profiles(user_id, full_name, email, phone, verification_status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
      u.id, u.name, u.email, u.phone ?? null, verificationFor(u), now(), now(),
    )
    row = await get<ProfileRow>('SELECT * FROM user_profiles WHERE user_id=?', u.id) as ProfileRow
  }
  // The sign-in email is the single source of truth: a profile row that drifted from it is corrected on read.
  if (row.email !== u.email) {
    await run('UPDATE user_profiles SET email=?, updated_at=? WHERE user_id=?', u.email, now(), u.id)
    row.email = u.email
  }
  const status = verificationFor(u)
  if (row.verification_status !== status) {
    await run('UPDATE user_profiles SET verification_status=?, updated_at=? WHERE user_id=?', status, now(), u.id)
    row.verification_status = status
  }
  return {
    fullName: row.full_name, email: row.email, phone: row.phone, avatarUrl: row.avatar_url, verificationStatus: row.verification_status,
    tier: u.kyc_tier, memberSince: u.created_at, updatedAt: row.updated_at,
  }
}

route('GET', '/api/profile', 'user', async (c) => ({ profile: await profileFor(c.user) }), [120, 60_000])

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
/** Nigerian mobile in local form (08012345678) or international form (+2348012345678), or another international number. */
function normalizePhone(input: string): string | null {
  const s = input.replace(/[\s()-]/g, '')
  const ng = /^\+234([789][01]\d{8})$/.exec(s)
  if (ng) return `0${ng[1]}`
  if (/^0[789][01]\d{8}$/.test(s)) return s
  if (/^\+[1-9]\d{7,14}$/.test(s)) return s
  return null
}

const profileSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name').max(80, 'Name is too long'),
  email: z.string().trim().toLowerCase().max(120).regex(EMAIL, 'Enter a valid email address'),
  phone: z.string().trim().max(24).optional().nullable(),
  /** Required only when the email changes: the email is also the sign-in identity. */
  currentPassword: z.string().max(200).optional(),
})

export async function updateProfile(user: User, b: z.infer<typeof profileSchema>) {
  const raw = b.phone?.trim() ?? ''
  const phone = raw ? normalizePhone(raw) : null
  if (raw && !phone) throw new HttpError(400, 'Enter a valid phone number, for example 08012345678 or +2348012345678')
  const before = await profileFor(user)
  const emailChanged = b.email !== user.email
  if (emailChanged) {
    // Changing the email changes how you sign in, so it needs your password and an address nobody else uses.
    const acct = await get<{ password_hash: string | null }>('SELECT password_hash FROM users WHERE id=?', user.id)
    if (!acct?.password_hash) throw new HttpError(400, 'The email of a preview account cannot be changed')
    if (!b.currentPassword || !(await Bun.password.verify(b.currentPassword, acct.password_hash))) throw new HttpError(403, 'Enter your current password to change your email')
    if (await get('SELECT 1 FROM users WHERE email=? AND id<>?', b.email, user.id) || await get('SELECT 1 FROM user_profiles WHERE email=? AND user_id<>?', b.email, user.id)) {
      throw new HttpError(409, 'That email is already used by another account')
    }
  }
  // Names and Nigerian mobile numbers are shared with the Naira wallet (transfers and name checks), so they stay in step.
  const nigerian = phone !== null && /^0[789][01]\d{8}$/.test(phone)
  try {
    await tx(async () => {
      if (nigerian) await run('UPDATE users SET phone=? WHERE id=?', phone, user.id)
      await run('UPDATE users SET name=? WHERE id=?', b.fullName, user.id)
      if (emailChanged) await run('UPDATE users SET email=? WHERE id=?', b.email, user.id)
      await run('UPDATE user_profiles SET full_name=?, email=?, phone=?, updated_at=? WHERE user_id=?', b.fullName, b.email, phone, now(), user.id)
    })
  } catch {
    throw new HttpError(409, 'That phone number or email is already used by another account')
  }
  await audit(user.id, 'profile.update', user.id, { fullName: before.fullName, email: before.email }, { fullName: b.fullName, email: b.email })
  const fresh = await get<User>('SELECT * FROM users WHERE id=?', user.id) as User
  return { profile: await profileFor(fresh) }
}

route('PUT', '/api/profile', 'user', async (c) => await updateProfile(c.user, body(c, profileSchema)), [20, 60_000])

/* ---------------- profile picture ---------------- */

/** The browser shrinks the picture to a small square before sending it; the request limit is 64 KB, so this is a hard ceiling. */
const MAX_AVATAR_BYTES = 40 * 1024
const DATA_URL = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/

/** The real image type, read from the file's own first bytes, never from what the caller claims. */
function sniffImage(buf: Buffer): 'png' | 'jpeg' | 'webp' | null {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg'
  if (buf.length > 12 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp'
  return null
}

route('PUT', '/api/profile/avatar', 'user', async (c) => {
  const { image } = body(c, z.object({ image: z.string().max(70_000) }))
  const m = DATA_URL.exec(image)
  if (!m) throw new HttpError(400, 'Choose a PNG, JPEG or WebP picture')
  const bytes = Buffer.from(m[1], 'base64')
  if (bytes.length === 0 || bytes.length > MAX_AVATAR_BYTES) throw new HttpError(413, 'That picture is too large. Choose a smaller one')
  const kind = sniffImage(bytes)
  if (!kind) throw new HttpError(400, 'That file is not a valid PNG, JPEG or WebP picture')
  await profileFor(c.user)
  const url = `data:image/${kind};base64,${bytes.toString('base64')}`
  await run('UPDATE user_profiles SET avatar_url=?, updated_at=? WHERE user_id=?', url, now(), c.user.id)
  await audit(c.user.id, 'profile.avatar_set', c.user.id)
  return { profile: await profileFor(c.user) }
}, [20, 60_000])

route('DELETE', '/api/profile/avatar', 'user', async (c) => {
  await profileFor(c.user)
  await run('UPDATE user_profiles SET avatar_url=NULL, updated_at=? WHERE user_id=?', now(), c.user.id)
  await audit(c.user.id, 'profile.avatar_removed', c.user.id)
  return { profile: await profileFor(c.user) }
}, [20, 60_000])
