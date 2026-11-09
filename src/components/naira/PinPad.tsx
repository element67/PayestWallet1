import { useEffect, useRef, useState } from 'react'
import { Delete } from 'lucide-react'
import { cx } from '../ui'

/** Four-digit PIN entry. Mount it with a new `key` to clear it after a wrong attempt. */
export function PinPad({ onComplete, disabled, error }: { onComplete: (pin: string) => void; disabled?: boolean; error?: string | null }) {
  const [pin, setPin] = useState('')
  const done = useRef(false)

  const push = (d: string) => {
    if (disabled || done.current) return
    const next = (pin + d).slice(0, 4)
    setPin(next)
    if (next.length === 4) {
      done.current = true
      onComplete(next)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) push(e.key)
      if (e.key === 'Backspace' && !done.current) setPin((p) => p.slice(0, -1))
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  return (
    <div className="mx-auto max-w-xs text-center">
      <div className="mb-2 flex justify-center gap-3" aria-label={`${pin.length} of 4 digits entered`}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={cx('size-4 rounded-full border-2 transition', i < pin.length ? 'border-accent bg-accent' : 'border-line-strong')} />
        ))}
      </div>
      <p className={cx('min-h-5 text-sm', error ? 'text-danger' : 'text-subtle')} role={error ? 'alert' : undefined}>{error ?? 'Enter your 4-digit transaction PIN'}</p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} disabled={disabled} onClick={() => push(d)} className="display min-h-14 rounded-2xl bg-muted text-2xl font-semibold transition active:scale-95 disabled:opacity-50">{d}</button>
        ))}
        <span />
        <button disabled={disabled} onClick={() => push('0')} className="display min-h-14 rounded-2xl bg-muted text-2xl font-semibold transition active:scale-95 disabled:opacity-50">0</button>
        <button aria-label="Delete" disabled={disabled} onClick={() => !done.current && setPin((p) => p.slice(0, -1))} className="grid min-h-14 place-items-center rounded-2xl text-subtle hover:bg-muted"><Delete size={22} /></button>
      </div>
    </div>
  )
}
