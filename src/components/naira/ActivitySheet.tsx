import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { TxnRow } from '@/views/Wallet'
import type { Txn } from '@/lib/naira'
import { Empty, cx } from '../ui'
import { Sheet } from './Sheet'

const FILTERS = [
  { id: '', label: 'All' }, { id: 'p2p', label: 'Deposits' }, { id: 'bank', label: 'Bank' }, { id: 'internal', label: 'Users' }, { id: 'bill', label: 'Bills' },
  { id: 'flight', label: 'Flights' }, { id: 'shopping', label: 'Shopping' },
]

export function ActivitySheet({ open, onClose, onOpen }: { open: boolean; onClose: () => void; onOpen: (id: string) => void }) {
  const [type, setType] = useState('')
  const { data, isLoading } = useQuery({
    queryKey: ['naira-activity', type], enabled: open, refetchInterval: 4000,
    queryFn: () => api<{ transactions: Txn[] }>(`/api/naira/transactions?limit=60${type ? `&type=${type}` : ''}`).then((r) => r.transactions),
  })
  return (
    <Sheet open={open} onClose={onClose} title="All activity">
      <div className="scroll-thin -mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1">
        {FILTERS.map((f) => (
          <button key={f.id} onClick={() => setType(f.id)} className={cx('min-h-11 shrink-0 rounded-full border px-4 text-sm font-semibold', type === f.id ? 'border-accent bg-accent text-accent-ink' : 'border-line')}>{f.label}</button>
        ))}
      </div>
      {isLoading && <div className="h-48 animate-pulse rounded-2xl bg-muted" aria-busy="true" />}
      {data && data.length === 0 && <Empty title="Nothing here yet" />}
      <div>{(data ?? []).map((t) => <TxnRow key={t.id} t={t} onOpen={() => onOpen(t.id)} />)}</div>
    </Sheet>
  )
}
