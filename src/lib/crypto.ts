import { useQuery } from '@tanstack/react-query'
import { api } from './api'

export interface CryptoAsset {
  key: string; symbol: string; name: string; network: string; kind: 'native' | 'token'; contract: string | null; decimals: number; info: string
  balance: string | null; verifiedAt: number | null; blockRef: string | null; rateNgn: string | null; valueNgn: string | null; error: string | null
}
export interface CryptoNetwork {
  id: string; name: string; family: 'evm' | 'solana' | 'bitcoin'; nativeSymbol: string; address: string; canSend: boolean; sendNote: string | null
  faucet: string | null; explorerAddress: string; monitor: { status: string; head: number | null; error: string | null; lastPollAt: number | null }
}
export interface CryptoOverview {
  addresses: { evm: string; solana: string; bitcoin: string }; assets: CryptoAsset[]; totalValueNgn: string; syncing: boolean; recentTxs: CryptoTx[]; unpricedSymbols: string[]
  heldCount: number; assetCount: number; syncedAt: number | null; unavailable: { symbol: string; name: string; reason: string }[]; networks: CryptoNetwork[]
}
export interface CryptoTx {
  id: string; type: 'received' | 'sent' | 'swapped' | 'bridged' | 'purchased'; network: string; networkId: string; symbol: string | null; assetKey: string | null
  tokenRef: string | null; amount: string; from: string | null; to: string | null; hash: string | null; simulated: boolean; fee: string | null; feeSymbol: string | null
  status: string; verdict: string; confirmations: number; finalConfirmations: number; riskScore: number; riskFlags: string[]; note: string | null
  url: string | null; createdAt: number; detectedAt: number; finalizedAt: number | null
}
export interface SendPreview {
  confirmToken: string; expiresAt: number; network: string; networkId: string; asset: string; assetKey: string; amount: string; from: string; to: string
  fee: string; feeSymbol: string; gasUnits: string; gasPriceGwei: string; balance: string; flags: string[]; riskScore: number; warnings: string[]
}

export const useCrypto = () =>
  useQuery({ queryKey: ['crypto'], queryFn: () => api<CryptoOverview>('/api/crypto/overview'), refetchInterval: 5000, staleTime: 3000 })

export const useCryptoTxs = (type?: string, asset?: string) =>
  useQuery({
    queryKey: ['crypto-txs', type ?? '', asset ?? ''],
    queryFn: () => api<{ txs: CryptoTx[] }>(`/api/crypto/txs?${new URLSearchParams({ ...(type ? { type } : {}), ...(asset ? { asset } : {}) })}`).then((r) => r.txs),
    refetchInterval: 3000,
  })

export const statusTone = (s: string): 'good' | 'bad' | 'warn' | 'info' =>
  s === 'finalized' ? 'good' : ['failed', 'dropped'].includes(s) ? 'bad' : s === 'pending' || s === 'signing' ? 'warn' : 'info'
