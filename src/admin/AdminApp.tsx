'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { ArrowLeftRight, Bell, Bot, Coins, FlaskConical, LayoutDashboard, LogOut, Scale, Settings2, ShieldCheck, Tags, Users, Wallet, Gauge, Home, Hourglass } from 'lucide-react'
import { api, type PublicUser } from '@/lib/api'
import { useSession } from '@/lib/session'
import { AppSkeleton } from '@/components/AppSkeleton'
import { Backdrop } from '@/components/Backdrop'
import { Button, Card, Field, cx } from '@/components/ui'
import { AlertsPanel } from '@/components/founder/AlertsPanel'
import { LimitsPanel } from '@/components/founder/LimitsPanel'
import { NairaAdmin } from '@/components/founder/NairaAdmin'
import { OrdersPanel } from '@/components/founder/OrdersPanel'
import { RatesPanel } from '@/components/founder/RatesPanel'
import { TestCredit } from '@/components/founder/TestCredit'
import { TokensAdmin } from '@/components/founder/TokensAdmin'
import { UsersPanel } from '@/components/founder/UsersPanel'
import { AgentMonitor } from '@/views/AgentMonitor'
import { Holds } from './panels/Holds'
import { Ledger } from './panels/Ledger'
import { Onchain } from './panels/Onchain'
import { Overview } from './panels/Overview'
import { System } from './panels/System'

interface Section { slug: string; label: string; title: string; sub: string; icon: typeof Home; group: 'Monitor' | 'Manage' | 'Configure'; render: () => ReactNode }

const SECTIONS: Section[] = [
  { slug: '', label: 'Overview', title: 'Overview', sub: 'Health, volume and alerts at a glance.', icon: LayoutDashboard, group: 'Monitor', render: () => <Overview /> },
  { slug: 'alerts', label: 'Alerts and audit', title: 'Alerts and audit log', sub: 'Everything that needs a decision, and every change anyone made.', icon: Bell, group: 'Monitor', render: () => <AlertsPanel /> },
  { slug: 'ledger', label: 'Ledger health', title: 'Ledger health', sub: 'Proof that the books balance.', icon: Scale, group: 'Monitor', render: () => <Ledger /> },
  { slug: 'system', label: 'Queue and chains', title: 'Queue and chain monitors', sub: 'Background jobs, blockchain readers and platform status.', icon: Gauge, group: 'Monitor', render: () => <System /> },
  { slug: 'agent', label: 'AI agent', title: 'AI transaction agent', sub: 'What the agent is watching and deciding.', icon: Bot, group: 'Monitor', render: () => <AgentMonitor /> },
  { slug: 'onchain', label: 'Exchange and bridge', title: 'Exchange and bridge activity', sub: 'Swaps, pools and USDC bridge transfers from app wallets.', icon: Coins, group: 'Monitor', render: () => <Onchain /> },
  { slug: 'holds', label: 'Held payouts', title: 'Held payouts', sub: 'Large payouts to a first-time destination, waiting out their cooling period.', icon: Hourglass, group: 'Manage', render: () => <Holds /> },
  { slug: 'orders', label: 'Orders', title: 'Orders', sub: 'Every buy, sell and P2P order, with review actions.', icon: ArrowLeftRight, group: 'Manage', render: () => <OrdersPanel /> },
  { slug: 'users', label: 'Users', title: 'Users', sub: 'Customers, KYC tiers and account status.', icon: Users, group: 'Manage', render: () => <UsersPanel /> },
  { slug: 'wallets', label: 'Naira wallets', title: 'Naira wallets', sub: 'Balances, transfers, bills, P2P deposits and wallet security.', icon: Wallet, group: 'Manage', render: () => <NairaAdmin /> },
  { slug: 'rates', label: 'Rates', title: 'Rates', sub: 'Buy and sell rates for each asset.', icon: Tags, group: 'Configure', render: () => <RatesPanel /> },
  { slug: 'limits', label: 'Limits and fees', title: 'Limits, fees and vaults', sub: 'Risk scores, daily limits, fees, pause switch and vault addresses.', icon: Settings2, group: 'Configure', render: () => <LimitsPanel /> },
  { slug: 'tokens', label: 'Tokens', title: 'Token registry', sub: 'Which tokens exist on which network.', icon: ShieldCheck, group: 'Configure', render: () => <TokensAdmin /> },
  { slug: 'credit', label: 'Test credit', title: 'Test credit', sub: 'Give test balances to accounts in this sandbox.', icon: FlaskConical, group: 'Configure', render: () => <TestCredit /> },
]
const GROUPS = ['Monitor', 'Manage', 'Configure'] as const

function AdminSignIn() {
  const { signIn } = useSession()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const login = useMutation({
    mutationFn: () => api<{ token: string; user: PublicUser }>('/api/auth/login', { method: 'POST', body: { email, password } }),
    onSuccess: (r) => signIn(r.token, r.user),
  })
  return (
    <main className="mx-auto grid min-h-dvh max-w-md items-center px-5 py-10">
      <Card className="space-y-4 p-6">
        <div className="display plate !inline-block text-xl">NairaBridge Admin</div>
        <p className="text-sm text-subtle">Founder access only. Sign in with your founder username or email.</p>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); login.mutate() }}>
          <Field label="Email or username" type="text" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" autoCapitalize="none" required />
          <Field label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          {login.error && <p role="alert" className="rounded-2xl border-2 border-outline bg-danger px-3 py-2 text-sm font-bold text-on-danger">{login.error.message}</p>}
          <Button type="submit" className="w-full" loading={login.isPending}>Sign in</Button>
        </form>
        <Link href="/" className="block text-center text-xs font-extrabold underline">Back to the customer app</Link>
      </Card>
    </main>
  )
}

function NotAllowed() {
  const { signOut } = useSession()
  return (
    <main className="mx-auto grid min-h-dvh max-w-md items-center px-5 py-10">
      <Card className="space-y-4 p-6 text-center">
        <ShieldCheck size={36} className="mx-auto" />
        <h1 className="display text-2xl">Founder access only</h1>
        <p className="text-sm text-subtle">This account is not a founder, so the admin dashboard is closed to it. Customers use the main app.</p>
        <Link href="/" className="inline-flex min-h-11 items-center justify-center rounded-full border-2 border-outline bg-accent px-5 text-sm font-extrabold text-accent-ink">Go to the customer app</Link>
        <button onClick={() => void signOut()} className="block w-full text-xs font-extrabold underline">Sign out</button>
      </Card>
    </main>
  )
}

function Shell({ section, children }: { section: Section; children: ReactNode }) {
  const { user, signOut } = useSession()
  const [menuOpen, setMenuOpen] = useState(false)
  const iconPill = 'border border-outline grid size-11 place-items-center rounded-full bg-card text-card-ink'
  const link = (s: Section, mobile?: boolean) => (
    <Link
      key={s.slug}
      href={s.slug ? `/admin/${s.slug}` : '/admin'}
      aria-current={s.slug === section.slug ? 'page' : undefined}
      className={cx(
        'no-pop flex min-h-11 shrink-0 items-center gap-3 rounded-full px-4 text-sm font-extrabold transition',
        s.slug === section.slug ? 'border-2 border-outline bg-accent text-accent-ink shadow-pop' : mobile ? 'border border-outline bg-card text-card-ink' : 'text-ink hover:bg-muted',
      )}
    >
      <s.icon size={18} />{s.label}
    </Link>
  )
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[300px_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col p-5 lg:flex">
        <div className="glass flex h-full flex-col rounded-3xl p-4">
          <div className="display plate !inline-block self-start text-xl">Admin</div>
          <nav className="scroll-thin mt-5 flex flex-1 flex-col gap-4 overflow-y-auto" aria-label="Admin sections">
            {GROUPS.map((g) => (
              <div key={g}>
                <p className="eyebrow mb-1.5 px-2">{g}</p>
                <div className="flex flex-col gap-1">{SECTIONS.filter((s) => s.group === g).map((s) => link(s))}</div>
              </div>
            ))}
          </nav>
          <Link href="/" className="mt-3 flex min-h-11 items-center gap-3 rounded-full px-4 text-sm font-extrabold text-ink hover:bg-muted"><Home size={18} />Customer app</Link>
          <div className="mt-1 truncate px-2 text-xs font-semibold text-subtle">{user?.email}</div>
        </div>
      </aside>

      <div className="min-w-0 pb-16">
        <header className="px-4 py-4 lg:px-8">
          <div className="flex items-center justify-between gap-3">
            <div className="display plate text-xl lg:hidden">Admin</div>
            <div className="ml-auto flex items-center gap-2">
              <Link href="/" aria-label="Customer app" title="Customer app" className={cx(iconPill, 'lg:hidden')}><Home size={18} /></Link>
              <button onClick={() => void signOut()} aria-label="Sign out" className={iconPill}><LogOut size={18} /></button>
            </div>
          </div>
          <div className="mt-3 lg:hidden">
            <button onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen} className="border border-outline flex min-h-11 w-full items-center justify-between rounded-full bg-card px-4 text-sm font-extrabold text-card-ink">
              <span className="flex items-center gap-2"><section.icon size={18} />{section.label}</span><span>{menuOpen ? "Close menu" : "All sections"}</span>
            </button>
            {menuOpen && <nav className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label="Admin sections" onClick={() => setMenuOpen(false)}>{SECTIONS.map((s) => link(s, true))}</nav>}
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl px-4 lg:px-8">
          <div className="mb-5">
            <h1 className="plate display text-3xl">{section.title}</h1>
            <p className="plate-sub mt-3 text-sm font-semibold">{section.sub}</p>
          </div>
          {children}
        </main>
      </div>
    </div>
  )
}

export default function AdminApp() {
  const { user, loading } = useSession()
  const path = usePathname() ?? '/admin'
  const slug = path.replace(/^\/admin\/?/, '').split('/')[0] ?? ''
  const section = SECTIONS.find((s) => s.slug === slug) ?? SECTIONS[0]
  if (loading) return <AppSkeleton />
  if (!user) return <AdminSignIn />
  if (user.role !== 'founder') return <NotAllowed />
  return (
    <>
      <Backdrop />
      <Shell section={section}>{section.render()}</Shell>
    </>
  )
}
