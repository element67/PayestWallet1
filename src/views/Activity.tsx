import { useState } from 'react'
import { useOrders } from '@/lib/queries'
import { ago, crypto, ngn } from '@/lib/format'
import { Card, Empty, PageTitle, Segmented, StatusBadge, TokenIcon } from '@/components/ui'

export function Activity({ open }: { open: (id: string) => void }) {
  const { data: orders, isLoading } = useOrders()
  const [filter, setFilter] = useState<'all' | 'sell' | 'buy'>('all')
  const rows = (orders ?? []).filter((o) => filter === 'all' || o.side === filter)

  return (
    <>
      <PageTitle title="Activity" sub="Every exchange, with live status. Tap one to see its full timeline." />
      <div className="mb-4 max-w-xs">
        <Segmented value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'sell', label: 'Sells' }, { value: 'buy', label: 'Buys' }]} />
      </div>
      <Card className="overflow-hidden p-2">
        {isLoading && <Empty title="Loading..." />}
        {!isLoading && rows.length === 0 && <Empty title="Nothing here yet" body="Start an exchange and it will appear instantly." />}
        {rows.map((o) => (
          <button key={o.id} onClick={() => open(o.id)} className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl px-4 py-3 text-left hover:bg-muted">
            <TokenIcon symbol={o.asset} size={36} />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">
                {o.side === 'sell' ? 'Sell' : 'Buy'} {crypto(o.cryptoAmount)} {o.asset}
                {o.instant && <span className="ml-2 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-bold text-success">INSTANT</span>}
              </div>
              <div className="mono truncate text-xs text-subtle">{o.id} · {ago(o.createdAt)}{o.mode === 'sandbox' ? ' · sandbox' : ' · live chain'}</div>
            </div>
            <div className="text-right">
              <div className="num text-sm font-semibold">{ngn(o.side === 'sell' ? o.netNgn : o.grossNgn)}</div>
              <StatusBadge status={o.status} />
            </div>
          </button>
        ))}
      </Card>
    </>
  )
}
