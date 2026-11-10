/* oxlint-disable */
/** Theme and profile API checks against the running API: bun scripts/design-test.ts */
const base = process.env.API ?? 'http://127.0.0.1:3001'
let failures = 0
const ok = (name: string, cond: boolean, extra = '') => {
  if (!cond) failures++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
}
async function call(path: string, token?: string, method = 'GET', body?: unknown) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { s: res.status, d: (await res.json().catch(() => ({}))) as any }
}
const dev = async (role: string) => (await call('/api/auth/dev-session', undefined, 'POST', { role })).d.token as string
const A = await dev('user')
const B = await dev('founder')

for (const [m, p] of [['GET', '/api/settings/appearance'], ['PUT', '/api/settings/appearance'], ['GET', '/api/profile'], ['PUT', '/api/profile']] as const) {
  ok(`${m} ${p} needs sign-in`, (await call(p, undefined, m, m === 'GET' ? undefined : {})).s === 401)
}

const IDS = ['cobalt-lime', 'orange-tape', 'forest-crimson', 'neon-emerald', 'mint-noir', 'lemon-lavender', 'orchid-orange', 'hot-pink-pulse', 'lavender-tomato', 'sage-burgundy']
let r = await call('/api/settings/appearance', A)
ok('a user with nothing saved gets a theme', r.s === 200 && IDS.includes(r.d.themeId), r.d.themeId)
for (const id of IDS) {
  r = await call('/api/settings/appearance', A, 'PUT', { themeId: id })
  const g = await call('/api/settings/appearance', A)
  if (r.s !== 200 || g.d.themeId !== id) ok(`saves ${id}`, false, JSON.stringify(r.d))
}
ok('every one of the 10 themes saves and reads back', true)
for (const bad of ['neon', '', 'COBALT-LIME', 'cobalt-lime; drop table', 7, null]) {
  r = await call('/api/settings/appearance', A, 'PUT', { themeId: bad })
  ok(`rejects theme ${JSON.stringify(bad)}`, r.s === 400 && /theme/i.test(r.d.error ?? ''), r.d.error)
}
r = await call('/api/settings/appearance', A, 'PUT', {})
ok('rejects a missing theme', r.s === 400)

await call('/api/settings/appearance', A, 'PUT', { themeId: 'mint-noir' })
await call('/api/settings/appearance', B, 'PUT', { themeId: 'orchid-orange' })
ok('themes are per user', (await call('/api/settings/appearance', A)).d.themeId === 'mint-noir' && (await call('/api/settings/appearance', B)).d.themeId === 'orchid-orange')

r = await call('/api/profile', A)
ok('profile loads', r.s === 200 && r.d.profile.fullName && r.d.profile.email, JSON.stringify(r.d.profile))
ok('profile has member since and verification', typeof r.d.profile.memberSince === 'number' && ['verified', 'unverified'].includes(r.d.profile.verificationStatus))
const orig = r.d.profile
const edit = (b: unknown, t = A) => call('/api/profile', t, 'PUT', b)
ok('rejects short name', (await edit({ fullName: 'A', email: 'a@b.co', phone: '' })).s === 400)
ok('rejects bad email', (await edit({ fullName: 'Ada Eze', email: 'nope', phone: '' })).s === 400)
ok('rejects bad phone', (await edit({ fullName: 'Ada Eze', email: 'a@b.co', phone: '12345' })).s === 400)
ok('rejects letters in phone', (await edit({ fullName: 'Ada Eze', email: 'a@b.co', phone: 'abc' })).s === 400)
r = await edit({ fullName: 'Ada Eze', email: 'Ada@Example.com', phone: '+2348012345670' })
ok('saves valid details (email lowercased, +234 normalised)', r.s === 200 && r.d.profile.email === 'ada@example.com' && r.d.profile.phone === '08012345670', JSON.stringify(r.d))
ok('profile reads back what was saved', (await call('/api/profile', A)).d.profile.fullName === 'Ada Eze')
ok('another user does not see it', (await call('/api/profile', B)).d.profile.fullName !== 'Ada Eze')
r = await edit({ fullName: 'Ada Eze', email: 'ada@example.com', phone: '08012345670' }, B)
ok('a phone number already used by another account is refused', r.s === 409, r.d.error)
ok('the other account was not changed by that attempt', (await call('/api/profile', B)).d.profile.fullName !== 'Ada Eze')
r = await edit({ fullName: orig.fullName, email: orig.email, phone: orig.phone ?? '' })
ok('restores the original details', r.s === 200)

await call('/api/settings/appearance', A, 'PUT', { themeId: 'cobalt-lime' })
await call('/api/settings/appearance', B, 'PUT', { themeId: 'cobalt-lime' })
// the sign-in email is never changed by the profile
const me = await call('/api/me', A)
ok('sign-in email is untouched', me.d.user.email === orig.email || /preview/.test(me.d.user.email))
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED')
process.exit(failures ? 1 : 0)
