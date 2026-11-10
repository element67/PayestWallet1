/**
 * Colour themes. A theme is only three colours: background, card and button. Everything else (text colours, outlines,
 * status colours, background artwork) is derived from them here, so no screen or component carries a colour of its own.
 * Text colours are chosen by contrast, so they stay readable on every background in every theme.
 */
import { DEFAULT_THEME, isThemeId, type ThemeId } from './themeIds'

export interface ThemeDef {
  id: ThemeId
  name: string
  bg: string
  card: string
  button: string
  /** Which background composition this theme uses (see Backdrop). */
  art: 0 | 1 | 2
}

export const THEMES: ThemeDef[] = [
  { id: 'cobalt-lime', name: 'Cobalt Lime', bg: '#030407', card: '#1558C9', button: '#D4FF24', art: 0 },
  { id: 'orange-tape', name: 'Orange Tape', bg: '#F04400', card: '#FFD91A', button: '#000000', art: 1 },
  { id: 'forest-crimson', name: 'Forest Crimson', bg: '#06110C', card: '#171717', button: '#A31C1B', art: 2 },
  { id: 'neon-emerald', name: 'Neon Emerald', bg: '#000000', card: '#0E1A10', button: '#39FF88', art: 0 },
  { id: 'mint-noir', name: 'Mint Noir', bg: '#39F0AE', card: '#000000', button: '#FF0000', art: 1 },
  { id: 'lemon-lavender', name: 'Lemon Lavender', bg: '#FFF21A', card: '#171717', button: '#A66BFF', art: 2 },
  { id: 'orchid-orange', name: 'Orchid Orange', bg: '#E7B0DE', card: '#400849', button: '#FF5A0A', art: 0 },
  { id: 'hot-pink-pulse', name: 'Hot Pink Pulse', bg: '#0B0B0B', card: '#1C1C1C', button: '#FF2DA8', art: 1 },
  { id: 'lavender-tomato', name: 'Lavender Tomato', bg: '#CBB3E8', card: '#D4FF3F', button: '#E34234', art: 2 },
  { id: 'sage-burgundy', name: 'Sage Burgundy', bg: '#A5A79B', card: '#E8D2B5', button: '#590907', art: 0 },
]

export const getTheme = (id: string | null | undefined): ThemeDef => THEMES.find((t) => t.id === id) ?? THEMES[0]

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
  for (let i = 0; i < 20 && contrast(c, bg) < min; i++) c = mix(c, target, 0.12)
  return c
}

const STATUS = { success: '#1FBF63', danger: '#F0344F', warn: '#F2A20C' } as const
const triplet = (hex: string) => toRgb(hex).join(' ')

/** Muted text shades and divider for one surface colour, plus status colours that read as TEXT on it. */
function surfaceTokens(surface: string, prefix: string): Record<string, string> {
  const ink = inkOn(surface)
  // Inner fills (fields, chips, tracks) get their own tint of the surface.
  // Fills move away from the text colour, so contrast with the text only goes up. On near-black surfaces there is no room to go darker, so they lift slightly instead.
  const darkInk = luminance(ink) < 0.5
  const nearBlack = luminance(surface) < 0.06
  const pole = darkInk ? '#FFFFFF' : nearBlack ? ink : '#000000'
  const muted = mix(surface, pole, darkInk ? 0.4 : nearBlack ? 0.12 : 0.3)
  const strong = mix(surface, pole, darkInk ? 0.6 : nearBlack ? 0.2 : 0.5)
  const out: Record<string, string> = {
    [`--${prefix}ink`]: ink,
    [`--${prefix}ink-2`]: mix(ink, surface, 0.12),
    // Muted text must stay readable on the surface AND on its inner fills.
    [`--${prefix}subtle`]: fit(fit(mix(ink, surface, 0.3), surface, 4.8), strong, 4.8),
    [`--${prefix}muted`]: muted,
    [`--${prefix}strong`]: strong,
    [`--${prefix}divider`]: mix(surface, ink, 0.3),
  }
  for (const [name, base] of Object.entries(STATUS)) out[`--${prefix}${name}-rgb`] = triplet(fit(base, surface))
  return out
}

/** Every CSS variable for a theme. */
export function themeVars(t: ThemeDef): Record<string, string> {
  const { bg, card, button } = t
  const ink = inkOn(bg)
  const buttonInk = inkOn(button)
  const bgDark = luminance(bg) < 0.03
  const cardDark = luminance(card) < 0.03
  // Dark cards on a dark page would lose their edge, so their hard shadow takes the button colour instead.
  const shadow = bgDark && cardDark ? button : DARK_INK
  const page = surfaceTokens(bg, '')
  const onCard = surfaceTokens(card, 'card-')

  // Artwork. Big shapes only use colours the page text can sit on; bolder colours go to small accents at the edges.
  const safe = (c: string) => contrast(ink, c) >= 4.5 && contrast(page['--subtle'], c) >= 4.5
  const tint = (c: string) => {
    let v = mix(bg, c, 0.35)
    for (let i = 0; i < 6 && !safe(v); i++) v = mix(v, bg, 0.4)
    return v
  }
  const big1 = safe(card) ? card : tint(card)
  const big2 = safe(button) ? button : tint(button)
  let big3 = mix(bg, ink, bgDark ? 0.2 : 0.12)
  for (let i = 0; i < 8 && !safe(big3); i++) big3 = mix(big3, bg, 0.4)
  const big6 = safe(mix(card, button, 0.5)) ? mix(card, button, 0.5) : tint(mix(card, button, 0.5))

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
    '--accent': button,
    '--accent-ink': buttonInk,
    '--outline': DARK_INK,
    '--shadow-c': shadow,
    '--focus': fit(button, bg, 3),
    '--paper': LIGHT_INK,
    '--halftone': mix(bg, ink, bgDark ? 0.16 : 0.14),
    '--art-1': big1,
    '--art-2': big2,
    '--art-3': big3,
    '--art-4': button,
    '--art-5': card,
    '--art-6': big6,
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
const KEY = 'nb_theme_id'

export function applyTheme(id: string): ThemeId {
  const theme = getTheme(id)
  const root = document.documentElement
  for (const [k, v] of Object.entries(themeVars(theme))) root.style.setProperty(k, v)
  root.dataset.theme = theme.id
  root.dataset.art = String(theme.art)
  root.style.colorScheme = luminance(theme.bg) < 0.18 ? 'dark' : 'light'
  return theme.id
}

export function localTheme(): ThemeId {
  try {
    const v = localStorage.getItem(KEY)
    return isThemeId(v) ? v : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

export function rememberTheme(id: ThemeId) {
  try {
    localStorage.setItem(KEY, id)
  } catch {
    /* private mode: the server copy still applies */
  }
}
