import { describe, expect, test } from 'bun:test'
import { makeUser } from '../helpers'
import { HttpError } from '../../server/auth'
import { get } from '../../server/db'
import { updateProfile } from '../../server/settings'

const base = (email: string, extra: Record<string, string> = {}) => ({ fullName: 'New Name', email, phone: null, ...extra })
const status = async (p: Promise<unknown>) => ((await p.then(() => 0, (e: unknown) => (e as HttpError).status)) as number)

describe('NB-16 changing the email keeps the sign-in email in step', () => {
  test('a name change alone needs no password', async () => {
    const u = await makeUser({ password: 'correct horse battery' })
    await updateProfile(u, base(u.email))
    expect((await get<{ name: string }>('SELECT name FROM users WHERE id=?', u.id))?.name).toBe('New Name')
  })
  test('a new email needs the current password', async () => {
    const u = await makeUser({ password: 'correct horse battery' })
    expect(await status(updateProfile(u, base('fresh1@test.example')))).toBe(403)
    expect(await status(updateProfile(u, base('fresh1@test.example', { currentPassword: 'wrong password!!' })))).toBe(403)
    expect((await get<{ email: string }>('SELECT email FROM users WHERE id=?', u.id))?.email).toBe(u.email)
  })
  test('another account\'s email is refused', async () => {
    const a = await makeUser({ password: 'correct horse battery' })
    const b = await makeUser({ password: 'correct horse battery' })
    expect(await status(updateProfile(a, base(b.email, { currentPassword: 'correct horse battery' })))).toBe(409)
  })
  test('with the right password both the sign-in and profile email change', async () => {
    const u = await makeUser({ password: 'correct horse battery' })
    const r = await updateProfile(u, base('changed-nb16@test.example', { currentPassword: 'correct horse battery' }))
    expect(r.profile.email).toBe('changed-nb16@test.example')
    expect((await get<{ email: string }>('SELECT email FROM users WHERE id=?', u.id))?.email).toBe('changed-nb16@test.example')
    expect((await get<{ email: string }>('SELECT email FROM user_profiles WHERE user_id=?', u.id))?.email).toBe('changed-nb16@test.example')
  })
  test('a preview account with no password cannot change its email', async () => {
    const u = await makeUser()
    expect(await status(updateProfile(u, base('nopass@test.example', { currentPassword: 'anything at all' })))).toBe(400)
  })
})
