/* oxlint-disable */
/** Zero balances, ledger-derived balances and the founder Test credit: bun scripts/ledger-test.ts */
import { Database } from 'bun:sqlite'
const base = process.env.API ?? 'http://127.0.0.1:3001'
let failures = 0
const ok = (n: string, c: boolean, x = '') => { if (!c) failures++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`) }
const call = async (p: string, t?: string, m = 'GET', b?: unknown) => {
  const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined })
  return { s: r.status, d: (await r.json().catch(() => ({}))) as any }
}
const key = () => 'k' + crypto.randomUUID().replace(/-/g, '').slice(0, 20)
const A = (await call('/api/auth/dev-session', undefined, 'POST', { role: 'user' })).d.token
const F = (await call('/api/auth/dev-session', undefined, 'POST', { role: 'founder' })).d.token
const email = `led${Date.now()}@test.local`
const N = (await call('/api/auth/register', undefined, 'POST', { email, name: 'Ledger Test', password: 'a-long-test-password' })).d
const users = (await call('/api/admin/users', F)).d.users
const me = users.find((u: any) => u.email === email)

// ---------- a new wallet starts at zero ----------
const s0 = (await call('/api/balance/summary', N.token)).d
ok('a new wallet shows $0.00 and ₦0.00', Number(s0.crypto.usd) === 0 && Number(s0.crypto.ngn) === 0 && Number(s0.naira.balance) === 0)
ok('a new wallet holds no crypto tokens', (await call('/api/crypto/tokens', N.token)).d.mine.length === 0)
ok('Home lists only Naira for a new wallet', (await call('/api/home', N.token)).d.assets.length === 1)
ok('a new wallet has no exchange balance', (await call('/api/balances', N.token)).d.assets.every((a: any) => Number(a.amount) === 0))
const led0 = (await call(`/api/admin/naira/users/${me.id}/ledger?asset=ALL`, F)).d
ok('and no ledger entries at all', (led0.entries ?? led0.ledger ?? []).length === 0)

// ---------- the starter funds are gone ----------
const raw = new Database('data/fintech.db', { readonly: true })
ok('the old 100 USDC starter balance was removed with an audited cleanup', (raw.query("SELECT COUNT(*) c FROM audit_logs WHERE action='system.cleanup_starter_balances'").get() as { c: number }).c >= 1)
const removals = raw.query("SELECT COUNT(*) c FROM ledger_entries WHERE reason='sandbox starter balance removed'").get() as { c: number }
ok('the removal is a compensating ledger entry (nothing was edited)', removals.c >= 1)
ok('ledger entries carry user, asset, amount, type, status and time', (raw.query('PRAGMA table_info(ledger_entries)').all() as any[]).map((c) => c.name).join(',').match(/owner.*asset.*delta.*side.*status.*created_at|owner.*asset.*delta.*created_at.*side.*status/) !== null)
raw.close()

// ---------- Test credit: security ----------
const body = { userId: me.id, asset: 'USDC', amount: '25', note: 'trying swaps', idempotencyKey: key() }
ok('Test credit needs a session', (await call('/api/admin/test-credit', undefined, 'POST', body)).s === 401)
ok('normal users cannot use Test credit', (await call('/api/admin/test-credit', N.token, 'POST', body)).s === 403)
ok('even a preview customer cannot use it', (await call('/api/admin/test-credit', A, 'POST', body)).s === 403)
ok('normal users cannot read the credit list either', (await call('/api/admin/test-credit', N.token)).s === 403)
for (const [label, patch] of [['zero amount', { amount: '0' }], ['negative amount', { amount: '-5' }], ['text amount', { amount: 'abc' }], ['too many decimals', { amount: '1.12345678901' }], ['over the cap', { amount: '99999999' }], ['unknown asset', { asset: 'DOGE' }], ['lowercase asset', { asset: 'usdc' }], ['missing reason', { note: 'x' }], ['unknown user', { userId: 'usr_nope' }], ['bad key', { idempotencyKey: 'a' }]] as const) {
  ok(`rejected: ${label}`, (await call('/api/admin/test-credit', F, 'POST', { ...body, ...patch, idempotencyKey: (patch as any).idempotencyKey ?? key() })).s >= 400)
}

// ---------- Test credit: it works and is recorded ----------
const credit = await call('/api/admin/test-credit', F, 'POST', body)
ok('founder can add test funds', credit.s === 200 && credit.d.balance === '25', credit.d.error ?? '')
const again = await call('/api/admin/test-credit', F, 'POST', body)
ok('repeating the same request does not add twice', again.d.duplicate === true && again.d.balance === '25')
ok('the balance comes from the ledger: exactly 25 USDC', (await call('/api/balances', N.token)).d.assets.find((a: any) => a.symbol === 'USDC').amount === '25')
const led = (await call(`/api/admin/naira/users/${me.id}/ledger?asset=ALL`, F)).d
const entries = led.entries ?? led.ledger ?? []
ok('exactly one confirmed credit entry exists, labelled as a test credit', entries.length === 1 && /test credit/.test(entries[0].reason) && Number(entries[0].delta ?? entries[0].amount) !== 0)
ok('the summary reflects it with the founder rate', Number((await call('/api/balance/summary', N.token)).d.crypto.usd) > 0)
ok('the user is told', JSON.stringify((await call('/api/notifications', N.token)).d).includes('Test funds added'))
const audit2 = JSON.stringify((await call('/api/admin/audit', F)).d)
ok('the credit is in the audit trail with who and why', audit2.includes('admin.test_credit') && audit2.includes('trying swaps'))
ok('the ledger is still balanced', (await call('/api/admin/naira/ledger/verify', F)).d.ok === true)

// ---------- the funded wallet can try a swap ----------
await call('/api/naira/pin', N.token, 'POST', { pin: '2580' }).catch(() => {})
await call('/api/naira/pin', N.token, 'POST', { pin: '7391' })
const sw = await call('/api/crypto/swap', N.token, 'POST', { from: 'USDC', to: 'SOL', amount: '5', idempotencyKey: key(), pin: '7391' })
ok('test funds can be swapped', sw.s === 200 && sw.d.op.status === 'completed', sw.d.error ?? '')
ok('USDC went down by exactly 5', (await call('/api/balances', N.token)).d.assets.find((a: any) => a.symbol === 'USDC').amount === '20')

// ---------- nothing edits a balance ----------
const rw = new Database('data/fintech.db')
let blocked = ''
try { rw.exec("UPDATE ledger_entries SET delta='999999999' WHERE id=(SELECT MIN(id) FROM ledger_entries)") } catch (e) { blocked = String(e) }
ok('ledger entries cannot be edited even directly in the database', blocked.includes('immutable'))
blocked = ''
try { rw.exec('DELETE FROM ledger_entries WHERE id=(SELECT MIN(id) FROM ledger_entries)') } catch (e) { blocked = String(e) }
ok('or deleted', blocked.includes('immutable'))
rw.close()
for (const p of ['/api/admin/naira/users/x/balance', '/api/balances', '/api/balance/summary']) {
  ok(`no endpoint writes a balance: PUT ${p}`, [404, 405].includes((await call(p, F, 'PUT', { amount: '1000000' })).s))
}
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`)
