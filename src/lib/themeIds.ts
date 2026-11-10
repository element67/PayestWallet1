/** The ten colour themes. The ids are shared by the app and the API, which accepts nothing else. */
export const THEME_IDS = [
  'cobalt-lime', 'orange-tape', 'forest-crimson', 'neon-emerald', 'mint-noir',
  'lemon-lavender', 'orchid-orange', 'hot-pink-pulse', 'lavender-tomato', 'sage-burgundy',
] as const

export type ThemeId = (typeof THEME_IDS)[number]
export const DEFAULT_THEME: ThemeId = 'cobalt-lime'
export const isThemeId = (v: unknown): v is ThemeId => typeof v === 'string' && (THEME_IDS as readonly string[]).includes(v)
