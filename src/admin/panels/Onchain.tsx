import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { ago, short } from '@/lib/format'
import { Badge, Card, Empty, PanelSkeleton, Segmented, Stat } from '@/components/ui'
import { TradeSettings } from '@/components/founder/TradeSettings'

interface Op { id: string; email: string; kind: string; provider: string; mode: string; from: string; to: string; tokenIn: string; tokenOut: string; amountIn: string; amountOut: string | null; status: string; error: string | null; steps: string[]; hashes: string[]; createdAt: number }
interface UniOp { id: string; email: string; chain: string; tokenIn: string; tokenOut: string; amountIn: string; amountOut: string | null; status: string; error: string | null; hash: string | null; createdAt: number }
interface Onchain {
  mode: 'testnet' | 'mainnet'
  last24h: { kind: string; provider: string; status: string; count: number }[]
  ops: Op[]
  uniswap: UniOp[]
}

export const useOnchainActivity = () => useQuery({ queryKey: ['admin-onchain'], queryFn: () => api<Onchain>('/api/admin/onchain'), refetchInterval: 5000 })

const kind = (s: string): 'good' | 'bad' | 'warn' => (s === 'completed' ? 'good' : s === 'failed' ? 'bad' : 'warn')
const count = (rows: Onchain['last24h'], pick: (r: Onchain['last24h'][number]) => boolean) => rows.filter(pick).reduce((n, r) => n + r.count, 0)

/** Swaps and bridges made through the trade module (Circle, LI.FI, AchSwap) and Uniswap swaps, signed from app wallets, plus the founder's trade settings. */
export function Onchain() {
  const { data } = useOnchainActivity()
  const [view, setView] = useState<'swap' | 'bridge' | 'uniswap'>('swap')
  if (!data) return <PanelSkeleton label="Loading onchain activity" />
  const failed = count(data.last24h, (r) => r.status === 'failed')
  const rows = data.ops.filter((o) => o.kind === view)
  return (
    <div className="space-y-5">
      <TradeSettings />
      <Card strong className="grid grid-cols-2 gap-5 p-6 lg:grid-cols-4">
        <Stat label="Swaps, 24h" value={count(data.last24h, (r) => r.kind === 'swap')} sub="trade module" />
        <Stat label="Bridges, 24h" value={count(data.last24h, (r) => r.kind === 'bridge')} sub="trade module" />
        <Stat label="Failed, 24h" value={failed} sub="swaps and bridges" />
        <Stat label="Network mode" value={data.mode === 'mainnet' ? 'Mainnet' : 'Testnet'} sub="set above" />
      </Card>

      <div className="max-w-md"><Segmented value={view} onChange={setView} options={[{ value: 'swap', label: 'Swaps' }, { value: 'bridge', label: 'Bridges' }, { value: 'uniswap', label: 'Uniswap' }]} /></div>

      {view !== 'uniswap' && (
        <Card className="overflow-hidden p-2">
          {rows.length === 0 && <Empty title={`No ${view}s yet`} body="Trades started from app wallets appear here." />}
          <div className="divide-y divide-line">
            {rows.map((o) => (
              <div key={o.id} className="px-3 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{o.amountIn} {o.tokenIn}{o.kind === 'swap' ? ` to ${o.tokenOut}` : ''}</span>
                  <span className="text-subtle">{o.from === o.to ? o.from : `${o.from} to ${o.to}`}</span>
                  <Badge kind={kind(o.status)}>{o.status}</Badge><Badge kind="info">{o.provider}</Badge><Badge kind={o.mode === 'mainnet' ? 'warn' : 'info'}>{o.mode}</Badge>
                  <span className="ml-auto text-xs text-subtle">{o.email} · {ago(o.createdAt)}</span>
                </div>
                <p className="mono mt-1 text-xs text-subtle">{o.steps.join(' · ') || 'no steps yet'}{o.amountOut ? ` · received ${o.amountOut}` : ''}</p>
                <div className="mt-1 flex flex-wrap gap-x-3 text-xs">{o.hashes.map((h) => <span key={h} className="mono">{short(h, 8, 6)}</span>)}</div>
                {o.error && <p className="mt-1 break-words text-xs text-danger">{o.error}</p>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {view === 'uniswap' && (
        <Card className="overflow-hidden p-2">
          {data.uniswap.length === 0 && <Empty title="No Uniswap swaps yet" body="Swaps made with the Uniswap tab appear here." />}
          <div className="divide-y divide-line">
            {data.uniswap.map((o) => (
              <div key={o.id} className="px-3 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{o.amountIn} {o.tokenIn} to {o.tokenOut}</span><Badge kind={kind(o.status)}>{o.status}</Badge><Badge kind="info">{o.chain}</Badge>
                  <span className="ml-auto text-xs text-subtle">{o.email} · {ago(o.createdAt)}</span>
                </div>
                {o.hash && <p className="mono mt-1 text-xs text-subtle">{short(o.hash, 8, 6)}{o.amountOut ? ` · received ${o.amountOut}` : ''}</p>}
                {o.error && <p className="mt-1 break-words text-xs text-danger">{o.error}</p>}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
