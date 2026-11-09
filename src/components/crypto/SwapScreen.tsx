import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowDownUp } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { crypto, ngn, parseError } from '@/lib/format'
import type { CryptoOp } from '@/lib/home'
import { newKey } from '@/lib/naira'
import { useExchangeBalances, useServerQuote } from '@/lib/useOpQuote'
import { PinPad } from '../naira/PinPad'
import { Sheet } from '../naira/Sheet'
import { TokenField } from '../TokenPicker'
import { Button, Card, Field, Row, Sandbox } from '../ui'
import { OpResult } from './OpResult'

interface SwapQuote {
  from: string; to: string; receive: string; valueNgn: string; feeNgn: string; platformFeeNgn: string; networkFeeNgn: string; feeBps: number
  fromRateNgn: string; toRateNgn: string; available: string; note: string
}

/** Swap between exchange balances at the founder-set rates. The server prices and verifies everything. */
export function SwapScreen({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient()
  const have = useExchangeBalances()
  const [from, setFrom] = useState('USDC')
  const [to, setTo] = useState('SOL')
  const [amount, setAmount] = useState('')
  const [pinOpen, setPinOpen] = useState(false)
  const [round, setRound] = useState(0)
  const [op, setOp] = useState<CryptoOp | null>(null)
  const [idem] = useState(newKey)
  const valid = /^\d+(\.\d{1,9})?$/.test(amount) && Number(amount) > 0 && from !== to
  const { data: quote, error, isFetching } = useServerQuote<SwapQuote>('/api/crypto/swap/quote', { from, to, amount }, valid)

  const swap = useMutation({
    mutationFn: (pin: string) => api<{ op: CryptoOp }>('/api/crypto/swap', { method: 'POST', body: { from, to, amount, idempotencyKey: idem, pin } }),
    onSuccess: (r) => {
      setPinOpen(false)
      setOp(r.op)
      void qc.invalidateQueries({ queryKey: ['balances'] })
      void qc.invalidateQueries({ queryKey: ['home'] })
    },
    onError: (e) => { toast.error(parseError(e)); setRound((n) => n + 1) },
  })

  if (op) return <OpResult op={op} onDone={onDone} />
  const flip = () => { setFrom(to); setTo(from) }
  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <div className="flex items-center justify-between"><span className="eyebrow">From</span><Sandbox label="Sandbox rates" /></div>
        <TokenField value={from} onChange={setFrom} balanceMode="exchange" reasonFor={(t) => (t.symbol === to ? 'Already chosen as the other side' : t.tradable ? null : 'No rate set yet')} />
        <Field label="Amount" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
        <p className="text-xs text-subtle">Available in your exchange balance: <span className="num font-semibold">{crypto(have[from] ?? '0')} {from}</span></p>
        <div className="flex justify-center"><button onClick={flip} aria-label="Swap direction" className="grid size-11 place-items-center rounded-full border border-line-strong hover:bg-muted"><ArrowDownUp size={18} /></button></div>
        <span className="eyebrow">To</span>
        <TokenField value={to} onChange={setTo} balanceMode="exchange" reasonFor={(t) => (t.symbol === from ? 'Already chosen as the other side' : t.tradable ? null : 'No rate set yet')} />
      </Card>
      <Card className="space-y-2 p-5">
        <Row label="You receive" value={<span className="num text-lg font-semibold">{quote ? `${crypto(quote.receive)} ${to}` : valid && isFetching ? '…' : '—'}</span>} />
        {quote && (
          <>
            <Row label="Rate" value={`1 ${from} ≈ ${ngn(quote.fromRateNgn)} · 1 ${to} ≈ ${ngn(quote.toRateNgn)}`} />
            <Row label={`Platform fee (${(quote.feeBps / 100).toFixed(2)}%)`} value={ngn(quote.platformFeeNgn)} />
            <Row label="Network (gas) fee" value={ngn(quote.networkFeeNgn)} />
            <p className="pt-1 text-xs text-subtle">{quote.note}</p>
          </>
        )}
        {error && valid && <p className="text-sm text-danger" role="alert">{parseError(error)}</p>}
      </Card>
      <Button className="w-full" disabled={!quote || swap.isPending} onClick={() => setPinOpen(true)}>Review and swap</Button>
      <Sheet open={pinOpen} onClose={() => setPinOpen(false)} title="Confirm swap">
        {quote && <p className="mb-4 text-center text-sm text-ink-2">Swap <b>{amount} {from}</b> for <b>{crypto(quote.receive)} {to}</b>. Enter your 4-digit PIN.</p>}
        <PinPad key={round} disabled={swap.isPending} onComplete={(pin) => swap.mutate(pin)} />
      </Sheet>
    </div>
  )
}
