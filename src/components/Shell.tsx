import type { ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ConnectKitButton } from 'connectkit'
import { Activity, ArrowLeftRight, Bell, Bot, Coins, Ellipsis, FlaskConical, Home, LogOut, Settings, Shield, Sun, UserRound, Wallet } from 'lucide-react'
import { api, type PublicUser } from '@/lib/api'
import type { Intent } from '@/lib/nav'
import { useNotifications } from '@/lib/queries'
import { useSession } from '@/lib/session'
import { cx } from './ui'

export type View = 'home' | 'crypto' | 'wallet' | 'exchange' | 'more' | 'profile' | 'activity' | 'alerts' | 'settings' | 'founder' | 'agent'

interface NavItem { id: View; label: string; icon: typeof Home }

const PRIMARY: NavItem[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'exchange', label: 'Exchange', icon: ArrowLeftRight },
  { id: 'crypto', label: 'Crypto', icon: Coins },
  { id: 'wallet', label: 'Naira', icon: Wallet },
]
const MORE_ITEMS: NavItem[] = [
  { id: 'profile', label: 'Profile', icon: UserRound },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'alerts', label: 'Alerts', icon: Bell },
]
const FOUNDER_ITEMS: NavItem[] = [
  { id: 'founder', label: 'Founder', icon: Shield },
  { id: 'agent', label: 'AI Agent', icon: Bot },
]

/** Every screen reached from the More tab. */
export const moreItemsFor = (founder: boolean): NavItem[] => (founder ? [...FOUNDER_ITEMS, ...MORE_ITEMS] : MORE_ITEMS)

export function Shell({ view, go, children }: { view: View; go: (v: View, i?: Intent) => void; children: ReactNode }) {
  const { user, signOut, signIn, config } = useSession()
  const { data: notes } = useNotifications()
  const unread = notes?.filter((n) => !n.read).length ?? 0
  const items = moreItemsFor(user?.role === 'founder')
  const moreActive = view === 'more' || items.some((n) => n.id === view)

  const swap = useMutation({
    mutationFn: (role: 'user' | 'founder') => api<{ token: string; user: PublicUser }>('/api/auth/dev-session', { method: 'POST', body: { role } }),
    onSuccess: (r) => {
      signIn(r.token, r.user)
      go(r.user.role === 'founder' ? 'founder' : 'home')
    },
  })

  const pill = 'border border-outline min-h-11 rounded-full bg-card px-3 text-xs tracking-tight text-card-ink'
  const iconPill = 'border border-outline grid size-11 place-items-center rounded-full bg-card text-card-ink'

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[250px_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col p-5 lg:flex">
        <div className="glass flex h-full flex-col rounded-3xl p-4">
          <div className="display plate !inline-block self-start text-xl">NairaBridge</div>
          <nav className="mt-6 flex flex-1 flex-col gap-1.5 overflow-y-auto">
            {[...PRIMARY, ...items].map((n) => (
              <button
                key={n.id}
                onClick={() => go(n.id)}
                className={cx(
                  'no-pop flex min-h-11 items-center gap-3 rounded-full px-4 text-sm font-extrabold transition',
                  view === n.id ? 'border-2 border-outline bg-accent text-accent-ink shadow-pop' : 'text-ink hover:bg-muted',
                )}
              >
                <n.icon size={18} />
                {n.label}
                {n.id === 'alerts' && unread > 0 && <span className="ml-auto rounded-full border-2 border-outline bg-danger px-2 text-xs text-on-danger">{unread}</span>}
              </button>
            ))}
          </nav>
          <div className="truncate text-xs font-semibold text-subtle">{user?.email}</div>
        </div>
      </aside>

      <div className="min-w-0 pb-32 lg:pb-12">
        {config && (
          <div className="px-4 pt-3 lg:px-8">
            <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-3xl border-3 border-outline bg-warn px-4 py-2 text-center text-xs font-bold text-on-warn shadow-pop">
              <FlaskConical size={14} />
              <span>Sandbox: no real money moves. Naira payouts, vault releases and non-Arc chains are simulated.</span>
              {user?.devPreview && <span className="font-extrabold underline decoration-2">Development preview, no login.</span>}
            </div>
          </div>
        )}
        <header className="px-4 py-4 lg:px-8">
          <div className="flex items-center justify-between gap-3">
            <div className="display plate text-xl lg:hidden">NairaBridge</div>
            <div className="ml-auto flex items-center gap-2">
              <button onClick={() => go('settings', { settings: 'appearance' })} aria-label="Appearance" title="Appearance" className={iconPill}>
                <Sun size={18} />
              </button>
              <button onClick={() => void signOut()} aria-label="Sign out" className={iconPill}>
                <LogOut size={18} />
              </button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 lg:justify-end">
            {user?.devPreview && (
              <button onClick={() => swap.mutate(user.role === 'founder' ? 'user' : 'founder')} className={pill}>
                View as {user.role === 'founder' ? 'customer' : 'founder'}
              </button>
            )}
            <ConnectKitButton.Custom>
              {({ isConnected, show, truncatedAddress }) => (
                <button onClick={show} className={pill}>
                  {isConnected ? truncatedAddress : 'Connect wallet'}
                </button>
              )}
            </ConnectKitButton.Custom>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl px-4 lg:px-8">{children}</main>
      </div>

      <nav className="sticker fixed inset-x-1.5 bottom-3 z-30 mx-auto grid max-w-md grid-cols-5 gap-0.5 rounded-full p-1 lg:hidden" aria-label="Main">
        {PRIMARY.map((n) => (
          <button
            key={n.id}
            onClick={() => go(n.id)}
            aria-current={view === n.id ? 'page' : undefined}
            className={cx(
              'no-pop flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 rounded-full px-0 text-tab leading-none tracking-tighter',
              view === n.id ? 'border-2 border-outline bg-accent text-accent-ink' : 'text-ink',
            )}
          >
            <n.icon size={20} />
            {n.label}
          </button>
        ))}
        <button
          onClick={() => go('more')}
          aria-current={moreActive ? 'page' : undefined}
          className={cx(
            'no-pop relative flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 rounded-full px-0 text-tab leading-none tracking-tighter',
            moreActive ? 'border-2 border-outline bg-accent text-accent-ink' : 'text-ink',
          )}
        >
          <Ellipsis size={20} />
          More
          {unread > 0 && <span className="absolute right-[22%] top-1.5 size-3 rounded-full border-2 border-outline bg-danger" />}
        </button>
      </nav>
    </div>
  )
}
