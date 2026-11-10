import { Minus, Plus, RotateCcw } from 'lucide-react'
import { DEFAULT_TEXT_SIZE } from '@/lib/textSizeIds'
import { useTextSize } from '@/lib/textSize'
import { TEXT_SIZES } from '@/lib/textSizes'
import { Button, Card, cx } from '../ui'

/**
 * Text size: a live preview, quick A- and A+ steps, four tap buttons and a reset. Everything here uses the same type scale as the
 * rest of the app, so the preview is exactly what the screens will look like.
 */
export function TextSizePicker() {
  const { sizeId, size, setSize, step, reset, saving } = useTextSize()
  const atMin = sizeId === TEXT_SIZES[0]?.id
  const atMax = sizeId === TEXT_SIZES[TEXT_SIZES.length - 1]?.id
  const stepBtn = 'border border-outline grid min-h-14 min-w-14 place-items-center rounded-full bg-accent px-4 text-accent-ink'
  return (
    <div className="space-y-5">
      <Card strong className="p-5">
        <div className="eyebrow">Preview</div>
        <div className="display num mt-2 break-words text-4xl">₦148,000.00</div>
        <p className="mt-3 text-pretty text-sm">Your balance is safe and your payouts are on their way. Tap any button to continue.</p>
        <Button className="mt-4 w-full" type="button">Send money</Button>
      </Card>

      <Card className="p-5">
        <div className="flex items-center justify-between gap-3">
          <button type="button" onClick={() => step(-1)} disabled={atMin} aria-label="Make text smaller" className={cx(stepBtn, 'text-sm')}>
            <span className="flex items-center gap-1">A<Minus size={14} strokeWidth={4} /></span>
          </button>
          <div className="min-w-0 text-center">
            <div className="display text-xl">{size.label}</div>
            <div className="num text-sm text-subtle">{size.percent}%</div>
          </div>
          <button type="button" onClick={() => step(1)} disabled={atMax} aria-label="Make text bigger" className={cx(stepBtn, 'text-lg')}>
            <span className="flex items-center gap-1">A<Plus size={16} strokeWidth={4} /></span>
          </button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3" role="radiogroup" aria-label="Text size">
          {TEXT_SIZES.map((t) => {
            const selected = t.id === sizeId
            return (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setSize(t.id)}
                className={cx('border border-outline no-pop min-h-16 rounded-2xl px-3 py-2 text-center', selected ? 'bg-accent text-accent-ink shadow-pop' : 'bg-surface-strong text-ink')}
              >
                <span className="block text-base">{t.label}</span>
                <span className="num block text-sm">{t.percent}%</span>
              </button>
            )
          })}
        </div>

        <Button type="button" variant="ghost" className="mt-5 w-full" onClick={reset} disabled={sizeId === DEFAULT_TEXT_SIZE}>
          <RotateCcw size={16} /> Reset to default
        </Button>
      </Card>

      <p className="plate-sub text-xs" role="status">{saving ? 'Saving your text size…' : 'Your text size is saved to your account and follows you to any device you sign in on.'}</p>
    </div>
  )
}
