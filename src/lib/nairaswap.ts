import { useQuery } from '@tanstack/react-query'
import { api } from './api'

export interface DexToken { key: string; symbol: string; name: string; decimals: number; contract: string }
export interface DexNetwork { id: 'arc-testnet' | 'ethereum-sepolia' | 'base-sepolia'; chainId: number; router: string; factory: string; treasury: string; tokens: DexToken[] }
export interface DexStep { label: string; to: `0x${string}`; data: `0x${string}`; value: '0' }
export interface DexPreview {
  kind: 'swap' | 'add' | 'remove'; networkId: DexNetwork['id']; chainId: number; from: string; params: Record<string, unknown>
  steps: DexStep[]; summary: Record<string, string | number>; warnings: string[]
}
export interface DexPreviewResponse { preview: DexPreview; expiresAt: number; confirmToken: string | null }
export interface DexOp { id: string; network: string; kind: string; summary: string; status: string; note: string | null; hashes: string[]; links: string[]; createdAt: number }
export interface DexPool {
  pair: string; token0: { address: string; symbol: string | null; key: string | null }; token1: { address: string; symbol: string | null; key: string | null }
  reserve0: string | null; reserve1: string | null; lpSupply: string; yourShareBps: number; yourLp: string
}
export type DexAction =
  | { kind: 'swap'; tokenIn: string; tokenOut: string; amount: string }
  | { kind: 'add'; tokenA: string; tokenB: string; amountA: string; amountB: string }
  | { kind: 'remove'; tokenA: string; tokenB: string; percent: number }

export const NETWORK_NAME: Record<string, string> = { 'arc-testnet': 'Arc Testnet', 'ethereum-sepolia': 'Ethereum Sepolia', 'base-sepolia': 'Base Sepolia' }

export const useDexConfig = () => useQuery({ queryKey: ['dex-config'], queryFn: () => api<{ networks: DexNetwork[] }>('/api/nairaswap/config').then((r) => r.networks), staleTime: 300_000 })

export const useDexPools = (networkId: string) =>
  useQuery({
    queryKey: ['dex-pools', networkId],
    queryFn: () => api<{ pools: DexPool[]; router: string }>(`/api/nairaswap/pools?networkId=${networkId}`),
    refetchInterval: 15_000,
  })

export const previewDex = (b: { networkId: string; signer: 'app' | 'browser'; address?: string; slippageBps: number; action: DexAction }) =>
  api<DexPreviewResponse>('/api/nairaswap/preview', { method: 'POST', body: b })

export const executeDex = (b: { networkId: string; params: Record<string, unknown>; expiresAt: number; confirmToken: string; pin: string; idempotencyKey: string }) =>
  api<{ op: DexOp }>('/api/nairaswap/execute', { method: 'POST', body: b })

export const explorerTx = (networkId: string, hash: string) =>
  ({ 'arc-testnet': 'https://explorer.testnet.arc.io/tx/', 'ethereum-sepolia': 'https://sepolia.etherscan.io/tx/', 'base-sepolia': 'https://sepolia.basescan.org/tx/' }[networkId] ?? 'https://explorer.testnet.arc.io/tx/') + hash

export const SUMMARY_LABELS: Record<string, string> = {
  pay: 'You pay', receive: 'You receive (estimate)', minimumReceived: 'Minimum you receive', priceImpactBps: 'Price impact', feeBps: 'Trading fee',
  slippageBps: 'Slippage limit', depositA: 'You deposit', depositB: 'You deposit', receiveA: 'You receive', receiveB: 'You receive', share: 'Share removed',
}
export function summaryValue(k: string, v: string | number): string {
  if (k === 'priceImpactBps' || k === 'feeBps' || k === 'slippageBps') return `${(Number(v) / 100).toFixed(2)}%`
  return String(v)
}
