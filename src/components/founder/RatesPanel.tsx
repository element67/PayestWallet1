import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, type Asset } from '@/lib/api'
import { ago } from '@/lib/format'
import { Badge, Button, Card, Field, TokenIcon } from '../ui'

function AssetEditor({ a }: { a: Asset }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ buyRate: a.buyRate, sellRate: a.sellRate, minNgn: a.minNgn, maxNgn: a.maxNgn, enabled: a.enabled })
  const save = useMutation({
    mutationFn: () => api(`/api/admin/assets/${a.symbol}`, { method: 'PUT', body: f }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-assets'] })
      void qc.invalidateQueries({ queryKey: ['assets'] })
      toast.success(`${a.symbol} rates published. New quotes use them immediately.`)
    },
    onError: (e) => toast.error(e.message),
  })
  const set = (k: 'buyRate' | 'sellRate' | 'minNgn' | 'maxNgn') => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value.replace(/[^\d.]/g, '') })
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <TokenIcon symbol={a.symbol} size={36} />
          <div>
            <div className="text-base font-semibold">{a.name} <span className="text-subtle">({a.symbol})</span></div>
            <div className="text-xs text-subtle">{a.chain} · v{a.rateVersion} · updated {ago(a.updatedAt)}</div>
          </div>
        </div>
        <div className="flex gap-2">
          <Badge kind={a.monitoring === 'live' ? 'live' : 'sandbox'}>{a.monitoring === 'live' ? 'Live monitor' : 'Simulated chain'}</Badge>
          {a.rateSource === 'seed placeholder' && <Badge kind="warn">Placeholder rate</Badge>}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Field label="Sell rate (NGN)" hint="You pay users this" inputMode="decimal" value={f.sellRate} onChange={set('sellRate')} />
        <Field label="Buy rate (NGN)" hint="Users pay you this" inputMode="decimal" value={f.buyRate} onChange={set('buyRate')} />
        <Field label="Min order (NGN)" inputMode="decimal" value={f.minNgn} onChange={set('minNgn')} />
        <Field label="Max order (NGN)" inputMode="decimal" value={f.maxNgn} onChange={set('maxNgn')} />
      </div>
      <div className="mt-4 flex items-center justify-between">
        <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
          <input type="checkbox" className="size-4" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /> Enabled for trading
        </label>
        <Button onClick={() => save.mutate()} loading={save.isPending}>Publish</Button>
      </div>
    </Card>
  )
}

export function RatesPanel() {
  const { data } = useQuery({ queryKey: ['admin-assets'], queryFn: () => api<{ assets: Asset[] }>('/api/admin/assets').then((r) => r.assets) })
  return (
    <div className="space-y-4">
      <p className="text-pretty text-sm text-subtle">
        The transaction agent and every customer quote use the latest published rates. Publishing invalidates open quotes, so nobody can trade on a stale price. Seeded rates are placeholders, not market data.
      </p>
      {(data ?? []).map((a) => <AssetEditor key={`${a.symbol}-${a.rateVersion}`} a={a} />)}
    </div>
  )
}
