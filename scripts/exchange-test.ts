/* oxlint-disable */
/** Exchange flows with the new PIN rules (bun scripts/exchange-test.ts). Needs the PIN of the preview customer in PIN env. */
const base = process.env.API ?? 'http://127.0.0.1:3001'
const PIN = process.env.PIN ?? '8642'
let failures = 0
const ok = (n: string, c: boolean, x = '') => { if (!c) failures++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`) }
const call = async (p: string, t?: string, m = 'GET', b?: unknown) => {
  const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined })
  return { s: r.status, d: (await r.json().catch(() => ({}))) as any }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const A = (await call('/api/auth/dev-session', undefined, 'POST', { role: 'user' })).d.token
const bal = async () => Number((await call('/api/naira/overview', A)).d.wallet.balance)
const k = () => 'k' + crypto.randomUUID().replace(/-/g, '').slice(0, 20)

const q = (await call('/api/quotes', A, 'POST', { side: 'buy', asset: 'USDC', amount: '20000' })).d
const noPin = await call('/api/orders', A, 'POST', { quoteId: q.id, idempotencyKey: k(), funding: 'wallet' })
ok('buying with the Naira wallet needs a PIN', noPin.s === 400)
const wrong = await call('/api/orders', A, 'POST', { quoteId: q.id, idempotencyKey: k(), funding: 'wallet', pin: '0001' })
ok('a wrong PIN is refused', wrong.s === 401)
const before = await bal()
const idem = k()
const good = await call('/api/orders', A, 'POST', { quoteId: q.id, idempotencyKey: idem, funding: 'wallet', pin: PIN })
ok('buy order accepted with the PIN', good.s === 200, good.d.error ?? '')
for (let i = 0; i < 20; i++) { await sleep(500); if ((await call('/api/orders/' + good.d.order?.id, A)).d.order?.status === 'completed') break }
ok('crypto released and order completed', (await call('/api/orders/' + good.d.order.id, A)).d.order.status === 'completed')
ok('Naira wallet debited exactly the quoted amount', Math.abs(before - (await bal()) - Number(q.grossNgn)) < 0.01)
const replay = await call('/api/orders', A, 'POST', { quoteId: q.id, idempotencyKey: idem, funding: 'wallet', pin: PIN })
ok('replaying the same request does not charge twice', Math.abs(before - (await bal()) - Number(q.grossNgn)) < 0.01 && replay.d.order?.id === good.d.order.id)
const credits = (await call('/api/balances', A)).d.assets.find((a: any) => a.symbol === 'USDC')
ok('exchange credits are separate from the Naira wallet', Number(credits.amount) > 0)
const wd0 = await call('/api/withdrawals', A, 'POST', { idempotencyKey: k(), asset: 'USDC', amount: '1', destAddress: '0x000000000000000000000000000000000000dEaD' })
ok('sending exchange credits out needs a PIN', wd0.s === 400)
ok('Naira can no longer leave through the old withdrawal route', (await call('/api/withdrawals', A, 'POST', { idempotencyKey: k(), asset: 'NGN', amount: '1000', pin: PIN })).s === 400)
const wd = await call('/api/withdrawals', A, 'POST', { idempotencyKey: k(), asset: 'USDC', amount: '1', destAddress: '0x000000000000000000000000000000000000dEaD', pin: PIN })
ok('exchange credits can be sent out with the PIN (simulated)', wd.s === 200 && wd.d.withdrawal.status === 'completed')
const q2 = (await call('/api/quotes', A, 'POST', { side: 'buy', asset: 'USDC', amount: '10000' })).d
const bt = await call('/api/orders', A, 'POST', { quoteId: q2.id, idempotencyKey: k(), funding: 'bank_transfer' })
ok('buying by bank transfer needs no wallet PIN and waits for the payment', bt.s === 200 && bt.d.order.status === 'awaiting_payment')
const lv = (await call('/api/admin/naira/ledger/verify', (await call('/api/auth/dev-session', undefined, 'POST', { role: 'founder' })).d.token)).d
ok('ledger still balanced', lv.ok === true, `${lv.entries} entries`)
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`)
