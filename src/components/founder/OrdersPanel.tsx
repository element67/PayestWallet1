import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, type Order } from '@/lib/api'
import { ago, crypto, ngn } from '@/lib/format'
import { Badge, Button, Card, Empty, StatusBadge, TokenIcon } from '../ui'

const FILTERS = ['', 'completed', 'awaiting_finality', 'flagged', 'failed', 'reversed'] as const

export function OrdersPanel() {
  const qc = useQueryClient()
  const [status, setStatus] = useState<string>('')
  const { data } = useQuery({
    queryKey: ['admin-orders', status],
    queryFn: () => api<{ orders: Order[] }>(`/api/admin/orders${status ? `?status=${status}` : ''}`).then((r) => r.orders),
    refetchInterval: 3000,
  })
  const review = useMutation({
    mutationFn: (v: { id: string; action: 'approve' | 'reject' }) => api(`/api/admin/orders/${v.id}/review`, { method: 'POST', body: { action: v.action } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-orders'] }),
    onError: (e) => toast.error(e.message),
  })
  return (
    <div>
      <div className="scroll-thin mb-4 flex gap-2 overflow-x-auto">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setStatus(f)} className={`min-h-9 shrink-0 rounded-xl px-3 text-xs font-semibold ${status === f ? 'bg-accent text-accent-ink' : 'border border-line hover:bg-muted'}`}>{f || 'All'}</button>
        ))}
      </div>
      <Card className="p-2">
        {data?.length === 0 && <Empty title="No transactions match" />}
        {(data ?? []).map((o) => (
          <div key={o.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3 hover:bg-muted">
            <div className="flex min-w-0 items-center gap-3">
              <TokenIcon symbol={o.asset} size={32} />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{o.side === 'sell' ? 'Sell' : 'Buy'} {crypto(o.cryptoAmount)} {o.asset} · {ngn(o.grossNgn)}</div>
                <div className="mono truncate text-xs text-subtle">{o.userEmail} · {o.id} · {ago(o.createdAt)}</div>
                {o.riskFlags.length > 0 && <div className="text-xs text-warn">risk {o.riskScore}: {o.riskFlags.join(', ')}</div>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {o.mode === 'sandbox' && <Badge kind="sandbox">Sim</Badge>}
              <StatusBadge status={o.status} />
              {o.status === 'flagged' && (
                <>
                  <Button variant="soft" className="!min-h-9 !px-3 text-xs" onClick={() => review.mutate({ id: o.id, action: 'approve' })}>Approve</Button>
                  <Button variant="ghost" className="!min-h-9 !px-3 text-xs" onClick={() => review.mutate({ id: o.id, action: 'reject' })}>Reject</Button>
                </>
              )}
            </div>
          </div>
        ))}
      </Card>
    </div>
  )
}
