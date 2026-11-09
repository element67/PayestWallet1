/* oxlint-disable */
/** Wallet checks against the running API: bun scripts/wallet-test.ts */
const base = process.env.API ?? 'http://127.0.0.1:3001'
let failures = 0
const ok = (name: string, cond: boolean, extra = '') => {
  if (!cond) failures++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
}
async function call(path: string, token?: string, method = 'GET', body?: unknown) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { s: res.status, d: (await res.json()) as any, raw: '' }
}
const dev = async (role: string) => (await call('/api/auth/dev-session', undefined, 'POST', { role })).d.token as string
const user = await dev('user')
const founder = await dev('founder')

const a = await call('/api/crypto/refresh', user, 'POST')
ok('overview loads', a.s === 200)
const ad = a.d.addresses
ok('EVM address valid', /^0x[0-9a-fA-F]{40}$/.test(ad.evm), ad.evm)
ok('Solana address valid base58', /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(ad.solana), ad.solana)
ok('Bitcoin testnet address valid bech32', /^tb1q[a-z0-9]{38,}$/.test(ad.bitcoin), ad.bitcoin)
const b = await call('/api/crypto/overview', user)
ok('addresses stable across calls', JSON.stringify(b.d.addresses) === JSON.stringify(ad))
const failed = a.d.assets.filter((x: any) => x.error)
ok('all balance reads succeeded', failed.length === 0, failed.map((x: any) => `${x.key}: ${x.error}`).join(' | '))
ok('balances are real reads (verifiedAt set)', a.d.assets.every((x: any) => x.error || x.verifiedAt))
ok('USDT listed as unavailable, no balance', a.d.unavailable.some((u: any) => u.symbol === 'USDT') && !a.d.assets.some((x: any) => x.symbol === 'USDT'))
ok('no seed material in overview', !/mnemonic|seed|private/i.test(JSON.stringify(a.d)))

// the old per-asset hide/add feature is gone
const gone = await call(`/api/crypto/assets/${encodeURIComponent('ETH@base-sepolia')}`, user, 'PUT', { visible: false })
ok('no asset display-toggle endpoint remains', gone.s === 404)
ok('assets carry no visibility flag; all supported assets are listed', a.d.assets.length >= 5 && a.d.assets.every((x: any) => !('visible' in x)))
ok('every listed asset has a real or pending balance reading, never a made-up one', a.d.assets.every((x: any) => x.balance === null || /^\d+(\.\d+)?$/.test(x.balance)))

// send validation
const prep = (to: string, amount = '0.01', assetKey = 'USDC@arc-testnet', networkId = 'arc-testnet') => call('/api/crypto/send/prepare', user, 'POST', { networkId, assetKey, to, amount })
let r = await prep('not-an-address')
ok('rejects malformed address', r.s === 400, r.d.error)
r = await prep('0x' + 'A'.repeat(39) + 'b')
ok('rejects bad checksum', r.s === 400, r.d.error)
r = await prep('0x0000000000000000000000000000000000000000')
ok('rejects zero address', r.s === 400, r.d.error)
r = await prep('0x3600000000000000000000000000000000000000')
ok('rejects token contract as destination', r.s === 400, r.d.error)
r = await prep(ad.evm, '0.01', 'USDC@base-sepolia', 'arc-testnet')
ok('rejects asset/network mismatch', r.s === 400, r.d.error)
r = await prep(ad.solana, '0.01', 'SOL@solana-devnet', 'solana-devnet')
ok('Solana send is honestly disabled', r.s === 400 && /not enabled|adapter/i.test(r.d.error), r.d.error)
r = await prep('0x000000000000000000000000000000000000dEaD', '5')
ok('unfunded wallet cannot send', r.s === 400 && /Insufficient|Not enough/i.test(r.d.error), r.d.error)
r = await call('/api/crypto/send', user, 'POST', { networkId: 'arc-testnet', assetKey: 'USDC@arc-testnet', to: '0x000000000000000000000000000000000000dEaD', amount: '1', confirmToken: 'forged', expiresAt: Date.now() + 60000, idempotencyKey: 'test-forged-0001' })
ok('forged confirmation token rejected', r.s === 400, r.d.error)

// authorization
r = await call('/api/admin/wallet-config', user)
ok('customers cannot read wallet policy', r.s === 403)
r = await call('/api/admin/wallet-config', founder)
ok('founder can read wallet policy', r.s === 200)
r = await call('/api/crypto/overview')
ok('wallet requires a session', r.s === 401)

// simulated events (preview only) and AI monitoring
r = await call('/api/crypto/sandbox/simulate', user, 'POST', { kind: 'unverified_token' })
ok('simulate unverified token', r.s === 200)
r = await call('/api/crypto/sandbox/simulate', user, 'POST', { kind: 'failed_send' })
ok('simulate failed send', r.s === 200)
const txs = await call('/api/crypto/txs', user)
ok('history lists simulated events flagged as simulated', txs.d.txs.length >= 2 && txs.d.txs.every((t: any) => t.hash === null && t.simulated))
const unv = txs.d.txs.find((t: any) => t.verdict === 'unverified_token')
const det = await call(`/api/crypto/txs/${unv.id}`, user)
ok('tx detail includes agent decisions', det.s === 200 && det.d.decisions.length > 0, det.d.decisions?.[0]?.decision)
const hist = await call('/api/crypto/overview', user)
ok('unverified token never counted in balances', hist.d.assets.every((x: any) => x.symbol !== 'FAKEUSDC'))
const ag = await call('/api/admin/agent', founder)
ok('AI monitor reports wallet activity', ag.d.wallet.unverified >= 1 && ag.d.wallet.wallets >= 1, JSON.stringify({ wallets: ag.d.wallet.wallets, unverified: ag.d.wallet.unverified, failed: ag.d.wallet.failed }))
ok('AI monitor lists wallet networks', ag.d.monitors.some((m: any) => String(m.chain).startsWith('wallet:')))

// ---------- access control, persistence, server-side values, limits ----------
const email = `b${Date.now()}@test.local`
const reg = await call('/api/auth/register', undefined, 'POST', { email, name: 'User B', password: 'a-long-test-password' })
const userB = reg.d.token as string
const ovA = (await call('/api/crypto/overview', user)).d
const ovB = (await call('/api/crypto/overview', userB)).d
ok('each user gets a different wallet', ovA.addresses.evm !== ovB.addresses.evm)

// 1. Per-user isolation of wallet data
const reA = await dev('user') // a brand new session for the same user = "another device"
const seenA = (await call('/api/crypto/overview', reA)).d
ok('a new session sees the same wallet', seenA.addresses.evm === ovA.addresses.evm)
ok("another user's wallet is separate", seenA.addresses.evm !== ovB.addresses.evm)
const spoof = await call('/api/crypto/overview?userId=usr_someone_else', userB)
ok('client-sent user id is ignored', spoof.d.addresses.evm === ovB.addresses.evm)

// 2. Access control
const myTx = (await call('/api/crypto/txs', user)).d.txs[0]
ok("another user cannot open my transaction", (await call(`/api/crypto/txs/${myTx.id}`, userB)).s === 404)
ok("another user's history is separate", (await call('/api/crypto/txs', userB)).d.txs.every((t: any) => t.id !== myTx.id))
ok('userId query param is ignored on history', (await call(`/api/crypto/txs?userId=${encodeURIComponent('x')}`, userB)).d.txs.every((t: any) => t.id !== myTx.id))
for (const path of ['/api/crypto/overview', '/api/crypto/addresses', '/api/crypto/txs', '/api/crypto/limits', '/api/crypto/integrations', '/api/balances', '/api/withdrawals']) {
  ok(`401 without a session: GET ${path}`, (await call(path)).s === 401)
}
for (const [path, b] of [['/api/crypto/send/prepare', {}], ['/api/crypto/send', {}], ['/api/crypto/swap', {}], ['/api/crypto/bridge', {}], ['/api/crypto/buy', {}], ['/api/crypto/refresh', {}]] as const) {
  ok(`401 without a session: POST ${path}`, (await call(path, undefined, 'POST', b)).s === 401)
}
ok('founder routes reject customers', (await call('/api/admin/agent', userB)).s === 403)

// 3. Values are computed by the server from founder rates
const rates = (await call('/api/admin/assets', founder)).d.assets
const usdcRate = rates.find((a: any) => a.symbol === 'USDC').sellRate
const usdcRow = ovA.assets.find((x: any) => x.key === 'USDC@arc-testnet')
ok('USDC rate equals the founder sell rate', Number(usdcRow.rateNgn) === Number(usdcRate), `${usdcRow.rateNgn} vs ${usdcRate}`)
ok('values are decimal strings from the server', typeof ovA.totalValueNgn === 'string' && (usdcRow.valueNgn === null || typeof usdcRow.valueNgn === 'string'))
const tamper = await call('/api/crypto/overview', user, 'POST', { totalValueNgn: '999999999', assets: [{ key: 'USDC@arc-testnet', valueNgn: '1' }] })
ok('values cannot be set by the client (no write route)', tamper.s === 404)

// 4. One request for the Overview payload; cached
const t0 = Date.now()
const one = (await call('/api/crypto/overview', user)).d
const ms = Date.now() - t0
ok('overview has balances, assets, networks, recent activity in one response', Boolean(one.assets && one.networks && one.recentTxs && one.addresses), `${ms}ms`)
ok('cached overview is fast', ms < 400, `${ms}ms`)

// 5. Actions validate on the server
for (const id of ['swap', 'bridge', 'buy']) {
  ok(`${id}: invalid input rejected`, (await call(`/api/crypto/${id}`, user, 'POST', { amount: '-1' })).s === 400)
}
// swap, bridge, buy and sell now have working endpoints (see scripts/home-test.ts)
ok('send: amount with too many decimals rejected', (await call('/api/crypto/send/prepare', user, 'POST', { networkId: 'arc-testnet', assetKey: 'USDC@arc-testnet', to: '0x000000000000000000000000000000000000dEaD', amount: '0.1234567' })).s === 400)
ok('send: negative or text amount rejected', (await call('/api/crypto/send/prepare', user, 'POST', { networkId: 'arc-testnet', assetKey: 'USDC@arc-testnet', to: '0x000000000000000000000000000000000000dEaD', amount: 'abc' })).s === 400)

// 6. No secrets in any response
const bodies = await Promise.all(['/api/crypto/overview', '/api/crypto/addresses', '/api/crypto/txs', '/api/crypto/limits', '/api/crypto/integrations', '/api/me', '/api/config'].map(async (p) => JSON.stringify((await call(p, user)).d)))
const secretish = /mnemonic|seed phrase|private.?key|WALLET_MASTER|APP_ENCRYPTION|WEBHOOK_SECRET|_rpc_token|password_hash/i
ok('no key or secret material in wallet responses', bodies.every((b) => !secretish.test(b)))
const failedSend = await call('/api/crypto/send', user, 'POST', { networkId: 'arc-testnet', assetKey: 'USDC@arc-testnet', to: '0x000000000000000000000000000000000000dEaD', amount: '1', confirmToken: 'x', expiresAt: Date.now() + 1000, idempotencyKey: 'leak-check-0001' })
ok('error responses do not leak secrets', !secretish.test(JSON.stringify(failedSend.d)))

// rate limiting (per user): 20 parallel refreshes against a limit of 12/minute
const burst = await Promise.all(Array.from({ length: 20 }, () => call('/api/crypto/refresh', userB, 'POST')))
ok('refresh is rate limited per user', burst.some((r) => r.s === 429), `${burst.filter((r) => r.s === 429).length} of 20 blocked`)

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`)
process.exit(failures ? 1 : 0)
