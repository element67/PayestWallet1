/**
 * Supported wallet networks and the verified asset catalog. Contract addresses come from the generated
 * onchain-facts registry, never from memory. Only TESTNETS are enabled in this build.
 */
import { getChain } from '../../src/onchain-facts'
import { all } from '../db'

export type Family = 'evm' | 'solana' | 'bitcoin'

export interface NetworkDef {
  id: string
  name: string
  family: Family
  chainId?: number
  nativeSymbol: string
  nativeDecimals: number
  /** Confirmations after which a transaction is treated as final. */
  finalConfirmations: number
  explorerTx: (hash: string) => string
  explorerAddress: (addr: string) => string
  /** True when sending is implemented for this network in this build. */
  canSend: boolean
  sendNote?: string
  faucet?: string
  /** Native incoming transfers are found by scanning blocks. Skipped on chains whose blocks are too fast to scan. */
  scanNative?: boolean
}

const evm = (id: string, chainId: number, final: number, faucet?: string): NetworkDef => {
  const c = getChain(chainId)
  if (!c) throw new Error(`Chain ${chainId} missing from onchain-facts`)
  return {
    id, name: c.name, family: 'evm', chainId, nativeSymbol: c.nativeCurrency.symbol, nativeDecimals: c.nativeCurrency.decimals,
    finalConfirmations: final, explorerTx: (h) => `${c.explorerBase}/tx/${h}`, explorerAddress: (a) => `${c.explorerBase}/address/${a}`,
    canSend: true, faucet, scanNative: id !== 'arc-testnet' && id !== 'arbitrum-sepolia',
  }
}

export const NETWORKS: NetworkDef[] = [
  evm('arc-testnet', 5042002, 2, 'Use the "Get test USDC" button in the Arc Studio sidebar'),
  evm('ethereum-sepolia', 11155111, 6),
  evm('base-sepolia', 84532, 6),
  evm('arbitrum-sepolia', 421614, 20),
  evm('optimism-sepolia', 11155420, 6),
  evm('polygon-amoy', 80002, 12),
  {
    id: 'solana-devnet', name: 'Solana Devnet', family: 'solana', nativeSymbol: 'SOL', nativeDecimals: 9, finalConfirmations: 1,
    explorerTx: (h) => `https://explorer.solana.com/tx/${h}?cluster=devnet`, explorerAddress: (a) => `https://explorer.solana.com/address/${a}?cluster=devnet`,
    canSend: false, sendNote: 'Receiving and balances are live. Sending from Solana needs a signing adapter that is not enabled in this build.',
  },
  {
    id: 'bitcoin-testnet', name: 'Bitcoin Testnet4', family: 'bitcoin', nativeSymbol: 'BTC', nativeDecimals: 8, finalConfirmations: 3,
    explorerTx: (h) => `https://mempool.space/testnet4/tx/${h}`, explorerAddress: (a) => `https://mempool.space/testnet4/address/${a}`,
    canSend: false, sendNote: 'Receiving and balances are live. Sending Bitcoin needs a UTXO signing adapter that is not enabled in this build.',
  },
]

export const getNetwork = (id: string) => NETWORKS.find((n) => n.id === id)

export interface AssetDef {
  key: string // e.g. "USDC@arc-testnet"
  symbol: string
  name: string
  network: string
  kind: 'native' | 'token'
  contract?: string
  decimals: number
  info: string
  logo: string
}

/**
 * The wallet's asset catalog is the ACTIVE, VERIFIED testnet deployments in the token registry (database).
 * The array is refreshed in place whenever the registry changes, so every importer always sees the current list.
 */
export const ASSETS: AssetDef[] = []
export const getAssetDef = (key: string) => ASSETS.find((a) => a.key === key)

/** Registry tokens that are enabled but have no active testnet deployment in this wallet. Shown honestly, never with a balance. */
export const UNAVAILABLE: Array<{ symbol: string; name: string; reason: string }> = []

export function refreshAssets() {
  const ids = new Set(NETWORKS.map((n) => n.id))
  const rows = all<{ symbol: string; name: string; logo: string; network_id: string; contract: string | null; decimals: number }>(
    `SELECT t.symbol, t.name, t.logo, tn.network_id, tn.contract, tn.decimals
       FROM token_networks tn JOIN tokens t ON t.symbol = tn.symbol
      WHERE t.is_active=1 AND tn.is_active=1 AND tn.verified=1 AND tn.is_testnet=1 ORDER BY t.sort, tn.id`,
  ).filter((r) => ids.has(r.network_id))
  const next: AssetDef[] = rows.map((r) => ({
    key: `${r.symbol}@${r.network_id}`, symbol: r.symbol, name: r.name, network: r.network_id, kind: r.contract ? 'token' : 'native',
    contract: r.contract ?? undefined, decimals: r.decimals, logo: r.logo,
    info: `${r.name} on ${getNetwork(r.network_id)?.name ?? r.network_id}. Testnet asset with no market value. ${r.contract ? 'Contract verified on-chain.' : 'Native asset of the chain.'}`,
  }))
  ASSETS.splice(0, ASSETS.length, ...next)
  const have = new Set(next.map((a) => a.symbol))
  const missing = all<{ symbol: string; name: string }>('SELECT symbol, name FROM tokens WHERE is_active=1 ORDER BY sort').filter((t) => !have.has(t.symbol))
  UNAVAILABLE.splice(0, UNAVAILABLE.length, ...missing.map((t) => ({ symbol: t.symbol, name: t.name, reason: 'No verified testnet contract is registered, so it cannot be listed without risking a fake token.' })))
}

/** All verified token contracts per network, lowercased. Anything else sent to a wallet is "unverified". */
export const verifiedTokens = (networkId: string) => new Set(ASSETS.filter((a) => a.network === networkId && a.contract).map((a) => a.contract?.toLowerCase()))
