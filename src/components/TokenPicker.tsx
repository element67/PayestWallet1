import { useMemo, useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { crypto } from '@/lib/format'
import { usePrivacy } from '@/lib/privacy'
import { useTokenBalances, useTokenList, type TokenInfo } from '@/lib/tokens'
import { Sheet } from './naira/Sheet'
import { TokenIcon, cx } from './ui'

export type BalanceMode = 'onchain' | 'exchange' | 'both' | 'none'
export type ReasonFor = (t: TokenInfo) => string | null

interface PickerProps {
  open: boolean
  onClose: () => void
  onSelect: (symbol: string) => void
  selected?: string
  title?: string
  balanceMode?: BalanceMode
  /** Return a short reason to show the token greyed out and not selectable, or null when it can be chosen. */
  reasonFor?: ReasonFor
  /** Hide tokens that are not on this network. */
  networkId?: string
}

function Row({ t, mode, reason, selected, onPick }: { t: TokenInfo; mode: BalanceMode; reason: string | null; selected: boolean; onPick: () => void }) {
  const { mask } = usePrivacy('crypto')
  const { data: balances } = useTokenBalances(mode !== 'none')
  const b = balances?.find((x) => x.symbol === t.symbol)
  const nets = t.networks.length
  return (
    <li>
      <button
        onClick={onPick} disabled={Boolean(reason)} aria-pressed={selected}
        className={cx('flex min-h-[60px] w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition', reason ? 'opacity-50' : 'hover:bg-muted active:bg-muted', selected && 'bg-accent/10')}
      >
        <TokenIcon symbol={t.symbol} logo={t.logo} size={36} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{t.symbol}</span>
          <span className="block truncate text-xs text-subtle">{reason ?? `${t.name} · ${nets === 1 ? t.networks[0].network : `${nets} networks`}`}</span>
        </span>
        {mode !== 'none' && b && (
          <span className="shrink-0 text-right">
            {(mode === 'onchain' || mode === 'both') && <span className="num block text-sm font-semibold">{mask(crypto(b.onchainTotal))}</span>}
            {(mode === 'exchange' || mode === 'both') && (mode === 'exchange' || Number(b.exchange) > 0) && (
              <span className={cx('num block', mode === 'both' ? 'text-xs text-subtle' : 'text-sm font-semibold')}>{mask(crypto(b.exchange))}{mode === 'both' && ' exch.'}</span>
            )}
          </span>
        )}
      </button>
    </li>
  )
}

/** Searchable token picker. Tokens, logos, networks and balances all come from the back end. */
export function TokenPicker({ open, onClose, onSelect, selected, title = 'Choose a token', balanceMode = 'onchain', reasonFor, networkId }: PickerProps) {
  const { data, isLoading, isError } = useTokenList()
  const [q, setQ] = useState('')
  const tokens = useMemo(() => (data?.tokens ?? []).filter((t) => !networkId || t.networks.some((n) => n.networkId === networkId)), [data, networkId])
  const needle = q.trim().toLowerCase()
  const match = (t: TokenInfo) =>
    !needle || t.symbol.toLowerCase().includes(needle) || t.name.toLowerCase().includes(needle) ||
    t.networks.some((n) => n.network.toLowerCase().includes(needle) || n.group.toLowerCase().includes(needle) || (n.contract ?? '').toLowerCase().includes(needle))
  const shown = tokens.filter(match)
  const popular = needle ? [] : shown.filter((t) => t.popular)
  const rest = needle ? shown : shown.filter((t) => !t.popular)
  const pick = (t: TokenInfo) => { onSelect(t.symbol); onClose(); setQ('') }
  const list = (items: TokenInfo[]) => items.map((t) => <Row key={t.symbol} t={t} mode={balanceMode} reason={reasonFor?.(t) ?? null} selected={t.symbol === selected} onPick={() => pick(t)} />)

  return (
    <Sheet open={open} onClose={() => { onClose(); setQ('') }} title={title}>
      <div className="relative mb-3">
        <Search size={16} aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-subtle" />
        <input
          value={q} onChange={(e) => setQ(e.target.value)} type="search" inputMode="search" autoComplete="off" spellCheck={false} maxLength={60}
          placeholder="Search name, symbol, network or contract" aria-label="Search tokens"
          className="min-h-[44px] w-full rounded-2xl border border-line bg-bg pl-10 pr-3 text-sm placeholder:text-subtle focus:border-accent focus:outline-none"
        />
      </div>
      {isLoading && <div className="space-y-2" aria-busy="true">{[0, 1, 2, 3].map((i) => <div key={i} className="h-14 animate-pulse rounded-2xl bg-muted" />)}</div>}
      {isError && <p className="py-6 text-center text-sm text-danger">Could not load tokens. Close this and try again.</p>}
      {data && popular.length > 0 && (
        <section aria-label="Popular">
          <div className="eyebrow mb-1 px-1">Popular</div>
          <ul>{list(popular)}</ul>
        </section>
      )}
      {data && rest.length > 0 && (
        <section aria-label="All tokens" className={popular.length ? 'mt-3' : ''}>
          <div className="eyebrow mb-1 px-1">{needle ? 'Results' : 'All tokens'}</div>
          <ul>{list(rest)}</ul>
        </section>
      )}
      {data && shown.length === 0 && <p className="py-8 text-center text-sm text-subtle">No token matches "{q}".</p>}
    </Sheet>
  )
}

/** A button that shows the chosen token and opens the picker. */
export function TokenField({ label, value, onChange, ...rest }: { label?: string; value: string; onChange: (symbol: string) => void } & Omit<PickerProps, 'open' | 'onClose' | 'onSelect' | 'selected'>) {
  const [open, setOpen] = useState(false)
  const { data } = useTokenList()
  const t = data?.tokens.find((x) => x.symbol === value)
  return (
    <div>
      {label && <span className="eyebrow mb-1 block">{label}</span>}
      <button onClick={() => setOpen(true)} aria-haspopup="dialog" className="flex min-h-[48px] w-full items-center justify-between gap-3 rounded-2xl border border-line px-3 text-left hover:bg-muted">
        <span className="flex items-center gap-2.5">
          {t ? <TokenIcon symbol={t.symbol} logo={t.logo} size={28} /> : <span className="size-7 rounded-full bg-muted" />}
          <span><span className="block text-sm font-semibold leading-tight">{value || 'Select'}</span>{t && <span className="block text-xs leading-tight text-subtle">{t.name}</span>}</span>
        </span>
        <ChevronDown size={16} aria-hidden className="text-subtle" />
      </button>
      <TokenPicker open={open} onClose={() => setOpen(false)} onSelect={onChange} selected={value} {...rest} />
    </div>
  )
}
