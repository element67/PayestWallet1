import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Bell, CheckCircle2, ShieldAlert } from 'lucide-react'
import { api } from '@/lib/api'
import { useNotifications } from '@/lib/queries'
import { ago } from '@/lib/format'
import { Button, Card, Empty, PageTitle, cx } from '@/components/ui'

/** `bare` hides the page title, for when it is shown inside Settings. */
export function Alerts({ bare = false }: { bare?: boolean }) {
  const { data } = useNotifications()
  const qc = useQueryClient()
  const read = useMutation({
    mutationFn: () => api('/api/notifications/read', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
  const icon = (k: string) => (k === 'security' ? <ShieldAlert size={18} className="text-danger" /> : k === 'order' || k === 'payout' ? <CheckCircle2 size={18} className="text-success" /> : <AlertTriangle size={18} />)

  return (
    <>
      {bare ? (
        data?.some((n) => !n.read) && <div className="mb-4"><Button variant="ghost" onClick={() => read.mutate()}>Mark all read</Button></div>
      ) : (
        <PageTitle
          title="Notifications"
          sub="Payout updates and security alerts."
          right={data?.some((n) => !n.read) ? <Button variant="ghost" onClick={() => read.mutate()}>Mark all read</Button> : undefined}
        />
      )}
      <Card className="p-2">
        {!data?.length && <Empty title="All quiet" body="Security alerts and payout updates will appear here." />}
        {(data ?? []).map((n) => (
          <div key={n.id} className={cx('flex gap-3 rounded-2xl px-4 py-3', !n.read && 'bg-muted')}>
            <div className="mt-0.5">{icon(n.kind) ?? <Bell size={18} />}</div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <div className="text-sm font-semibold">{n.title}</div>
                <div className="shrink-0 text-xs text-subtle">{ago(n.at)}</div>
              </div>
              <p className="text-pretty text-sm text-ink-2">{n.body}</p>
            </div>
          </div>
        ))}
      </Card>
    </>
  )
}
