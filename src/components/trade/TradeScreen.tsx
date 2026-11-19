import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowDownUp, FlaskConical } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { parseError } from '@/lib/format'
import { newKey } from '@/lib/naira'
import type { TradeConfig, TradeOp, TradeQuote } from '@/lib/trade'
import { NetworkLabel, NetworkPicker } from '../NetworkIcon'
import { PinPad } from '../naira/PinPad'
import { Sheet } from '../naira/Sheet'
import { Badge, Button, Card, Field, Segmented } from '../ui'
import { ProgressView } from './ProgressView'
import { QuoteView } from './QuoteView'
import { TokenRow, formatBalance } from './TokenRow'
import { PoweredBy } from '../crypto/PoweredBy'
import { BRIDGE_POWERED_BY } from '@/lib/providers'

const SLIPPAGE = [{ value: '50', label: '0.5%' }, { value: '100', label: '1%' }, { value: '300', label: '3%' }]

/** One screen for both trades. Swaps stay on one network; bridges move a token to another network. The server picks the provider. */
export function TradeScreen({ kind, onDone, initialFrom }: { kind: 'swap' | 'bridge'; onDone: () => void; initialFrom?: string }) {
  const { data: cfg } = useQuery({ queryKey: ['trade-config'], queryFn: () => api<TradeConfig>('/api/trade/config'), staleTime: 30_000 })
  const { data: ops } = useQuery({ queryKey: ['trade-ops'], queryFn: () => api<{ ops: TradeOp[] }>('/api/trade/ops'), refetchInterval: 5000 })
  const [from, setFrom] = useState(initialFrom ?? '')
  const [to, setTo] = useState('')
  const [tokenIn, setTokenIn] = useState('USDC')
  const [tokenOut, setTokenOut] = useState('')
  const [amount, setAmount] = useState('')
  const [slip, setSlip] = useState('50')
  const [speed, setSpeed] = useState<'fast' | 'slow'>('fast')
  const [quote, setQuote] = useState<TradeQuote | null>(null)
  const [chosen, setChosen] = useState('')
  const [pinOpen, setPinOpen] = useState(false)
  const [round, setRound] = useState(0)
  const [idem, setIdem] = useState(newKey)
  const [opId, setOpId] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(null)

  const chains = (cfg?.chains ?? []).filter((c) => (kind === 'swap' ? c.swap : true))
  const defaultFrom = chains.find((c) => c.id === (kind === 'swap' ? 'arc-testnet' : 'arc-testnet'))?.id ?? chains[0]?.id ?? ''
  const fromId = chains.some((c) => c.id === from) ? from : defaultFrom
  const toId = kind === 'swap' ? fromId : chains.some((c) => c.id === to && c.id !== fromId) ? to : (chains.find((c) => c.id !== fromId)?.id ?? '')
  const fromChain = chains.find((c) => c.id === fromId)
  const tokens = (kind === 'swap' ? fromChain?.swapTokens : fromChain?.bridgeTokens) ?? []
  const inSym = tokens.some((t) => t.symbol === tokenIn) ? tokenIn : (tokens[0]?.symbol ?? '')
  const outSym = tokens.some((t) => t.symbol === tokenOut) && tokenOut !== inSym ? tokenOut : (tokens.find((t) => t.symbol !== inSym)?.symbol ?? '')
  const { data: chainBal } = useQuery({ queryKey: ['trade-chain-balances', inSym, fromId], enabled: kind === 'bridge' && Boolean(inSym), queryFn: () => api<{ balances: Record<string, string | null> }>(`/api/trade/chain-balances?token=${inSym}`).then((r) => r.balances), staleTime: 0 })
  const { data: bal } = useQuery({ queryKey: ['trade-balances', fromId], enabled: Boolean(fromId), queryFn: () => api<{ balances: Record<string, string | null> }>(`/api/trade/balances?chain=${fromId}`).then((r) => r.balances), staleTime: 0 })
  const valid = /^\d+(\.\d{1,8})?$/.test(amount) && Number(amount) > 0 && Boolean(fromId) && Boolean(toId) && Boolean(inSym) && (kind === 'bridge' || (Boolean(outSym) && outSym !== inSym))
  const body = { kind, from: fromId, to: toId, tokenIn: inSym, tokenOut: kind === 'swap' ? outSym : inSym, amount, slippageBps: Number(slip), speed }
  const reset = () => { setQuote(null); setChosen('') }

  const getQuote = useMutation({
    mutationFn: () => api<{ quote: TradeQuote }>('/api/trade/quote', { method: 'POST', body }),
    onSuccess: (r) => { setQuote(r.quote); setChosen(r.quote.recommended.provider) },
    onError: (e) => toast.error(parseError(e)),
  })
  const picked = quote ? [quote.recommended, ...quote.alternatives].find((a) => a.provider === chosen) ?? quote.recommended : null
  const start = useMutation({
    mutationFn: (pin: string) => api<{ op: TradeOp }>('/api/trade/start', { method: 'POST', body: { ...body, provider: picked?.provider, confirmToken: picked?.confirmToken, expiresAt: quote?.expiresAt, pin, idempotencyKey: idem } }),
    onSuccess: (r) => { setPinOpen(false); setOpId(r.op.id) },
    onError: (e) => { toast.error(parseError(e)); setRound((n) => n + 1) },
  })

  // A trade that is still running (started here, or before the person left) is shown again when they come back.
  const running = ops?.ops.find((o) => o.kind === kind && o.status === 'running' && o.id !== dismissed)
  const activeId = opId ?? running?.id ?? null

  if (!cfg) return <div className="h-64 animate-pulse rounded-3xl bg-muted" aria-busy="true" />
  if (activeId) return <ProgressView opId={activeId} onDone={() => { setDismissed(activeId); setOpId(null); reset(); setAmount(''); onDone() }} />
  if (chains.length === 0) return <Card className="p-5 text-sm">No network is available for this right now.</Card>

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <div className="flex items-center justify-end gap-2">
          {cfg.testnet ? <Badge kind="info"><FlaskConical size={12} className="mr-1 inline" />Testnet</Badge> : <Badge kind="warn">Mainnet: real funds</Badge>}
        </div>
        <NetworkPicker label={kind === 'swap' ? 'Network' : 'From'} value={fromId} options={chains.map((c) => ({ id: c.id, name: c.name }))} onChange={(v) => { setFrom(v); reset() }}
          trailing={kind === 'bridge' ? Object.fromEntries(chains.map((c) => [c.id, formatBalance(chainBal?.[c.id])])) : undefined} />
        <span className="eyebrow block">{kind === 'swap' ? 'You pay' : 'Token'}</span>
        <TokenRow tokens={tokens} value={inSym} balances={bal ?? {}} onChange={(s) => { setTokenIn(s); reset() }} />
        <Field label="Amount" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => { setAmount(e.target.value.replace(/[^0-9.]/g, '')); reset() }} />

        {kind === 'swap' ? (
          <>
            <div className="flex justify-center"><button onClick={() => { setTokenIn(outSym); setTokenOut(inSym); reset() }} aria-label="Swap direction" className="grid size-11 place-items-center rounded-full border border-line-strong hover:bg-muted"><ArrowDownUp size={18} /></button></div>
            <span className="eyebrow block">You receive</span>
            <TokenRow tokens={tokens.filter((t) => t.symbol !== inSym)} value={outSym} onChange={(s) => { setTokenOut(s); reset() }} />
          </>
        ) : (
          <>
            <div className="flex justify-center"><button onClick={() => { setFrom(toId); setTo(fromId); reset() }} aria-label="Reverse networks" className="grid size-11 place-items-center rounded-full border border-line-strong hover:bg-muted"><ArrowDownUp size={18} /></button></div>
            <NetworkPicker label="To" value={toId} options={chains.filter((c) => c.id !== fromId).map((c) => ({ id: c.id, name: c.name }))} onChange={(v) => { setTo(v); reset() }} />
            <div>
              <span className="eyebrow mb-2 block">Transfer speed</span>
              <Segmented value={speed} onChange={(v) => { setSpeed(v); reset() }} options={[{ value: 'fast', label: 'Fast' }, { value: 'slow', label: 'Standard (cheaper, slower)' }]} />
            </div>
          </>
        )}
        <div>
          <span className="eyebrow mb-2 block">Slippage limit</span>
          <Segmented value={slip} onChange={(v) => { setSlip(v); reset() }} options={SLIPPAGE.filter((o) => Number(o.value) <= cfg.slippage.maxBps)} />
        </div>
      </Card>

      {quote && <QuoteView quote={quote} chosen={chosen} onChoose={setChosen} />}

      {quote
        ? <Button className="w-full" onClick={() => { setIdem(newKey()); setPinOpen(true) }}>Confirm {kind === 'swap' ? 'swap' : 'bridge'} with PIN</Button>
        : <Button className="w-full" disabled={!valid} loading={getQuote.isPending} onClick={() => getQuote.mutate()}>Get quote</Button>}
      <p className="text-center text-xs text-subtle">Nothing is sent until you confirm with your PIN. The tokens go to your own wallet. {cfg.testnet ? 'Test network: these tokens have no market value.' : ''}</p>

      {kind === 'bridge' && <PoweredBy providers={BRIDGE_POWERED_BY} />}

      <Sheet open={pinOpen} onClose={() => setPinOpen(false)} title={kind === 'swap' ? 'Confirm swap' : 'Confirm bridge'}>
        {quote && picked && (
          <p className="mb-4 text-center text-sm text-ink-2">
            {kind === 'swap' ? <>Swap <b>{quote.amount} {quote.labelIn}</b> for about <b>{picked.amountOut} {quote.labelOut}</b> on <NetworkLabel id={quote.from} name={quote.fromName} size={14} /></> : <>Send <b>{quote.amount} {quote.labelIn}</b> from <b>{quote.fromName}</b> to <b>{quote.toName}</b>, about <b>{picked.amountOut} {quote.labelOut}</b> arrives.</>} Enter your 4-digit PIN.
          </p>
        )}
        <PinPad key={round} disabled={start.isPending} onComplete={(pin) => start.mutate(pin)} />
      </Sheet>
    </div>
  )
}
