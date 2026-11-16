'use client'

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { View } from '@/components/Shell'
import type { Intent, SettingsPage } from './nav'

/** One real URL per customer screen. Screens that open on a specific form carry it in the query: /crypto?screen=send. */
export const VIEW_PATH: Record<View, string> = {
  home: '/', exchange: '/exchange', crypto: '/crypto', wallet: '/wallet', more: '/more',
  profile: '/profile', activity: '/activity', alerts: '/alerts', settings: '/settings',
}

export function viewFromPath(pathname: string): View {
  const clean = pathname.replace(/\/+$/, '') || '/'
  return (Object.entries(VIEW_PATH).find(([, p]) => p === clean)?.[0] as View | undefined) ?? 'home'
}

const SCREENS = ['send', 'receive', 'swap', 'bridge', 'buy', 'sell', 'transfer'] as const
const SETTINGS: SettingsPage[] = ['list', 'display', 'appearance', 'textsize', 'notifications', 'security', 'linked', 'help']

export function intentToQuery(i: Intent & { order?: string } = {}): string {
  const q = new URLSearchParams()
  if (i.screen) q.set('screen', i.screen)
  if (i.side) q.set('side', i.side)
  if (i.settings) q.set('settings', i.settings)
  if (i.order) q.set('order', i.order)
  const s = q.toString()
  return s ? `?${s}` : ''
}

/** Reads the intent back from the address. Unknown values are ignored, never trusted. */
export function intentFromQuery(q: URLSearchParams): Intent & { order?: string } {
  const screen = q.get('screen'), side = q.get('side'), settings = q.get('settings'), order = q.get('order')
  return {
    screen: SCREENS.find((s) => s === screen),
    side: side === 'sell' || side === 'buy' ? side : undefined,
    settings: SETTINGS.find((s) => s === settings),
    order: order && /^[\w-]{4,60}$/.test(order) ? order : undefined,
  }
}

interface NavApi { view: View; go: (v: View, i?: Intent & { order?: string }) => void; intent: Intent & { order?: string }; query: string }
const NavCtx = createContext<NavApi | null>(null)

export function NavProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const go = useCallback((v: View, i: Intent & { order?: string } = {}) => router.push(`${VIEW_PATH[v]}${intentToQuery(i)}`), [router])
  const query = params.toString()
  const value = useMemo<NavApi>(() => ({ view: viewFromPath(pathname), go, intent: intentFromQuery(new URLSearchParams(query)), query }), [pathname, go, query])
  return <NavCtx.Provider value={value}>{children}</NavCtx.Provider>
}

export function useNav(): NavApi {
  const c = useContext(NavCtx)
  if (!c) throw new Error('useNav must be used inside NavProvider')
  return c
}
