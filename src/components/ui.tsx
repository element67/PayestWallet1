import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { TokenAAVE, TokenARB, TokenBNB, TokenBTC, TokenDAI, TokenETH, TokenEURC, TokenLINK, TokenOP, TokenPOL, TokenSOL, TokenUNI, TokenUSDC, TokenUSDT, TokenWBTC } from '@web3icons/react'
import { STATUS_LABEL, tone } from '@/lib/format'

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

export function Card({ children, className, strong }: { children: ReactNode; className?: string; strong?: boolean }) {
  return <div className={cx('glass rounded-3xl shadow-card', strong && 'bg-surface-strong', className)}>{children}</div>
}

export function Button({ variant = 'primary', loading, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' | 'soft'; loading?: boolean }) {
  const v = {
    primary: 'bg-accent text-accent-ink hover:opacity-90',
    ghost: 'bg-transparent text-ink border border-line hover:bg-muted',
    soft: 'bg-muted text-ink hover:opacity-80',
    danger: 'bg-danger text-white hover:opacity-90',
  }[variant]
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx('min-h-11 inline-flex items-center justify-center gap-2 rounded-2xl px-5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-45', v, className)}
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
      <input {...rest} className={cx('mt-1.5 min-h-11 w-full rounded-2xl border border-line bg-surface-strong px-4 text-sm text-ink placeholder:text-subtle', rest.className)} />
      {hint && <span className="mt-1 block text-xs text-subtle">{hint}</span>}
    </label>
  )
}

export function Badge({ children, kind = 'info' }: { children: ReactNode; kind?: 'good' | 'bad' | 'warn' | 'info' | 'sandbox' | 'live' }) {
  const k = {
    good: 'text-success bg-success/10',
    bad: 'text-danger bg-danger/10',
    warn: 'text-warn bg-warn/10',
    info: 'text-ink-2 bg-muted',
    sandbox: 'text-warn bg-warn/10 border border-warn/30',
    live: 'text-success bg-success/10 border border-success/30',
  }[kind]
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold', k)}>{children}</span>
}

export const Sandbox = ({ label = 'Sandbox' }: { label?: string }) => <Badge kind="sandbox">{label}</Badge>

export function StatusBadge({ status }: { status: string }) {
  return <Badge kind={tone(status)}>{STATUS_LABEL[status] ?? status}</Badge>
}

export function Stat({ label, value, sub, className }: { label: string; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="eyebrow">{label}</div>
      <div className="display num mt-1 text-2xl font-semibold text-ink">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-subtle">{sub}</div>}
    </div>
  )
}

const LOGOS = {
  USDC: TokenUSDC, USDT: TokenUSDT, BTC: TokenBTC, SOL: TokenSOL, ETH: TokenETH, DAI: TokenDAI, WBTC: TokenWBTC, BNB: TokenBNB, POL: TokenPOL,
  LINK: TokenLINK, UNI: TokenUNI, AAVE: TokenAAVE, ARB: TokenARB, OP: TokenOP, EURC: TokenEURC,
} as const

/** Wrapped assets have no icon of their own: show the base asset's mark with a small badge. */
const WRAPPED: Record<string, { base: keyof typeof LOGOS; tag: string }> = { WETH: { base: 'ETH', tag: 'W' }, CBBTC: { base: 'BTC', tag: 'cb' } }

/** `logo` is the icon key stored with the token in the registry; it falls back to the symbol. */
export function TokenIcon({ symbol, size = 28, logo }: { symbol: string; size?: number; logo?: string }) {
  const p = { variant: 'branded' as const, size }
  const key = (logo ?? symbol).toUpperCase()
  if (key === 'NGN') return <div className="grid place-items-center rounded-full bg-success/15 font-bold text-success" style={{ width: size, height: size, fontSize: size * 0.5 }} aria-label="Naira">₦</div>
  const Logo = LOGOS[key as keyof typeof LOGOS]
  if (Logo) return <Logo {...p} />
  const w = WRAPPED[key]
  if (w) {
    const Base = LOGOS[w.base]
    return (
      <span className="relative inline-block" style={{ width: size, height: size }}>
        <Base {...p} />
        <span className="absolute -bottom-0.5 -right-0.5 grid place-items-center rounded-full bg-ink px-[3px] font-bold leading-none text-bg" style={{ fontSize: Math.max(8, size * 0.3), minWidth: size * 0.42, height: size * 0.42 }}>{w.tag}</span>
      </span>
    )
  }
  return <div className="grid place-items-center rounded-full bg-muted text-xs font-bold" style={{ width: size, height: size }}>{symbol.slice(0, 1).toUpperCase()}</div>
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="inline-flex w-full rounded-2xl bg-muted p-1" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx('min-h-10 flex-1 rounded-xl px-3 text-sm font-semibold transition', value === o.value ? 'bg-surface-strong text-ink shadow-sm' : 'text-subtle hover:text-ink')}
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
      <span className="text-subtle">{label}</span>
      <span className={cx('num text-right font-medium text-ink', mono && 'mono text-xs')}>{value}</span>
    </div>
  )
}

export function Empty({ title, body }: { title: string; body?: string }) {
  return (
    <div className="px-6 py-12 text-center">
      <div className="display text-lg font-semibold">{title}</div>
      {body && <p className="mx-auto mt-1 max-w-sm text-pretty text-sm text-subtle">{body}</p>}
    </div>
  )
}

export const PageTitle = ({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) => (
  <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
    <div>
      <h1 className="display text-balance text-3xl font-semibold">{title}</h1>
      {sub && <p className="mt-1 max-w-xl text-pretty text-sm text-subtle">{sub}</p>}
    </div>
    {right}
  </div>
)
