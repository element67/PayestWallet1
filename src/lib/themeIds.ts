/** The six colour themes and the two modes. The ids are shared by the app and the API, which accepts nothing else. */
export const THEME_IDS = [
  'sage-burgundy', 'midnight-cobalt', 'lavender-tomato', 'orchid-violet', 'charcoal-crimson', 'mint-noir',
] as const

export type ThemeId = (typeof THEME_IDS)[number]
export const DEFAULT_THEME: ThemeId = 'midnight-cobalt'
export const isThemeId = (v: unknown): v is ThemeId => typeof v === 'string' && (THEME_IDS as readonly string[]).includes(v)

/** Every theme has a light and a dark mode. */
export const MODES = ['light', 'dark'] as const
export type Mode = (typeof MODES)[number]
export const DEFAULT_MODE: Mode = 'light'
export const isMode = (v: unknown): v is Mode => v === 'light' || v === 'dark'

/** Themes saved before the redesign keep their closest match; any other old id falls back to the default. */
const LEGACY: Record<string, ThemeId> = {
  'cobalt-lime': 'midnight-cobalt',
  'forest-crimson': 'charcoal-crimson',
  'orchid-orange': 'orchid-violet',
}
export const normalizeThemeId = (v: unknown): ThemeId => (isThemeId(v) ? v : typeof v === 'string' && LEGACY[v] ? LEGACY[v] : DEFAULT_THEME)
