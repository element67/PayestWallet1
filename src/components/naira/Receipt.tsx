import { toast } from 'sonner'
import { CheckCircle2, Clock, Copy, Share2, ShieldAlert, XCircle } from 'lucide-react'
import { ngn } from '@/lib/format'
import { TXN_STATUS, TYPE_LABEL, type Txn } from '@/lib/naira'
import { Badge, Button, Row, Sandbox } from '../ui'

const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
const when = (ms: number) => new Date(ms).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })

/** Special lines that only exist once the provider confirmed (tokens, tickets, codes). */
function extras(t: Txn): { label: string; value: string }[] {
  const m = t.meta
  const out: { label: string; value: string }[] = []
  if (t.status !== 'success') return out
  if (m.token) out.push({ label: t.meta.category === 'education' ? 'PIN' : 'Token', value: str(m.token) })
  if (m.units) out.push({ label: 'Units', value: `${str(m.units)} kWh` })
  if (m.pnr) out.push({ label: 'Booking reference (PNR)', value: str(m.pnr) })
  for (const tk of (m.tickets as { passenger: string; ticketNo: string }[] | undefined) ?? []) out.push({ label: `Ticket: ${tk.passenger}`, value: tk.ticketNo })
  for (const g of (m.giftCodes as { product: string; code: string }[] | undefined) ?? []) out.push({ label: g.product, value: g.code })
  if (m.shippingNote) out.push({ label: 'Delivery', value: str(m.shippingNote) })
  return out
}

export function receiptText(t: Txn): string {
  const lines = [
    `NairaBridge receipt (sandbox)`, `${t.title}`, `Amount: ${ngn(t.amount)}`, ...(Number(t.fee) > 0 ? [`Fee: ${ngn(t.fee)}`] : []),
    `Status: ${TXN_STATUS[t.status]?.label ?? t.status}`, `Reference: ${t.reference}`, `Date: ${when(t.createdAt)}`, ...(t.counterparty ? [`To/From: ${t.counterparty}`] : []),
    ...extras(t).map((e) => `${e.label}: ${e.value}`),
  ]
  return lines.join('\n')
}

export function Receipt({ txn, onDone }: { txn: Txn; onDone?: () => void }) {
  const st = TXN_STATUS[txn.status] ?? { label: txn.status, kind: 'info' as const }
  const ok = txn.status === 'success'
  const bad = txn.status === 'failed'
  const share = () => {
    void doShare()
  }
  const doShare = async () => {
    const text = receiptText(txn)
    try {
      if (navigator.share) await navigator.share({ title: 'NairaBridge receipt', text })
      else {
        await navigator.clipboard.writeText(text)
        toast.success('Receipt copied')
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast.error('Sharing is blocked here. Use Copy instead.')
    }
  }
  const copy = () => {
    navigator.clipboard.writeText(receiptText(txn)).then(() => toast.success('Receipt copied')).catch(() => toast.error('Copy is blocked here'))
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center gap-2 pt-1 text-center">
        <div className={`grid size-16 place-items-center rounded-full ${ok ? 'bg-success/15 text-success' : bad ? 'bg-danger/15 text-danger' : txn.underReview ? 'bg-warn/15 text-warn' : 'bg-muted text-subtle'}`}>
          {ok ? <CheckCircle2 size={34} /> : bad ? <XCircle size={34} /> : txn.underReview ? <ShieldAlert size={34} /> : <Clock size={34} />}
        </div>
        <div className="display num text-4xl font-semibold">{ngn(txn.amount)}</div>
        <div className="flex items-center gap-2"><Badge kind={st.kind}>{st.label}</Badge><Sandbox /></div>
        <p className="text-pretty text-sm text-subtle">
          {ok ? txn.title : bad ? (txn.failureReason ?? 'This payment did not go through.') : txn.underReview ? 'This transfer is above the automatic limit and is waiting for review. Your funds are reserved.' : txn.status === 'reversed' ? 'This payment was reversed and the money returned to your wallet.' : 'Processing. This usually takes a few seconds.'}
        </p>
        {bad && txn.reversed && <p className="text-sm font-medium text-success">Your money was returned to your wallet.</p>}
      </div>

      <div className="rounded-2xl bg-muted p-4">
        <Row label="Type" value={TYPE_LABEL[txn.type] ?? txn.type} />
        {txn.counterparty && <Row label={txn.direction === 'credit' ? 'From' : 'To'} value={txn.counterparty} />}
        <Row label="Amount" value={ngn(txn.amount)} />
        {Number(txn.fee) > 0 && <Row label="Fee" value={ngn(txn.fee)} />}
        {txn.direction === 'debit' && <Row label="Total charged" value={ngn(txn.total)} />}
        {txn.note && <Row label="Note" value={txn.note} />}
        <Row label="Reference" value={txn.reference} mono />
        <Row label="Date" value={when(txn.createdAt)} />
        {txn.meta.cryptoAmount != null && <Row label="Crypto sold" value={`${str(txn.meta.cryptoAmount)} ${str(txn.meta.asset)} @ ${ngn(str(txn.meta.rateNgn))}`} />}
        {txn.meta.txHash != null && <Row label="Transaction hash" value={str(txn.meta.txHash).slice(0, 14) + '…'} mono />}
        {txn.meta.simulatedChain === true && <Row label="Network" value="Sandbox network (simulated)" />}
      </div>

      {extras(txn).length > 0 && (
        <div className="rounded-2xl border border-line p-4">
          {extras(txn).map((e) => <Row key={e.label + e.value} label={e.label} value={e.value} mono />)}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Button variant="soft" onClick={share}><Share2 size={16} />Share</Button>
        <Button variant="soft" onClick={copy}><Copy size={16} />Copy</Button>
      </div>
      {onDone && <Button className="w-full" onClick={onDone}>Done</Button>}
    </div>
  )
}
