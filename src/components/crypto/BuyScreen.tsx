import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, type Quote } from '@/lib/api'
import { crypto, ngn, parseError } from '@/lib/format'
import type { CryptoOp } from '@/lib/home'
import { useOp, useServerQuote } from '@/lib/useOpQuote'
import { PinPad } from '../naira/PinPad'
import { Sheet } from '../naira/Sheet'
import { TokenField } from '../TokenPicker'
import { Button, Card, Field, Row, Sandbox } from '../ui'
import { OpResult } from './OpResult'

/** Buy crypto with your Naira wallet through the P2P exchange. Needs your PIN; the server prices and verifies. */
export function BuyScreen({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient()
  const [symbol, setSymbol] = useState('USDC')
  const [amount, setAmount] = useState('')
  const [pinOpen, setPinOpen] = useState(false)
  const [round, setRound] = useState(0)
  const [opId, setOpId] = useState<string | null>(null)
  const valid = /^\d+(\.\d{1,2})?$/.test(amount) && Number(amount) > 0
  const { data: quote, error, isFetching, refetch } = useServerQuote<Quote>('/api/quotes', { side: 'buy', asset: symbol, amount }, valid)
  const { data: op } = useOp(opId)

  const buy = useMutation({
    mutationFn: (pin: string) => api<{ op: CryptoOp }>('/api/crypto/buy', { method: 'POST', body: { quoteId: quote?.id, idempotencyKey: `buy-${quote?.id}`, funding: 'wallet', pin } }),
    onSuccess: (r) => {
      setPinOpen(false)
      setOpId(r.op.id)
      void qc.invalidateQueries({ queryKey: ['home'] })
      void qc.invalidateQueries({ queryKey: ['naira'] })
      void qc.invalidateQueries({ queryKey: ['balances'] })
    },
    onError: (e) => { toast.error(parseError(e)); setRound((n) => n + 1); void refetch() },
  })

  if (opId) return op ? <OpResult op={op} onDone={onDone} /> : <div className="h-64 animate-pulse rounded-3xl bg-muted" aria-busy="true" />
  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <div className="flex items-center justify-between"><span className="eyebrow">Buy</span><Sandbox label="Sandbox" /></div>
        <TokenField label="Crypto to buy" value={symbol} onChange={setSymbol} balanceMode="exchange" reasonFor={(t) => (t.tradable ? null : 'No rate set yet')} />
        <Field label="Naira to spend (₦)" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
        <p className="text-xs text-subtle">Paid from your Naira wallet. The crypto is added to your exchange balance.</p>
      </Card>
      <Card className="space-y-2 p-5">
        <Row label="You receive" value={<span className="num text-lg font-semibold">{quote ? `${crypto(quote.cryptoAmount)} ${symbol}` : valid && isFetching ? '…' : '—'}</span>} />
        {quote && (
          <>
            <Row label="Rate" value={`${ngn(quote.rate)} per ${symbol}`} />
            <Row label={`Platform fee (${(quote.feeBps / 100).toFixed(2)}%)`} value={ngn(quote.platformFeeNgn)} />
            <Row label="Network (gas) fee" value={ngn(quote.networkFeeNgn)} />
            <Row label="You pay" value={<span className="num font-semibold">{ngn(quote.grossNgn)}</span>} />
          </>
        )}
        {error && valid && <p className="text-sm text-danger" role="alert">{parseError(error)}</p>}
      </Card>
      <Button className="w-full" disabled={!quote || buy.isPending} onClick={() => setPinOpen(true)}>Review and buy</Button>
      <Sheet open={pinOpen} onClose={() => setPinOpen(false)} title="Confirm purchase">
        {quote && <p className="mb-4 text-center text-sm text-ink-2">Pay <b>{ngn(quote.grossNgn)}</b> for <b>{crypto(quote.cryptoAmount)} {symbol}</b>. Enter your 4-digit PIN.</p>}
        <PinPad key={round} disabled={buy.isPending} onComplete={(pin) => buy.mutate(pin)} />
      </Sheet>
    </div>
  )
}
