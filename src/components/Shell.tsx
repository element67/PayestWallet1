import { useState, type ReactNode } from 'react'
import { ConnectKitButton } from 'connectkit'
import { Activity, ArrowLeftRight, Bell, CircleHelp, Coins, Ellipsis, FlaskConical, Home, LayoutDashboard, Moon, Plug, ScanQrCode, Settings, Sun, UserRound, Wallet } from 'lucide-react'
import type { Intent } from '@/lib/nav'
import { useNotifications } from '@/lib/queries'
import { useSession } from '@/lib/session'
import { useProfile } from '@/lib/profile'
import { useTheme } from '@/lib/theme'
import { Avatar } from './Avatar'
import { HelpSheet } from './HelpPanel'
import { QrScannerSheet } from './QrScanner'
import { cx } from './ui'

export type View = 'home' | 'crypto' | 'wallet' | 'exchange' | 'more' | 'profile' | 'activity' | 'alerts' | 'settings'

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
/** Every screen reached from the More tab. */
export const moreItems: NavItem[] = MORE_ITEMS

/** The founder dashboard is a separate area at /admin, not a screen of this app. */
export const ADMIN_URL = '/admin'

export function Shell({ view, go, children }: { view: View; go: (v: View, i?: Intent) => void; children: ReactNode }) {
  const { user, config } = useSession()
  const { data: profile } = useProfile()
  const [helpOpen, setHelpOpen] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const { mode, toggleMode } = useTheme()
  const { data: notes } = useNotifications()
  const unread = notes?.filter((n) => !n.read).length ?? 0
  const items = moreItems
  const moreActive = view === 'more' || items.some((n) => n.id === view)

  // 32px circles keep the whole row on one line on a phone; the invisible ring around each (after:) keeps the tap area comfortable.
  const iconPill = 'relative border border-outline grid size-8 shrink-0 place-items-center rounded-full bg-card text-card-ink after:absolute after:-inset-1.5 after:content-[""]'
  // The name comes from the signed-in account, never from anything typed in the page.
  const displayName = (profile?.fullName ?? user?.name ?? '').trim().split(/\s+/)[0] || user?.username || 'there'

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
          {user?.role === 'founder' && (
            <a href={ADMIN_URL} className="no-pop mb-2 flex min-h-11 items-center gap-3 rounded-full border-2 border-outline bg-card px-4 text-sm font-extrabold text-card-ink"><LayoutDashboard size={18} />Admin dashboard</a>
          )}
          <div className="truncate text-xs font-semibold text-subtle">{user?.email}</div>
        </div>
      </aside>

      <div className="min-w-0 pb-32 lg:pb-12">
        {config && (
          <div className="px-4 pt-2 lg:px-8">
            <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-3xl border-3 border-outline bg-warn/15 px-4 py-2 text-center text-xs font-semibold text-warn">
              <FlaskConical size={14} />
              <span>Sandbox: no real money moves. Naira payouts, vault releases and non-Arc chains are simulated.</span>
              {user?.devPreview && <span className="font-extrabold underline decoration-2">Development preview, no login.</span>}
            </div>
          </div>
        )}
        <header className="liquid sticky top-0 z-20 px-4 py-2 lg:px-8">
          <div className="mx-auto flex max-w-5xl items-center gap-2">
            <button onClick={() => go('profile')} aria-label={`Open your profile, ${displayName}`} className="no-pop flex min-w-0 items-center gap-2 rounded-full pr-1 text-left">
              <Avatar name={profile?.fullName ?? user?.name ?? ''} url={profile?.avatarUrl} className="size-8 text-sm" />
              <span className="min-w-0 leading-none">
                <span className="block overflow-hidden text-ellipsis whitespace-nowrap pb-0.5 text-[14px] font-semibold leading-none text-subtle">Welcome back,</span>
                <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-sm font-extrabold leading-tight text-ink" title={displayName}>{displayName}</span>
              </span>
            </button>
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              <ConnectKitButton.Custom>
                {({ isConnected, show, truncatedAddress }) => (
                  <button onClick={show} aria-label={isConnected ? `Wallet connected ${truncatedAddress}` : 'Connect wallet'} title={isConnected ? truncatedAddress : 'Connect wallet'} className={iconPill}>
                    <Plug size={15} />
                    {isConnected && <span className="absolute right-0.5 top-0.5 size-2 rounded-full bg-success" aria-hidden="true" />}
                  </button>
                )}
              </ConnectKitButton.Custom>
              <button onClick={toggleMode} aria-label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} title={mode === 'dark' ? 'Light mode' : 'Dark mode'} className={iconPill}>
                {mode === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
              </button>
              <button onClick={() => setHelpOpen(true)} aria-label="Help" title="Help" className={iconPill}><CircleHelp size={15} /></button>
              <button onClick={() => setScanOpen(true)} aria-label="Scan a payment QR code" title="Scan to pay" className={iconPill}><ScanQrCode size={15} /></button>
              <button onClick={() => go('alerts')} aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'} title="Notifications" className={iconPill}>
                <Bell size={15} />
                {unread > 0 && <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold leading-4 text-on-danger">{unread > 9 ? '9+' : unread}</span>}
              </button>
            </div>
          </div>
        </header>
        <HelpSheet open={helpOpen} onClose={() => setHelpOpen(false)} />
        <QrScannerSheet open={scanOpen} onClose={() => setScanOpen(false)} go={go} />
        <main className="mx-auto w-full max-w-5xl px-4 lg:px-8">{children}</main>
      </div>

      <nav className="sticker liquid fixed inset-x-1.5 bottom-3 z-30 mx-auto grid max-w-md grid-cols-5 gap-0.5 rounded-full p-1 lg:hidden" aria-label="Main">
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
