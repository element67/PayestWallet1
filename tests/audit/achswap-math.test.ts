import { describe, expect, test } from 'bun:test'
import { achswapConfig, amountOut, DexError, priceImpactBps } from '../../server/dex/achswap'

describe('AchSwap V2 quote math (same formula as the pair contract)', () => {
  test('matches the constant-product formula with the 0.30% fee', () => {
    // 1,000,000 in against 13,300,780 / 8,553,199 reserves (the live USDC/EURC pool, in 6-decimal units)
    const out = amountOut(1_000_000n, 13_300_780n, 8_553_199n)
    const expected = (1_000_000n * 997n * 8_553_199n) / (13_300_780n * 1000n + 1_000_000n * 997n)
    expect(out).toBe(expected)
    expect(out).toBeLessThan((1_000_000n * 8_553_199n) / 13_300_780n) // always worse than the mid price
  })

  test('the pool can never be drained: output stays below the reserve', () => {
    expect(amountOut(10n ** 30n, 1_000n, 1_000n)).toBeLessThan(1_000n)
  })

  test('empty pool or zero input gives nothing', () => {
    expect(amountOut(0n, 100n, 100n)).toBe(0n)
    expect(amountOut(10n, 0n, 100n)).toBe(0n)
    expect(amountOut(10n, 100n, 0n)).toBe(0n)
  })

  test('price impact grows with trade size', () => {
    const [rin, rout] = [13_300_780n, 8_553_199n]
    const small = priceImpactBps(10_000n, amountOut(10_000n, rin, rout), rin, rout)
    const big = priceImpactBps(5_000_000n, amountOut(5_000_000n, rin, rout), rin, rout)
    expect(big).toBeGreaterThan(small)
    expect(small).toBeLessThan(50) // a tiny trade costs little more than the 0.30% fee
  })

  test('contract addresses come from the environment and must be valid', () => {
    const saved = { ...process.env }
    try {
      delete process.env.ACHSWAP_FACTORY
      expect(() => achswapConfig()).toThrow(DexError)
      process.env.ACHSWAP_FACTORY = 'not-an-address'
      expect(() => achswapConfig()).toThrow(DexError)
      process.env.ACHSWAP_FACTORY = '0x' + '11'.repeat(20)
      process.env.ACHSWAP_ROUTER = '0x' + '22'.repeat(20)
      process.env.ACHSWAP_WRAPPED = '0x' + '33'.repeat(20)
      expect(achswapConfig().router.toLowerCase()).toBe('0x' + '22'.repeat(20))
    } finally {
      process.env = saved
    }
  })
})
