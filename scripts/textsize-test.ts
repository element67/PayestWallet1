/* oxlint-disable */
/** Text size API checks against the running API: bun scripts/textsize-test.ts */
import { Database } from 'bun:sqlite'
const base = process.env.API ?? 'http://127.0.0.1:3001'
let failures = 0
const ok = (name: string, cond: boolean, extra = '') => {
  if (!cond) failures++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
}
async function call(path: string, token?: string, method = 'GET', body?: unknown) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { s: res.status, d: (await res.json()) as any }
}
const dev = async (role: string) => (await call('/api/auth/dev-session', undefined, 'POST', { role })).d.token as string
const A = await dev('user')
const B = await dev('founder')

ok('GET needs sign-in', (await call('/api/settings/text-size')).s === 401)
ok('PUT needs sign-in', (await call('/api/settings/text-size', undefined, 'PUT', { textScale: 'large' })).s === 401)

// a user with no saved setting is created with the default (medium)
const db = new Database('data/fintech.db')
const uid = (db.query("select id from users where email like 'preview-user%'").get() as { id: string }).id
db.query('delete from user_settings where user_id=?').run(uid)
const first = await call('/api/settings/text-size', A)
ok('no saved setting: defaults to medium', first.s === 200 && first.d.textScale === 'medium', JSON.stringify(first.d))
const row = db.query('select theme_id, text_scale from user_settings where user_id=?').get(uid) as { theme_id: string; text_scale: string } | null
ok('the default row was created in user_settings', row?.text_scale === 'medium' && row?.theme_id === 'cobalt-lime', JSON.stringify(row))

for (const id of ['small', 'medium', 'large', 'xlarge']) {
  const r = await call('/api/settings/text-size', A, 'PUT', { textScale: id })
  const g = await call('/api/settings/text-size', A)
  const stored = (db.query('select text_scale from user_settings where user_id=?').get(uid) as { text_scale: string }).text_scale
  ok(`"${id}" saves, reads back and is in the database`, r.s === 200 && g.d.textScale === id && stored === id)
}
for (const bad of ['huge', '', 'LARGE', 'large ', 150, null, ['large'], "xlarge'; drop table user_settings;--"]) {
  const r = await call('/api/settings/text-size', A, 'PUT', { textScale: bad })
  ok(`rejects ${JSON.stringify(bad)}`, r.s === 400 && /Choose one of/.test(r.d.error), r.d.error)
}
ok('rejects a missing value', (await call('/api/settings/text-size', A, 'PUT', {})).s === 400)
ok('still the last valid value after bad requests', (await call('/api/settings/text-size', A)).d.textScale === 'xlarge')

// the theme is untouched by a text size change, and the other way round
await call('/api/settings/appearance', A, 'PUT', { themeId: 'orange-tape' })
ok('changing the theme keeps the text size', (await call('/api/settings/text-size', A)).d.textScale === 'xlarge')
await call('/api/settings/text-size', A, 'PUT', { textScale: 'small' })
ok('changing the text size keeps the theme', (await call('/api/settings/appearance', A)).d.themeId === 'orange-tape')

// per user
await call('/api/settings/text-size', B, 'PUT', { textScale: 'large' })
ok('settings are per user', (await call('/api/settings/text-size', A)).d.textScale === 'small' && (await call('/api/settings/text-size', B)).d.textScale === 'large')

// restore defaults
await call('/api/settings/text-size', A, 'PUT', { textScale: 'medium' })
await call('/api/settings/text-size', B, 'PUT', { textScale: 'medium' })
await call('/api/settings/appearance', A, 'PUT', { themeId: 'cobalt-lime' })
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED')
process.exit(failures ? 1 : 0)
