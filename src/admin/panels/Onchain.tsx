import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { ago, short } from '@/lib/format'
import { explorerTx, NETWORK_NAME } from '@/lib/nairaswap'
import { Badge, Card, Empty, PanelSkeleton, Segmented, Stat } from '@/components/ui'

interface Onchain {
  contracts: { network: string; router: string | null; factory: string | null; treasury: string | null }[]
  dex: { last24h: { kind: string; status: string; count: number }[]; ops: { id: string; email: string; network: string; kind: string; summary: string; status: string; note: string | null; hashes: string[]; createdAt: number }[] }
  bridge: { last24h: { status: string; count: number; usdc: string }[]; ops: { id: string; email: string; from: string; to: string; amount: string; recipient: string; status: string; error: string | null; steps: string[]; createdAt: number }[] }
}

export const useOnchainActivity = () => useQuery({ queryKey: ['admin-onchain'], queryFn: () => api<Onchain>('/api/admin/onchain'), refetchInterval: 5000 })

const kind = (s: string): 'good' | 'bad' | 'warn' => (s === 'confirmed' || s === 'completed' ? 'good' : s === 'failed' ? 'bad' : 'warn')
const sum = (rows: { count: number }[], pick?: (r: never) => boolean) => rows.filter((r) => (pick ? pick(r as never) : true)).reduce((n, r) => n + r.count, 0)

/** Activity on your exchange contracts (swaps and pool changes) and USDC bridge transfers signed from app wallets. */
export function Onchain() {
  const { data } = useOnchainActivity()
  const [view, setView] = useState<'exchange' | 'bridge'>('exchange')
  if (!data) return <PanelSkeleton label="Loading onchain activity" />
  const dexFailed = sum(data.dex.last24h, (r: { status: string }) => r.status === 'failed')
  const bridgeFailed = sum(data.bridge.last24h, (r: { status: string }) => r.status === 'failed')
  const bridgeUsdc = data.bridge.last24h.filter((r) => r.status === 'completed').reduce((n, r) => n + Number(r.usdc), 0)
  return (
    <div className="space-y-5">
      <Card strong className="grid grid-cols-2 gap-5 p-6 lg:grid-cols-4">
        <Stat label="Exchange operations, 24h" value={sum(data.dex.last24h)} sub={`${dexFailed} failed`} />
        <Stat label="Bridge transfers, 24h" value={sum(data.bridge.last24h)} sub={`${bridgeFailed} failed`} />
        <Stat label="USDC bridged, 24h" value={bridgeUsdc.toLocaleString('en-US', { maximumFractionDigits: 2 })} sub="completed transfers" />
        <Stat label="Networks" value={data.contracts.filter((c) => c.router).length} sub="with exchange contracts" />
      </Card>

      <Card className="p-5">
        <h3 className="mb-3 font-extrabold">Your exchange contracts</h3>
        <div className="divide-y divide-line">
          {data.contracts.map((c) => (
            <div key={c.network} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-sm">
              <span className="min-w-36 font-semibold">{NETWORK_NAME[c.network] ?? c.network}</span>
              <span className="mono text-xs text-subtle">router {short(c.router, 8, 6) || 'not set'}</span>
              <span className="mono text-xs text-subtle">factory {short(c.factory, 8, 6) || 'not set'}</span>
              <span className="mono text-xs text-subtle">treasury {short(c.treasury, 8, 6) || 'not set'}</span>
            </div>
          ))}
        </div>
      </Card>

      <div className="max-w-sm"><Segmented value={view} onChange={setView} options={[{ value: 'exchange', label: 'Exchange activity' }, { value: 'bridge', label: 'Bridge transfers' }]} /></div>

      {view === 'exchange' && (
        <Card className="overflow-hidden p-2">
          {data.dex.ops.length === 0 && <Empty title="No exchange activity yet" body="Swaps and pool changes made from app wallets appear here." />}
          <div className="divide-y divide-line">
            {data.dex.ops.map((o) => (
              <div key={o.id} className="px-3 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{o.summary}</span><Badge kind={kind(o.status)}>{o.status}</Badge><Badge kind="info">{NETWORK_NAME[o.network] ?? o.network}</Badge>
                  <span className="ml-auto text-xs text-subtle">{o.email} · {ago(o.createdAt)}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 text-xs">
                  {o.hashes.map((h) => <a key={h} href={explorerTx(o.network, h)} target="_blank" rel="noreferrer" className="mono underline">{short(h, 8, 6)}</a>)}
                </div>
                {o.note && <p className="mt-1 break-words text-xs text-danger">{o.note}</p>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {view === 'bridge' && (
        <Card className="overflow-hidden p-2">
          {data.bridge.ops.length === 0 && <Empty title="No bridge transfers yet" body="Transfers started with the app wallet appear here. Browser-wallet transfers are tracked in the browser only." />}
          <div className="divide-y divide-line">
            {data.bridge.ops.map((o) => (
              <div key={o.id} className="px-3 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{o.amount} USDC</span><span className="text-subtle">{NETWORK_NAME[o.from] ?? o.from} to {NETWORK_NAME[o.to] ?? o.to}</span><Badge kind={kind(o.status)}>{o.status}</Badge>
                  <span className="ml-auto text-xs text-subtle">{o.email} · {ago(o.createdAt)}</span>
                </div>
                <p className="mono mt-1 text-xs text-subtle">{o.steps.join(' · ') || 'no steps yet'} · to {short(o.recipient, 8, 6)}</p>
                {o.error && <p className="mt-1 break-words text-xs text-danger">{o.error}</p>}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

