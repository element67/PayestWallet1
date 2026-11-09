import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { crypto, ngn } from '@/lib/format'
import type { CryptoOp } from '@/lib/home'
import { Badge, Button, Card, Row } from '../ui'

const LABEL: Record<CryptoOp['kind'], string> = { sell: 'Sell', buy: 'Buy', p2p: 'P2P exchange', swap: 'Swap', bridge: 'Bridge' }
const TONE = { pending: 'warn', verifying: 'info', completed: 'good', failed: 'bad' } as const

/** Live status card for a crypto operation record. */
export function OpResult({ op, onDone }: { op: CryptoOp; onDone: () => void }) {
  const Icon = op.status === 'completed' ? CheckCircle2 : op.status === 'failed' ? XCircle : Loader2
  return (
    <Card className="p-5 text-center">
      <Icon size={44} className={op.status === 'completed' ? 'mx-auto text-success' : op.status === 'failed' ? 'mx-auto text-danger' : 'mx-auto animate-spin text-subtle'} />
      <h2 className="display mt-3 text-2xl font-semibold">{LABEL[op.kind]} {op.status === 'completed' ? 'completed' : op.status === 'failed' ? 'did not go through' : 'in progress'}</h2>
      <div className="mt-1"><Badge kind={TONE[op.status]}>{op.status}</Badge></div>
      {op.reason && <p className="mx-auto mt-3 max-w-sm text-pretty text-sm text-ink-2">{op.reason}</p>}
      <div className="mt-4 space-y-2 text-left">
        <Row label="Reference" value={<span className="mono text-xs">{op.reference}</span>} />
        <Row label="Amount" value={`${crypto(op.amount)} ${op.asset}`} />
        {op.toAsset && op.resultAmount && <Row label="You receive" value={`${crypto(op.resultAmount)} ${op.toAsset}`} />}
        {op.kind !== 'bridge' && <Row label="Value" value={ngn(op.valueNgn)} />}
        {op.kind !== 'bridge' && <Row label="Fees (incl. network fee)" value={ngn(op.feeNgn)} />}
      </div>
      <Button className="mt-5 w-full" onClick={onDone}>Done</Button>
    </Card>
  )
}
