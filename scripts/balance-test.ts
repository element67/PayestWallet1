/* oxlint-disable */
/** Home balance card backend: bun scripts/balance-test.ts */
const base = process.env.API ?? 'http://127.0.0.1:3001'
let failures = 0
const ok = (n: string, c: boolean, x = '') => { if (!c) failures++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`) }
const call = async (p: string, t?: string, m = 'GET', b?: unknown) => {
  const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined })
  return { s: r.status, d: (await r.json().catch(() => ({}))) as any }
}
const kobo = (s: string) => { const [w, f = ''] = s.split('.'); return BigInt(w) * 100n + BigInt((f + '00').slice(0, 2)) }
const A = (await call('/api/auth/dev-session', undefined, 'POST', { role: 'user' })).d.token
const F = (await call('/api/auth/dev-session', undefined, 'POST', { role: 'founder' })).d.token
const B = (await call('/api/auth/register', undefined, 'POST', { email: `bal${Date.now()}@test.local`, name: 'Bal Test', password: 'a-long-test-password' })).d.token

// ---------- security ----------
ok('summary requires a session', (await call('/api/balance/summary')).s === 401)
ok('a made-up session is refused', (await call('/api/balance/summary', 'not-a-real-token')).s === 401)
ok('preference needs a session', (await call('/api/me/preferences', undefined, 'PUT', { cryptoCurrency: 'NGN' })).s === 401)
const audit = (await call('/api/admin/audit', F)).d
const logs = JSON.stringify(audit)
ok('unauthorized requests are written to the audit log', logs.includes('security.request_denied') && logs.includes('/api/balance/summary'))
const cfg = await fetch(base + '/api/config').then((r) => r.text())
ok('the public config no longer exposes the vault address', !('vaultAddress' in JSON.parse(cfg)) && typeof JSON.parse(cfg).vaultConfigured === 'boolean')

// ---------- shape and math ----------
const s = (await call('/api/balance/summary', A)).d
ok('summary has crypto USD and NGN, Naira, rate and timestamp', ['usd', 'ngn'].every((k) => typeof s.crypto[k] === 'string') && typeof s.naira.balance === 'string' && typeof s.rate.ngnPerUsd === 'string' && typeof s.asOf === 'number' && Math.abs(Date.now() - s.asOf) < 5000)
ok('crypto is labelled: testnet and sandbox are separate components', s.crypto.testnet.label === 'Testnet, onchain' && s.crypto.sandbox.label.includes('Sandbox'))
ok('testnet + sandbox = the total (NGN, exact)', kobo(s.crypto.testnet.ngn) + kobo(s.crypto.sandbox.ngn) === kobo(s.crypto.ngn))
ok('USD is the NGN total divided by the founder rate (integer math)', kobo(s.crypto.usd) === (kobo(s.crypto.ngn) * 100n) / kobo(s.rate.ngnPerUsd))
const assets = (await call('/api/admin/assets', F)).d
const usdc = (assets.assets ?? assets).find((a: any) => a.symbol === 'USDC')
ok('the rate used is the founder-set USDC rate', Number(s.rate.ngnPerUsd) === Number(usdc.sellRate))
const swq = (await call('/api/crypto/swap/quote', A, 'POST', { from: 'USDC', to: 'SOL', amount: '1' })).d
ok('the rate matches what the swap feature uses', Number(swq.fromRateNgn) === Number(s.rate.ngnPerUsd))
const home = (await call('/api/home', A)).d
ok('Home totals agree with the card', home.crypto.totalValueNgn === s.crypto.ngn && home.naira.balance === s.naira.balance)

// founder changes the rate -> the card follows, exactly, with an awkward rate that would break floating point
const keep = { buyRate: usdc.buyRate, sellRate: usdc.sellRate, minNgn: usdc.minNgn, maxNgn: usdc.maxNgn, enabled: true }
await call('/api/admin/assets/USDC', F, 'PUT', { ...keep, buyRate: '1500.07', sellRate: '1499.99' })
const s2 = (await call('/api/balance/summary', A)).d
ok('a new founder rate is used immediately', s2.rate.ngnPerUsd === '1499.99')
ok('USD stays exact at the new rate', kobo(s2.crypto.usd) === (kobo(s2.crypto.ngn) * 100n) / kobo('1499.99'))
await call('/api/admin/assets/USDC', F, 'PUT', keep)

// ---------- preference ----------
ok('the default display currency is USD', s.preference.cryptoCurrency === 'USD')
ok('an invalid currency is rejected', (await call('/api/me/preferences', A, 'PUT', { cryptoCurrency: 'EUR' })).s === 400)
ok('extra fields such as a user id are ignored', (await call('/api/me/preferences', B, 'PUT', { cryptoCurrency: 'NGN', userId: 'someone-else' })).s === 200)
ok('the choice is saved for that user', (await call('/api/balance/summary', B)).d.preference.cryptoCurrency === 'NGN')
const A2 = (await call('/api/auth/dev-session', undefined, 'POST', { role: 'user' })).d.token
ok('another user\'s choice is untouched', (await call('/api/balance/summary', A2)).d.preference.cryptoCurrency === 'USD')
await call('/api/me/preferences', A, 'PUT', { cryptoCurrency: 'NGN' })
const A3 = (await call('/api/auth/dev-session', undefined, 'POST', { role: 'user' })).d.token
ok('the choice survives signing in again', (await call('/api/balance/summary', A3)).d.preference.cryptoCurrency === 'NGN')
await call('/api/me/preferences', A3, 'PUT', { cryptoCurrency: 'USD' })

// ---------- ownership ----------
const sb = (await call('/api/balance/summary?userId=' + 'x', B)).d
ok('a new customer sees only their own zero balances', Number(sb.crypto.ngn) === 0 && Number(sb.naira.balance) === 0)
ok('a user id in the query string changes nothing', (await call('/api/balance/summary?userId=demo', A)).d.naira.balance === s.naira.balance)

// ---------- the pages behind the card load for the signed-in user ----------
for (const p of ['/api/crypto/overview', '/api/crypto/tokens', '/api/crypto/ops', '/api/crypto/addresses', '/api/naira/overview', '/api/naira/transactions', '/api/naira/p2p', '/api/home', '/api/assets', '/api/balances']) {
  const r = await call(p, A)
  ok(`page data loads: ${p}`, r.s === 200, String(r.s))
}
ok('no key, seed or address leaks in the summary', !/0x[0-9a-fA-F]{40}|mnemonic|private|secret/i.test(JSON.stringify(s)))

// ---------- rate limit ----------
const burst = await Promise.all(Array.from({ length: 80 }, () => call('/api/balance/summary', B)))
ok('the balance endpoint is rate limited', burst.some((r) => r.s === 429) && burst.filter((r) => r.s === 200).length <= 60)
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`)
