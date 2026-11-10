/** The four text sizes. The ids are shared by the app and the API, which accepts nothing else. */
export const TEXT_SIZE_IDS = ['small', 'medium', 'large', 'xlarge'] as const

export type TextSizeId = (typeof TEXT_SIZE_IDS)[number]
export const DEFAULT_TEXT_SIZE: TextSizeId = 'medium'
export const isTextSizeId = (v: unknown): v is TextSizeId => typeof v === 'string' && (TEXT_SIZE_IDS as readonly string[]).includes(v)
