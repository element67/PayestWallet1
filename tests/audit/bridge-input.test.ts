import { describe, expect, test } from 'bun:test'
import { HttpError } from '../../server/auth'
import { bridgeChains, chainName, findChain } from '../../server/bridge/chains'
import { checkInput } from '../../server/bridge/service'

const WANTED = ['Arbitrum', 'Arc', 'Avalanche', 'Base', 'Codex', 'Ethereum', 'Edge', 'HyperEVM', 'Linea', 'Monad', 'Optimism', 'Plume', 'Polygon', 'Solana', 'Unichain', 'Sonic']

describe('bridge networks', () => {
  test('all sixteen test networks are offered, in the requested order', () => {
    const chains = bridgeChains()
    expect(chains).toHaveLength(16)
    chains.forEach((c, i) => expect(c.name.startsWith(WANTED[i])).toBe(true))
    expect(new Set(chains.map((c) => c.id)).size).toBe(16)
  })
  test('every network has a real USDC address, an https RPC and a way to pay fees', () => {
    for (const c of bridgeChains()) {
      expect(c.rpc.startsWith('https://')).toBe(true)
      expect(c.gasSymbol.length).toBeGreaterThan(0)
      if (c.family === 'evm') { expect(c.usdc).toMatch(/^0x[0-9a-fA-F]{40}$/); expect(c.chainId).toBeGreaterThan(0) }
      else expect(c.usdc).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
    }
  })
  test('only Solana is non-EVM, and the earlier ids still resolve', () => {
    expect(bridgeChains().filter((c) => c.family === 'solana').map((c) => c.id)).toEqual(['solana-devnet'])
    for (const id of ['arc-testnet', 'ethereum-sepolia', 'base-sepolia']) expect(findChain(id)).not.toBeNull()
    expect(chainName('arc-testnet')).toBe('Arc Testnet')
  })
})

describe('bridge input checks', () => {
  test('accepts a valid route and converts to 6-decimal units', () => {
    expect(checkInput({ from: 'arc-testnet', to: 'base-sepolia', amount: '1.5' })).toEqual({ from: 'arc-testnet', to: 'base-sepolia', amountRaw: 1_500_000n })
  })
  test('accepts any pair of the offered networks, Solana included', () => {
    const ids = bridgeChains().map((c) => c.id)
    for (const a of ids) for (const b of ids) if (a !== b) expect(checkInput({ from: a, to: b, amount: '2' }).amountRaw).toBe(2_000_000n)
  })
  test('refuses unknown networks, the same network on both sides, and bad amounts', () => {
    const bad = [
      { from: 'solana-mainnet', to: 'base-sepolia', amount: '1' },
      { from: 'ethereum', to: 'base-sepolia', amount: '1' },
      { from: 'arc-testnet', to: 'arc-testnet', amount: '1' },
      { from: 'solana-devnet', to: 'solana-devnet', amount: '1' },
      { from: 'arc-testnet', to: 'base-sepolia', amount: '0' },
      { from: 'arc-testnet', to: 'base-sepolia', amount: '1.1234567' },
      { from: 'arc-testnet', to: 'base-sepolia', amount: '-1' },
      { from: 'arc-testnet', to: 'base-sepolia', amount: '1e6' },
      { from: '__proto__', to: 'base-sepolia', amount: '1' },
    ]
    for (const b of bad) expect(() => checkInput(b as never)).toThrow(HttpError)
  })
})
