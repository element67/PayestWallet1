import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { TokenAAVE, TokenARB, TokenBNB, TokenBTC, TokenDAI, TokenETH, TokenEURC, TokenLINK, TokenOP, TokenPOL, TokenSOL, TokenUNI, TokenUSDC, TokenUSDT, TokenWBTC } from '@web3icons/react'
import { STATUS_LABEL, tone } from '@/lib/format'

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

export function Card({ children, className, strong }: { children: ReactNode; className?: string; strong?: boolean }) {
  return <div className={cx('glass rounded-3xl', strong && 'hero', className)}>{children}</div>
}

/** A shimmering placeholder block. Use it where content will appear so the page keeps its shape while loading. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cx('skeleton rounded-2xl', className)} />
}

/** A card of placeholder rows (icon, two lines, amount) for lists that are still loading. */
export function ListSkeleton({ rows = 4, label = 'Loading', bare }: { rows?: number; label?: string; bare?: boolean }) {
  return (
    <div className={cx(!bare && 'glass overflow-hidden rounded-3xl p-2')} role="status" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex min-h-14 items-center gap-3 px-3 py-2">
          <Skeleton className="size-10 shrink-0 !rounded-full" />
          <div className="min-w-0 flex-1 space-y-2"><Skeleton className="h-3.5 w-2/5" /><Skeleton className="h-3 w-3/5" /></div>
          <Skeleton className="h-4 w-16 shrink-0" />
        </div>
      ))}
    </div>
  )
}

/** Placeholder for a dashboard panel: a stat block and a couple of rows. */
export function PanelSkeleton({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="space-y-5" role="status" aria-busy="true" aria-label={label}>
      <div className="glass grid grid-cols-2 gap-5 rounded-3xl p-6 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => <div key={i} className="space-y-2"><Skeleton className="h-3 w-24" /><Skeleton className="h-7 w-32" /></div>)}
      </div>
      <ListSkeleton rows={3} label={label} />
    </div>
  )
}

export function Button({ variant = 'primary', loading, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' | 'soft'; loading?: boolean }) {
  const v = {
    primary: 'bg-accent text-accent-ink',
    ghost: 'bg-surface-strong text-ink',
    soft: 'bg-muted text-ink',
    danger: 'bg-danger text-on-danger',
  }[variant]
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx('border border-outline min-h-12 inline-flex items-center justify-center gap-2 rounded-full px-6 text-sm font-semibold tracking-tight transition disabled:cursor-not-allowed disabled:opacity-50', v, className)}
    >
      {loading && <Loader2 size={16} className="animate-spin" />}
      {children}
    </button>
  )
}

export function Field({ label, hint, wrapperClassName, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; wrapperClassName?: string }) {
  return (
    <label className={cx('block', wrapperClassName)}>
      <span className="eyebrow">{label}</span>
      <input {...rest} className={cx('mt-1.5 min-h-12 w-full rounded-2xl border border-outline bg-surface-strong px-4 text-sm font-semibold text-ink placeholder:text-subtle', rest.className)} />
      {hint && <span className="mt-1.5 block text-xs font-medium text-subtle">{hint}</span>}
    </label>
  )
}

export function Badge({ children, kind = 'info' }: { children: ReactNode; kind?: 'good' | 'bad' | 'warn' | 'info' | 'sandbox' | 'live' }) {
  const k = {
    good: 'bg-success/15 text-success',
    bad: 'bg-danger/15 text-danger',
    warn: 'bg-warn/15 text-warn',
    info: 'bg-surface-strong text-subtle',
    sandbox: 'bg-warn/15 text-warn',
    live: 'bg-success/15 text-success',
  }[kind]
  return <span className={cx('inline-flex items-center gap-1 rounded-full border-2 border-outline px-2.5 py-0.5 text-xs font-semibold', k)}>{children}</span>
}

export const Sandbox = ({ label = 'Sandbox' }: { label?: string }) => <Badge kind="sandbox">{label}</Badge>

export function StatusBadge({ status }: { status: string }) {
  return <Badge kind={tone(status)}>{STATUS_LABEL[status] ?? status}</Badge>
}

export function Stat({ label, value, sub, className }: { label: string; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cx('min-w-0', className)}>
      <div className="eyebrow">{label}</div>
      <div className="display num mt-1 break-words text-stat leading-tight text-ink">{value}</div>
      {sub && <div className="mt-0.5 text-xs font-medium text-subtle">{sub}</div>}
    </div>
  )
}

const LOGOS = {
  USDC: TokenUSDC, USDT: TokenUSDT, BTC: TokenBTC, SOL: TokenSOL, ETH: TokenETH, DAI: TokenDAI, WBTC: TokenWBTC, BNB: TokenBNB, POL: TokenPOL,
  LINK: TokenLINK, UNI: TokenUNI, AAVE: TokenAAVE, ARB: TokenARB, OP: TokenOP, EURC: TokenEURC,
} as const

/** Wrapped assets have no icon of their own: show the base asset's mark with a small badge. */
const WRAPPED: Record<string, { base: keyof typeof LOGOS; tag: string }> = { WETH: { base: 'ETH', tag: 'W' }, CBBTC: { base: 'BTC', tag: 'cb' }, CIRBTC: { base: 'BTC', tag: 'c' } }

/** `logo` is the icon key stored with the token in the registry; it falls back to the symbol. */
export function TokenIcon({ symbol, size = 28, logo }: { symbol: string; size?: number; logo?: string }) {
  const p = { variant: 'branded' as const, size }
  const key = (logo ?? symbol).toUpperCase()
  if (key === 'NGN') return <div className="grid place-items-center rounded-full bg-success/15 font-bold text-success" style={{ width: size, height: size, fontSize: Math.max(14, size * 0.5) }} aria-label="Naira">₦</div>
  const Logo = LOGOS[key as keyof typeof LOGOS]
  if (Logo) return <Logo {...p} />
  const w = WRAPPED[key]
  if (w) {
    const Base = LOGOS[w.base]
    return (
      <span className="relative inline-block" style={{ width: size, height: size }}>
        <Base {...p} />
        <span className="absolute -bottom-0.5 -right-0.5 grid place-items-center rounded-full border border-outline bg-surface-strong px-[3px] font-bold leading-none text-ink" style={{ fontSize: Math.max(14, size * 0.38), minWidth: Math.max(18, size * 0.5), height: Math.max(18, size * 0.5) }}>{w.tag}</span>
      </span>
    )
  }
  return <div className="grid place-items-center rounded-full bg-muted text-xs font-bold" style={{ width: size, height: size }}>{symbol.slice(0, 1).toUpperCase()}</div>
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[] }) {
  return (
    <div className="flex w-full flex-wrap gap-1 rounded-3xl border-3 border-outline bg-muted p-1" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx('no-pop min-h-11 flex-auto rounded-full px-3 text-sm transition', value === o.value ? 'border-2 border-outline bg-accent text-accent-ink shadow-pop' : 'text-ink hover:bg-surface-strong')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Row({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <span className="font-medium text-subtle">{label}</span>
      <span className={cx('num text-right font-bold text-ink', mono && 'mono text-xs')}>{value}</span>
    </div>
  )
}

export function Empty({ title, body }: { title: string; body?: string }) {
  return (
    <div className="px-6 py-10 text-center">
      <div className="mx-auto mb-4 grid size-14 place-items-center rounded-full bg-surface-strong text-subtle" aria-hidden="true">
        <span className="size-5 rounded-md bg-card" />
      </div>
      <div className="display text-xl text-ink">{title}</div>
      {body && <p className="mx-auto mt-2 max-w-sm text-pretty text-sm font-medium text-subtle">{body}</p>}
    </div>
  )
}

export const PageTitle = ({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) => (
  <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
    <div>
      <h1 className="plate display text-balance text-3xl">{title}</h1>
      {sub && <p className="plate-sub mt-3 max-w-xl text-pretty text-sm font-semibold">{sub}</p>}
    </div>
    {right}
  </div>
)
