import { describe, expect, test } from 'bun:test'
import { price } from '../../server/assets'
import { api, makeUser, tokenFor } from '../helpers'
import '../../server/routes'

describe('Naira to crypto quotes by crypto amount', () => {
  test('delivers at least the crypto asked for, and not a kobo more Naira than needed', async () => {
    const q = await price('buy', 'USDC', '10', true)
    expect(q.cryptoUnits >= 10_000_000n).toBe(true)
    expect(q.netKobo).toBe(q.grossKobo - q.feeKobo)
    // one kobo less Naira would fall short of the 10 USDC asked for
    const shorter = ((q.grossKobo - 1n) - (((q.grossKobo - 1n) * BigInt(q.feeBps) + 9_999n) / 10_000n) - q.gasKobo) * 1_000_000n / q.rateKobo
    expect(shorter < 10_000_000n).toBe(true)
  })

  test('the Naira amount path is unchanged', async () => {
    const q = await price('buy', 'USDC', '15000.00')
    expect(q.grossKobo).toBe(1_500_000n)
  })

  test('the quote route accepts a crypto amount for Naira to crypto and the sell direction is untouched', async () => {
    const u = { token: await tokenFor(await makeUser()) }
    const buy = await api('POST', '/api/quotes', { token: u.token, body: { side: 'buy', asset: 'USDC', amount: '10', unit: 'crypto' } })
    expect(buy.status).toBe(200)
    expect(Number(buy.json.cryptoAmount)).toBeGreaterThanOrEqual(10)
    const sell = await api('POST', '/api/quotes', { token: u.token, body: { side: 'sell', asset: 'USDC', amount: '10', unit: 'crypto' } })
    expect(sell.status).toBe(200)
    expect(sell.json.cryptoAmount).toBe('10')
    const bad = await api('POST', '/api/quotes', { token: u.token, body: { side: 'buy', asset: 'USDC', amount: '10', unit: 'bogus' } })
    expect(bad.status).toBe(400)
  })
})
