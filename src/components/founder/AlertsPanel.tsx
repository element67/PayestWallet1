import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { ago } from '@/lib/format'
import { Badge, Button, Card, Empty } from '../ui'

interface Alert { id: number; at: number; severity: 'info' | 'warning' | 'critical'; kind: string; title: string; detail: string; resolved: number }
interface Log { id: number; at: number; actor: string | null; action: string; target: string | null; before: string | null; after: string | null }

export function AlertsPanel() {
  const qc = useQueryClient()
  const { data: alerts } = useQuery({ queryKey: ['admin-alerts'], queryFn: () => api<{ alerts: Alert[] }>('/api/admin/alerts').then((r) => r.alerts), refetchInterval: 4000 })
  const { data: logs } = useQuery({ queryKey: ['admin-audit'], queryFn: () => api<{ logs: Log[] }>('/api/admin/audit').then((r) => r.logs), refetchInterval: 8000 })
  const resolve = useMutation({
    mutationFn: (id: number) => api(`/api/admin/alerts/${id}/resolve`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-alerts'] }),
  })
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="p-2">
        <div className="eyebrow px-4 pb-1 pt-3">Suspicious activity and alerts</div>
        {alerts?.length === 0 && <Empty title="No alerts" body="Fake tokens, mismatches and risk blocks show up here." />}
        {(alerts ?? []).map((a) => (
          <div key={a.id} className="rounded-2xl px-4 py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="text-sm font-semibold">{a.title}</div>
              <Badge kind={a.severity === 'critical' ? 'bad' : a.severity === 'warning' ? 'warn' : 'info'}>{a.severity}</Badge>
            </div>
            <p className="text-pretty text-xs text-subtle">{a.detail}</p>
            <div className="mt-1 flex items-center justify-between text-xs text-subtle">
              <span>{ago(a.at)} · {a.kind}</span>
              {a.resolved ? <span>Resolved</span> : <Button variant="ghost" className="!min-h-8 !px-3 text-xs" onClick={() => resolve.mutate(a.id)}>Resolve</Button>}
            </div>
          </div>
        ))}
      </Card>
      <Card className="p-2">
        <div className="eyebrow px-4 pb-1 pt-3">Audit log</div>
        {logs?.length === 0 && <Empty title="Nothing logged yet" />}
        {(logs ?? []).map((l) => (
          <div key={l.id} className="rounded-2xl px-4 py-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="mono text-xs font-semibold">{l.action}</span>
              <span className="text-xs text-subtle">{ago(l.at)}</span>
            </div>
            <div className="truncate text-xs text-subtle">{l.actor ?? 'system'} · {l.target}</div>
            {l.after && <div className="mono truncate text-[11px] text-subtle" title={l.after}>{l.after.slice(0, 120)}</div>}
          </div>
        ))}
      </Card>
    </div>
  )
}
