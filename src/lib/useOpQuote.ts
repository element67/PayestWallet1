import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import { useBalances } from './queries'
import type { CryptoOp } from './home'

/** Waits briefly after typing stops so a quote is not requested on every keystroke. */
export function useDebounced<T>(value: T, ms = 450): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/** A server-priced quote. The app only displays it; the server re-prices at execution. */
export function useServerQuote<T>(path: string, payload: Record<string, string>, enabled: boolean) {
  const settled = useDebounced(JSON.stringify(payload))
  return useQuery({
    queryKey: ['quote', path, settled],
    enabled: enabled && settled === JSON.stringify(payload),
    queryFn: () => api<T>(path, { method: 'POST', body: JSON.parse(settled) as Record<string, string> }),
    retry: false,
    staleTime: 20_000,
    refetchOnWindowFocus: false,
  })
}

export const useOp = (id: string | null) =>
  useQuery({
    queryKey: ['op', id],
    enabled: Boolean(id),
    queryFn: () => api<{ op: CryptoOp }>(`/api/crypto/ops/${id}`).then((r) => r.op),
    refetchInterval: (q) => (q.state.data && ['completed', 'failed'].includes(q.state.data.status) ? false : 1500),
  })

/** Exchange balances per asset symbol (what swap and buy work with). */
export function useExchangeBalances() {
  const { data } = useBalances()
  return Object.fromEntries((data?.assets ?? []).map((a) => [a.symbol, a.amount])) as Record<string, string>
}
