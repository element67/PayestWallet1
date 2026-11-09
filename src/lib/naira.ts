import { useQuery } from '@tanstack/react-query'
import { api } from './api'

export interface NairaWallet {
  balance: string; currency: 'NGN'; status: 'active' | 'frozen'; freezeReason: string | null; mode: 'SANDBOX'
  account: { number: string; bank: string; name: string; sandbox: boolean }
  pin: { set: boolean; lockedUntil: number | null }
  profile: { username: string | null; phone: string | null }
  limits: { daily: string; spent24h: string; remaining: string }
  fees: { bankTransfer: string; bill: string }
}
export interface Txn {
  id: string; reference: string; type: string; direction: 'credit' | 'debit'; amount: string; fee: string; total: string
  status: 'pending' | 'processing' | 'pending_review' | 'success' | 'failed' | 'reversed'
  title: string; counterparty: string | null; note: string | null; meta: Record<string, unknown>; failureReason: string | null
  reversed: boolean; underReview: boolean; createdAt: number; completedAt: number | null; sandbox: boolean
  bill?: { category: string; status: string; providerRef: string | null } | null
}
export interface NairaOverview { wallet: NairaWallet; recent: Txn[]; pending: number }
export interface Pkg { id: string; label: string; validity?: string; priceKobo: number }
export interface Category {
  id: string; label: string; customerLabel: string; customerPattern: string; verify: boolean; mode: 'amount' | 'package'
  minKobo?: number; maxKobo?: number; providers: { id: string; label: string }[]; variants?: { id: string; label: string }[]
  packages?: Record<string, Pkg[]>; note: string
}
export interface NairaConfig {
  mode: 'SANDBOX'; minTransferNgn: string; banks: { code: string; name: string }[]; categories: Category[]; airports: { code: string; city: string }[]
  hints: { notFound: string; providerFailure: string }
}

export const useNairaOverview = () =>
  useQuery({ queryKey: ['naira'], queryFn: () => api<NairaOverview>('/api/naira/overview'), refetchInterval: 4000, staleTime: 2000 })
export const useNairaConfig = () => useQuery({ queryKey: ['naira-config'], queryFn: () => api<NairaConfig>('/api/naira/config'), staleTime: 300_000 })
export const useTxn = (id: string | null) =>
  useQuery({
    queryKey: ['naira-txn', id], enabled: Boolean(id),
    queryFn: () => api<{ transaction: Txn }>(`/api/naira/transactions/${id}`).then((r) => r.transaction),
    refetchInterval: (q) => (q.state.data && ['success', 'failed', 'reversed'].includes(q.state.data.status) ? false : 1200),
  })

/** One idempotency key per attempt: reuse it for retries of the same request, create a new one for a new request. */
export const newKey = () => `k${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`

export const TYPE_LABEL: Record<string, string> = {
  p2p_deposit: 'Deposit', bank_transfer: 'Bank transfer', internal_transfer: 'Transfer', internal_credit: 'Received', bill: 'Bill payment',
  flight: 'Flight', shopping: 'Shopping', adjustment: 'Adjustment',
}
export const TXN_STATUS: Record<string, { label: string; kind: 'good' | 'bad' | 'warn' | 'info' }> = {
  success: { label: 'Successful', kind: 'good' }, failed: { label: 'Failed', kind: 'bad' }, reversed: { label: 'Reversed', kind: 'warn' },
  processing: { label: 'Processing', kind: 'info' }, pending: { label: 'Pending', kind: 'info' }, pending_review: { label: 'Under review', kind: 'warn' },
}
