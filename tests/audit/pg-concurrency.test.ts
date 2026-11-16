/** Postgres runs requests side by side, so the guards that used to rely on single-threaded code are tested under real parallelism. */
import { describe, expect, test } from 'bun:test'
import { api, count, fundNgn, makeUser, PIN, tokenFor } from '../helpers'
import { createQuote, price } from '../../server/assets'
import { get } from '../../server/db'
import { InsufficientFunds, balanceOf, move, verifyLedger } from '../../server/ledger'
import { verifyPin } from '../../server/naira/wallet'
import { uid } from '../../server/db'

const settled = async (ps: Promise<unknown>[]) => (await Promise.allSettled(ps)).map((r) => r.status)

describe('parallel requests cannot beat the money guards', () => {
  test('two parallel debits that together exceed the balance: exactly one lands', async () => {
    const u = await makeUser()
    await fundNgn(u.id, 100n)
    const results = await Promise.allSettled([
      move({ from: u.id, to: 'house', asset: 'NGN', amount: 60n, reason: 'race', idem: uid('race') }),
      move({ from: u.id, to: 'house', asset: 'NGN', amount: 60n, reason: 'race', idem: uid('race') }),
    ])
    expect(results.filter((r) => r.status === 'fulfilled').length).toBe(1)
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(failed.reason).toBeInstanceOf(InsufficientFunds)
    expect(await balanceOf(u.id, 'NGN')).toBe(40n)
  })

  test('the same idempotency key applied in parallel moves the money once', async () => {
    const u = await makeUser()
    await fundNgn(u.id, 1000n)
    const idem = uid('same')
    const out = await Promise.all([1, 2, 3, 4].map(() => move({ from: u.id, to: 'house', asset: 'NGN', amount: 10n, reason: 'dupe', idem })))
    expect(out.filter((x) => x !== null).length).toBe(1)
    expect(await balanceOf(u.id, 'NGN')).toBe(990n)
  })

  test('one quote cannot become two orders', async () => {
    const u = await makeUser({ pin: true })
    await fundNgn(u.id, 10_000_000n)
    const quoteId = (await createQuote(u.id, await price('buy', 'USDC', '2000'))).id
    const token = await tokenFor(u)
    const post = (key: string) => api('POST', '/api/orders', { token, body: { quoteId, idempotencyKey: key, funding: 'wallet', pin: PIN } })
    const rs = await Promise.all([post('idem-race-0001'), post('idem-race-0002'), post('idem-race-0003')])
    expect(rs.filter((r) => r.status === 200).length).toBe(1)
    expect(await count('SELECT COUNT(*) c FROM orders WHERE user_id=?', u.id)).toBe(1)
  })

  test('the same idempotency key sent in parallel returns one order', async () => {
    const u = await makeUser({ pin: true })
    await fundNgn(u.id, 10_000_000n)
    const token = await tokenFor(u)
    const quoteId = (await createQuote(u.id, await price('buy', 'USDC', '2000'))).id
    const post = () => api('POST', '/api/orders', { token, body: { quoteId, idempotencyKey: 'idem-same-0001', funding: 'wallet', pin: PIN } })
    const rs = await Promise.all([post(), post(), post()])
    expect(rs.every((r) => r.status === 200)).toBe(true)
    expect(await count('SELECT COUNT(*) c FROM orders WHERE user_id=?', u.id)).toBe(1)
  })

  test('parallel wrong PIN guesses are all counted, so the lockout cannot be dodged', async () => {
    const u = await makeUser({ pin: true })
    await settled(['1357', '2468x', '1111', '9999', '8642', '7531', '1470'].map((p) => verifyPin(u.id, p.slice(0, 4))))
    const w = await get<{ pin_locked_until: number | null }>('SELECT pin_locked_until FROM naira_wallets WHERE user_id=?', u.id)
    expect(w?.pin_locked_until ?? 0).toBeGreaterThan(Date.now())
  })
})

describe('the ledger stays balanced while many requests run at once', () => {
  test('30 parallel moves and repeated integrity checks never disagree', async () => {
    const [a, b, c] = [await makeUser(), await makeUser(), await makeUser()]
    for (const u of [a, b, c]) await fundNgn(u.id, 10_000n)
    const users = [a.id, b.id, c.id]
    const moves = Array.from({ length: 30 }, (_, i) =>
      move({ from: users[i % 3], to: users[(i + 1) % 3], asset: 'NGN', amount: BigInt(10 + i), reason: 'stress', idem: uid('stress') }),
    )
    const checks = Array.from({ length: 8 }, async () => (await verifyLedger()).ok)
    const [, verdicts] = await Promise.all([Promise.all(moves), Promise.all(checks)])
    expect(verdicts.every(Boolean)).toBe(true)
    expect((await verifyLedger()).ok).toBe(true)
    const total = (await balanceOf(a.id, 'NGN')) + (await balanceOf(b.id, 'NGN')) + (await balanceOf(c.id, 'NGN'))
    expect(total).toBe(30_000n)
  })
})
