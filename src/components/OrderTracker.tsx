import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, Circle, FlaskConical, Loader2, OctagonAlert } from 'lucide-react'
import { toast } from 'sonner'
import { api, type Order } from '@/lib/api'
import { TERMINAL, useOrder } from '@/lib/queries'
import { STATUS_LABEL, crypto, duration, ngn, short } from '@/lib/format'
import { Badge, Button, Card, Row, Sandbox, StatusBadge, TokenIcon, cx } from './ui'
import { LiveDeposit } from './LiveDeposit'

interface Step { label: string; done: boolean; note?: string }

function stepsFor(o: Order): Step[] {
  if (o.side === 'sell') {
    const paid = Boolean(o.payoutAt)
    return [
      { label: 'Transaction broadcast', done: o.status !== 'awaiting_deposit' },
      { label: 'Detected by the agent', done: Boolean(o.detectedAt), note: o.chainTx?.detectLatencyMs != null ? `seen ${duration(o.chainTx.detectLatencyMs)} after it was visible` : undefined },
      { label: 'Token and amount verified', done: Boolean(o.detectedAt) && o.chainTx?.verdict === 'genuine' },
      { label: o.payoutType === 'bank' ? 'Naira sent to your bank' : 'Naira credited to your wallet', done: paid && o.status !== 'payout_processing', note: o.instant ? 'instant payout' : undefined },
      { label: 'Final confirmation', done: o.status === 'completed', note: o.chainTx ? `${o.chainTx.confirmations} confirmations` : undefined },
    ]
  }
  return [
    { label: 'Naira payment received', done: o.status !== 'awaiting_payment' },
    { label: 'Payment verified', done: ['payment_verified', 'awaiting_liquidity', 'completed'].includes(o.status) },
    { label: 'Vault releasing crypto', done: o.status === 'completed' },
    { label: 'Crypto delivered', done: o.status === 'completed' },
  ]
}

const SCENARIOS = [
  { id: 'genuine', label: 'Genuine deposit' },
  { id: 'fake_token', label: 'Fake token' },
  { id: 'underpay', label: 'Wrong amount' },
  { id: 'dropped', label: 'Dropped tx' },
  { id: 'duplicate', label: 'Duplicate report' },
] as const

export function OrderTracker({ orderId, onBack }: { orderId: string; onBack: () => void }) {
  const { data: o } = useOrder(orderId)
  const qc = useQueryClient()
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['order', orderId] })
    void qc.invalidateQueries({ queryKey: ['balances'] })
  }
  const deposit = useMutation({
    mutationFn: (scenario: string) => api('/api/sandbox/deposit', { method: 'POST', body: { orderId, scenario } }),
    onSuccess: refresh,
    onError: (e) => toast.error(e.message),
  })
  const pay = useMutation({
    mutationFn: () => api('/api/sandbox/pay', { method: 'POST', body: { orderId } }),
    onSuccess: refresh,
    onError: (e) => toast.error(e.message),
  })
  const cancel = useMutation({
    mutationFn: () => api(`/api/orders/${orderId}/cancel`, { method: 'POST' }),
    onSuccess: refresh,
    onError: (e) => toast.error(e.message),
  })

  if (!o) return <div className="grid place-items-center py-24"><Loader2 className="animate-spin" /></div>
  const steps = stepsFor(o)
  const firstOpen = steps.findIndex((s) => !s.done)
  const ended = TERMINAL.includes(o.status)
  const bad = ['failed', 'reversed', 'rejected', 'flagged', 'expired'].includes(o.status)
  const decimals = o.cryptoAmount

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <button onClick={onBack} className="flex min-h-10 items-center gap-2 text-sm font-semibold text-ink-2"><ArrowLeft size={16} /> Back to exchange</button>
      <Card strong className="p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <TokenIcon symbol={o.asset} size={44} />
            <div>
              <div className="display text-xl font-semibold">{o.side === 'sell' ? 'Sell' : 'Buy'} {crypto(decimals)} {o.asset}</div>
              <div className="mono text-xs text-subtle">{o.id}</div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <StatusBadge status={o.status} />
            {o.mode === 'sandbox' ? <Sandbox label="Simulated chain" /> : <Badge kind="live">Live Arc Testnet</Badge>}
          </div>
        </div>
        <div className="display num mt-5 text-4xl font-semibold">{o.side === 'sell' ? ngn(o.netNgn) : `${crypto(o.cryptoAmount)} ${o.asset}`}</div>
        <div className="text-sm text-subtle">{o.side === 'sell' ? 'You receive' : `For ${ngn(o.grossNgn)}`}</div>

        {bad && (
          <div className="mt-4 flex gap-3 rounded-2xl bg-danger/10 p-4 text-sm text-danger">
            <OctagonAlert size={18} className="mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold">{STATUS_LABEL[o.status]}</div>
              <p className="text-pretty">{o.failureReason ?? o.events?.[o.events.length - 1]?.detail ?? 'Our agent held this order. You were not charged.'}</p>
            </div>
          </div>
        )}

        <ol className="mt-6 space-y-3">
          {steps.map((s, i) => (
            <li key={s.label} className="flex items-start gap-3">
              <span className={cx('mt-0.5 grid size-6 shrink-0 place-items-center rounded-full', s.done ? 'bg-success text-accent-ink' : i === firstOpen && !ended ? 'bg-muted' : 'bg-muted')}>
                {s.done ? <Check size={14} /> : i === firstOpen && !ended ? <Loader2 size={14} className="animate-spin" /> : <Circle size={8} />}
              </span>
              <div className={cx('text-sm', s.done ? 'font-semibold' : i === firstOpen ? 'font-medium' : 'text-subtle')}>
                {s.label}
                {s.done && s.note && <span className="ml-2 text-xs font-normal text-subtle">{s.note}</span>}
              </div>
            </li>
          ))}
        </ol>
      </Card>

      {o.status === 'awaiting_deposit' && o.mode === 'live' && <LiveDeposit order={o} />}

      {o.status === 'awaiting_deposit' && o.mode === 'sandbox' && (
        <Card className="p-5">
          <div className="flex items-center gap-2"><FlaskConical size={16} /><span className="text-sm font-semibold">Sandbox lab</span><Sandbox /></div>
          <p className="mt-1 text-pretty text-xs text-subtle">
            This asset has no live chain adapter yet, so the deposit is simulated. Try the failure cases too: the same agent and payout engine handle them.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {SCENARIOS.map((s) => (
              <Button key={s.id} variant={s.id === 'genuine' ? 'primary' : 'ghost'} className={s.id === 'genuine' ? 'col-span-2' : ''} loading={deposit.isPending && deposit.variables === s.id} onClick={() => deposit.mutate(s.id)}>
                Simulate: {s.label}
              </Button>
            ))}
          </div>
        </Card>
      )}

      {o.status === 'awaiting_payment' && (
        <Card className="p-5">
          <div className="text-sm font-semibold">Pay {ngn(o.grossNgn)} by bank transfer</div>
          <p className="mt-1 text-xs text-subtle">Sandbox virtual account. No real bank transfer is possible.</p>
          <Row label="Reference" value={o.payment?.reference} mono />
          <Button className="mt-2 w-full" onClick={() => pay.mutate()} loading={pay.isPending}>Simulate bank transfer</Button>
        </Card>
      )}

      {['awaiting_deposit', 'awaiting_payment'].includes(o.status) && (
        <Button variant="ghost" className="w-full" onClick={() => cancel.mutate()} loading={cancel.isPending}>Cancel order</Button>
      )}

      <Card className="p-5">
        <h3 className="display text-base font-semibold">Details</h3>
        <Row label="Rate" value={`${ngn(o.rate)} per ${o.asset}`} />
        <Row label="Gross" value={ngn(o.grossNgn)} />
        <Row label="Fee" value={ngn(o.feeNgn)} />
        {o.side === 'sell' && <Row label="Net payout" value={ngn(o.netNgn)} />}
        {o.destAddress && <Row label="Delivered to" value={short(o.destAddress, 8, 6)} mono />}
        {o.txHash && <Row label="Transaction" value={o.txUrl ? <a className="underline" href={o.txUrl} target="_blank" rel="noopener noreferrer">{short(o.txHash, 10, 6)}</a> : short(o.txHash, 12, 6)} mono />}
        {o.chainTx && <Row label="Chain check" value={`${o.chainTx.verdict}${o.chainTx.simulated ? ' (simulated)' : ''}`} />}
        {o.riskScore > 0 && <Row label="Risk score" value={`${o.riskScore}${o.riskFlags.length ? ` (${o.riskFlags.join(', ')})` : ''}`} />}
        {o.completedAt && <Row label="Total time" value={duration(o.completedAt - o.createdAt)} />}
        {o.payoutAt && <Row label="Time to payout" value={duration(o.payoutAt - o.createdAt)} />}
      </Card>

      <Card className="p-5">
        <h3 className="display text-base font-semibold">Timeline</h3>
        <ul className="mt-2 space-y-2">
          {(o.events ?? []).map((e, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="mono text-xs text-subtle">{new Date(e.at).toLocaleTimeString()}</span>
              <span className="min-w-0 font-medium">{e.kind}</span>
              {e.detail && <span className="basis-full text-xs text-subtle">{e.detail}</span>}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
