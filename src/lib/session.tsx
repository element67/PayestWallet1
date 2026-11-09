import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, getToken, setToken, type AppConfig, type PublicUser } from './api'

type Theme = 'light' | 'dark'
interface Ctx {
  user: PublicUser | null
  loading: boolean
  config: AppConfig | undefined
  theme: Theme
  toggleTheme: () => void
  signIn: (token: string, user: PublicUser) => void
  signOut: () => Promise<void>
}
const SessionCtx = createContext<Ctx | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [user, setUser] = useState<PublicUser | null>(null)
  const [booting, setBooting] = useState(Boolean(getToken()))
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('nb_theme') as Theme) || 'dark')

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem('nb_theme', theme)
  }, [theme])

  useEffect(() => {
    if (!getToken()) return
    api<{ user: PublicUser }>('/api/me')
      .then((r) => setUser(r.user))
      .catch(() => setToken(null))
      .finally(() => setBooting(false))
  }, [])

  // Rotate the session token every 20 minutes: the old one stops working as soon as the new one is issued.
  useEffect(() => {
    if (!user) return
    const t = setInterval(() => {
      api<{ token: string }>('/api/auth/rotate', { method: 'POST' }).then((r) => setToken(r.token)).catch(() => undefined)
    }, 20 * 60_000)
    return () => clearInterval(t)
  }, [user])

  const { data: config } = useQuery({ queryKey: ['config'], queryFn: () => api<AppConfig>('/api/config'), refetchInterval: 15000 })

  const signIn = useCallback((token: string, u: PublicUser) => {
    setToken(token)
    qc.clear()
    setUser(u)
  }, [qc])

  const signOut = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined)
    setToken(null)
    qc.clear()
    setUser(null)
  }, [qc])

  const value = useMemo<Ctx>(
    () => ({ user, loading: booting, config, theme, toggleTheme: () => setTheme((t) => (t === 'light' ? 'dark' : 'light')), signIn, signOut }),
    [user, booting, config, theme, signIn, signOut],
  )
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>
}

export function useSession() {
  const c = useContext(SessionCtx)
  if (!c) throw new Error('useSession must be used inside SessionProvider')
  return c
}
