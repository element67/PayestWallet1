import { DEFAULT_TEXT_SIZE, isTextSizeId, TEXT_SIZE_IDS, type TextSizeId } from './textSizeIds'

export interface TextSizeDef { id: TextSizeId; label: string; percent: number; scale: number }

/**
 * The one place text sizes are defined. `scale` multiplies every font size in the app (see tailwind.config.js, which writes all
 * font sizes as rem * var(--text-scale)). Small is the base: 16px body text and 14px for the smallest text.
 */
export const TEXT_SIZES: readonly TextSizeDef[] = [
  { id: 'small', label: 'Small', percent: 100, scale: 1 },
  { id: 'medium', label: 'Medium', percent: 115, scale: 1.15 },
  { id: 'large', label: 'Large', percent: 130, scale: 1.3 },
  { id: 'xlarge', label: 'Extra large', percent: 150, scale: 1.5 },
]

export const getTextSize = (id: TextSizeId): TextSizeDef => TEXT_SIZES.find((s) => s.id === id) ?? (TEXT_SIZES[1])
export const stepTextSize = (id: TextSizeId, dir: -1 | 1): TextSizeId => TEXT_SIZE_IDS[Math.min(TEXT_SIZE_IDS.length - 1, Math.max(0, TEXT_SIZE_IDS.indexOf(id) + dir))]

const KEY = 'nb_text_size'

/** This device's copy, so the right size shows before the server answers. */
export function localTextSize(): TextSizeId {
  try {
    const v = localStorage.getItem(KEY)
    return isTextSizeId(v) ? v : DEFAULT_TEXT_SIZE
  } catch {
    return DEFAULT_TEXT_SIZE
  }
}
export function rememberTextSize(id: TextSizeId) {
  try {
    localStorage.setItem(KEY, id)
  } catch {
    /* storage can be blocked; the account copy still applies */
  }
}

/** Sets the scale on the page. Everything sized in rem or through the Tailwind type scale follows at once. */
export function applyTextSize(id: TextSizeId) {
  const { scale } = getTextSize(id)
  const root = document.documentElement
  root.style.setProperty('--text-scale', String(scale))
  // Big headlines and balances grow half as fast so a wide heavy font still fits a phone.
  root.style.setProperty('--text-scale-h', String(1 + (scale - 1) * 0.5))
  root.dataset.text = id
}
