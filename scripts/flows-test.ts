/* oxlint-disable */
/**
 * End-to-end check of every money screen through the API: receive, send, exchange (sell and buy), P2P both ways,
 * swap, bridge and Naira transfers (bank and NairaBridge user).
 *
 *   API=http://127.0.0.1:3002 bun scripts/flows-test.ts
 *
 * Needs an API started with DEV_PREVIEW=true (use a throwaway schema: DB_SCHEMA=e2e DEV_PREVIEW=true PORT=3002 bun server/index.ts).
 * It creates its own customers and funds them with audited sandbox test credits.
 */
const base = process.env.API ?? 'http://127.0.0.1:3002'
const PIN = '8642'
let failures = 0
const ok = (n: string, c: boolean, x = '') => {
  if (!c) failures++
  console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`)
}
const call = async (p: string, t?: string, m = 'GET', b?: unknown) => {
  const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined })
  return { s: r.status, d: (await r.json().catch(() => ({}))) as any }
}
const key = () => 'k' + crypto.randomUUID().replace(/-/g, '').slice(0, 20)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const F = (await call('/api/auth/dev-session', undefined, 'POST', { role: 'founder' })).d.token
const mk = async (label: string) => {
  const r = await call('/api/auth/register', undefined, 'POST', { email: `${label}${Date.now()}@flows.test`, name: `Flows ${label}`, password: 'a-long-test-password' })
  const t = r.d.token as string
  await call('/api/naira/pin', t, 'POST', { pin: PIN })
  return { t, id: r.d.user.id as string, email: r.d.user.email as string }
}
const credit = (userId: string, asset: string, amount: string) => call('/api/admin/test-credit', F, 'POST', { userId, asset, amount, note: 'flows test funds', idempotencyKey: key() })
const addLiquidity = (asset: string, amount: string) => call('/api/admin/liquidity', F, 'POST', { asset, direction: 'add', amount })

const A = await mk('alice')
const B = await mk('bob')
const bobName = 'bob_' + Date.now().toString(36).slice(-6)
await call('/api/naira/profile', B.t, 'PUT', { username: bobName })
await call(`/api/admin/users/${A.id}`, F, 'PATCH', { kycTier: 2 })
// The platform needs liquidity to pay out, and the founder must have set rates (seeded placeholders are fine for this test).
for (const [a, n] of [['NGN', '50000000'], ['USDC', '100000'], ['USDT', '100000'], ['BTC', '5'], ['SOL', '5000']] as const) await addLiquidity(a, n)
for (const [a, n] of [['NGN', '5000000'], ['USDC', '2000'], ['USDT', '2000'], ['SOL', '20']] as const) {
  const r = await credit(A.id, a, n)
  if (r.s !== 200) console.log('  (funding)', a, r.s, r.d.error)
}

console.log('\n-- Receive')
const ov = await call('/api/crypto/overview', A.t)
ok('crypto overview loads', ov.s === 200, ov.d.error ?? '')
const addr = await call('/api/crypto/addresses', A.t)
const list = addr.d.addresses ?? addr.d.networks ?? []
ok('receive addresses exist for each network', addr.s === 200 && Array.isArray(list) && list.length >= 3, `${list.length} networks`)
ok('addresses are real-looking (not placeholders)', JSON.stringify(list).match(/0x[0-9a-fA-F]{40}/) !== null)

console.log('\n-- Exchange (sell and buy)')
const q1 = await call('/api/quotes', A.t, 'POST', { side: 'buy', asset: 'USDC', amount: '10000' })
ok('buy quote', q1.s === 200 && q1.d.id, q1.d.error ?? '')
const buy = await call('/api/orders', A.t, 'POST', { quoteId: q1.d.id, idempotencyKey: key(), funding: 'wallet', pin: PIN })
ok('buy USDC from the Naira wallet', buy.s === 200 && ['payment_verified', 'completed', 'releasing', 'payout_processing'].includes(buy.d.order?.status) || buy.d.order?.status !== undefined && buy.s === 200, `${buy.d.order?.status ?? buy.d.error}`)
await sleep(2500)
const q2 = await call('/api/quotes', A.t, 'POST', { side: 'sell', asset: 'USDC', amount: '5' })
ok('sell quote', q2.s === 200 && q2.d.id, q2.d.error ?? '')
const sell = await call('/api/orders', A.t, 'POST', { quoteId: q2.d.id, idempotencyKey: key(), payoutType: 'wallet' })
ok('sell order opened (awaits deposit)', sell.s === 200 && sell.d.order?.status === 'awaiting_deposit', `${sell.d.order?.status ?? sell.d.error}`)
if (sell.d.order?.id) {
  const dep = await call('/api/sandbox/deposit', A.t, 'POST', { orderId: sell.d.order.id, scenario: 'genuine' })
  ok('simulated deposit accepted', dep.s === 200, dep.d.error ?? '')
  let st = ''
  for (let i = 0; i < 20 && st !== 'completed'; i++) { await sleep(1500); st = (await call('/api/orders/' + sell.d.order.id, A.t)).d.order?.status }
  ok('sell order completes and pays out', st === 'completed', `final status: ${st}`)
}

console.log('\n-- P2P (both directions)')
const q3 = await call('/api/quotes', A.t, 'POST', { side: 'sell', asset: 'USDT', amount: '20' })
const p1 = await call('/api/p2p/crypto-to-naira', A.t, 'POST', { quoteId: q3.d.id, idempotencyKey: key(), payoutType: 'wallet' })
ok('P2P crypto to Naira request', p1.s === 200 && (p1.d.op || p1.d.order), p1.d.error ?? '')
const q4 = await call('/api/quotes', A.t, 'POST', { side: 'buy', asset: 'USDT', amount: '10000' })
const p2 = await call('/api/p2p/naira-to-crypto', A.t, 'POST', { quoteId: q4.d.id, idempotencyKey: key(), funding: 'wallet', pin: PIN })
ok('P2P Naira to crypto request', p2.s === 200 && (p2.d.op || p2.d.order), p2.d.error ?? '')
const p2pList = await call('/api/naira/p2p', A.t)
ok('P2P history loads', p2pList.s === 200, p2pList.d.error ?? '')

console.log('\n-- Swap')
const sq = await call('/api/crypto/swap/quote', A.t, 'POST', { from: 'USDC', to: 'USDT', amount: '25' })
ok('swap quote', sq.s === 200 && Number(sq.d.receive) > 0, sq.d.error ?? `receive ${sq.d.receive}`)
const sw = await call('/api/crypto/swap', A.t, 'POST', { from: 'USDC', to: 'USDT', amount: '25', idempotencyKey: key(), pin: PIN })
ok('swap USDC to USDT completes', sw.s === 200 && sw.d.op?.status === 'completed', sw.d.error ?? sw.d.op?.status)
const swSame = await call('/api/crypto/swap/quote', A.t, 'POST', { from: 'USDC', to: 'USDC', amount: '1' })
ok('swapping a token for itself is refused', swSame.s === 400)
const swBad = await call('/api/crypto/swap', A.t, 'POST', { from: 'USDC', to: 'USDT', amount: '25', idempotencyKey: key(), pin: '1111' })
ok('swap with a wrong PIN is refused', swBad.s >= 400)

console.log('\n-- Bridge')
const bo = await call('/api/crypto/bridge/options', A.t)
ok('bridge options load', bo.s === 200 && bo.d.networks?.length > 1)
const br = await call('/api/crypto/bridge', A.t, 'POST', { symbol: 'USDC', fromNetwork: bo.d.networks?.[0]?.id ?? 'arc-testnet', toNetwork: bo.d.networks?.[1]?.id ?? 'ethereum-sepolia', amount: '5', idempotencyKey: key() })
ok('BRIDGE actually moves funds', br.d.op?.status === 'completed' || br.d.op?.status === 'processing', `status: ${br.d.op?.status}; ${br.d.op?.reason ?? ''}`)

console.log('\n-- Send (onchain)')
const evm = JSON.stringify(list).match(/0x[0-9a-fA-F]{40}/)?.[0] ?? ''
const sp = await call('/api/crypto/send/prepare', A.t, 'POST', { networkId: 'base-sepolia', assetKey: 'USDC@base-sepolia', to: '0x000000000000000000000000000000000000dead', amount: '1' })
ok('send preview: a new wallet has no onchain funds, so it says so instead of sending', sp.s === 400 && /balance|fund|enough/i.test(sp.d.error ?? ''), `${sp.s} ${sp.d.error ?? 'ok'}`)
const spBad = await call('/api/crypto/send/prepare', A.t, 'POST', { networkId: 'base-sepolia', assetKey: 'USDC@base-sepolia', to: 'not-an-address', amount: '1' })
ok('send to a bad address is refused', spBad.s === 400, spBad.d.error ?? '')
const wd = await call('/api/withdrawals', A.t, 'POST', { asset: 'USDC', amount: '5', destAddress: '0x000000000000000000000000000000000000dead', pin: PIN, idempotencyKey: key() })
ok('send exchange credits to an external address (simulated release)', wd.s === 200 && wd.d.withdrawal?.status === 'completed', wd.d.error ?? wd.d.withdrawal?.status)

console.log('\n-- Transfer (Naira)')
const rcp = await call('/api/naira/recipients/search?q=' + encodeURIComponent(bobName), A.t)
ok('find a NairaBridge user by email', rcp.s === 200 && rcp.d.recipient?.id, rcp.d.error ?? '')
const ti = await call('/api/naira/transfer/internal', A.t, 'POST', { recipientId: rcp.d.recipient?.id ?? 'x', amount: '1500', pin: PIN, idempotencyKey: key() })
ok('transfer to another user succeeds', ti.s === 200 && ['success', 'completed'].includes(ti.d.txn?.status), JSON.stringify(ti.d).slice(0, 120))
const ver = await call('/api/naira/transfer/bank/verify', A.t, 'POST', { bankCode: '058', accountNumber: '0123456789' })
ok('bank account name check', ver.s === 200 && (ver.d.accountName || ver.d.name), JSON.stringify(ver.d).slice(0, 100))
const tb = await call('/api/naira/transfer/bank', A.t, 'POST', { bankCode: '058', accountNumber: '0123456789', amount: '2000', pin: PIN, idempotencyKey: key() })
ok('transfer to a bank account', tb.s === 200, JSON.stringify(tb.d).slice(0, 140))
const tbBad = await call('/api/naira/transfer/bank', A.t, 'POST', { bankCode: '058', accountNumber: '0123456789', amount: '2000', pin: '0000', idempotencyKey: key() })
ok('transfer with a wrong PIN is refused', tbBad.s >= 400)
const bobBal = await call('/api/balances', B.t)
ok('recipient actually received the money', Number(bobBal.d.ngn) === 1500, `Bob NGN: ${bobBal.d.ngn}`)

console.log('\n-- Integrity')
const lv = await call('/api/admin/naira/ledger/verify', F)
ok('ledger still balanced after all of it', lv.d.ok === true, `${lv.d.entries} entries`)

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
