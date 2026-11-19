import { AlertTriangle } from 'lucide-react'
import { eta } from '@/lib/trade-format'
import type { ProviderQuote, TradeQuote } from '@/lib/trade'
import { Card, Row } from '../ui'

const feeText = (f: { label: string; token: string; amount: string }) => `${f.amount} ${f.token}`

/** The full summary a customer reviews before anything is signed: tokens, networks, fees, time, slippage, and the other providers' offers. */
export function QuoteView({ quote, chosen, onChoose }: { quote: TradeQuote; chosen: string; onChoose: (p: string) => void }) {
  const all = [quote.recommended, ...quote.alternatives]
  const q: ProviderQuote = all.find((a) => a.provider === chosen) ?? quote.recommended
  const bridge = quote.kind === 'bridge'
  return (
    <div className="space-y-3">
      <Card className="space-y-1 p-5">
        <Row label="You send" value={`${quote.amount} ${quote.labelIn}`} />
        <Row label="You receive (estimate)" value={`${q.amountOut} ${quote.labelOut}`} />
        {q.minOut && <Row label={`Minimum after ${quote.slippageBps / 100}% slippage`} value={`${q.minOut} ${quote.labelOut}`} />}
        <Row label={bridge ? 'From' : 'Network'} value={quote.fromName} />
        {bridge && <Row label="To" value={quote.toName} />}
        {bridge && <Row label="Arrives at" value={<span className="mono text-xs">{quote.recipient.slice(0, 8)}…{quote.recipient.slice(-6)} (your wallet)</span>} />}
        {q.fees.map((f) => <Row key={f.type + f.label} label={f.label} value={feeText(f)} />)}
        {q.priceImpactBps !== null && <Row label="Price impact" value={<span className={q.priceImpactBps > 100 ? 'text-danger' : ''}>{(q.priceImpactBps / 100).toFixed(2)}%</span>} />}
        <Row label="Estimated time" value={eta(q.etaSeconds)} />
        <Row label="Provider" value={q.providerName} />
        {quote.balance !== null && <Row label="Your balance" value={`${quote.balance} ${quote.labelIn}`} />}
        {bridge && q.otherSpeed && (
          <p className="pt-2 text-xs text-subtle">{q.otherSpeed.speed === 'slow' ? 'Standard' : 'Fast'} instead: you would receive {q.otherSpeed.amountOut} {quote.labelOut}, in about {eta(q.otherSpeed.etaSeconds)}.</p>
        )}
        {quote.warnings.map((w) => <p key={w} className="flex gap-2 pt-2 text-xs text-subtle"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{w}</p>)}
      </Card>
      {all.length > 1 && (
        <Card className="space-y-2 p-5">
          <span className="eyebrow block">Other providers</span>
          <div role="radiogroup" className="space-y-2">
            {all.map((a) => (
              <button key={a.provider} type="button" role="radio" aria-checked={a.provider === q.provider} onClick={() => onChoose(a.provider)}
                className={'flex min-h-[48px] w-full items-center justify-between gap-3 rounded-2xl border px-3 text-left text-sm ' + (a.provider === q.provider ? 'border-ink bg-muted' : 'border-line-strong')}>
                <span className="font-bold">{a.providerName}{a.provider === quote.recommended.provider ? ' (recommended)' : ''}</span>
                <span className="num">{a.amountOut} {quote.labelOut}</span>
              </button>
            ))}
          </div>
        </Card>
      )}
      {quote.skipped.length > 0 && <p className="text-xs text-subtle">Not used: {quote.skipped.map((s) => `${s.name} (${s.reason})`).join('; ')}</p>}
    </div>
  )
}
