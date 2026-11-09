import { useQuery } from '@tanstack/react-query'
import { api } from './api'

export interface TokenNetwork {
  networkId: string; network: string; group: string; chainId: number | null; testnet: boolean; contract: string | null; native: boolean
  decimals: number; active: boolean; verified: boolean; note: string | null; explorer: string | null
}
export interface TokenInfo {
  symbol: string; name: string; decimals: number; logo: string; popular: boolean; tradable: boolean; networks: TokenNetwork[]
}
export interface RegNetworkInfo { id: string; name: string; group: string; chainId: number | null; testnet: boolean; family: string; tokenCount: number }
export interface TokenBalance {
  symbol: string; onchainTotal: string; exchange: string
  onchain: { networkId: string; key: string; balance: string | null; verifiedAt: number | null; error: string | null }[]
}

/** The only source of token lists in the app. Nothing is hardcoded on the front end. */
export const useTokenList = () =>
  useQuery({ queryKey: ['tokens-registry'], queryFn: () => api<{ tokens: TokenInfo[]; networks: RegNetworkInfo[] }>('/api/tokens'), staleTime: 30_000 })

/** The signed-in user's own balances. On-chain and exchange figures stay separate. */
export const useTokenBalances = (enabled = true) =>
  useQuery({ queryKey: ['token-balances'], enabled, queryFn: () => api<{ balances: TokenBalance[]; asOf: number }>('/api/tokens/balances').then((r) => r.balances), refetchInterval: 10_000, staleTime: 5_000 })
