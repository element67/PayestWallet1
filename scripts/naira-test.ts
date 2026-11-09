/* oxlint-disable */
/** End-to-end tests of the Naira wallet against the running API (bun scripts/naira-test.ts). Sandbox only. */
const base = process.env.API ?? 'http://127.0.0.1:3001'
let failures = 0
const ok = (name: string, cond: boolean, extra = '') => {
  if (!cond) failures++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
}
const call = async (p: string, t?: string, m = 'GET', b?: unknown, headers: Record<string, string> = {}) => {
  const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}), ...headers }, body: b ? JSON.stringify(b) : undefined })
  return { s: r.status, d: (await r.json().catch(() => ({}))) as any }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const dev = async (role: string, ua = 'naira-test/1.0') => (await call('/api/auth/dev-session', undefined, 'POST', { role }, { 'user-agent': ua })).d.token as string
const key = () => 'k' + crypto.randomUUID().replace(/-/g, '').slice(0, 20)
const num = (s: string) => Number(s)
const waitTxn = async (t: string, id: string, want: string[], ms = 15000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const r = await call('/api/naira/transactions/' + id, t)
    if (want.includes(r.d.transaction?.status)) return r.d.transaction
    await sleep(500)
  }
  return (await call('/api/naira/transactions/' + id, t)).d.transaction
}
const bal = async (t: string) => num((await call('/api/naira/overview', t)).d.wallet.balance)

const A = await dev('user')
const F = await dev('founder')
const origVel = { velocityBlock: 15, velocityFlag: 8 }
await call('/api/admin/settings', F, 'PUT', { dailyLimitTier2Ngn: '100000000' }) // the exchange's own 24h cap also fills up over repeated runs
await call('/api/admin/naira/config', F, 'PUT', { velocityBlock: 1000, velocityFlag: 1000, reviewThreshold: '3000000', dailySpendLimit: '100000000' }) // this suite makes many payments in minutes
const reg = await call('/api/auth/register', undefined, 'POST', { email: `n${Date.now()}@test.local`, name: 'Tola Bello', password: 'a-long-test-password' })
const B = reg.d.token as string
const bPhone = '0803' + String(Math.floor(Math.random() * 1e7)).padStart(7, '0')
const prof = await call('/api/naira/profile', B, 'PUT', { username: 'tola' + String(Date.now()).slice(-8), phone: bPhone })
if (prof.s !== 200) console.log('profile setup failed', prof.s, prof.d)

// ---------- dashboard ----------
const ov = (await call('/api/naira/overview', A)).d
ok('overview comes from the backend', typeof ov.wallet.balance === 'string' && Array.isArray(ov.recent))
ok('unique 10-digit virtual account number', /^\d{10}$/.test(ov.wallet.account.number), ov.wallet.account.number)
ok('wallet is labelled sandbox', ov.wallet.mode === 'SANDBOX' && ov.wallet.account.sandbox === true)
ok('B has a different account number', (await call('/api/naira/overview', B)).d.wallet.account.number !== ov.wallet.account.number)

// ---------- PIN ----------
const noPin = await call('/api/naira/transfer/internal', A, 'POST', { recipientId: 'x', amount: '100', pin: '2468', idempotencyKey: key() })
ok('money movement needs a PIN to exist', [428, 404].includes(noPin.s))
ok('weak PIN rejected', (await call('/api/naira/pin', A, 'POST', { pin: '1234' })).s === 400)
ok('non-numeric PIN rejected', (await call('/api/naira/pin', A, 'POST', { pin: 'abcd' })).s === 400)
let pinA = '2468'
const setA = await call('/api/naira/pin', A, 'POST', { pin: pinA })
if (setA.s !== 200) { // an earlier run already set it; reset through the one-time code
  await call('/api/naira/pin/reset/request', A, 'POST')
  const otp = /(\d{6})/.exec((await call('/api/notifications', A)).d.notifications.find((n: any) => n.title.includes('PIN reset code'))?.body ?? '')?.[1]
  ok('PIN reset with one-time code', (await call('/api/naira/pin/reset/confirm', A, 'POST', { otp, pin: pinA })).s === 200)
}
await call('/api/naira/pin', B, 'POST', { pin: '1357' })
ok('PIN is never returned', !JSON.stringify((await call('/api/naira/overview', A)).d).match(/pin_hash|argon2/i))

// ---------- fund wallet: P2P only ----------
const fund = (await call('/api/naira/fund/options', A)).d
ok('funding lists exactly USDC, USDT, BTC, SOL', fund.assets.map((a: any) => a.symbol).join() === 'USDC,USDT,BTC,SOL' && fund.method === 'p2p')
ok('testnet / simulated chains are labelled', fund.assets.every((a: any) => a.testnet && a.chainMode))
ok('no sandbox top-up route remains', (await call('/api/sandbox/topup', A, 'POST', { amount: '1000' })).s === 404)
const fundOrder = async (asset: string, amount: string, scenario: string, token = A) => {
  const q = (await call('/api/quotes', token, 'POST', { side: 'sell', asset, amount })).d
  const o = (await call('/api/orders', token, 'POST', { quoteId: q.id, idempotencyKey: key(), payoutType: 'wallet' })).d.order
  await call('/api/sandbox/deposit', token, 'POST', { orderId: o.id, scenario })
  return { q, o }
}
let before = await bal(A)
const g = await fundOrder('USDT', '10', 'genuine')
for (let i = 0; i < 30; i++) { await sleep(500); if ((await call('/api/orders/' + g.o.id, A)).d.order.status === 'completed') break }
const afterG = await bal(A)
ok('verified deposit credits the wallet by the quoted Naira amount', Math.abs(afterG - before - num(g.q.netNgn)) < 0.01, `+${(afterG - before).toFixed(2)} vs ${g.q.netNgn}`)
const p2p = (await call('/api/naira/p2p', A)).d.orders.find((p: any) => p.orderId === g.o.id)
ok('P2P order is confirmed and linked to a receipt', p2p?.status === 'confirmed' && p2p.transactionId)
const rcpt = (await call('/api/naira/transactions/' + p2p.transactionId, A)).d.transaction
ok('P2P receipt has asset, rate and chain mode', rcpt.type === 'p2p_deposit' && rcpt.meta.asset === 'USDT' && rcpt.meta.simulatedChain === true)
before = await bal(A)
const dupe = await fundOrder('SOL', '0.05', 'duplicate')
await sleep(9000)
const afterD = await bal(A)
ok('duplicate deposit report credits once', Math.abs(afterD - before - num(dupe.q.netNgn)) < 0.01, `+${(afterD - before).toFixed(2)} vs ${dupe.q.netNgn}`)
before = await bal(A)
const fake = await fundOrder('USDT', '5', 'fake_token')
await sleep(5000)
ok('fake token never credits', (await bal(A)) === before)
const under = await fundOrder('USDT', '5', 'underpay')
await sleep(4000)
ok('underpayment never credits', (await bal(A)) === before)
const stranger = await call('/api/sandbox/deposit', B, 'POST', { orderId: g.o.id, scenario: 'genuine' })
ok("another user cannot act on my deposit order", [403, 404].includes(stranger.s))
before = await bal(A)
const drop = await fundOrder('BTC', '0.0005', 'dropped')
await sleep(12000)
ok('dropped deposit is reversed through the ledger', Math.abs((await bal(A)) - before) < 0.01, `${before} -> ${await bal(A)}`)
const dropTxn = (await call('/api/naira/p2p', A)).d.orders.find((p: any) => p.orderId === drop.o.id)
ok('dropped P2P order is marked failed', dropTxn?.status === 'failed')

// ---------- bank transfer ----------
const banks = (await call('/api/naira/config', A)).d.banks
ok('bank list available', banks.length >= 5)
ok('account-name verification works', (await call('/api/naira/transfer/bank/verify', A, 'POST', { bankCode: '058', accountNumber: '0123456789' })).d.accountName?.length > 3)
ok('unknown account is rejected', (await call('/api/naira/transfer/bank/verify', A, 'POST', { bankCode: '058', accountNumber: '0123450000' })).s === 404)
ok('malformed account number rejected', (await call('/api/naira/transfer/bank/verify', A, 'POST', { bankCode: '058', accountNumber: '12' })).s === 400)
const tb = (acct: string, amount: string, pin = pinA, idk = key()) => call('/api/naira/transfer/bank', A, 'POST', { bankCode: '058', accountNumber: acct, amount, note: 'rent', pin, idempotencyKey: idk })
before = await bal(A)
const wrong = await tb('0123456789', '1000', '9999')
ok('wrong PIN is rejected with attempts left', wrong.s === 401 && wrong.d.attemptsLeft === 4)
const t1 = await tb('0123456789', '1000')
ok('transfer starts as processing', t1.s === 200 && t1.d.txn.status === 'processing')
ok('funds are reserved immediately', Math.abs((await bal(A)) - (before - 1000 - 25)) < 0.01)
const done = await waitTxn(A, t1.d.txn.id, ['success', 'failed'])
ok('transfer settles successfully after the provider confirms', done.status === 'success' && done.meta.providerRef?.startsWith('SBX-BANK'))
ok('receipt has fee, reference and counterparty', done.fee === '25' && done.reference.startsWith('NBT-') && done.counterparty.includes('••6789'))
const idk = key()
const par = await Promise.all(Array.from({ length: 6 }, () => tb('0123456789', '500', pinA, idk)))
const ids = new Set(par.filter((r) => r.s === 200).map((r) => r.d.txn.id))
ok('6 concurrent identical requests create one transaction', ids.size === 1, `${ids.size} txn`)
await waitTxn(A, [...ids][0] as string, ['success'])
before = await bal(A)
const bad = await tb('0123459999', '2000')
const failed = await waitTxn(A, bad.d.txn.id, ['failed', 'success'])
ok('provider failure marks the transaction failed', failed.status === 'failed' && failed.reversed === true)
ok('provider failure refunds the full amount through the ledger', Math.abs((await bal(A)) - before) < 0.01, `${before} -> ${await bal(A)}`)
const detail = await call('/api/admin/naira/transactions/' + bad.d.txn.id, F)
ok('reservation and reversal are both in the ledger', detail.d.ledger.some((e: any) => e.reason.startsWith('reserve')) && detail.d.ledger.some((e: any) => e.reason.startsWith('reversal')))
ok('insufficient balance rejected', (await tb('0123456789', '4000000')).s === 400)

// ---------- internal transfer ----------
const bProfile = (await call('/api/naira/overview', B)).d.wallet.profile
const found = await call('/api/naira/recipients/search?q=' + bProfile.username, A)
ok('recipient found by username', found.s === 200 && found.d.recipient.name === 'Tola Bello')
ok('recipient found by phone number', (await call('/api/naira/recipients/search?q=' + encodeURIComponent('+234' + bPhone.slice(1)), A)).d.recipient?.id === found.d.recipient.id)
ok('unknown recipient returns 404', (await call('/api/naira/recipients/search?q=nobody_here', A)).s === 404)
const bBefore = await bal(B)
before = await bal(A)
const it = await call('/api/naira/transfer/internal', A, 'POST', { recipientId: found.d.recipient.id, amount: '700.50', pin: pinA, idempotencyKey: key(), note: 'lunch' })
ok('internal transfer succeeds instantly', it.s === 200 && it.d.txn.status === 'success')
ok('sender debited and recipient credited exactly', Math.abs((await bal(A)) - (before - 700.5)) < 0.01 && Math.abs((await bal(B)) - (bBefore + 700.5)) < 0.01)
ok('recipient has a matching credit record', (await call('/api/naira/transactions?type=internal_credit', B)).d.transactions.some((t: any) => t.amount === '700.5'))
ok('cannot send to yourself', (await call('/api/naira/transfer/internal', A, 'POST', { recipientId: (await call('/api/naira/recipients/search?q=demo_founder', A)).d.recipient.id.replace(/./, 'x'), amount: '100', pin: pinA, idempotencyKey: key() })).s === 404)

// ---------- bills ----------
const topup = await fundOrder('USDT', '400', 'genuine') // enough Naira for flights and shopping, funded the only allowed way
for (let i = 0; i < 40; i++) { await sleep(500); if ((await call('/api/orders/' + topup.o.id, A)).d.order.status === 'completed') break }
const cfg = (await call('/api/naira/config', A)).d
const cat = (id: string) => cfg.categories.find((c: any) => c.id === id)
const pay = (c: string, b: any) => call(`/api/naira/bills/${c}/pay`, A, 'POST', { pin: pinA, idempotencyKey: key(), ...b })
before = await bal(A)
const air = await pay('airtime', { provider: 'mtn', customerRef: '08031234567', amount: '500' })
const airDone = await waitTxn(A, air.d.txn.id, ['success', 'failed'])
ok('airtime purchase succeeds with a bills order record', airDone.status === 'success' && airDone.bill?.category === 'airtime')
ok('airtime debits amount plus fee', Math.abs((await bal(A)) - (before - 510)) < 0.01)
const dataPkgs = cat('data').packages['*']
const dat = await pay('data', { provider: 'glo', customerRef: '08051234567', packageId: dataPkgs[1].id })
ok('data bundle priced by the server', (await waitTxn(A, dat.d.txn.id, ['success'])).amount === String(dataPkgs[1].priceKobo / 100))
ok('tampered amount on a package purchase is ignored', (await pay('data', { provider: 'glo', customerRef: '08051234567', packageId: dataPkgs[0].id, amount: '1' })).d.txn.amount === String(dataPkgs[0].priceKobo / 100))
const mv = await call('/api/naira/bills/electricity/verify', A, 'POST', { provider: 'ikeja-electric', customerRef: '45012345678', variant: 'prepaid' })
ok('meter name is verified', mv.s === 200 && mv.d.customerName)
ok('unknown meter is rejected', (await call('/api/naira/bills/electricity/verify', A, 'POST', { provider: 'ikeja-electric', customerRef: '45012340000', variant: 'prepaid' })).s === 404)
const el = await pay('electricity', { provider: 'ikeja-electric', customerRef: '45012345678', variant: 'prepaid', amount: '2000' })
const elDone = await waitTxn(A, el.d.txn.id, ['success'])
ok('prepaid electricity returns a token only after success', /^\d{4}(-\d{4}){4}$/.test(elDone.meta.token ?? ''), elDone.meta.token)
const cv = await call('/api/naira/bills/cable/verify', A, 'POST', { provider: 'dstv', customerRef: '7012345678' })
ok('smartcard is verified', cv.s === 200 && cv.d.customerName)
const cb = await pay('cable', { provider: 'dstv', customerRef: '7012345678', packageId: cat('cable').packages.dstv[0].id })
ok('cable subscription succeeds', (await waitTxn(A, cb.d.txn.id, ['success'])).status === 'success')
const wt = await pay('water', { provider: 'lagos-water-corporation', customerRef: '12345678', amount: '1500' })
ok('water payment succeeds', (await waitTxn(A, wt.d.txn.id, ['success'])).status === 'success')
before = await bal(A)
const bf = await pay('airtime', { provider: 'mtn', customerRef: '08039999999'.replace(/\d{4}$/, '9999'), amount: '500' })
const bfDone = await waitTxn(A, bf.d.txn.id, ['failed', 'success'])
ok('failed airtime is reversed automatically', bfDone.status === 'failed' && Math.abs((await bal(A)) - before) < 0.01)
ok('invalid phone number rejected by the server', (await pay('airtime', { provider: 'mtn', customerRef: '12345', amount: '500' })).s === 400)
ok('airtime below the minimum rejected', (await pay('airtime', { provider: 'mtn', customerRef: '08031234567', amount: '10' })).s === 400)
const day = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)
const fl = (await call('/api/naira/flights/search', A, 'POST', { from: 'LOS', to: 'ABV', date: day, passengers: 2 })).d
ok('flight search returns priced results (labelled simulated)', fl.outbound.length >= 3 && fl.simulated === true)
const book = await call('/api/naira/flights/book', A, 'POST', { offerId: fl.outbound[0].id, passengers: [{ firstName: 'Ada', lastName: 'Obi' }, { firstName: 'Tunde', lastName: 'Obi' }], contactPhone: '08031234567', pin: pinA, idempotencyKey: key() })
const bookDone = await waitTxn(A, book.d.txn.id, ['success'])
ok('flight booking returns a PNR and tickets after success', /^[A-Z0-9]{6}$/.test(bookDone.meta.pnr ?? '') && bookDone.meta.tickets.length === 2)
ok('flight price is computed by the server (2 passengers)', num(bookDone.amount) === fl.outbound[0].priceKobo * 2 / 100)
ok('flight to the same city rejected', (await call('/api/naira/flights/search', A, 'POST', { from: 'LOS', to: 'LOS', date: day, passengers: 1 })).s === 400)
const shop = (await call('/api/naira/shop/products', A)).d
ok('shop has categories and gift cards', shop.categories.includes('Gift cards') && shop.products.some((p: any) => p.kind === 'giftcard'))
const gift = shop.products.find((p: any) => p.kind === 'giftcard')
const co = await call('/api/naira/shop/checkout', A, 'POST', { items: [{ productId: gift.id, qty: 2 }], pin: pinA, idempotencyKey: key() })
const coDone = await waitTxn(A, co.d.txn.id, ['success'])
ok('gift card checkout returns codes after payment', coDone.meta.giftCodes?.length === 2 && num(coDone.amount) === gift.price * 2)
ok('physical item needs a delivery address', (await call('/api/naira/shop/checkout', A, 'POST', { items: [{ productId: shop.products.find((p: any) => p.kind === 'physical').id, qty: 1 }], pin: pinA, idempotencyKey: key() })).s === 400)

// ---------- limits, review, freeze ----------
await sleep(62000) // let the per-minute API rate-limit window reset between sections
const setCfg = (b: any) => call('/api/admin/naira/config', F, 'PUT', b)
const cur = (await call('/api/admin/naira/config', F)).d.config
ok('customers cannot read or change Naira admin config', (await call('/api/admin/naira/config', A)).s === 403 && (await call('/api/admin/naira/config', A, 'PUT', { billFee: '0' })).s === 403)
const limitSet = await setCfg({ dailySpendLimit: (num((await call('/api/naira/overview', A)).d.wallet.limits.spent24h) + 3000).toFixed(2) })
if (limitSet.s !== 200) console.log('limit config failed', limitSet.s, limitSet.d)
const lim = await tb('0123456789', '5000')
ok('daily limit is enforced', lim.s === 403 && lim.d.code === 'DAILY_LIMIT')
await setCfg({ dailySpendLimit: cur.dailySpendLimit, reviewThreshold: '1500' })
before = await bal(A)
const rv = await tb('0123456789', '2000')
if (!rv.d.txn) console.log('review transfer failed', rv.s, rv.d)
ok('large transfer waits for review with funds reserved', rv.d.txn?.status === 'pending_review' && Math.abs((await bal(A)) - (before - 2025)) < 0.01)
const rej = await call(`/api/admin/naira/transactions/${rv.d.txn.id}/resolve`, F, 'POST', { action: 'reject', note: 'Test rejection' })
ok('rejecting a review refunds the customer', rej.d.transaction.status === 'failed' && Math.abs((await bal(A)) - before) < 0.01)
const rv2 = await tb('0123456789', '2000')
await call(`/api/admin/naira/transactions/${rv2.d.txn.id}/resolve`, F, 'POST', { action: 'approve', note: 'Test approval' })
ok('approving a review settles the transfer', (await waitTxn(A, rv2.d.txn.id, ['success'])).status === 'success')
await setCfg({ reviewThreshold: cur.reviewThreshold })
const me = (await call('/api/admin/naira/users', F)).d.users.find((u: any) => u.username === 'demo_user')
ok('founder can list users with balances', Boolean(me) && me.balance === (await call('/api/naira/overview', A)).d.wallet.balance)
await call(`/api/admin/naira/users/${me.id}/freeze`, F, 'POST', { frozen: true, reason: 'Test freeze for review' })
const fz = await tb('0123456789', '1000')
ok('frozen wallet cannot move money', fz.s === 403 && fz.d.code === 'FROZEN')
ok('frozen wallet cannot pay from the Naira balance on the exchange', (await call('/api/orders', A, 'POST', { quoteId: 'x', idempotencyKey: key(), funding: 'wallet', pin: pinA })).s === 403)
await call(`/api/admin/naira/users/${me.id}/freeze`, F, 'POST', { frozen: false })
ok('unfrozen wallet works again', (await tb('0123456789', '1000')).s === 200)

// ---------- admin corrections ----------
const refundable = await waitTxn(A, wt.d.txn.id, ['success'])
before = await bal(A)
const rf = await call(`/api/admin/naira/transactions/${refundable.id}/resolve`, F, 'POST', { action: 'refund', note: 'Customer complaint test' })
ok('admin refund of a settled payment is a ledger reversal', rf.d.transaction.status === 'reversed' && num(rf.d.transaction.amount) + num(rf.d.transaction.fee) > 0 && Math.abs((await bal(A)) - (before + 1500 + 10)) < 0.01)
ok('refund cannot be applied twice', (await call(`/api/admin/naira/transactions/${refundable.id}/resolve`, F, 'POST', { action: 'refund', note: 'again again' })).s === 409)
const adjKey = key()
const adj = await call(`/api/admin/naira/users/${me.id}/adjust`, F, 'POST', { direction: 'credit', amount: '250', note: 'Goodwill credit test', idempotencyKey: adjKey })
const adj2 = await call(`/api/admin/naira/users/${me.id}/adjust`, F, 'POST', { direction: 'credit', amount: '250', note: 'Goodwill credit test', idempotencyKey: adjKey })
ok('adjustment is idempotent and recorded as a transaction', adj.d.applied === true && adj2.d.applied === false)
ok('no endpoint edits balances directly', (await call(`/api/admin/naira/users/${me.id}/balance`, F, 'PUT', { balance: '1' })).s === 404)
ok('adjustment needs a reason', (await call(`/api/admin/naira/users/${me.id}/adjust`, F, 'POST', { direction: 'credit', amount: '1', note: 'x', idempotencyKey: key() })).s === 400)
const sec = (await call('/api/admin/naira/security', F)).d
ok('admin actions are in the audit log', ['admin.reject', 'admin.approve', 'admin.refund', 'admin.freeze', 'admin.adjust_credit'].every((a) => sec.events.some((e: any) => e.action === a)))
ok('ledger is balanced and cached balances match entries', sec.ledger.ok === true, `${sec.ledger.entries} entries`)

// ---------- PIN lockout & reset (last: it locks the account) ----------
await sleep(62000)
for (let i = 0; i < 4; i++) await tb('0123456789', '1000', '7531')
const lock = await tb('0123456789', '1000', '7531')
ok('5th wrong PIN locks money movement', lock.s === 423 && lock.d.code === 'PIN_LOCKED')
ok('correct PIN is refused while locked', (await tb('0123456789', '1000')).s === 423)
await call('/api/naira/pin/reset/request', A, 'POST')
const otp = /(\d{6})/.exec((await call('/api/notifications', A)).d.notifications.find((n: any) => n.title.includes('PIN reset code'))?.body ?? '')?.[1]
ok('wrong reset code rejected', (await call('/api/naira/pin/reset/confirm', A, 'POST', { otp: '000000', pin: '8642' })).s === 400)
ok('reset with the one-time code unlocks and sets a new PIN', (await call('/api/naira/pin/reset/confirm', A, 'POST', { otp, pin: '8642' })).s === 200)
pinA = '8642'
ok('new PIN works after reset', (await tb('0123456789', '1000')).s === 200)

// ---------- fraud velocity ----------
await call('/api/admin/naira/config', F, 'PUT', { velocityBlock: 1 })
const vel = await tb('0123456789', '1000')
ok('rapid payments are refused by the velocity guard', vel.s === 429 && vel.d.code === 'VELOCITY')
await call('/api/admin/naira/config', F, 'PUT', { velocityBlock: origVel.velocityBlock, velocityFlag: origVel.velocityFlag })

// ---------- sessions, devices, persistence ----------
const rot = await call('/api/auth/rotate', A, 'POST')
ok('token rotation issues a new token', rot.s === 200 && rot.d.token !== A)
ok('the old token stops working', (await call('/api/naira/overview', A)).s === 401)
const A2 = rot.d.token as string
await dev('user', `Mozilla/5.0 (a brand new device ${Date.now()})`)
const alerts = (await call('/api/admin/naira/security', F)).d.alerts
ok('sign-in from a new device raises a security alert', alerts.some((a: any) => a.kind === 'new_device'))
const A3 = await dev('user')
const hist = (await call('/api/naira/transactions?limit=100', A3)).d.transactions
ok('history persists across sessions', hist.length > 15 && hist.some((t: any) => t.type === 'p2p_deposit') && hist.some((t: any) => t.type === 'bill'))
ok('another user cannot read my receipt', (await call('/api/naira/transactions/' + hist[0].id, B)).s === 404)
const txt = JSON.stringify([ov, hist, (await call('/api/naira/beneficiaries', A3)).d])
ok('no secrets in responses', !/pin_hash|account_enc|argon2|mnemonic|password_hash/i.test(txt))
for (const p of ['/api/naira/overview', '/api/naira/transactions', '/api/naira/beneficiaries', '/api/naira/fund/options']) ok(`401 without a session: ${p}`, (await call(p)).s === 401)
const burst = await Promise.all(Array.from({ length: 25 }, () => call('/api/naira/recipients/search?q=abcdef', A3)))
ok('recipient search is rate limited', burst.some((r) => r.s === 429))

// ---------- concurrency: different keys, same balance ----------
const rc = await call('/api/auth/register', undefined, 'POST', { email: `c${Date.now()}@test.local`, name: 'Race Test', password: 'a-long-test-password' })
await call('/api/naira/pin', rc.d.token, 'POST', { pin: '1357' })
const raceUser = (await call('/api/admin/naira/users', F)).d.users.find((u: any) => u.email === rc.d.user.email)
await call(`/api/admin/naira/users/${raceUser.id}/adjust`, F, 'POST', { direction: 'credit', amount: '1000', note: 'race test funding', idempotencyKey: key() })
const target = (await call('/api/naira/recipients/search?q=demo_user', rc.d.token)).d.recipient
const race = await Promise.all(Array.from({ length: 8 }, () => call('/api/naira/transfer/internal', rc.d.token, 'POST', { recipientId: target.id, amount: '400', pin: '1357', idempotencyKey: key() })))
ok('8 parallel transfers of 400 from a 1000 balance: exactly 2 succeed, never overdrawn', race.filter((r) => r.s === 200).length === 2 && (await bal(rc.d.token)) === 200)
const lv = (await call('/api/admin/naira/ledger/verify', F)).d
ok('final ledger check: balanced', lv.ok === true, `${lv.entries} entries`)
await call('/api/admin/settings', F, 'PUT', { dailyLimitTier2Ngn: '5000000' })
await call('/api/admin/naira/config', F, 'PUT', { dailySpendLimit: '5000000', velocityBlock: 15, velocityFlag: 8 }) // back to the production defaults
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`)
