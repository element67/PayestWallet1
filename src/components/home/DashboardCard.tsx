import type { KeyboardEvent, MouseEvent, ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, RotateCw } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { ngn, parseError, usd } from '@/lib/format'
import type { BalanceSummary } from '@/lib/home'
import { useBalanceSummary } from '@/lib/home'
import { EyeToggle, usePrivacy, type PrivacyScope } from '@/lib/privacy'
import { Badge, Card, cx } from '../ui'

/** Keeps taps on small controls (eye, currency chip) from also opening the page behind them. */
const stop = (e: MouseEvent | KeyboardEvent) => e.stopPropagation()

function Half({ scope, label, onOpen, children }: { scope: PrivacyScope; label: string; onOpen: () => void; children: (mask: (t: string) => string) => ReactNode }) {
  const { mask } = usePrivacy(scope)
  const key = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onOpen()
    }
  }
  return (
    <div
      role="button" tabIndex={0} aria-label={`Open ${label} page`} onClick={onOpen} onKeyDown={key}
      className="min-w-0 cursor-pointer p-4 pt-3.5 text-left transition hover:bg-muted/60 active:scale-[0.99] active:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
    >
      <div className="flex items-start justify-between gap-1">
        <div className="eyebrow flex items-center gap-0.5 pt-3">{label}<ChevronRight size={12} aria-hidden /></div>
        <span onClick={stop} onKeyDown={stop}><EyeToggle scope={scope} className="-mr-2 -mt-1 border-transparent" /></span>
      </div>
      {children(mask)}
    </div>
  )
}

function CurrencyChip({ value, onChange, busy }: { value: 'USD' | 'NGN'; onChange: (v: 'USD' | 'NGN') => void; busy: boolean }) {
  return (
    <span onClick={stop} onKeyDown={stop} className="mt-2 inline-flex rounded-full border border-line p-0.5" role="group" aria-label="Show crypto in">
      {(['USD', 'NGN'] as const).map((c, i) => (
        <span key={c} className="inline-flex items-center">
          {i === 1 && <span className="text-subtle" aria-hidden>|</span>}
          <button
            type="button" aria-pressed={value === c} disabled={busy} onClick={(e) => { stop(e); if (value !== c) onChange(c) }}
            className={cx('min-h-9 rounded-full px-2.5 text-[11px] font-bold transition', value === c ? 'bg-accent text-accent-ink' : 'text-subtle hover:text-ink')}
          >{c}</button>
        </span>
      ))}
    </span>
  )
}

function Failed({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  return (
    <button onClick={onRetry} className="flex min-h-[132px] w-full flex-col items-center justify-center gap-2 rounded-3xl border border-danger/40 bg-danger/10 p-5 text-center text-sm font-semibold text-danger transition hover:bg-danger/15 active:scale-[0.99]">
      <RotateCw size={20} className={cx(retrying && 'animate-spin')} aria-hidden />
      Couldn't load balance, tap to retry
    </button>
  )
}

/** One card split in half. Crypto (left, USD or Naira) opens the Crypto page; Naira (right) opens the Naira page. */
export function DashboardCard({ onOpenCrypto, onOpenNaira }: { onOpenCrypto: () => void; onOpenNaira: () => void }) {
  const qc = useQueryClient()
  const { data, isPending, isError, isFetching, refetch } = useBalanceSummary()
  const setCurrency = useMutation({
    mutationFn: (cryptoCurrency: 'USD' | 'NGN') => api('/api/me/preferences', { method: 'PUT', body: { cryptoCurrency } }),
    onMutate: async (cryptoCurrency) => {
      await qc.cancelQueries({ queryKey: ['balance-summary'] })
      const prev = qc.getQueryData<BalanceSummary>(['balance-summary'])
      if (prev) qc.setQueryData<BalanceSummary>(['balance-summary'], { ...prev, preference: { cryptoCurrency } })
      return { prev }
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['balance-summary'], ctx.prev)
      toast.error(parseError(e))
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['balance-summary'] }),
  })

  if (isPending) return <div className="h-36 animate-pulse rounded-3xl bg-muted" aria-busy="true" aria-label="Loading balances" />
  // A failed refresh never leaves an old number on screen.
  if (isError || !data) return <Failed onRetry={() => void refetch()} retrying={isFetching} />

  const cur = data.preference.cryptoCurrency
  const fmt = (m: { usd: string; ngn: string }) => (cur === 'USD' ? usd(m.usd) : ngn(m.ngn))
  return (
    <Card strong className="grid grid-cols-2 divide-x divide-line overflow-hidden !p-0">
      <Half scope="crypto" label="Crypto" onOpen={onOpenCrypto}>
        {(mask) => (
          <>
            <div className="display num mt-1 truncate text-[22px] font-semibold leading-tight sm:text-3xl" title={mask(fmt(data.crypto))}>{mask(fmt(data.crypto))}</div>
            <CurrencyChip value={cur} busy={setCurrency.isPending} onChange={(c) => setCurrency.mutate(c)} />
            <div className="mt-2"><Badge kind="live">{data.crypto.testnet.label}</Badge></div>
            <p className="mt-1.5 text-[11px] leading-snug text-subtle">
              {data.crypto.includesSandbox ? `Includes sandbox exchange balances (${mask(fmt(data.crypto.sandbox))})` : data.crypto.syncing ? 'Verifying balances…' : `Rate ${ngn(data.rate.ngnPerUsd)} per $1`}
            </p>
          </>
        )}
      </Half>
      <Half scope="naira" label="Naira" onOpen={onOpenNaira}>
        {(mask) => (
          <>
            <div className="display num mt-1 truncate text-[22px] font-semibold leading-tight sm:text-3xl" title={mask(ngn(data.naira.balance))}>{mask(ngn(data.naira.balance))}</div>
            <div className="mt-2 pt-[36px]"><Badge kind="sandbox">{data.naira.label}</Badge></div>
            <p className="mt-1.5 text-[11px] leading-snug text-subtle">Available balance</p>
          </>
        )}
      </Half>
    </Card>
  )
}
