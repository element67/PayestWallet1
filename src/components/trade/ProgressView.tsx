import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Circle, ExternalLink, Loader2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { parseError, short } from '@/lib/format'
import type { Step, TradeOp } from '@/lib/trade'
import { PinPad } from '../naira/PinPad'
import { Sheet } from '../naira/Sheet'
import { Button, Card, Row } from '../ui'

/** The stages a customer sees, in order. A stage the provider has not reported yet shows as waiting. */
const STAGES: Record<string, { name: string; label: string }[]> = {
  circle_bridge: [{ name: 'approve', label: 'Approving' }, { name: 'burn', label: 'Sending (burn on the source network)' }, { name: 'fetchAttestation', label: 'Circle confirms the transfer' }, { name: 'mint', label: 'Receiving (mint on the destination)' }],
  lifi_bridge: [{ name: 'approve', label: 'Approving' }, { name: 'send', label: 'Sending' }, { name: 'bridging', label: 'Bridging' }, { name: 'receive', label: 'Receiving' }],
  swap: [{ name: 'approve', label: 'Approving' }, { name: 'swap', label: 'Swapping' }],
  lifi_swap: [{ name: 'approve', label: 'Approving' }, { name: 'send', label: 'Swapping' }],
}
const stagesFor = (op: TradeOp) => (op.kind === 'bridge' ? (op.provider === 'circle' ? STAGES.circle_bridge : STAGES.lifi_bridge) : op.provider === 'lifi' ? STAGES.lifi_swap : STAGES.swap)

const Icon = ({ s }: { s?: Step }) => (s?.state === 'success' ? <CheckCircle2 size={20} className="text-success" /> : s?.state === 'error' ? <XCircle size={20} className="text-danger" /> : s?.state === 'pending' ? <Loader2 size={20} className="animate-spin" /> : <Circle size={20} className="text-subtle" />)

/** Live progress of one trade. It polls the server, so the person can leave the screen and come back to the same view. */
export function ProgressView({ opId, onDone }: { opId: string; onDone: () => void }) {
  const qc = useQueryClient()
  const [pinOpen, setPinOpen] = useState(false)
  const [round, setRound] = useState(0)
  const { data: op } = useQuery({
    queryKey: ['trade-op', opId], queryFn: () => api<{ op: TradeOp }>(`/api/trade/ops/${opId}`).then((r) => r.op),
    refetchInterval: (q) => (q.state.data?.status === 'running' || !q.state.data ? 2000 : false),
  })
  const resume = useMutation({
    mutationFn: (pin: string) => api(`/api/trade/ops/${opId}/resume`, { method: 'POST', body: { pin } }),
    onSuccess: () => { setPinOpen(false); void qc.invalidateQueries({ queryKey: ['trade-op', opId] }) },
    onError: (e) => { toast.error(parseError(e)); setRound((n) => n + 1) },
  })
  if (!op) return <div className="h-48 animate-pulse rounded-3xl bg-muted" aria-busy="true" />
  const status = op.status
  const byName = new Map(op.steps.map((s) => [s.name, s]))
  const stages = stagesFor(op)
  const shown = [...stages, ...op.steps.filter((s) => !stages.some((x) => x.name === s.name)).map((s) => ({ name: s.name, label: s.name }))]
  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center gap-3">
        {status === 'completed' ? <CheckCircle2 size={28} className="text-success" /> : status === 'failed' ? <XCircle size={28} className="text-danger" /> : <Loader2 size={28} className="animate-spin" />}
        <h2 className="display text-xl">{status === 'completed' ? (op.kind === 'swap' ? 'Swap complete' : 'Bridge complete') : status === 'failed' ? 'Did not finish' : op.kind === 'swap' ? 'Swapping…' : 'Bridging…'}</h2>
      </div>
      <ol className="space-y-2" aria-label="Progress">
        {shown.map((st) => {
          const s = byName.get(st.name)
          return (
            <li key={st.name} className="flex items-start gap-3 text-sm">
              <Icon s={s} />
              <span className="min-w-0 flex-1"><span className={s ? 'font-semibold' : 'text-subtle'}>{st.label}</span>
                {s?.txHash && <span className="mono ml-2 text-xs text-subtle">{short(s.txHash, 8, 6)}</span>}
                {s?.explorerUrl && <a href={s.explorerUrl} target="_blank" rel="noreferrer" aria-label="View transaction" className="ml-2 inline-block align-middle"><ExternalLink size={14} /></a>}
                {s?.error && <span className="block text-xs text-danger">{s.error}</span>}
              </span>
            </li>
          )
        })}
      </ol>
      <div className="space-y-1">
        <Row label="You sent" value={`${op.amountIn} ${op.tokenIn}`} />
        <Row label={op.kind === 'swap' ? 'You received' : 'You receive'} value={op.amountOut ? `${op.amountOut} ${op.tokenOut}` : status === 'running' ? 'Waiting for the network' : '-'} />
        <Row label="Route" value={`${op.providerName}${op.from === op.to ? ` on ${op.fromName}` : `: ${op.fromName} to ${op.toName}`}`} />
        {op.txHashes.length > 0 && <Row label="Transaction" value={<span className="mono text-xs">{short(op.txHashes[op.txHashes.length - 1], 8, 6)}</span>} />}
      </div>
      {op.error && <p className="text-sm text-danger" role="alert">{op.error}</p>}
      {op.explorerUrl && <a href={op.explorerUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-bold underline">View on the explorer <ExternalLink size={14} /></a>}
      {status === 'running' && <p className="text-xs text-subtle">You can leave this screen. The trade keeps running and shows here when you come back.</p>}
      {op.canResume && <Button className="w-full" onClick={() => setPinOpen(true)}>Resume from where it stopped</Button>}
      <Button className="w-full" variant={status === 'running' ? 'soft' : 'primary'} disabled={status === 'running'} onClick={onDone}>Done</Button>
      <Sheet open={pinOpen} onClose={() => setPinOpen(false)} title="Resume"><p className="mb-4 text-center text-sm text-ink-2">Enter your 4-digit PIN to continue this transfer.</p><PinPad key={round} disabled={resume.isPending} onComplete={(pin) => resume.mutate(pin)} /></Sheet>
    </Card>
  )
}
