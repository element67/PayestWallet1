/* oxlint-disable */
/** Home dashboard, tokens, gas fees, sell/buy/P2P, swap and bridge (bun scripts/home-test.ts). PIN env = preview customer PIN. */
const base = process.env.API ?? 'http://127.0.0.1:3001'
const PIN = process.env.PIN ?? '8642'
let failures = 0
const ok = (n: string, c: boolean, x = '') => { if (!c) failures++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`) }
const call = async (p: string, t?: string, m = 'GET', b?: unknown) => {
  const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined })
  return { s: r.status, d: (await r.json().catch(() => ({}))) as any }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const key = () => 'k' + crypto.randomUUID().replace(/-/g, '').slice(0, 20)
const A = (await call('/api/auth/dev-session', undefined, 'POST', { role: 'user' })).d.token
const F = (await call('/api/auth/dev-session', undefined, 'POST', { role: 'founder' })).d.token
const reg = await call('/api/auth/register', undefined, 'POST', { email: `h${Date.now()}@test.local`, name: 'Home Test', password: 'a-long-test-password' })
const B = reg.d.token

// ---------- home ----------
ok('home needs sign-in', (await call('/api/home')).s === 401)
const h = (await call('/api/home', A)).d
ok('home lists Naira first', h.assets[0].symbol === 'NGN' && h.assets[0].kind === 'naira')
ok('home hides zero balances', h.assets.every((a: any) => a.kind === 'naira' || Number(a.amount) > 0))
ok('home carries the account number and totals', /^\d{10}$/.test(h.naira.accountNumber) && typeof h.crypto.totalValueNgn === 'string')
const hb = (await call('/api/home', B)).d
ok('a new customer only sees Naira at zero', hb.assets.length === 1 && Number(hb.naira.balance) === 0 && Number(hb.crypto.totalValueNgn) === 0)

// ---------- tokens ----------
const t0 = (await call('/api/crypto/tokens', B)).d
ok('tokens: nothing added yet, everything supported is offered', t0.mine.length === 0 && t0.more.length >= 5)
ok('tokens: USDT is shown as unavailable instead of faked', t0.unavailable.some((u: any) => u.symbol === 'USDT'))
const k1 = t0.more.find((t: any) => t.symbol === 'BTC').key
const add = await call('/api/crypto/tokens', B, 'POST', { assetKey: k1 })
ok('adding a token moves it into Your tokens with its address', add.s === 200 && add.d.mine.some((t: any) => t.key === k1 && t.address) && !add.d.more.some((t: any) => t.key === k1))
ok('adding does not create a balance', Number(add.d.mine.find((t: any) => t.key === k1).balance ?? 0) === 0)
ok('adding again is harmless', (await call('/api/crypto/tokens', B, 'POST', { assetKey: k1 })).d.mine.filter((t: any) => t.key === k1).length === 1)
ok('an unknown token is refused', (await call('/api/crypto/tokens', B, 'POST', { assetKey: 'FAKE@nowhere' })).s === 404)
ok('the choice persists and is private to the user', (await call('/api/crypto/tokens', B)).d.mine.length === 1 && (await call('/api/crypto/tokens', A)).d.mine.every((t: any) => t.key !== k1 || Number(t.balance) > 0))
ok('home still hides the added zero-balance token', (await call('/api/home', B)).d.assets.length === 1)

// ---------- gas fee per chain ----------
const q0 = (await call('/api/quotes', A, 'POST', { side: 'sell', asset: 'USDC', amount: '10' })).d
await call('/api/admin/naira/config', F, 'PUT', { gasFeeNgn: { 'arc-testnet': '12' } })
const q1 = (await call('/api/quotes', A, 'POST', { side: 'sell', asset: 'USDC', amount: '10' })).d
ok('founder gas fee is added to the quote', Number(q1.networkFeeNgn) === 12 && Math.abs(Number(q1.feeNgn) - Number(q0.feeNgn) - (12 - Number(q0.networkFeeNgn))) < 0.01, `${q0.feeNgn} -> ${q1.feeNgn}`)
ok('gas fee settings are founder-only', (await call('/api/admin/naira/config', A, 'PUT', { gasFeeNgn: { 'arc-testnet': '1' } })).s === 403)

// ---------- sell ----------
const sq = (await call('/api/quotes', A, 'POST', { side: 'sell', asset: 'USDT', amount: '5' })).d
const bq = (await call('/api/quotes', A, 'POST', { side: 'buy', asset: 'USDT', amount: '5000' })).d
ok('sell refuses a buy quote', (await call('/api/crypto/sell', A, 'POST', { quoteId: bq.id, idempotencyKey: key() })).s === 400)
ok('sell refuses someone else\'s quote', (await call('/api/crypto/sell', B, 'POST', { quoteId: sq.id, idempotencyKey: key() })).s === 404)
const si = key()
const sell = await call('/api/crypto/sell', A, 'POST', { quoteId: sq.id, idempotencyKey: si })
ok('sell creates a pending record', sell.s === 200 && sell.d.op.status === 'pending' && sell.d.op.kind === 'sell', sell.d.error ?? '')
ok('replaying a sell returns the same record', (await call('/api/crypto/sell', A, 'POST', { quoteId: sq.id, idempotencyKey: si })).d.op.id === sell.d.op.id)
const before = Number((await call('/api/naira/overview', A)).d.wallet.balance)
await call('/api/sandbox/deposit', A, 'POST', { orderId: sell.d.order.id, scenario: 'genuine' })
let st = ''
for (let i = 0; i < 40 && st !== 'completed'; i++) { await sleep(500); st = (await call('/api/crypto/ops/' + sell.d.op.id, A)).d.op.status }
ok('sell record turns completed only after verification', st === 'completed')
ok('Naira credited with the quoted net', Math.abs(Number((await call('/api/naira/overview', A)).d.wallet.balance) - before - Number(sq.netNgn)) < 0.01)

// ---------- buy and P2P ----------
const buyQ = (await call('/api/quotes', A, 'POST', { side: 'buy', asset: 'USDC', amount: '15000' })).d
ok('buy needs a PIN', (await call('/api/crypto/buy', A, 'POST', { quoteId: buyQ.id, idempotencyKey: key() })).s === 400)
const buy = await call('/api/crypto/buy', A, 'POST', { quoteId: buyQ.id, idempotencyKey: key(), pin: PIN })
ok('buy with PIN is accepted', buy.s === 200, buy.d.error ?? '')
for (let i = 0; i < 20; i++) { await sleep(500); if ((await call('/api/crypto/ops/' + buy.d.op.id, A)).d.op.status === 'completed') break }
ok('buy completes and records the crypto amount', (await call('/api/crypto/ops/' + buy.d.op.id, A)).d.op.status === 'completed')
const h2 = (await call('/api/home', A)).d
ok('bought crypto appears on home as an exchange-wallet row', h2.assets.some((a: any) => a.kind === 'credit' && a.symbol === 'USDC') && h2.crypto.includesCredits === true)
const p2q = (await call('/api/quotes', A, 'POST', { side: 'buy', asset: 'USDC', amount: '5000' })).d
const p2 = await call('/api/p2p/naira-to-crypto', A, 'POST', { quoteId: p2q.id, idempotencyKey: key(), pin: PIN })
ok('P2P Naira to crypto works', p2.s === 200 && p2.d.op.kind === 'p2p')
const p3q = (await call('/api/quotes', A, 'POST', { side: 'sell', asset: 'SOL', amount: '0.05' })).d
const p3 = await call('/api/p2p/crypto-to-naira', A, 'POST', { quoteId: p3q.id, idempotencyKey: key() })
ok('P2P crypto to Naira works', p3.s === 200 && p3.d.op.kind === 'p2p')
ok('P2P endpoints reject the wrong direction', (await call('/api/p2p/crypto-to-naira', A, 'POST', { quoteId: p2q.id, idempotencyKey: key() })).s === 400)

for (let i = 0; i < 20; i++) { await sleep(500); if ((await call('/api/crypto/ops/' + p2.d.op.id, A)).d.op.status === 'completed') break }
// ---------- swap ----------
const sw = { from: 'USDC', to: 'SOL', amount: '2' }
const swq = await call('/api/crypto/swap/quote', A, 'POST', sw)
ok('swap quote shows the amount received, rates and fees', swq.s === 200 && Number(swq.d.receive) > 0 && swq.d.networkFeeNgn !== undefined)
ok('swapping an asset for itself is refused', (await call('/api/crypto/swap/quote', A, 'POST', { from: 'USDC', to: 'USDC', amount: '1' })).s === 400)
ok('swap needs a PIN', (await call('/api/crypto/swap', A, 'POST', { ...sw, idempotencyKey: key() })).s === 400)
ok('swap refuses a wrong PIN', (await call('/api/crypto/swap', A, 'POST', { ...sw, idempotencyKey: key(), pin: '0001' })).s === 401)
const bal = async (sym: string) => Number((await call('/api/balances', A)).d.assets.find((a: any) => a.symbol === sym).amount)
const [u0, s0] = [await bal('USDC'), await bal('SOL')]
const si2 = key()
const swap = await call('/api/crypto/swap', A, 'POST', { ...sw, idempotencyKey: si2, pin: PIN })
ok('swap completes instantly with a record', swap.s === 200 && swap.d.op.status === 'completed' && swap.d.op.kind === 'swap', swap.d.error ?? '')
const [u1, s1] = [await bal('USDC'), await bal('SOL')]
ok('swap debits one asset and credits the other exactly', Math.abs(u0 - u1 - 2) < 1e-6 && Math.abs(s1 - s0 - Number(swap.d.op.resultAmount)) < 1e-9)
await call('/api/crypto/swap', A, 'POST', { ...sw, idempotencyKey: si2, pin: PIN })
ok('retrying the same swap does not swap twice', Math.abs((await bal('USDC')) - u1) < 1e-9)
ok('swapping more than you hold is refused', (await call('/api/crypto/swap', A, 'POST', { from: 'USDC', to: 'SOL', amount: '999999', idempotencyKey: key(), pin: PIN })).s >= 400)
ok('a customer with nothing cannot swap', (await call('/api/crypto/swap', B, 'POST', { ...sw, idempotencyKey: key(), pin: '1357' })).s >= 400)

// ---------- bridge ----------
const br = await call('/api/crypto/bridge', A, 'POST', { symbol: 'USDC', fromNetwork: 'arc-testnet', toNetwork: 'base-sepolia', amount: '1', idempotencyKey: key() })
ok('bridge validates and records a failed attempt honestly (no provider)', br.s === 200 && br.d.op.status === 'failed' && /provider/i.test(br.d.op.reason))
ok('bridge rejects the same network', (await call('/api/crypto/bridge', A, 'POST', { symbol: 'USDC', fromNetwork: 'arc-testnet', toNetwork: 'arc-testnet', amount: '1', idempotencyKey: key() })).s === 400)
ok('bridge rejects an asset missing on the target network', (await call('/api/crypto/bridge', A, 'POST', { symbol: 'SOL', fromNetwork: 'solana-devnet', toNetwork: 'base-sepolia', amount: '1', idempotencyKey: key() })).s === 400)
ok('bridge rejects a bad amount', (await call('/api/crypto/bridge', A, 'POST', { symbol: 'USDC', fromNetwork: 'arc-testnet', toNetwork: 'base-sepolia', amount: '-1', idempotencyKey: key() })).s === 400)

// ---------- access ----------
ok('another customer cannot read the record', (await call('/api/crypto/ops/' + swap.d.op.id, B)).s === 404)
ok('records need sign-in', (await call('/api/crypto/ops')).s === 401)
const ops = (await call('/api/crypto/ops', A)).d.ops
ok('history lists every kind with a live status', ['sell', 'buy', 'p2p', 'swap', 'bridge'].every((k) => ops.some((o: any) => o.kind === k)) && ops.every((o: any) => ['pending', 'verifying', 'completed', 'failed'].includes(o.status)))
await call('/api/admin/naira/config', F, 'PUT', { gasFeeNgn: { 'arc-testnet': '5' } })
const lv = (await call('/api/admin/naira/ledger/verify', F)).d
ok('ledger still balanced', lv.ok === true, `${lv.entries} entries`)
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`)
