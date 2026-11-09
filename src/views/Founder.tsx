import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { crypto, ngn } from '@/lib/format'
import { Badge, Card, PageTitle, Sandbox, Stat, TokenIcon, cx } from '@/components/ui'
import { RatesPanel } from '@/components/founder/RatesPanel'
import { TokensAdmin } from '@/components/founder/TokensAdmin'
import { TestCredit } from '@/components/founder/TestCredit'
import { NairaAdmin } from '@/components/founder/NairaAdmin'
import { LimitsPanel } from '@/components/founder/LimitsPanel'
import { UsersPanel } from '@/components/founder/UsersPanel'
import { OrdersPanel } from '@/components/founder/OrdersPanel'
import { AlertsPanel } from '@/components/founder/AlertsPanel'
import { LiquidityForm } from '@/components/founder/LiquidityForm'

interface Overview {
  volumeNgn: string; feesNgn: string; pendingVolumeNgn: string; openAlerts: number
  counts: { completed: number; pending: number; failed: number; flagged: number; users: number }
  liquidity: { ngn: string; crypto: { symbol: string; amount: string }[] }
  onchainVault: { address: string | null; usdc: string | null; error?: string }
  daily: { d: string; c: number }[]
}

const TABS = ['Overview', 'Test credit', 'Tokens', 'Naira wallets', 'Rates', 'Limits and fees', 'Transactions', 'Users', 'Alerts and audit'] as const

export function Founder() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Overview')
  return (
    <>
      <PageTitle title="Founder dashboard" sub="Volume, liquidity, rates, limits and risk in one place. Every change is written to the audit log." />
      <div className="scroll-thin mb-5 flex gap-2 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cx('min-h-10 shrink-0 rounded-xl px-4 text-sm font-semibold', tab === t ? 'bg-accent text-accent-ink' : 'border border-line text-ink-2 hover:bg-muted')}>{t}</button>
        ))}
      </div>
      {tab === 'Overview' && <OverviewPanel />}
      {tab === 'Test credit' && <TestCredit />}
      {tab === 'Tokens' && <TokensAdmin />}
      {tab === 'Naira wallets' && <NairaAdmin />}
      {tab === 'Rates' && <RatesPanel />}
      {tab === 'Limits and fees' && <LimitsPanel />}
      {tab === 'Transactions' && <OrdersPanel />}
      {tab === 'Users' && <UsersPanel />}
      {tab === 'Alerts and audit' && <AlertsPanel />}
    </>
  )
}

function OverviewPanel() {
  const { data: o } = useQuery({ queryKey: ['admin-overview'], queryFn: () => api<Overview>('/api/admin/overview'), refetchInterval: 3000 })
  if (!o) return <p className="text-subtle">Loading...</p>
  const max = Math.max(1, ...o.daily.map((d) => d.c))
  return (
    <div className="space-y-5">
      <Card strong className="grid grid-cols-2 gap-5 p-6 lg:grid-cols-3">
        <Stat label="Completed volume" value={ngn(o.volumeNgn)} sub={`${o.counts.completed} completed`} />
        <Stat label="Fees earned" value={ngn(o.feesNgn)} />
        <Stat label="In flight" value={ngn(o.pendingVolumeNgn)} sub={`${o.counts.pending} pending`} />
        <Stat label="Failed or reversed" value={o.counts.failed} />
        <Stat label="Held for review" value={o.counts.flagged} />
        <Stat label="Open alerts" value={o.openAlerts} sub={`${o.counts.users} users`} />
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <div className="flex items-center gap-2"><h2 className="display text-lg font-semibold">Liquidity</h2><Sandbox label="Sandbox funds" /></div>
          <div className="mt-3 flex items-center justify-between py-2 text-sm"><span className="font-semibold">Naira</span><span className="num font-semibold">{ngn(o.liquidity.ngn)}</span></div>
          {o.liquidity.crypto.map((c) => (
            <div key={c.symbol} className="flex items-center justify-between py-2 text-sm">
              <span className="flex items-center gap-2 font-semibold"><TokenIcon symbol={c.symbol} size={20} />{c.symbol} vault</span>
              <span className="num font-semibold">{crypto(c.amount)}</span>
            </div>
          ))}
          <div className="mt-3 rounded-2xl bg-muted p-3 text-xs">
            <div className="font-semibold">Onchain Arc Testnet vault <Badge kind="live">Live</Badge></div>
            {o.onchainVault.address ? (
              <>
                <div className="mono mt-1 break-all text-subtle">{o.onchainVault.address}</div>
                <div className="num mt-1 text-sm font-semibold">{o.onchainVault.usdc !== null ? `${crypto(o.onchainVault.usdc)} USDC` : o.onchainVault.error ?? 'unavailable'}</div>
              </>
            ) : <div className="mt-1 text-subtle">No vault address set. Add one under Limits and fees to enable live USDC deposits.</div>}
          </div>
        </Card>

        <div className="space-y-5">
          <Card className="p-5">
            <h2 className="display text-lg font-semibold">Orders, last 7 days</h2>
            <div className="mt-4 flex h-28 items-end gap-2">
              {o.daily.length === 0 && <span className="text-sm text-subtle">No orders yet.</span>}
              {o.daily.map((d) => (
                <div key={d.d} className="flex flex-1 flex-col items-center gap-1">
                  <div className="w-full rounded-t-lg bg-accent" style={{ height: `${(d.c / max) * 100}%`, minHeight: 4 }} title={`${d.c} orders`} />
                  <span className="text-[10px] text-subtle">{d.d.slice(5)}</span>
                </div>
              ))}
            </div>
          </Card>
          <LiquidityForm />
        </div>
      </div>
    </div>
  )
}
