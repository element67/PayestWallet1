import { useQuery } from '@tanstack/react-query'
import { Bot, Radio } from 'lucide-react'
import { api } from '@/lib/api'
import { ago, duration, short } from '@/lib/format'
import { Badge, Card, Empty, PageTitle, Sandbox, Stat } from '@/components/ui'

interface Monitor { chain: string; status: string; last_block: number | null; head_block: number | null; last_poll_at: number | null; poll_ms: number | null; error: string | null; mode: string }
interface Decision { id: number; at: number; order_id: string | null; kind: string; decision: string; score: number; reasons: string }
interface Tx { id: string; chain: string; tx_hash: string; asset: string | null; verdict: string; status: string; confirmations: number; simulated: number; detect_latency_ms: number | null; first_seen_at: number }
interface Alert { id: number; at: number; severity: string; title: string; detail: string }
interface WalletStats { wallets: number; txs: number; pending: number; incoming: number; outgoing: number; failed: number; unverified: number; recent: { id: string; network: string; symbol: string | null; type: string; status: string; verdict: string; tx_hash: string; detected_at: number }[] }
interface Metrics {
  status: string; monitors: Monitor[]; monitoring: number; detected: number; detected24h: number; verified: number; finalized: number; pending: number
  failed: number; fakeTokens: number; suspicious: number; avgDetectionMs: number | null; avgDetectionMsSim: number | null; avgPayoutMs: number | null
  avgSettlementMs: number | null; wallet: WalletStats; queue: { queued: number; dead: number }; decisions: Decision[]; txs: Tx[]; alerts: Alert[]
}

const reasons = (s: string) => JSON.parse(s) as string[]

export function AgentMonitor() {
  const { data: m } = useQuery({ queryKey: ['agent'], queryFn: () => api<Metrics>('/api/admin/agent'), refetchInterval: 2000 })
  if (!m) return <p className="text-subtle">Loading...</p>
  const verdictKind = (v: string) => (v === 'genuine' ? 'good' : v === 'fake_token' ? 'bad' : 'warn')

  return (
    <>
      <PageTitle title="AI transaction agent" sub="Live view of what the agent is watching and deciding. Every number comes from stored data." />
      <div className="space-y-5">
        <Card strong className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="grid size-11 place-items-center rounded-2xl bg-accent text-accent-ink"><Bot size={22} /></div>
              <div>
                <div className="display text-xl font-semibold">Agent is {m.status}</div>
                <div className="text-xs text-subtle">Rule-based risk engine. Holds no keys. Requests actions that the payout engine re-checks.</div>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-subtle"><Radio size={14} className="text-success" /> refreshing every 2s · queue {m.queue.queued} queued, {m.queue.dead} dead</div>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
            <Stat label="Monitoring now" value={m.monitoring} />
            <Stat label="Detected" value={m.detected} sub={`${m.detected24h} in 24h`} />
            <Stat label="Verified genuine" value={m.verified} sub={`${m.finalized} finalized`} />
            <Stat label="Pending orders" value={m.pending} />
            <Stat label="Failed or dropped" value={m.failed} />
            <Stat label="Fake tokens caught" value={m.fakeTokens} />
            <Stat label="Open warnings" value={m.suspicious} />
            <Stat label="Avg detection" value={duration(m.avgDetectionMs)} sub={m.avgDetectionMsSim !== null ? `sim ${duration(m.avgDetectionMsSim)}` : 'live chain'} />
            <Stat label="Avg detect to payout" value={duration(m.avgPayoutMs)} />
            <Stat label="Avg full settlement" value={duration(m.avgSettlementMs)} />
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="display text-lg font-semibold">Crypto wallet monitoring</h2>
          <div className="mt-3 grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-7">
            <Stat label="Wallets" value={m.wallet.wallets} />
            <Stat label="Transactions" value={m.wallet.txs} />
            <Stat label="Pending" value={m.wallet.pending} />
            <Stat label="Incoming" value={m.wallet.incoming} />
            <Stat label="Outgoing" value={m.wallet.outgoing} />
            <Stat label="Failed" value={m.wallet.failed} />
            <Stat label="Unverified tokens" value={m.wallet.unverified} />
          </div>
          {m.wallet.recent.length > 0 && (
            <ul className="mt-4 divide-y divide-line">
              {m.wallet.recent.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="capitalize">{t.type} {t.symbol ?? 'unknown token'} <span className="text-xs text-subtle">{t.network} · {ago(t.detected_at)}</span></span>
                  <span className="flex gap-1">{t.tx_hash.startsWith('sim:') && <Sandbox label="Sim" />}<Badge kind={t.verdict === 'unverified_token' ? 'bad' : 'info'}>{t.verdict === 'unverified_token' ? 'unverified' : t.status}</Badge></span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-2">
          <div className="eyebrow px-4 pb-1 pt-3">Active networks</div>
          {m.monitors.map((n) => (
            <div key={n.chain} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl px-4 py-3">
              <div>
                <div className="text-sm font-semibold">{n.chain}</div>
                <div className="num text-xs text-subtle">
                  {n.mode === 'live' ? `block ${n.last_block ?? '-'} of head ${n.head_block ?? '-'}${n.poll_ms ? ` · poll ${n.poll_ms}ms` : ''}` : n.error}
                  {n.mode === 'live' && n.error ? ` · ${n.error}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {n.mode === 'simulated' && <Sandbox label="Simulated" />}
                <Badge kind={n.status === 'live' ? 'live' : n.status === 'degraded' ? 'bad' : 'info'}>{n.status}</Badge>
              </div>
            </div>
          ))}
        </Card>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card className="p-2">
            <div className="eyebrow px-4 pb-1 pt-3">Recent decisions</div>
            {m.decisions.length === 0 && <Empty title="No decisions yet" body="Make an exchange and watch the agent reason about it." />}
            {m.decisions.map((d) => (
              <div key={d.id} className="rounded-2xl px-4 py-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold">{d.decision}</span>
                  <span className="shrink-0 text-xs text-subtle">{ago(d.at)}</span>
                </div>
                <div className="mono truncate text-[11px] text-subtle">{d.kind}{d.order_id ? ` · ${d.order_id}` : ''}{d.score ? ` · score ${d.score}` : ''}</div>
                {reasons(d.reasons).length > 0 && <div className="text-xs text-subtle">{reasons(d.reasons).join(' · ')}</div>}
              </div>
            ))}
          </Card>
          <div className="space-y-5">
            <Card className="p-2">
              <div className="eyebrow px-4 pb-1 pt-3">Transactions seen</div>
              {m.txs.length === 0 && <Empty title="Nothing detected yet" />}
              {m.txs.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-2 rounded-2xl px-4 py-2.5">
                  <div className="min-w-0">
                    <div className="mono truncate text-xs">{short(t.tx_hash, 10, 6)}</div>
                    <div className="text-xs text-subtle">{t.chain} · {t.asset ?? 'unknown token'} · {t.confirmations} conf · {duration(t.detect_latency_ms)}</div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {t.simulated ? <Sandbox label="Sim" /> : null}
                    <Badge kind={verdictKind(t.verdict)}>{t.verdict}</Badge>
                    <Badge>{t.status}</Badge>
                  </div>
                </div>
              ))}
            </Card>
            <Card className="p-2">
              <div className="eyebrow px-4 pb-1 pt-3">Security alerts</div>
              {m.alerts.length === 0 && <Empty title="No alerts" />}
              {m.alerts.slice(0, 8).map((a) => (
                <div key={a.id} className="rounded-2xl px-4 py-2.5">
                  <div className="flex items-baseline justify-between gap-2"><span className="text-sm font-semibold">{a.title}</span><Badge kind={a.severity === 'critical' ? 'bad' : 'warn'}>{a.severity}</Badge></div>
                  <p className="truncate text-xs text-subtle">{a.detail}</p>
                </div>
              ))}
            </Card>
          </div>
        </div>
      </div>
    </>
  )
}
