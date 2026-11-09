import { useState, type ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ConnectKitButton } from 'connectkit'
import { Activity, ArrowLeftRight, Bell, Bot, FlaskConical, Home, LogOut, Moon, Settings, Shield, Sun, Wallet, Coins, Ellipsis, X } from 'lucide-react'
import { api, type PublicUser } from '@/lib/api'
import { useNotifications } from '@/lib/queries'
import { useSession } from '@/lib/session'
import { cx } from './ui'

export type View = 'home' | 'crypto' | 'wallet' | 'exchange' | 'activity' | 'alerts' | 'settings' | 'founder' | 'agent'

const USER_NAV: { id: View; label: string; icon: typeof Home }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'exchange', label: 'Exchange', icon: ArrowLeftRight },
  { id: 'crypto', label: 'Crypto', icon: Coins },
  { id: 'wallet', label: 'Naira', icon: Wallet },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'alerts', label: 'Alerts', icon: Bell },
  { id: 'settings', label: 'Settings', icon: Settings },
]
const PRIMARY: View[] = ['home', 'exchange', 'crypto', 'wallet']
const FOUNDER_NAV: { id: View; label: string; icon: typeof Home }[] = [
  { id: 'founder', label: 'Founder', icon: Shield },
  { id: 'agent', label: 'AI Agent', icon: Bot },
]

export function Shell({ view, setView, children }: { view: View; setView: (v: View) => void; children: ReactNode }) {
  const { user, theme, toggleTheme, signOut, signIn, config } = useSession()
  const { data: notes } = useNotifications()
  const unread = notes?.filter((n) => !n.read).length ?? 0
  const nav = user?.role === 'founder' ? [...FOUNDER_NAV, ...USER_NAV] : USER_NAV
  const [more, setMore] = useState(false)
  const primary = USER_NAV.filter((n) => PRIMARY.includes(n.id))
  const overflow = nav.filter((n) => !PRIMARY.includes(n.id))
  const moreActive = overflow.some((n) => n.id === view)

  const swap = useMutation({
    mutationFn: (role: 'user' | 'founder') => api<{ token: string; user: PublicUser }>('/api/auth/dev-session', { method: 'POST', body: { role } }),
    onSuccess: (r) => {
      signIn(r.token, r.user)
      setView(r.user.role === 'founder' ? 'founder' : 'home')
    },
  })

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[232px_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line p-5 lg:flex">
        <div className="display text-xl font-bold tracking-tight">NairaBridge</div>
        <nav className="mt-8 flex flex-1 flex-col gap-1">
          {nav.map((n) => (
            <button
              key={n.id}
              onClick={() => setView(n.id)}
              className={cx('flex min-h-11 items-center gap-3 rounded-2xl px-3.5 text-sm font-semibold transition', view === n.id ? 'bg-accent text-accent-ink' : 'text-ink-2 hover:bg-muted')}
            >
              <n.icon size={18} />
              {n.label}
              {n.id === 'alerts' && unread > 0 && <span className="ml-auto rounded-full bg-danger px-2 text-xs text-white">{unread}</span>}
            </button>
          ))}
        </nav>
        <div className="text-xs text-subtle">{user?.email}</div>
      </aside>

      <div className="min-w-0 pb-28 lg:pb-10">
        {config && (
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-warn/30 bg-warn/10 px-4 py-2 text-center text-xs font-medium text-warn">
            <FlaskConical size={14} />
            <span>Sandbox: no real money moves. Naira payouts, vault releases and non-Arc chains are simulated.</span>
            {user?.devPreview && <span className="font-semibold">Development preview, no login.</span>}
          </div>
        )}
        <header className="flex items-center justify-between gap-3 px-4 py-3 lg:px-8">
          <div className="display text-lg font-bold lg:hidden">NairaBridge</div>
          <div className="ml-auto flex items-center gap-2">
            {user?.devPreview && (
              <button
                onClick={() => swap.mutate(user.role === 'founder' ? 'user' : 'founder')}
                className="min-h-11 rounded-xl border border-line px-3 text-xs font-semibold hover:bg-muted"
              >
                View as {user.role === 'founder' ? 'customer' : 'founder'}
              </button>
            )}
            <ConnectKitButton.Custom>
              {({ isConnected, show, truncatedAddress }) => (
                <button onClick={show} className="min-h-11 rounded-xl border border-line px-3 text-xs font-semibold hover:bg-muted">
                  {isConnected ? truncatedAddress : 'Connect wallet'}
                </button>
              )}
            </ConnectKitButton.Custom>
            <button onClick={toggleTheme} aria-label="Toggle theme" className="grid size-11 place-items-center rounded-xl border border-line hover:bg-muted">
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <button onClick={() => void signOut()} aria-label="Sign out" className="grid size-11 place-items-center rounded-xl border border-line hover:bg-muted">
              <LogOut size={17} />
            </button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl px-4 lg:px-8">{children}</main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-bg lg:hidden" aria-label="Main">
        {primary.map((n) => (
          <button key={n.id} onClick={() => { setView(n.id); setMore(false) }} className={cx('flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] font-semibold', view === n.id && !more ? 'text-ink' : 'text-subtle')}>
            <n.icon size={21} />
            {n.label}
          </button>
        ))}
        <button onClick={() => setMore(!more)} aria-expanded={more} className={cx('relative flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] font-semibold', more || moreActive ? 'text-ink' : 'text-subtle')}>
          <Ellipsis size={21} />
          More
          {unread > 0 && <span className="absolute right-[28%] top-2 size-2 rounded-full bg-danger" />}
        </button>
      </nav>

      {more && (
        <div className="fixed inset-0 z-20 lg:hidden" onClick={() => setMore(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="absolute inset-x-0 bottom-[57px] rounded-t-3xl border border-line bg-bg p-4 pb-5" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="More">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="eyebrow">More</span>
              <button aria-label="Close" onClick={() => setMore(false)} className="grid size-11 place-items-center rounded-xl hover:bg-muted"><X size={18} /></button>
            </div>
            <div className="grid gap-1">
              {overflow.map((n) => (
                <button key={n.id} onClick={() => { setView(n.id); setMore(false) }} className={cx('flex min-h-[48px] items-center gap-3 rounded-2xl px-4 text-sm font-semibold', view === n.id ? 'bg-accent text-accent-ink' : 'hover:bg-muted')}>
                  <n.icon size={19} />
                  {n.label}
                  {n.id === 'alerts' && unread > 0 && <span className="ml-auto rounded-full bg-danger px-2 text-xs text-white">{unread}</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
