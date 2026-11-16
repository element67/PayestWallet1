import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, ApiError } from '@/lib/api'
import { ago, ngn } from '@/lib/format'
import { Badge, Button, Card, Field, ListSkeleton, Segmented } from '@/components/ui'
import { KIND_LABEL, untilText, type HeldPayout } from '@/components/HeldPayouts'

interface AdminHold extends HeldPayout { userId: string; email: string; name: string; resolvedBy: string | null; ref: string }

const FILTERS = [
  { value: 'held', label: 'Held' },
  { value: 'released', label: 'Released' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: '', label: 'All' },
]

/** First-time counterparty holds: payouts waiting out their cooling period. Founders can release or cancel any of them. */
export function Holds() {
  const [status, setStatus] = useState('held')
  const [cancelling, setCancelling] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: ['admin-holds', status],
    queryFn: () => api<{ holds: AdminHold[] }>(`/api/admin/holds${status ? `?status=${status}` : ''}`).then((r) => r.holds),
    placeholderData: keepPreviousData,
    refetchInterval: 10_000,
  })
  const done = () => { void qc.invalidateQueries({ queryKey: ['admin-holds'] }); setCancelling(null); setReason('') }
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'That did not work')
  const release = useMutation({ mutationFn: (id: string) => api(`/api/admin/holds/${id}/release`, { method: 'POST', body: {} }), onSuccess: () => { toast.success('Released'); done() }, onError: fail })
  const cancel = useMutation({ mutationFn: (id: string) => api(`/api/admin/holds/${id}/cancel`, { method: 'POST', body: { reason } }), onSuccess: () => { toast.success('Cancelled'); done() }, onError: fail })

  return (
    <div className="space-y-4">
      <Segmented value={status} onChange={setStatus} options={FILTERS} />
      <Card className="overflow-hidden p-2">
        {!data && <ListSkeleton bare rows={4} />}
        {data?.length === 0 && <p className="p-4 text-sm text-subtle">Nothing here. Large payouts to a first-time destination appear in this list while they wait.</p>}
        <ul className="divide-y divide-line">
          {data?.map((h) => (
            <li key={h.id} className="space-y-2 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{KIND_LABEL[h.kind]} to {h.label}</p>
                  <p className="truncate text-xs text-subtle">{h.name} · {h.email}</p>
                  <p className="text-xs text-subtle">
                    {ngn(Number(h.amountKobo) / 100)} · started {ago(h.createdAt)}
                    {h.status === 'held' ? ` · sends automatically ${untilText(h.releaseAt)}` : h.resolvedAt ? ` · ${h.status} ${ago(h.resolvedAt)}${h.resolvedBy === 'system' ? ' (timer)' : ''}` : ''}
                  </p>
                  {h.status === 'cancelled' && h.note && <p className="text-xs text-subtle">{h.note}</p>}
                </div>
                <Badge kind={h.status === 'held' ? 'warn' : h.status === 'released' ? 'good' : 'bad'}>{h.status === 'held' ? 'Held' : h.status === 'released' ? 'Released' : 'Cancelled'}</Badge>
              </div>
              {h.status === 'held' && cancelling !== h.id && (
                <div className="flex gap-2">
                  <Button variant="soft" className="flex-1" loading={release.isPending && release.variables === h.id} onClick={() => release.mutate(h.id)}>Release now</Button>
                  <Button variant="danger" className="flex-1" onClick={() => { setCancelling(h.id); setReason('') }}>Cancel</Button>
                </div>
              )}
              {h.status === 'held' && cancelling === h.id && (
                <div className="space-y-2">
                  <Field label="Reason (the customer sees it)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
                  <div className="flex gap-2">
                    <Button variant="ghost" className="flex-1" onClick={() => setCancelling(null)}>Back</Button>
                    <Button variant="danger" className="flex-1" disabled={reason.trim().length < 3} loading={cancel.isPending} onClick={() => cancel.mutate(h.id)}>Confirm cancel</Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <p className="text-xs text-subtle">Customers can cancel with their PIN. Only founders can release early. A hold never releases while the account or wallet is frozen.</p>
    </div>
  )
}
