import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, ShieldAlert } from 'lucide-react'
import { api } from '@/lib/api'
import { ngn } from '@/lib/format'
import { Badge, Card, Empty, PanelSkeleton, Stat } from '@/components/ui'

interface Verify { ok: boolean; entries: number; unbalanced: { txn_id: string; asset: string; net: string }[]; mismatched: { owner: string; asset: string; computed: string; cached: string }[] }
interface Overview { liquidity: { ngn: string; crypto: { symbol: string; amount: string }[] }; feesNgn: string }

/** Double-entry integrity: every transaction must net to zero and every running balance must equal the sum of its entries. */
export function Ledger() {
  const { data: v, refetch, isFetching } = useQuery({ queryKey: ['admin-ledger'], queryFn: () => api<Verify>('/api/admin/naira/ledger/verify'), refetchInterval: 30_000 })
  const { data: o } = useQuery({ queryKey: ['admin-overview'], queryFn: () => api<Overview>('/api/admin/overview'), refetchInterval: 10_000 })
  if (!v) return <PanelSkeleton label="Checking the ledger" />
  return (
    <div className="space-y-5">
      <Card strong className="flex flex-wrap items-center gap-4 p-6">
        {v.ok ? <CheckCircle2 size={32} className="text-success" /> : <ShieldAlert size={32} className="text-danger" />}
        <div>
          <h2 className="text-xl font-extrabold">{v.ok ? 'The ledger is balanced' : 'The ledger has problems'}</h2>
          <p className="text-sm text-subtle">{v.entries.toLocaleString()} entries checked. Entries can never be edited or deleted, so a problem here means a bug or tampering.</p>
        </div>
        <button onClick={() => void refetch()} disabled={isFetching} className="border border-outline ml-auto min-h-11 rounded-full bg-card px-4 text-sm font-extrabold text-card-ink disabled:opacity-60">{isFetching ? 'Checking…' : 'Check again'}</button>
      </Card>

      {o && (
        <Card className="grid grid-cols-2 gap-5 p-6 lg:grid-cols-4">
          <Stat label="House Naira" value={ngn(o.liquidity.ngn)} sub="liquidity to pay out" />
          <Stat label="Fees booked" value={ngn(o.feesNgn)} />
          {o.liquidity.crypto.map((c) => <Stat key={c.symbol} label={`House ${c.symbol}`} value={c.amount} />)}
        </Card>
      )}

      <Card className="p-5">
        <h3 className="mb-3 font-extrabold">Transactions that do not net to zero <Badge kind={v.unbalanced.length ? 'bad' : 'good'}>{v.unbalanced.length}</Badge></h3>
        {v.unbalanced.length === 0 ? <Empty title="None" body="Every transaction debits and credits the same amount." /> : (
          <div className="divide-y divide-line">{v.unbalanced.map((u) => <div key={u.txn_id + u.asset} className="mono py-2 text-xs">{u.txn_id} · {u.asset} · off by {u.net}</div>)}</div>
        )}
      </Card>
      <Card className="p-5">
        <h3 className="mb-3 font-extrabold">Balances that disagree with their entries <Badge kind={v.mismatched.length ? 'bad' : 'good'}>{v.mismatched.length}</Badge></h3>
        {v.mismatched.length === 0 ? <Empty title="None" body="Every running balance equals the sum of its entries." /> : (
          <div className="divide-y divide-line">{v.mismatched.map((m) => <div key={m.owner + m.asset} className="mono py-2 text-xs">{m.owner} · {m.asset} · computed {m.computed} vs stored {m.cached}</div>)}</div>
        )}
      </Card>
    </div>
  )
}
