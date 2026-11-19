import { TokenIcon } from '../ui'
import type { TradeToken } from '@/lib/trade'

/** What goes in front of each balance ("$" as requested). Set to '' to show the bare number. */
export const BALANCE_PREFIX = '$'

/** A balance such as "$10.00": rounded down to two places. "—" while loading or when it can't be read, never a made-up zero. */
export function formatBalance(b: string | null | undefined): string {
  if (b === undefined || b === null || !/^\d+(\.\d+)?$/.test(b)) return '—'
  const [whole, frac = ''] = b.split('.')
  return `${BALANCE_PREFIX}${whole}.${(frac + '00').slice(0, 2)}`
}

/** Token choices with their logos. With balances it is a list and the balance sits right-aligned; without, compact tap targets. */
export function TokenRow({ tokens, value, onChange, balances }: { tokens: TradeToken[]; value: string; onChange: (s: string) => void; balances?: Record<string, string | null> }) {
  return (
    <div className={balances ? 'flex flex-col gap-2' : 'flex flex-wrap gap-2'} role="radiogroup">
      {tokens.map((t) => (
        <button key={t.symbol} type="button" role="radio" aria-checked={value === t.symbol} onClick={() => onChange(t.symbol)}
          className={'flex min-h-[48px] items-center gap-2 rounded-2xl border px-3 text-left ' + (balances ? 'w-full justify-between ' : '') + (value === t.symbol ? 'border-ink bg-muted' : 'border-line-strong')}>
          <span className="flex items-center gap-2"><TokenIcon symbol={t.symbol} size={24} /><span className="text-sm font-bold">{t.label}</span></span>
          {balances && <span className="num text-sm font-bold tabular-nums">{formatBalance(balances[t.symbol])}</span>}
        </button>
      ))}
    </div>
  )
}
