import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { ago, ngn } from '@/lib/format'
import { Badge, Card, Empty, PanelSkeleton, Stat, cx } from '@/components/ui'
import { useOnchainActivity } from './Onchain'
import { useSystemHealth } from './System'

interface Overview {
  volumeNgn: string; feesNgn: string; pendingVolumeNgn: string; openAlerts: number
  counts: { completed: number; pending: number; failed: number; flagged: number; users: number }
  liquidity: { ngn: string; crypto: { symbol: string; amount: string }[] }
  onchainVault: { address: string | null; usdc: string | null; error?: string }
  daily: { d: string; c: number }[]
}
interface Alert { id: number; at: number; severity: 'info' | 'warning' | 'critical'; title: string; detail: string; resolved: number }

function Health({ label, ok, detail, href }: { label: string; ok: boolean | null; detail: string; href: string }) {
  return (
    <Link href={href} className="block rounded-2xl border-2 border-outline bg-card p-4 text-card-ink transition hover:-translate-y-0.5">
      <div className="flex items-center gap-2 text-sm font-extrabold">
        <span className={cx('size-3 rounded-full border-2 border-outline', ok === null ? 'bg-muted' : ok ? 'bg-success' : 'bg-danger')} aria-hidden />
        {label}
      </div>
      <p className="mt-1 text-xs text-subtle">{detail}</p>
    </Link>
  )
}

/** One screen that answers "is everything fine right now?", with a way into every area. */
export function Overview() {
  const { data: o } = useQuery({ queryKey: ['admin-overview'], queryFn: () => api<Overview>('/api/admin/overview'), refetchInterval: 4000 })
  const { data: alerts } = useQuery({ queryKey: ['admin-alerts'], queryFn: () => api<{ alerts: Alert[] }>('/api/admin/alerts').then((r) => r.alerts), refetchInterval: 6000 })
  const { data: sys } = useSystemHealth()
  const { data: chain } = useOnchainActivity()
  if (!o) return <PanelSkeleton label="Loading overview" />
  const open = (alerts ?? []).filter((a) => !a.resolved)
  const critical = open.filter((a) => a.severity === 'critical').length
  const failedJobs = sys?.queue.counts.failed ?? 0
  const monitorsBad = sys?.monitors.filter((m) => m.stale || m.error).length ?? 0
  const dex24 = chain?.dex.last24h.reduce((n, r) => n + r.count, 0) ?? 0
  const bridge24 = chain?.bridge.last24h.reduce((n, r) => n + r.count, 0) ?? 0
  const max = Math.max(1, ...o.daily.map((d) => d.c))
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Health label="Ledger" ok={sys ? sys.ledger.ok : null} detail={sys ? (sys.ledger.ok ? `${sys.ledger.entries.toLocaleString()} entries, balanced` : `${sys.ledger.unbalanced + sys.ledger.mismatched} problems`) : 'Checking…'} href="/admin/ledger" />
        <Health label="Alerts" ok={critical === 0 && open.length < 5} detail={`${open.length} open${critical ? `, ${critical} critical` : ''}`} href="/admin/alerts" />
        <Health label="Queue and chains" ok={sys ? failedJobs === 0 && monitorsBad === 0 && sys.db.ok : null} detail={sys ? `${failedJobs} failed jobs, ${monitorsBad} monitors off` : 'Checking…'} href="/admin/system" />
        <Health label="Platform" ok={sys ? !sys.platform.paused : null} detail={sys ? (sys.platform.paused ? 'Paused: customers are blocked' : 'Running') : 'Checking…'} href="/admin/limits" />
      </div>

      <Card strong className="grid grid-cols-2 gap-5 p-6 lg:grid-cols-4">
        <Stat label="Completed volume" value={ngn(o.volumeNgn)} sub={`${o.counts.completed} orders`} />
        <Stat label="Fees earned" value={ngn(o.feesNgn)} />
        <Stat label="In flight" value={ngn(o.pendingVolumeNgn)} sub={`${o.counts.pending} pending`} />
        <Stat label="Customers" value={o.counts.users} />
        <Stat label="Held for review" value={o.counts.flagged} />
        <Stat label="Failed or reversed" value={o.counts.failed} />
        <Stat label="Exchange operations, 24h" value={dex24} sub="onchain swaps and pools" />
        <Stat label="Bridge transfers, 24h" value={bridge24} />
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="mb-3 font-extrabold">Liquidity</h3>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-subtle">House Naira</span><span className="num font-semibold">{ngn(o.liquidity.ngn)}</span></div>
            {o.liquidity.crypto.map((c) => <div key={c.symbol} className="flex justify-between"><span className="text-subtle">House {c.symbol}</span><span className="num font-semibold">{c.amount}</span></div>)}
            <div className="flex justify-between"><span className="text-subtle">Arc vault USDC</span><span className="num font-semibold">{o.onchainVault.address ? (o.onchainVault.usdc ?? o.onchainVault.error ?? '-') : 'vault not set'}</span></div>
          </div>
          <h3 className="mb-2 mt-5 font-extrabold">Orders, last 7 days</h3>
          <div className="flex h-20 items-end gap-1.5" aria-label="Orders per day">
            {o.daily.map((d) => <div key={d.d} title={`${d.d}: ${d.c}`} className="flex-1 rounded-t bg-accent" style={{ height: `${Math.max(6, (d.c / max) * 100)}%` }} />)}
            {o.daily.length === 0 && <span className="text-sm text-subtle">No orders yet.</span>}
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between"><h3 className="font-extrabold">Open alerts</h3><Link href="/admin/alerts" className="text-xs font-extrabold underline">See all</Link></div>
          {open.length === 0 && <Empty title="Nothing needs attention" body="New alerts show up here the moment they are raised." />}
          <div className="divide-y divide-line">
            {open.slice(0, 6).map((a) => (
              <div key={a.id} className="py-2.5 text-sm">
                <div className="flex items-center gap-2"><Badge kind={a.severity === 'critical' ? 'bad' : a.severity === 'warning' ? 'warn' : 'info'}>{a.severity}</Badge><span className="font-semibold">{a.title}</span><span className="ml-auto text-xs text-subtle">{ago(a.at)}</span></div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
