import { describe, expect, test } from 'bun:test'
import { api, count, fundNgn, makeUser, PIN, tokenFor } from '../helpers'
import { createQuote, price } from '../../server/assets'
import { get, run } from '../../server/db'
import { balanceOf } from '../../server/ledger'

async function buyQuote(userId: string) {
  return (await createQuote(userId, await price('buy', 'USDC', '2000'))).id
}

describe('NB-02 POST /api/orders cannot skip the PIN or the frozen-wallet check', () => {
  test('omitting `funding` on a frozen wallet is refused and nothing moves', async () => {
    const u = await makeUser({ pin: true })
    await fundNgn(u.id, 1_000_000n)
    await run("UPDATE naira_wallets SET status='frozen' WHERE user_id=?", u.id)
    const r = await api('POST', '/api/orders', { token: await tokenFor(u), body: { quoteId: await buyQuote(u.id), idempotencyKey: 'idem-frozen-0001' } })
    expect(r.status).toBe(403)
    expect(await count('SELECT COUNT(*) c FROM orders WHERE user_id=?', u.id)).toBe(0)
    expect(await balanceOf(u.id, 'NGN')).toBe(1_000_000n)
  })

  test('omitting `funding` and the PIN is refused', async () => {
    const u = await makeUser({ pin: true })
    await fundNgn(u.id, 1_000_000n)
    const r = await api('POST', '/api/orders', { token: await tokenFor(u), body: { quoteId: await buyQuote(u.id), idempotencyKey: 'idem-nopin-0001' } })
    expect(r.status).toBe(400) // pin is required to be 4 digits by the verifier
    expect(await count('SELECT COUNT(*) c FROM orders WHERE user_id=?', u.id)).toBe(0)
    expect(await balanceOf(u.id, 'NGN')).toBe(1_000_000n)
  })

  test('a wrong PIN is refused, the right PIN succeeds', async () => {
    const u = await makeUser({ pin: true })
    await fundNgn(u.id, 1_000_000n)
    const bad = await api('POST', '/api/orders', { token: await tokenFor(u), body: { quoteId: await buyQuote(u.id), idempotencyKey: 'idem-badpin-001', pin: '1357' } })
    expect(bad.status).toBe(401)
    const ok = await api('POST', '/api/orders', { token: await tokenFor(u), body: { quoteId: await buyQuote(u.id), idempotencyKey: 'idem-goodpin-01', pin: PIN } })
    expect(ok.status).toBe(200)
    expect((await get<{ funding: string }>('SELECT funding FROM orders WHERE user_id=?', u.id))?.funding).toBe('wallet')
  })
})
