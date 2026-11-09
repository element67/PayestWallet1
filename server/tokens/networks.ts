/**
 * Chains the token registry knows about. Chain ids, names and explorers come from the generated onchain-facts registry.
 * Tokens themselves are never listed here: they live in the database (tokens, token_networks).
 */
import { getChain } from '../../src/onchain-facts'

export interface RegNetwork {
  id: string
  group: string // Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain, Arc, Solana, Bitcoin
  chainId: number | null
  testnet: boolean
  family: 'evm' | 'solana' | 'bitcoin'
  /** Symbol of the chain's gas / native asset. */
  native: string
}

const e = (id: string, group: string, chainId: number, testnet: boolean, native = 'ETH'): RegNetwork => ({ id, group, chainId, testnet, family: 'evm', native })

export const REG_NETWORKS: readonly RegNetwork[] = [
  e('ethereum-sepolia', 'Ethereum', 11155111, true), e('ethereum', 'Ethereum', 1, false),
  e('base-sepolia', 'Base', 84532, true), e('base', 'Base', 8453, false),
  e('arbitrum-sepolia', 'Arbitrum', 421614, true), e('arbitrum', 'Arbitrum', 42161, false),
  e('optimism-sepolia', 'Optimism', 11155420, true), e('optimism', 'Optimism', 10, false),
  e('polygon-amoy', 'Polygon', 80002, true, 'POL'), e('polygon', 'Polygon', 137, false, 'POL'),
  // BNB Chain: only the mainnet is in the chain registry, so there is no BNB testnet entry (and none is invented here).
  e('bnb', 'BNB Chain', 56, false, 'BNB'),
  e('arc-testnet', 'Arc', 5042002, true, 'USDC'), e('arc', 'Arc', 5042, false, 'USDC'),
  { id: 'solana-devnet', group: 'Solana', chainId: null, testnet: true, family: 'solana', native: 'SOL' },
  { id: 'bitcoin-testnet', group: 'Bitcoin', chainId: null, testnet: true, family: 'bitcoin', native: 'BTC' },
]

export const regNetwork = (id: string) => REG_NETWORKS.find((n) => n.id === id)

export function networkLabel(n: RegNetwork): string {
  if (n.id === 'solana-devnet') return 'Solana Devnet'
  if (n.id === 'bitcoin-testnet') return 'Bitcoin Testnet4'
  return (n.chainId ? getChain(n.chainId)?.name : undefined) ?? n.id
}

export const explorerAddress = (n: RegNetwork, address: string): string | null => {
  const c = n.chainId ? getChain(n.chainId) : undefined
  return c ? `${c.explorerBase}/address/${address}` : null
}
