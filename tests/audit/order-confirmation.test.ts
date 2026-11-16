import { describe, expect, test } from 'bun:test'
import { api, count, makeUser, PIN, tokenFor } from '../helpers'
import { createQuote, price } from '../../server/assets'
import { run } from '../../server/db'

const dest = '0x4674A1b673b4A9e682888d10a52509b6b88123C2'
const buyQuote = async (userId: string, amount = '2000') => (await createQuote(userId, await price('buy', 'USDC', amount))).id
const sellQuote = async (userId: string) => (await createQuote(userId, await price('sell', 'USDC', '5'))).id

describe('extra confirmation rules apply to every order endpoint', () => {
  test('a buy sent to an external address needs the PIN even when it is not paid from the wallet', async () => {
    const u = await makeUser({ pin: true })
    for (const path of ['/api/orders', '/api/crypto/buy', '/api/p2p/naira-to-crypto']) {
      const body = { quoteId: await buyQuote(u.id), idempotencyKey: `k-ext-${path.length}-${Math.random()}`.padEnd(12, 'x'), funding: 'bank_transfer', destAddress: dest }
      const r = await api('POST', path, { token: await tokenFor(u), body })
      expect(r.status).toBe(400) // the PIN is mandatory here, so a missing PIN is refused before any order exists
    }
    expect(await count('SELECT COUNT(*) c FROM orders WHERE user_id=?', u.id)).toBe(0)
  })

  test('a wrong PIN is refused and the right PIN lets the external buy through', async () => {
    const u = await makeUser({ pin: true })
    const bad = await api('POST', '/api/p2p/naira-to-crypto', { token: await tokenFor(u), body: { quoteId: await buyQuote(u.id), idempotencyKey: 'k-ext-badpin-01', funding: 'bank_transfer', destAddress: dest, pin: '1357' } })
    expect(bad.status).toBe(401)
    const ok = await api('POST', '/api/p2p/naira-to-crypto', { token: await tokenFor(u), body: { quoteId: await buyQuote(u.id), idempotencyKey: 'k-ext-goodpin-1', funding: 'bank_transfer', destAddress: dest, pin: PIN } })
    expect(ok.status).toBe(200)
  })

  test('a sell paid out to a bank needs the PIN', async () => {
    const u = await makeUser({ pin: true })
    const r = await api('POST', '/api/p2p/crypto-to-naira', { token: await tokenFor(u), body: { quoteId: await sellQuote(u.id), idempotencyKey: 'k-bank-nopin-01', payoutType: 'bank', bankAccountId: 'none' } })
    expect(r.status).toBe(400)
    expect(await count('SELECT COUNT(*) c FROM orders WHERE user_id=?', u.id)).toBe(0)
  })

  test('large orders need KYC tier 2 and an account older than a day', async () => {
    await run("UPDATE settings SET value='100000' WHERE key='large_flag_kobo'") // NGN 1,000 so a normal test order counts as large
    try {
      const tier1 = await makeUser({ pin: true, kyc: 1 })
      const a = await api('POST', '/api/crypto/buy', { token: await tokenFor(tier1), body: { quoteId: await buyQuote(tier1.id), idempotencyKey: 'k-large-tier1-01', funding: 'bank_transfer', pin: PIN } })
      expect(a.status).toBe(403)
      const fresh = await makeUser({ pin: true, kyc: 2 })
      const b = await api('POST', '/api/crypto/buy', { token: await tokenFor(fresh), body: { quoteId: await buyQuote(fresh.id), idempotencyKey: 'k-large-new-0001', funding: 'bank_transfer', pin: PIN } })
      expect(b.status).toBe(403)
      await run('UPDATE users SET created_at=? WHERE id=?', Date.now() - 2 * 86_400_000, fresh.id)
      const c = await api('POST', '/api/crypto/buy', { token: await tokenFor(fresh), body: { quoteId: await buyQuote(fresh.id), idempotencyKey: 'k-large-old-0001', funding: 'bank_transfer', pin: PIN } })
      expect(c.status).toBe(200)
    } finally {
      await run("UPDATE settings SET value='100000000' WHERE key='large_flag_kobo'")
    }
  })
})
