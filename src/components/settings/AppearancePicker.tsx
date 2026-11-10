import { Check } from 'lucide-react'
import { useTheme } from '@/lib/theme'
import { THEMES, luminance } from '@/lib/themes'
import { cx } from '../ui'

/** Dark themes get a lighter rim in their preview so a dark card stays visible on a dark page. */
const rim = (t: { bg: string; card: string; button: string }) => (luminance(t.bg) < 0.03 && luminance(t.card) < 0.03 ? t.button : 'var(--outline)')

/** Two-column grid of the ten themes. Each tile previews the theme's background, card and button. Tapping one changes the whole app at once. */
export function AppearancePicker() {
  const { themeId, setTheme, saving } = useTheme()
  return (
    <div>
      <div className="grid grid-cols-2 gap-4" role="radiogroup" aria-label="Colour theme">
        {THEMES.map((t) => {
          const selected = t.id === themeId
          return (
            <button
              key={t.id}
              role="radio"
              aria-checked={selected}
              onClick={() => setTheme(t.id)}
              className={cx('glass no-pop relative overflow-hidden rounded-3xl p-2 text-left transition active:translate-x-0.5 active:translate-y-0.5', selected && 'outline outline-4 outline-offset-2 outline-[var(--accent)]')}
            >
              <div className="relative h-24 overflow-hidden rounded-2xl border-3 border-outline" style={{ background: t.bg }}>
                <div className="absolute left-3 top-3 h-12 w-[62%] rounded-xl border-2" style={{ background: t.card, borderColor: rim(t), boxShadow: `3px 3px 0 ${rim(t)}` }} />
                <div className="absolute bottom-3 right-3 h-6 w-[46%] rounded-full border-2" style={{ background: t.button, borderColor: rim(t) }} />
              </div>
              <div className="flex min-h-[44px] items-center justify-between gap-2 px-1.5 pt-2">
                <span className="text-sm font-extrabold leading-tight text-ink">{t.name}</span>
                {selected && (
                  <span className="grid size-7 shrink-0 place-items-center rounded-full border-2 border-outline bg-accent text-accent-ink" aria-label="Selected">
                    <Check size={16} strokeWidth={3} />
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>
      <p className="plate-sub mt-5 text-xs" role="status">{saving ? 'Saving your theme…' : 'Your theme is saved to your account and follows you to any device you sign in on.'}</p>
    </div>
  )
}
