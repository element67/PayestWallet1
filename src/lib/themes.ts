/**
 * One palette, two modes.
 *   page background  #FFFFFF (light) / charcoal #1C1C1E (dark)
 *   cards, sheets, tab bar  #F5F7FA (light) / #2A2A2D (dark), set apart by a thin line
 *   text  #050912 (light) / #FFFFFF (dark)
 *   blue  #1558C9 / #2F6FEB for the main button and the active tab; blue is never used for text or icons. All written text and icons are black (white in dark mode)
 * The Light / Dark toggle swaps the page, surface and text colours and nothing else. Every other token (muted fills,
 * secondary text, dividers) is a blend of those colours, and the status colours (success, danger, warning) keep their own
 * hues because they carry meaning. Every colour in the app is a token set here, so no screen carries a colour of its own.
 */
import { DEFAULT_MODE, isMode, type Mode } from './themeIds'

export const PALETTE = {
  light: { bg: '#FFFFFF', card: '#F3F6FA', ink: '#050912', line: '#B9C3D0', brand: '#1558C9' },
  dark: { bg: '#1C1C1E', card: '#2A2A2D', ink: '#FFFFFF', line: '#46474D', brand: '#6AA9FF' },
  /** The fill of the main button and the active tab. White text on it reads at 4.7:1 or better in both modes. */
  accent: { light: '#1558C9', dark: '#2F6FEB' },
} as const

/* ---------- colour maths ---------- */
type RGB = [number, number, number]
const toRgb = (hex: string): RGB => {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}
const toHex = ([r, g, b]: RGB) => `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`
const lin = (v: number) => {
  const s = v / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
export const luminance = (hex: string) => {
  const [r, g, b] = toRgb(hex)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}
export const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
/** `t` of the way from a to b. */
export const mix = (a: string, b: string, t: number) => {
  const x = toRgb(a)
  const y = toRgb(b)
  return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t])
}

const DARK_INK = '#0A0A10'
const LIGHT_INK = '#FFFFFF'
const inkOn = (bg: string) => (contrast(DARK_INK, bg) >= contrast(LIGHT_INK, bg) ? DARK_INK : LIGHT_INK)

/** Moves `fg` toward black or white until it reads on `bg` at the given ratio. */
const fit = (fg: string, bg: string, min = 4.5) => {
  const target = inkOn(bg)
  let c = fg
  for (let i = 0; i < 24 && contrast(c, bg) < min; i++) c = mix(c, target, 0.1)
  return c
}

/** Muted status colours: tags use them as a soft tint with coloured text, never as loud solid blocks. */
const STATUS = { success: '#2FA574', danger: '#E5534B', warn: '#D9A441' } as const
const triplet = (hex: string) => toRgb(hex).join(' ')

/** Muted fills, divider and text shades for one surface, plus status colours that read as TEXT on it. */
function surfaceTokens(surface: string, ink: string, mode: Mode, prefix: string): Record<string, string> {
  const light = mode === 'light'
  const muted = mix(surface, ink, light ? 0.05 : 0.07)
  const strong = mix(surface, ink, light ? 0.09 : 0.12)
  const out: Record<string, string> = {
    [`--${prefix}ink`]: ink,
    [`--${prefix}ink-2`]: mix(ink, surface, 0.06),
    // Muted text must stay readable on the surface AND on its inner fills.
    [`--${prefix}subtle`]: fit(mix(ink, surface, light ? 0.3 : 0.28), strong, light ? 7 : 5.5),
    [`--${prefix}muted`]: muted,
    [`--${prefix}strong`]: strong,
    [`--${prefix}divider`]: mix(surface, ink, light ? 0.22 : 0.18),
  }
  for (const [name, base] of Object.entries(STATUS)) out[`--${prefix}${name}-rgb`] = triplet(fit(base, strong))
  return out
}

/** Every CSS variable for a mode. */
export function themeVars(mode: Mode): Record<string, string> {
  const { bg, card, ink, line, brand } = PALETTE[mode]
  const accent = PALETTE.accent[mode]
  const page = surfaceTokens(bg, ink, mode, '')
  const onCard = surfaceTokens(card, ink, mode, 'card-')
  return {
    '--bg': bg,
    '--ink': page['--ink'],
    '--ink-2': page['--ink-2'],
    '--subtle': page['--subtle'],
    '--surface-muted': page['--muted'],
    '--surface-strong': page['--strong'],
    '--divider': page['--divider'],
    '--card': card,
    '--card-ink': onCard['--card-ink'],
    '--card-ink-2': onCard['--card-ink-2'],
    '--card-subtle': onCard['--card-subtle'],
    '--card-muted': onCard['--card-muted'],
    '--card-strong': onCard['--card-strong'],
    '--card-divider': onCard['--card-divider'],
    '--accent': accent,
    '--accent-ink': inkOn(accent),
    // A thin line around cards and fields keeps each feature clearly separate from the next, in both modes.
    '--outline': line,
    // Blue for feature labels and icons: the deeper blue on white, a lighter blue on charcoal so it stays easy to read.
    '--brand': brand,
    '--focus': accent,
    '--paper': LIGHT_INK,
    '--success-rgb': page['--success-rgb'],
    '--danger-rgb': page['--danger-rgb'],
    '--warn-rgb': page['--warn-rgb'],
    // Solid status fills (badges, banners) keep the vivid colour on every surface; the text on top is chosen against that colour.
    '--fill-success-rgb': triplet(STATUS.success),
    '--fill-danger-rgb': triplet(STATUS.danger),
    '--fill-warn-rgb': triplet(STATUS.warn),
    '--on-success': inkOn(STATUS.success),
    '--on-danger': inkOn(STATUS.danger),
    '--on-warn': inkOn(STATUS.warn),
    '--card-success-rgb': onCard['--card-success-rgb'],
    '--card-danger-rgb': onCard['--card-danger-rgb'],
    '--card-warn-rgb': onCard['--card-warn-rgb'],
  }
}

/* ---------- applying and remembering ---------- */
const MODE_KEY = 'nb_theme_mode'

export function applyTheme(mode: Mode = DEFAULT_MODE): Mode {
  const root = document.documentElement
  for (const [k, v] of Object.entries(themeVars(mode))) root.style.setProperty(k, v)
  root.dataset.mode = mode
  root.style.colorScheme = mode
  return mode
}

/** The saved mode on this device. The app is bright by default: it only goes dark when the user chooses Dark. */
export function localMode(): Mode {
  try {
    const v = localStorage.getItem(MODE_KEY)
    if (isMode(v)) return v
    return DEFAULT_MODE
  } catch {
    return DEFAULT_MODE
  }
}

export function rememberMode(mode: Mode) {
  try {
    localStorage.setItem(MODE_KEY, mode)
  } catch {
    /* private mode: the choice lasts until the tab closes */
  }
}
