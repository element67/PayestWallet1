import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { AuthScreen } from '@/components/AuthScreen'
import { Shell, type View } from '@/components/Shell'
import { Home } from '@/views/Home'
import { Exchange } from '@/views/Exchange'
import { Activity } from '@/views/Activity'
import { Wallet } from '@/views/Wallet'
import { Crypto } from '@/views/Crypto'
import { Alerts } from '@/views/Alerts'
import { SettingsView } from '@/views/SettingsView'
import { Founder } from '@/views/Founder'
import { AgentMonitor } from '@/views/AgentMonitor'
import { SessionProvider, useSession } from '@/lib/session'
import type { Intent } from '@/lib/nav'

function Routes() {
  const { user, loading } = useSession()
  const [view, setView] = useState<View>('home')
  const [focusOrder, setFocusOrder] = useState<string | null>(null)
  const [intent, setIntent] = useState<Intent & { n: number }>({ n: 0 })

  if (loading) return <div className="grid min-h-dvh place-items-center"><Loader2 className="animate-spin" /></div>
  if (!user) return <AuthScreen />

  const open = (id: string) => {
    setFocusOrder(id)
    setView('exchange')
  }
  const go = (v: View, i: Intent = {}) => {
    setIntent((p) => ({ ...i, n: p.n + 1 }))
    setView(v)
  }
  const nav = (v: View) => go(v)
  const current: View = user.role !== 'founder' && (view === 'founder' || view === 'agent') ? 'home' : view

  return (
    <Shell view={current} setView={nav}>
      {current === 'home' && <Home go={go} />}
      {current === 'exchange' && <Exchange key={`${focusOrder ?? 'form'}-${intent.n}`} focusOrder={focusOrder} clearFocus={() => setFocusOrder(null)} initialSide={intent.side} />}
      {current === 'crypto' && <Crypto key={intent.n} initial={intent.screen} go={go} />}
      {current === 'wallet' && <Wallet key={intent.n} openTransfer={intent.screen === 'transfer'} />}
      {current === 'activity' && <Activity open={open} />}
      {current === 'alerts' && <Alerts />}
      {current === 'settings' && <SettingsView />}
      {current === 'founder' && <Founder />}
      {current === 'agent' && <AgentMonitor />}
    </Shell>
  )
}

export default function App() {
  return (
    <SessionProvider>
      <Routes />
    </SessionProvider>
  )
}
