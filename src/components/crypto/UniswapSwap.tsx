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
import { TokenSelect } from './TokenSelect'
import { Button, Card, Row } from '../ui'

interface Config { chain: string; networkId?: string; network: 'testnet'; tokens: { symbol: string; label: string; name: string; balance?: string | null }[]; slippage: { defaultBps: number; maxBps: number } }
interface Fee { type: string; token: string; amount: string }
interface Quote {
  confirmToken: string; expiresAt: number; chain: string; tokenIn: string; tokenOut: string; labelIn: string; labelOut: string; amount: string; slippageBps: number
  estimatedOut: string; minimumOut: string | null; balance: string; address: string; fees: Fee[]; provider: string; warnings: string[]
  networkId?: string; feeTier?: number; minimumOutRaw?: string; priceImpactBps?: number; needsApproval?: boolean
}
interface SwapOp {
  id: string; chain: string; tokenIn: string; tokenOut: string; labelIn: string; labelOut: string; amountIn: string; amountOut: string | null
  status: 'running' | 'completed' | 'failed'; txHash: string | null; explorerUrl: string | null; error: string | null; provider: string | null
}

const SLIPPAGE = [{ value: '50', label: '0.5%' }, { value: '100', label: '1%' }]
const FEE_LABEL: Record<string, string> = { provider: 'Pool fee', gas: 'Network fee', custom: 'Service fee' }
const base = '/api/uniswap'

/** The value after `ms` of no change, so a price is requested once the person stops typing. */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [value, ms])
  return v
}

/**
 * The swap card: From token, Amount (with your balance under it), flip, To token, and a live "You receive". Swaps always run on Uniswap
 * and are signed from the user's app wallet after the transaction PIN. The price updates by itself; nothing is sent until the user confirms.
 */
export function UniswapSwap({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient()
  const { data: cfg } = useQuery({ queryKey: ['swap-config', 'uniswap'], queryFn: () => api<Config>(`${base}/config`), staleTime: 30_000 })
  const [pickIn, setIn] = useState('USDC')
  const [pickOut, setOut] = useState('WETH')
  const [amount, setAmount] = useState('')
  const [slip, setSlip] = useState('50')
  const [pinOpen, setPinOpen] = useState(false)
  const [round, setRound] = useState(0)
  const [idem, setIdem] = useState(newKey)
  const [opId, setOpId] = useState<string | null>(null)

  const tokens = cfg?.tokens ?? []
  const tokenIn = tokens.some((t) => t.symbol === pickIn) ? pickIn : (tokens[0]?.symbol ?? '')
  const tokenOut = tokens.some((t) => t.symbol === pickOut) && pickOut !== tokenIn ? pickOut : (tokens.find((t) => t.symbol !== tokenIn)?.symbol ?? '')
  const balance = tokens.find((t) => t.symbol === tokenIn)?.balance
  const typed = useDebounced(amount, 500)
  const valid = /^\d+(\.\d{1,18})?$/.test(typed) && Number(typed) > 0 && Boolean(tokenIn) && Boolean(tokenOut) && tokenIn !== tokenOut
  const body = { tokenIn, tokenOut, amount: typed, slippageBps: Number(slip), networkId: cfg?.networkId }

  // The price is requested by itself as the details change. A request that fails shows its reason under the "You receive" box.
  const price = useQuery({
    queryKey: ['uni-quote', body], enabled: valid && Boolean(cfg), retry: false, staleTime: 20_000, gcTime: 0,
    queryFn: () => api<{ quote: Quote }>(`${base}/quote`, { method: 'POST', body }).then((r) => r.quote),
  })
  const quote = valid && amount === typed ? price.data : undefined
  const quoting = (valid && price.isFetching) || amount !== typed
  const start = useMutation({
    mutationFn: (pin: string) => api<{ op: SwapOp }>(`${base}/start`, { method: 'POST', body: { ...body, feeTier: quote?.feeTier, minimumOutRaw: quote?.minimumOutRaw, confirmToken: quote?.confirmToken, expiresAt: quote?.expiresAt, pin, idempotencyKey: idem } }),
    onSuccess: (r) => { setPinOpen(false); setOpId(r.op.id) },
    onError: (e) => { toast.error(parseError(e)); setRound((n) => n + 1) },
  })
  const { data: op } = useQuery({
    queryKey: ['swap-op', opId], enabled: Boolean(opId),
    queryFn: () => api<{ op: SwapOp }>(`${base}/ops/${opId}`).then((r) => r.op),
    refetchInterval: (q) => (q.state.data?.status === 'running' || !q.state.data ? 2000 : false),
  })
  const finished = Boolean(op && op.status !== 'running')
  // Balances change once the swap lands, so the screens that show them are refreshed then.
  useEffect(() => { if (finished) { void qc.invalidateQueries({ queryKey: ['crypto'] }); void qc.invalidateQueries({ queryKey: ['swap-config'] }) } }, [finished, qc])

  const confirm = async () => {
    // A quote is good for two minutes. An older one is replaced first, so the person confirms the current price.
    const fresh = quote && quote.expiresAt - Date.now() > 10_000 ? quote : (await price.refetch()).data
    if (!fresh) return
    setIdem(newKey())
    setPinOpen(true)
  }

  if (opId) {
    const status = op?.status ?? 'running'
    return (
      <Card className="space-y-4 p-5">
        <div className="flex items-center gap-3">
          {status === 'completed' ? <CheckCircle2 size={28} className="text-success" /> : status === 'failed' ? <XCircle size={28} className="text-danger" /> : <Loader2 size={28} className="animate-spin" />}
          <h2 className="display text-xl">{status === 'completed' ? 'Swap complete' : status === 'failed' ? 'Swap did not finish' : 'Swapping…'}</h2>
        </div>
        <div className="space-y-1">
          <Row label="You paid" value={`${op?.amountIn ?? amount} ${op?.labelIn ?? tokenIn}`} />
          <Row label="You received" value={op?.amountOut ? `${op.amountOut} ${op.labelOut}` : status === 'running' ? 'Waiting for the network' : '-'} />
        </div>
        {op?.error && <p className="text-sm text-danger" role="alert">{op.error}</p>}
        {op?.explorerUrl && <a href={op.explorerUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-bold underline">View on the explorer <ExternalLink size={14} /></a>}
        <Button className="w-full" variant={status === 'running' ? 'soft' : 'primary'} disabled={status === 'running'} onClick={onDone}>Done</Button>
      </Card>
    )
  }

  if (!cfg) return <div className="h-64 animate-pulse rounded-3xl bg-muted" aria-busy="true" />

  const label = (s: string) => tokens.find((t) => t.symbol === s)?.label ?? s
  const error = valid && !quoting && price.isError ? parseError(price.error) : null

  return (
    <div className="space-y-3">
      <Card className="space-y-3 p-4">
        <div className="rounded-2xl bg-muted p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="eyebrow">From</span>
            <NetworkLabel id={cfg.networkId} name={cfg.chain} size={16} className="text-xs" />
          </div>
          <div className="flex items-center gap-3">
            <TokenSelect label="From token" value={tokenIn} tokens={tokens} onChange={setIn} showBalance />
            <input aria-label="Amount" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              className="num min-w-0 flex-1 bg-transparent text-right text-2xl font-extrabold outline-none placeholder:text-subtle" />
          </div>
          <p className="mt-2 text-xs text-subtle">{balance === undefined ? '' : balance === null ? 'Balance unavailable right now' : `Balance: ${balance} ${label(tokenIn)}`}</p>
        </div>

        <div className="-my-1 flex justify-center"><button onClick={() => { setIn(tokenOut); setOut(tokenIn) }} aria-label="Swap direction" className="grid size-11 place-items-center rounded-full border border-line-strong bg-card hover:bg-muted"><ArrowDownUp size={18} /></button></div>

        <div className="rounded-2xl bg-muted p-4" aria-live="polite">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="eyebrow">To</span>
            <div className="flex items-center gap-1" role="radiogroup" aria-label="Slippage limit">
              <span className="mr-1 text-xs text-subtle">Slippage</span>
              {SLIPPAGE.filter((o) => Number(o.value) <= (cfg.slippage.maxBps ?? 100)).map((o) => (
                <button key={o.value} type="button" role="radio" aria-checked={slip === o.value} onClick={() => setSlip(o.value)}
                  className={'min-h-9 rounded-full border px-3 text-xs font-bold ' + (slip === o.value ? 'border-ink bg-card' : 'border-line-strong')}>{o.label}</button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <TokenSelect label="To token" value={tokenOut} tokens={tokens.filter((t) => t.symbol !== tokenIn)} onChange={setOut} />
            <div className="min-w-0 flex-1 text-right">
              <span className="eyebrow block">You receive</span>
              <span className="num block truncate text-2xl font-extrabold">{quote ? quote.estimatedOut : quoting ? '…' : '0.00'}</span>
            </div>
          </div>
          {error && <p className="mt-2 text-xs text-danger" role="alert">{error}</p>}
        </div>
      </Card>

      {quote && (
        <Card className="space-y-1 p-5">
          {quote.minimumOut && <Row label={`Minimum you will accept (${quote.slippageBps / 100}% slippage)`} value={`${quote.minimumOut} ${quote.labelOut}`} />}
          {quote.priceImpactBps !== undefined && <Row label="Price impact" value={<span className={quote.priceImpactBps > 100 ? 'text-danger' : ''}>{(quote.priceImpactBps / 100).toFixed(2)}%</span>} />}
          {quote.fees.map((f) => <Row key={f.type + f.token} label={FEE_LABEL[f.type] ?? f.type} value={`${f.amount} ${f.token}`} />)}
          {quote.warnings.map((w) => <p key={w} className="flex gap-2 pt-2 text-xs text-subtle"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{w}</p>)}
        </Card>
      )}

      <Button className="w-full" disabled={!quote || quoting || Boolean(error)} loading={start.isPending} onClick={() => void confirm()}>{quote?.needsApproval ? 'Approve and swap' : 'Swap'}</Button>

      <Sheet open={pinOpen} onClose={() => setPinOpen(false)} title="Confirm swap">
        {quote && <p className="mb-4 text-center text-sm text-ink-2">{quote.needsApproval ? 'Approve and swap ' : 'Swap '}<b>{quote.amount} {quote.labelIn}</b> for about <b>{quote.estimatedOut} {quote.labelOut}</b>. Enter your 4-digit PIN.</p>}
        <PinPad key={round} disabled={start.isPending} onComplete={(pin) => start.mutate(pin)} />
      </Sheet>
    </div>
  )
}
