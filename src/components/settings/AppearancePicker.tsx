import { Moon, Sun } from 'lucide-react'
import { useTheme } from '@/lib/theme'
import type { Mode } from '@/lib/themeIds'
import { cx } from '../ui'

const MODE_OPTIONS: { id: Mode; label: string; icon: typeof Sun }[] = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
]

/** The Light / Dark switch. It swaps the page, card and text colours; the accent blue stays the same. */
export function AppearancePicker() {
  const { mode, setMode } = useTheme()
  return (
    <div>
      <div className="grid grid-cols-2 gap-2 rounded-full bg-surface-strong p-1" role="radiogroup" aria-label="Light or dark mode">
        {MODE_OPTIONS.map((o) => (
          <button
            key={o.id}
            role="radio"
            aria-checked={mode === o.id}
            onClick={() => setMode(o.id)}
            className={cx('no-pop flex min-h-11 items-center justify-center gap-2 rounded-full px-3 text-sm font-semibold', mode === o.id ? 'bg-accent text-accent-ink' : 'text-ink')}
          >
            <o.icon size={16} />
            {o.label}
          </button>
        ))}
      </div>
      <p className="plate-sub mt-5 text-xs" role="status">Your choice is remembered on this device. Until you choose, the app follows your device's own light or dark setting.</p>
    </div>
  )
}
