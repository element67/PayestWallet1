import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { ago, ngn } from '@/lib/format'
import { Badge, Button, Card, Empty } from '../ui'

interface U { id: string; email: string; name: string; role: string; kycTier: number; status: string; devPreview: boolean; createdAt: number; ngn: string; orders: number }

export function UsersPanel() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['admin-users'], queryFn: () => api<{ users: U[] }>('/api/admin/users').then((r) => r.users) })
  const patch = useMutation({
    mutationFn: (v: { id: string; status?: string; kycTier?: number }) => api(`/api/admin/users/${v.id}`, { method: 'PATCH', body: { status: v.status, kycTier: v.kycTier } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
    onError: (e) => toast.error(e.message),
  })
  if (!data) return <p className="text-subtle">Loading...</p>
  return (
    <Card className="overflow-hidden p-2">
      {data.length === 0 && <Empty title="No users yet" />}
      {data.map((u) => (
        <div key={u.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3 hover:bg-muted">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{u.name} <span className="font-normal text-subtle">{u.email}</span></div>
            <div className="num text-xs text-subtle">Joined {ago(u.createdAt)} · {u.orders} orders · wallet {ngn(u.ngn)}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {u.devPreview && <Badge kind="sandbox">Preview</Badge>}
            <Badge kind={u.role === 'founder' ? 'live' : 'info'}>{u.role}</Badge>
            <Badge kind={u.status === 'active' ? 'good' : 'bad'}>{u.status}</Badge>
            <select aria-label="KYC tier" value={u.kycTier} onChange={(e) => patch.mutate({ id: u.id, kycTier: Number(e.target.value) })} className="min-h-10 rounded-xl border border-line bg-surface-strong px-2 text-xs font-semibold">
              {[1, 2, 3].map((t) => <option key={t} value={t}>Tier {t}</option>)}
            </select>
            {u.role !== 'founder' && (
              <Button variant={u.status === 'active' ? 'ghost' : 'soft'} className="!min-h-10 !px-3 text-xs" onClick={() => patch.mutate({ id: u.id, status: u.status === 'active' ? 'suspended' : 'active' })}>
                {u.status === 'active' ? 'Suspend' : 'Reinstate'}
              </Button>
            )}
          </div>
        </div>
      ))}
    </Card>
  )
}
