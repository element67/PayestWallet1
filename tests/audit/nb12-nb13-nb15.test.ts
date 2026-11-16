import { describe, expect, test } from 'bun:test'
import { api, makeUser } from '../helpers'
import { dailyVolumeKobo } from '../../server/assets'
import { HttpError } from '../../server/auth'
import { now, run, uid } from '../../server/db'
import { assertSameOrigin, clientIp } from '../../server/http'

describe('NB-12 one daily volume across orders, swaps and withdrawals', () => {
  test('all three count toward the same total', async () => {
    const u = await makeUser()
    const t = now()
    await run("INSERT INTO orders(id,user_id,quote_id,idem_key,side,asset,crypto_amount,gross_kobo,fee_kobo,net_kobo,rate_kobo,status,mode,created_at,updated_at) VALUES (?,?,'q',?,'sell','USDC','1','1000','0','1000','1','completed','sandbox',?,?)", uid('o'), u.id, uid('i'), t, t)
    await run("INSERT INTO crypto_ops(id,reference,user_id,kind,status,asset,amount,value_kobo,idem_key,created_at,updated_at) VALUES (?,?,?,'swap','completed','USDC','1','20000',?,?,?)", uid('s'), uid('r'), u.id, uid('i'), t, t)
    await run("INSERT INTO crypto_ops(id,reference,user_id,kind,status,asset,amount,value_kobo,idem_key,created_at,updated_at) VALUES (?,?,?,'swap','failed','USDC','1','999999',?,?,?)", uid('s'), uid('r'), u.id, uid('i'), t, t)
    await run("INSERT INTO withdrawals(id,user_id,kind,asset,amount,value_kobo,status,idem_key,created_at,updated_at) VALUES (?,?,'crypto','USDC','1','300000','completed',?,?,?)", uid('w'), u.id, uid('i'), t, t)
    expect(await dailyVolumeKobo(u.id)).toBe(321_000n) // the failed swap does not count
  })
})

describe('NB-13 X-Forwarded-For is trusted only behind a configured proxy', () => {
  const h = (xff: string) => new Headers({ 'x-forwarded-for': xff })
  test('by default a spoofed header is ignored', () => {
    expect(clientIp(h('6.6.6.6'), '203.0.113.9', { trustProxy: false, hops: 1 })).toBe('203.0.113.9')
  })
  test('behind a trusted private proxy the hop from the right is used, so prepended values are ignored', () => {
    expect(clientIp(h('1.1.1.1, 2.2.2.2'), '10.0.0.5', { trustProxy: true, hops: 1 })).toBe('2.2.2.2')
    expect(clientIp(h('9.9.9.9, 1.1.1.1, 10.0.0.4'), '10.0.0.5', { trustProxy: true, hops: 2 })).toBe('1.1.1.1')
  })
  test('a public peer can never set the address, even when the proxy flag is on', () => {
    expect(clientIp(h('6.6.6.6'), '198.51.100.7', { trustProxy: true, hops: 1 })).toBe('198.51.100.7')
  })
  test('with no peer information the address is "unknown", not an attacker value', () => {
    expect(clientIp(h('6.6.6.6'), undefined, { trustProxy: false, hops: 1 })).toBe('unknown')
  })
})

describe('NB-15 the dev-session endpoint rejects cross-site requests', () => {
  const req = (site?: string) => new Request('http://localhost/x', { headers: site ? { 'sec-fetch-site': site } : {} })
  test('cross-site and same-site are refused; same-origin, direct and non-browser requests pass', () => {
    expect(() => assertSameOrigin(req('cross-site'))).toThrow(HttpError)
    expect(() => assertSameOrigin(req('same-site'))).toThrow(HttpError)
    expect(() => assertSameOrigin(req('same-origin'))).not.toThrow()
    expect(() => assertSameOrigin(req('none'))).not.toThrow()
    expect(() => assertSameOrigin(req())).not.toThrow()
  })
  test('over HTTP: a cross-site founder session request gets 403 and no token', async () => {
    const r = await api('POST', '/api/auth/dev-session', { body: { role: 'founder' }, headers: { 'sec-fetch-site': 'cross-site' } })
    expect(r.status).toBe(403)
    expect(r.json.token).toBeUndefined()
    const ok = await api('POST', '/api/auth/dev-session', { body: { role: 'user' }, headers: { 'sec-fetch-site': 'same-origin' } })
    expect(ok.status).toBe(200)
  })
})
