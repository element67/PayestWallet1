import { describe, expect, test } from 'bun:test'
import { HttpError } from '../../server/auth'
import { checkInput } from '../../server/bridge/service'

describe('bridge input checks', () => {
  test('accepts a valid route and converts to 6-decimal units', () => {
    expect(checkInput({ from: 'arc-testnet', to: 'base-sepolia', amount: '1.5' })).toEqual({ from: 'arc-testnet', to: 'base-sepolia', amountRaw: 1_500_000n })
  })
  test('refuses unknown networks, the same network on both sides, and bad amounts', () => {
    const bad = [
      { from: 'solana-devnet', to: 'base-sepolia', amount: '1' },
      { from: 'arc-testnet', to: 'arc-testnet', amount: '1' },
      { from: 'arc-testnet', to: 'base-sepolia', amount: '0' },
      { from: 'arc-testnet', to: 'base-sepolia', amount: '1.1234567' },
      { from: 'arc-testnet', to: 'base-sepolia', amount: '-1' },
      { from: 'arc-testnet', to: 'base-sepolia', amount: '1e6' },
    ]
    for (const b of bad) expect(() => checkInput(b as never)).toThrow(HttpError)
  })
})
