import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from './api'
import { useSession } from './session'
import { applyTheme, getTheme, localTheme, rememberTheme, type ThemeDef } from './themes'
import { isThemeId, type ThemeId } from './themeIds'

interface Ctx {
  themeId: ThemeId
  theme: ThemeDef
  art: 0 | 1 | 2
  /** Changes the colours everywhere at once, then saves the choice to the account. A failed save keeps the new theme on screen. */
  setTheme: (id: ThemeId) => void
  saving: boolean
}
const ThemeCtx = createContext<Ctx | null>(null)

/**
 * The saved theme is applied from this device's copy straight away (main.tsx), then replaced by the account's copy once the
 * server answers, so the same theme follows the user to every device they sign in on.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { user } = useSession()
  const [themeId, setThemeId] = useState<ThemeId>(localTheme)
  const [saving, setSaving] = useState(false)
  // Once the user picks a theme in this session, a slower server answer must not overwrite it.
  const picked = useRef(false)

  useEffect(() => {
    applyTheme(themeId)
    rememberTheme(themeId)
  }, [themeId])

  const { data } = useQuery({
    queryKey: ['appearance', user?.id],
    enabled: Boolean(user),
    queryFn: () => api<{ themeId: string }>('/api/settings/appearance'),
    staleTime: Infinity,
    retry: 1,
  })
  useEffect(() => {
    if (data && !picked.current && isThemeId(data.themeId)) setThemeId(data.themeId)
  }, [data])
  useEffect(() => {
    picked.current = false
  }, [user?.id])

  const setTheme = useCallback((id: ThemeId) => {
    picked.current = true
    setThemeId(id)
    applyTheme(id)
    rememberTheme(id)
    setSaving(true)
    api('/api/settings/appearance', { method: 'PUT', body: { themeId: id } })
      .catch((e: unknown) => toast.error(`Theme applied here, but not saved to your account: ${e instanceof Error ? e.message : 'request failed'}`))
      .finally(() => setSaving(false))
  }, [])

  const value = useMemo<Ctx>(() => {
    const theme = getTheme(themeId)
    return { themeId, theme, art: theme.art, setTheme, saving }
  }, [themeId, setTheme, saving])
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>
}

export function useTheme() {
  const c = useContext(ThemeCtx)
  if (!c) throw new Error('useTheme must be used inside ThemeProvider')
  return c
}
