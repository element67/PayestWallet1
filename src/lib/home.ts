import { useQuery } from '@tanstack/react-query'
import { api } from './api'

export interface HomeAsset {
  id: string; symbol: string; name: string; kind: 'naira' | 'onchain' | 'credit'; chain: string; amount: string; valueNgn: string | null
}
export interface HomeData {
  crypto: { totalValueNgn: string; includesCredits: boolean; unpricedSymbols: string[]; syncing: boolean; syncedAt: number | null }
  naira: { balance: string; accountNumber: string; status: string }
  assets: HomeAsset[]
}

/** One request feeds the whole dashboard: totals and the assets list come from the database and the chains. */
export const useHome = () =>
  useQuery({ queryKey: ['home'], queryFn: () => api<HomeData>('/api/home'), refetchInterval: 6000, staleTime: 3000 })

export interface Token {
  key: string; symbol: string; name: string; network: string; networkName: string; kind: string; contract: string | null; decimals: number
  info: string; balance: string | null; valueNgn: string | null; verifiedAt: number | null; error: string | null; address: string | null; added: boolean
}
export interface TokenLists { mine: Token[]; more: Token[]; unavailable: { symbol: string; name: string; reason: string }[] }

export const useTokens = () =>
  useQuery({ queryKey: ['tokens'], queryFn: () => api<TokenLists>('/api/crypto/tokens'), refetchInterval: 8000, staleTime: 3000 })

export interface CryptoOp {
  id: string; reference: string; kind: 'sell' | 'buy' | 'p2p' | 'swap' | 'bridge'; status: 'pending' | 'verifying' | 'completed' | 'failed'
  asset: string; toAsset: string | null; amount: string; resultAmount: string | null; valueNgn: string; feeNgn: string
  orderId: string | null; reason: string | null; meta: Record<string, unknown>; createdAt: number
}

export interface BalanceSummary {
  crypto: {
    usd: string; ngn: string
    testnet: { usd: string; ngn: string; label: string }
    sandbox: { usd: string; ngn: string; label: string }
    includesSandbox: boolean; unpricedSymbols: string[]; syncing: boolean; syncedAt: number | null
  }
  naira: { balance: string; currency: 'NGN'; label: string }
  rate: { ngnPerUsd: string; source: string; updatedAt: number }
  preference: { cryptoCurrency: 'USD' | 'NGN' }
  asOf: number
}

/** The Home card's numbers. All conversion is done by the server; this only fetches and displays. */
export const useBalanceSummary = () =>
  useQuery({ queryKey: ['balance-summary'], queryFn: () => api<BalanceSummary>('/api/balance/summary'), refetchInterval: 8000, staleTime: 4000, retry: 1 })
