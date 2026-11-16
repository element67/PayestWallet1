import { useQuery } from '@tanstack/react-query'
import { Database, ListChecks, Radio } from 'lucide-react'
import { api } from '@/lib/api'
import { ago, duration } from '@/lib/format'
import { Badge, Card, Empty, PanelSkeleton, Stat } from '@/components/ui'

export interface SystemHealth {
  checkedAt: number; db: { ok: boolean; latencyMs: number }; uptimeSec: number
  platform: { paused: boolean; instantPayouts: boolean; vaults: { arc: boolean; solana: boolean; bitcoin: boolean } }
  ledger: { ok: boolean; entries: number; unbalanced: number; mismatched: number }
  queue: { counts: Record<string, number>; oldestQueuedAgeMs: number; failed: { id: number; kind: string; attempts: number; error: string | null; createdAt: number }[] }
  monitors: { chain: string; status: string; mode: string; lastBlock: number | null; headBlock: number | null; lastPollAt: number | null; pollMs: number | null; error: string | null; stale: boolean }[]
}

export const useSystemHealth = () => useQuery({ queryKey: ['admin-system'], queryFn: () => api<SystemHealth>('/api/admin/system'), refetchInterval: 5000 })

const uptime = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 60)}m ${s % 60}s`)

/** Job queue and chain monitors: what is waiting, what failed, and whether each chain is being read. */
export function System() {
  const { data: s } = useSystemHealth()
  if (!s) return <PanelSkeleton label="Loading system status" />
  const queued = s.queue.counts.queued ?? 0
  const failed = s.queue.counts.failed ?? 0
  const bad = s.monitors.filter((m) => m.status !== 'ok' && m.status !== 'live' || m.stale || m.error)
  return (
    <div className="space-y-5">
      <Card strong className="grid grid-cols-2 gap-5 p-6 lg:grid-cols-4">
        <Stat label="Database" value={s.db.ok ? 'Healthy' : 'Down'} sub={`${s.db.latencyMs} ms round trip`} />
        <Stat label="API uptime" value={uptime(s.uptimeSec)} />
        <Stat label="Jobs waiting" value={queued} sub={queued ? `oldest ${duration(s.queue.oldestQueuedAgeMs)}` : 'queue is empty'} />
        <Stat label="Failed jobs" value={failed} sub={failed ? 'needs a look' : 'none'} />
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 flex items-center gap-2 font-extrabold"><Radio size={18} /> Chain monitors</h2>
        {s.monitors.length === 0 && <Empty title="No monitors have reported yet" body="They appear a few seconds after the server starts." />}
        <div className="divide-y divide-line">
          {s.monitors.map((m) => (
            <div key={m.chain} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-sm">
              <span className="mono min-w-44 font-semibold">{m.chain}</span>
              <Badge kind={m.error || m.stale ? 'bad' : m.status === 'ok' || m.status === 'live' ? 'good' : 'warn'}>{m.stale ? 'stale' : m.status}</Badge>
              <Badge kind={m.mode === 'live' ? 'good' : 'sandbox'}>{m.mode}</Badge>
              <span className="text-subtle">block {m.lastBlock ?? '-'} of {m.headBlock ?? '-'}</span>
              <span className="ml-auto text-subtle">{m.lastPollAt ? `polled ${ago(m.lastPollAt)}` : 'never polled'}</span>
              {m.error && <p className="w-full text-xs text-danger">{m.error}</p>}
            </div>
          ))}
        </div>
        {bad.length > 0 && <p className="mt-3 text-xs font-semibold text-danger">{bad.length} monitor{bad.length === 1 ? '' : 's'} need attention.</p>}
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 flex items-center gap-2 font-extrabold"><ListChecks size={18} /> Job queue</h2>
        <div className="mb-3 flex flex-wrap gap-2 text-sm">
          {Object.entries(s.queue.counts).map(([k, v]) => <Badge key={k} kind={k === 'failed' ? 'bad' : k === 'queued' ? 'warn' : 'info'}>{k}: {v}</Badge>)}
          {Object.keys(s.queue.counts).length === 0 && <span className="text-subtle">No jobs yet.</span>}
        </div>
        {s.queue.failed.length === 0 ? <p className="text-sm text-subtle">No failed jobs.</p> : (
          <div className="divide-y divide-line">
            {s.queue.failed.map((j) => (
              <div key={j.id} className="py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{j.kind}</span><Badge kind="bad">{j.attempts} attempts</Badge><span className="ml-auto text-subtle">{ago(j.createdAt)}</span></div>
                {j.error && <p className="mt-1 break-words text-xs text-danger">{j.error}</p>}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 flex items-center gap-2 font-extrabold"><Database size={18} /> Platform</h2>
        <div className="flex flex-wrap gap-2 text-sm">
          <Badge kind={s.platform.paused ? 'bad' : 'good'}>{s.platform.paused ? 'Platform paused' : 'Platform running'}</Badge>
          <Badge kind={s.platform.instantPayouts ? 'good' : 'warn'}>Instant payouts {s.platform.instantPayouts ? 'on' : 'off'}</Badge>
          <Badge kind={s.platform.vaults.arc ? 'good' : 'warn'}>Arc vault {s.platform.vaults.arc ? 'set' : 'not set'}</Badge>
          <Badge kind={s.platform.vaults.solana ? 'info' : 'warn'}>Solana vault {s.platform.vaults.solana ? 'set (not auto-detected)' : 'not set'}</Badge>
          <Badge kind={s.platform.vaults.bitcoin ? 'info' : 'warn'}>Bitcoin vault {s.platform.vaults.bitcoin ? 'set (not auto-detected)' : 'not set'}</Badge>
        </div>
        <p className="mt-3 text-xs text-subtle">Checked {ago(s.checkedAt)}. Refreshes every 5 seconds.</p>
      </Card>
    </div>
  )
}
