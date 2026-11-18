import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowDownUp, CheckCircle2, ExternalLink, Loader2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { parseError } from '@/lib/format'
import { newKey } from '@/lib/naira'
import { NetworkLabel } from '../NetworkIcon'
import { PinPad } from '../naira/PinPad'
import { Sheet } from '../naira/Sheet'
import { Button, Card, Field, Row, Segmented, TokenIcon } from '../ui'

interface Config { chain: string; network: 'testnet'; tokens: { symbol: string; label: string; name: string }[]; slippage: { defaultBps: number; maxBps: number } }
interface Fee { type: string; token: string; amount: string }
interface Quote {
  confirmToken: string; expiresAt: number; chain: string; tokenIn: string; tokenOut: string; labelIn: string; labelOut: string; amount: string; slippageBps: number
  estimatedOut: string; minimumOut: string | null; balance: string; address: string; fees: Fee[]; provider: string; warnings: string[]
}
interface SwapOp {
  id: string; chain: string; tokenIn: string; tokenOut: string; labelIn: string; labelOut: string; amountIn: string; amountOut: string | null
  status: 'running' | 'completed' | 'failed'; txHash: string | null; explorerUrl: string | null; error: string | null; provider: string | null
}

const SLIPPAGE = [{ value: '50', label: '0.5%' }, { value: '100', label: '1%' }, { value: '300', label: '3%' }]
const FEE_LABEL: Record<string, string> = { provider: 'Provider fee', gas: 'Network fee', custom: 'Service fee' }

const TokenButtons = ({ value, onChange, tokens }: { value: string; onChange: (s: string) => void; tokens: Config['tokens'] }) => (
  <Segmented value={value} onChange={onChange} options={tokens.map((t) => ({ value: t.symbol, label: <span className="inline-flex items-center justify-center gap-1.5"><TokenIcon symbol={t.symbol} size={20} />{t.label}</span> }))} />
)

/** Swaps between the tokens Circle supports on Arc Testnet, from the user's app wallet. Quote first, then a PIN. Nothing is sent until the user confirms. */
export function CircleSwap({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient()
  const { data: cfg } = useQuery({ queryKey: ['swap-config'], queryFn: () => api<Config>('/api/swap/config'), staleTime: 10 * 60_000 })
  const [pickIn, setIn] = useState('USDC')
  const [pickOut, setOut] = useState('EURC')
  const [amount, setAmount] = useState('')
  const [slip, setSlip] = useState('100')
  const [quote, setQuote] = useState<Quote | null>(null)
  const [pinOpen, setPinOpen] = useState(false)
  const [round, setRound] = useState(0)
  const [idem, setIdem] = useState(newKey)
  const [opId, setOpId] = useState<string | null>(null)

  const tokens = cfg?.tokens ?? []
  const tokenIn = tokens.some((t) => t.symbol === pickIn) ? pickIn : (tokens[0]?.symbol ?? '')
  const tokenOut = tokens.some((t) => t.symbol === pickOut) && pickOut !== tokenIn ? pickOut : (tokens.find((t) => t.symbol !== tokenIn)?.symbol ?? '')
  const valid = /^\d+(\.\d{1,8})?$/.test(amount) && Number(amount) > 0 && Boolean(tokenIn) && Boolean(tokenOut) && tokenIn !== tokenOut
  const body = { tokenIn, tokenOut, amount, slippageBps: Number(slip) }
  const reset = () => setQuote(null)

  const getQuote = useMutation({
    mutationFn: () => api<{ quote: Quote }>('/api/swap/quote', { method: 'POST', body }),
    onSuccess: (r) => setQuote(r.quote),
    onError: (e) => toast.error(parseError(e)),
  })
  const start = useMutation({
    mutationFn: (pin: string) => api<{ op: SwapOp }>('/api/swap/start', { method: 'POST', body: { ...body, confirmToken: quote?.confirmToken, expiresAt: quote?.expiresAt, pin, idempotencyKey: idem } }),
    onSuccess: (r) => { setPinOpen(false); setOpId(r.op.id) },
    onError: (e) => { toast.error(parseError(e)); setRound((n) => n + 1) },
  })
  const { data: op } = useQuery({
    queryKey: ['swap-op', opId],
    enabled: Boolean(opId),
    queryFn: () => api<{ op: SwapOp }>(`/api/swap/ops/${opId}`).then((r) => r.op),
    refetchInterval: (q) => (q.state.data?.status === 'running' || !q.state.data ? 2000 : false),
  })
  const finished = Boolean(op && op.status !== 'running')
  // Balances change once the swap lands, so the Crypto screen is refreshed then.
  useEffect(() => { if (finished) void qc.invalidateQueries({ queryKey: ['crypto'] }) }, [finished, qc])

  if (opId) {
    const status = op?.status ?? 'running'
    return (
      <Card className="space-y-4 p-5">
        <div className="flex items-center gap-3">
          {status === 'completed' ? <CheckCircle2 size={28} className="text-success" /> : status === 'failed' ? <XCircle size={28} className="text-danger" /> : <Loader2 size={28} className="animate-spin" />}
          <h2 className="display text-xl">{status === 'completed' ? 'Swap complete' : status === 'failed' ? 'Swap did not finish' : 'Swapping…'}</h2>
        </div>
        <div className="space-y-1">
          <Row label="You paid" value={`${op?.amountIn ?? amount} ${op?.labelIn ?? quote?.labelIn ?? ''}`} />
          <Row label="You received" value={op?.amountOut ? `${op.amountOut} ${op.labelOut}` : status === 'running' ? 'Waiting for the network' : '-'} />
          {op?.provider && <Row label="Swap provider" value={<span className="capitalize">{op.provider}</span>} />}
        </div>
        {op?.error && <p className="text-sm text-danger" role="alert">{op.error}</p>}
        {op?.explorerUrl && <a href={op.explorerUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-bold underline">View on the explorer <ExternalLink size={14} /></a>}
        <Button className="w-full" variant={status === 'running' ? 'soft' : 'primary'} disabled={status === 'running'} onClick={onDone}>Done</Button>
      </Card>
    )
  }

  if (!cfg) return <div className="h-64 animate-pulse rounded-3xl bg-muted" aria-busy="true" />

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <div className="flex items-center justify-between gap-2">
          <span className="eyebrow">Network</span>
          <NetworkLabel id="arc-testnet" name={cfg.chain} size={20} />
        </div>
        <span className="eyebrow block">You pay</span>
        <TokenButtons value={tokenIn} onChange={(s) => { setIn(s); reset() }} tokens={tokens} />
        <Field label="Amount" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => { setAmount(e.target.value.replace(/[^0-9.]/g, '')); reset() }} />
        <div className="flex justify-center"><button onClick={() => { setIn(tokenOut); setOut(tokenIn); reset() }} aria-label="Swap direction" className="grid size-11 place-items-center rounded-full border border-line-strong hover:bg-muted"><ArrowDownUp size={18} /></button></div>
        <span className="eyebrow block">You receive</span>
        <TokenButtons value={tokenOut} onChange={(s) => { setOut(s); reset() }} tokens={tokens} />
        <div>
          <span className="eyebrow mb-2 block">Slippage limit</span>
          <Segmented value={slip} onChange={(v) => { setSlip(v); reset() }} options={SLIPPAGE} />
        </div>
      </Card>

      {quote && (
        <Card className="space-y-1 p-5">
          <Row label="You pay" value={`${quote.amount} ${quote.labelIn}`} />
          <Row label="You receive (estimate)" value={`${quote.estimatedOut} ${quote.labelOut}`} />
          {quote.minimumOut && <Row label={`Minimum you will accept (${quote.slippageBps / 100}% slippage)`} value={`${quote.minimumOut} ${quote.labelOut}`} />}
          {quote.fees.map((f) => <Row key={f.type + f.token} label={FEE_LABEL[f.type] ?? f.type} value={`${f.amount} ${f.token}`} />)}
          <Row label="Your balance" value={`${quote.balance} ${quote.labelIn}`} />
          <Row label="Swap provider" value={<span className="capitalize">{quote.provider}</span>} />
          {quote.warnings.map((w) => (
            <p key={w} className="flex gap-2 pt-2 text-xs text-subtle"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{w}</p>
          ))}
        </Card>
      )}

      {quote
        ? <Button className="w-full" onClick={() => { setIdem(newKey()); setPinOpen(true) }}>Confirm swap with PIN</Button>
        : <Button className="w-full" disabled={!valid} loading={getQuote.isPending} onClick={() => getQuote.mutate()}>Get quote</Button>}
      <p className="text-center text-xs text-subtle">Testnet only: these tokens have no market value. The swap pays out to your own wallet, and nothing is sent until you confirm with your PIN.</p>

      <Sheet open={pinOpen} onClose={() => setPinOpen(false)} title="Confirm swap">
        {quote && <p className="mb-4 text-center text-sm text-ink-2">Swap <b>{quote.amount} {quote.labelIn}</b> for about <b>{quote.estimatedOut} {quote.labelOut}</b>. Enter your 4-digit PIN.</p>}
        <PinPad key={round} disabled={start.isPending} onComplete={(pin) => start.mutate(pin)} />
      </Sheet>
    </div>
  )
}
