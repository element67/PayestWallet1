import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { TokenIcon, cx } from '../ui'

export interface SelectToken { symbol: string; label: string; name: string; balance?: string | null }

/** A compact token chooser: the chosen token's logo and symbol, and a list of the others with their logos and your balance. Works with the keyboard. */
export function TokenSelect({ label, value, tokens, onChange, showBalance }: { label: string; value: string; tokens: SelectToken[]; onChange: (symbol: string) => void; showBalance?: boolean }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const current = tokens.find((t) => t.symbol === value) ?? tokens[0]

  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc) }
  }, [open])

  if (!current) return null
  return (
    <div ref={root} className="relative shrink-0">
      <button type="button" aria-label={`${label}: ${current.label}`} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-line-strong bg-card px-3 text-sm font-bold">
        <TokenIcon symbol={current.symbol} size={24} />{current.label}<ChevronDown size={16} className={cx(open && 'rotate-180')} />
      </button>
      {open && (
        <ul role="listbox" aria-label={label} className="absolute left-0 top-full z-30 mt-2 max-h-72 w-64 max-w-[80vw] overflow-auto rounded-2xl border border-line-strong bg-card p-1 shadow-none">
          {tokens.map((t) => (
            <li key={t.symbol} role="option" aria-selected={t.symbol === current.symbol}>
              <button type="button" onClick={() => { onChange(t.symbol); setOpen(false) }} className="flex min-h-[48px] w-full items-center gap-3 rounded-xl px-3 text-left hover:bg-muted">
                <TokenIcon symbol={t.symbol} size={28} />
                <span className="min-w-0 flex-1 leading-tight"><span className="block text-sm font-bold">{t.label}</span>
                  {showBalance && <span className="block text-xs text-subtle">{t.balance === undefined ? '' : t.balance === null ? 'Balance unavailable' : t.balance}</span>}
                </span>
                {t.symbol === current.symbol && <Check size={16} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
