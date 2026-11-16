import { beforeAll, describe, expect, test } from 'bun:test'
import { seedTokens } from '../../server/tokens/seed'
import { refreshAssets } from '../../server/wallet/networks'
import { HttpError } from '../../server/auth'
import { dexConfig, dexTokens, parseSlippage, resolveToken } from '../../server/dex/nairaswap'

describe('NairaSwap request guards', () => {
  beforeAll(async () => { await seedTokens(); await refreshAssets() })

  test('slippage is bounded to 0.01%..5%', () => {
    expect(parseSlippage(undefined)).toBe(50)
    expect(parseSlippage(500)).toBe(500)
    for (const bad of [0, -1, 501, 900, 1.5, 'abc']) expect(() => parseSlippage(bad)).toThrow(HttpError)
  })

  test('only verified registry tokens on the chosen network can be used', () => {
    expect(() => resolveToken('arc-testnet', 'FAKE@arc-testnet')).toThrow(HttpError)
    expect(() => resolveToken('arc-testnet', 'ETH@ethereum-sepolia')).toThrow(HttpError)
    expect(() => resolveToken('arc-testnet', 'USDC@base-sepolia')).toThrow(HttpError)
    const usdc = resolveToken('arc-testnet', 'USDC@arc-testnet')
    expect(usdc.symbol).toBe('USDC')
    expect(usdc.contract).toMatch(/^0x[0-9a-fA-F]{40}$/)
  })

  test('only token assets (never a native coin) are listed for trading', () => {
    for (const net of ['arc-testnet', 'base-sepolia']) for (const t of dexTokens(net)) expect(t.kind).toBe('token')
  })

  test('unsupported networks are refused, and a missing address is a clear error', () => {
    expect(() => dexConfig('polygon-amoy')).toThrow(HttpError)
    const saved = process.env.NAIRASWAP_ARC_ROUTER
    delete process.env.NAIRASWAP_ARC_ROUTER
    expect(() => dexConfig('arc-testnet')).toThrow(/not configured/)
    process.env.NAIRASWAP_ARC_ROUTER = saved
  })
})
