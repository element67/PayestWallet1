import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import { RefreshCw, Timer } from 'lucide-react'
import { toast } from 'sonner'
import { api, type Order, type Quote } from '@/lib/api'
import { useAssets, useBalances, useBanks } from '@/lib/queries'
import { crypto, ngn } from '@/lib/format'
import { useSession } from '@/lib/session'
import { OrderTracker } from '@/components/OrderTracker'
import { ExchangeCredits } from '@/components/ExchangeCredits'
import { PinPad } from '@/components/naira/PinPad'
import { Sheet } from '@/components/naira/Sheet'
import { TokenField } from '@/components/TokenPicker'
import { Badge, Button, Card, Field, PageTitle, Row, Sandbox, Segmented } from '@/components/ui'

export function Exchange({ focusOrder, clearFocus, initialSide = 'sell' }: { focusOrder: string | null; clearFocus: () => void; initialSide?: 'sell' | 'buy' }) {
  const [orderId, setOrderId] = useState<string | null>(focusOrder)
  if (orderId) {
    return <OrderTracker orderId={orderId} onBack={() => { setOrderId(null); clearFocus() }} />
  }
  return <ExchangeForm onCreated={setOrderId} initialSide={initialSide} />
}

function ExchangeForm({ onCreated, initialSide }: { onCreated: (id: string) => void; initialSide: 'sell' | 'buy' }) {
  const { config } = useSession()
  const { address, isConnected } = useAccount()
  const { data: assets } = useAssets()
  const { data: banks } = useBanks()
  const { data: bal } = useBalances()
  const qc = useQueryClient()

  const [side, setSide] = useState<'sell' | 'buy'>(initialSide)
  const [symbol, setSymbol] = useState('USDC')
  const [amount, setAmount] = useState('')
  const [payoutType, setPayoutType] = useState<'wallet' | 'bank'>('wallet')
  const [bankId, setBankId] = useState('')
  const [funding, setFunding] = useState<'wallet' | 'bank_transfer'>('wallet')
  const [dest, setDest] = useState('')
  const [useLive, setUseLive] = useState(true)
  const [res, setRes] = useState<{ key: string; quote?: Quote; err?: string } | null>(null)
  const [tick, setTick] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const quoteKey = `${side}|${symbol}|${amount}|${tick}`
  const quote = res?.key === quoteKey ? (res.quote ?? null) : null
  const quoteErr = res?.key === quoteKey ? (res.err ?? null) : null

  const asset = assets?.find((a) => a.symbol === symbol)
  const liveEligible = side === 'sell' && asset?.monitoring === 'live' && Boolean(config?.vaultConfigured) && isConnected
  const live = liveEligible && useLive

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [])

  // Debounced quote from the backend, which always prices with the latest founder-set rate.
  useEffect(() => {
    if (!amount || Number(amount) <= 0) return
    const t = setTimeout(() => {
      api<Quote>('/api/quotes', { method: 'POST', body: { side, asset: symbol, amount } })
        .then((q) => setRes({ key: quoteKey, quote: q }))
        .catch((e: Error) => setRes({ key: quoteKey, err: e.message }))
    }, 450)
    return () => clearTimeout(t)
  }, [amount, side, symbol, quoteKey])

  // Re-quote automatically when the locked quote runs out.
  useEffect(() => {
    if (!quote) return
    const t = setTimeout(() => setTick((n) => n + 1), Math.max(0, quote.expiresAt - Date.now()))
    return () => clearTimeout(t)
  }, [quote])

  const secondsLeft = quote ? Math.max(0, Math.round((quote.expiresAt - now) / 1000)) : 0

  const [askPin, setAskPin] = useState(false)
  const [pinRound, setPinRound] = useState(0)
  const needsBank = side === 'sell' && payoutType === 'bank' && !bankId
  const create = useMutation({
    mutationFn: (pin?: string) =>
      api<{ order: Order }>(side === 'sell' ? '/api/p2p/crypto-to-naira' : '/api/p2p/naira-to-crypto', {
        method: 'POST',
        body: {
          quoteId: quote?.id,
          idempotencyKey: `ord-${quote?.id}`,
          ...(side === 'sell'
            ? { payoutType, bankAccountId: payoutType === 'bank' ? bankId : undefined, fromAddress: live ? address : undefined }
            : { funding, destAddress: dest.trim() || undefined, pin }),
        },
      }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['orders'] })
      void qc.invalidateQueries({ queryKey: ['balances'] })
      onCreated(r.order.id)
    },
    onError: (e) => {
      toast.error(e.message)
      setPinRound((r) => r + 1)
    },
  })
  const needsPin = side === 'buy' && funding === 'wallet'

  const switchSide = (s: 'sell' | 'buy') => { setSide(s); setAmount('') }
  const ngnBalance = useMemo(() => Number(bal?.ngn ?? 0), [bal])
  const cantPay = side === 'buy' && funding === 'wallet' && quote && Number(quote.grossNgn) > ngnBalance

  return (
    <>
      <PageTitle title="Payest P2P Exchange" sub="Swap crypto and Naira, fast and verified. You see the exact amount before you approve." />
      <div className="mx-auto max-w-xl space-y-4">
        <Card strong className="p-5">
          <Segmented value={side} onChange={switchSide} options={[{ value: 'sell', label: 'Crypto to Naira' }, { value: 'buy', label: 'Naira to crypto' }]} />

          <div className="mt-5">
            <TokenField
              label={side === 'sell' ? 'Crypto you send' : 'Crypto you receive'} value={symbol} onChange={setSymbol}
              balanceMode={side === 'sell' ? 'onchain' : 'exchange'}
              reasonFor={(t) => (assets?.find((x) => x.symbol === t.symbol)?.enabled ? null : t.tradable ? 'Not enabled yet' : 'No rate set yet')}
            />
          </div>

          <div className="mt-5 rounded-3xl bg-muted p-4">
            <div className="flex items-center justify-between">
              <span className="eyebrow">{side === 'sell' ? `You send (${symbol})` : 'You pay (NGN)'}</span>
              {side === 'buy' && <button className="text-xs font-semibold underline" onClick={() => setAmount(String(Math.floor(ngnBalance)))}>Wallet {ngn(ngnBalance)}</button>}
            </div>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
              placeholder="0.00"
              aria-label="Amount"
              className="display num mt-1 w-full bg-transparent text-5xl font-semibold text-ink placeholder:text-subtle/50 focus:outline-none"
            />
          </div>

          <div className="mt-3 rounded-3xl border border-line p-4">
            <span className="eyebrow">{side === 'sell' ? 'You receive (NGN)' : `You receive (${symbol})`}</span>
            <div className="display num mt-1 min-h-12 text-4xl font-semibold">
              {quote ? (side === 'sell' ? ngn(quote.netNgn) : `${crypto(quote.cryptoAmount)} ${symbol}`) : <span className="text-subtle/50">{quoteErr ? '-' : '0.00'}</span>}
            </div>
            {quoteErr && <p className="mt-1 text-sm text-danger">{quoteErr}</p>}
          </div>

          {quote && (
            <div className="mt-3 divide-y divide-line rounded-2xl px-1">
              <Row label="Rate" value={`${ngn(quote.rate)} per ${symbol}`} />
              <Row label={`Platform fee (${(quote.feeBps / 100).toFixed(2)}%)`} value={ngn(quote.platformFeeNgn)} />
              <Row label="Network (gas) fee" value={ngn(quote.networkFeeNgn)} />
              <Row label={side === 'sell' ? 'Gross Naira value' : 'Total you pay'} value={ngn(quote.grossNgn)} />
              <Row label="Quote valid for" value={<span className="inline-flex items-center gap-1"><Timer size={14} />{secondsLeft}s</span>} />
            </div>
          )}
          {quote?.rateSource === 'seed placeholder' && <p className="mt-2 text-xs text-warn">Rate is a placeholder until the founder sets live rates.</p>}
        </Card>

        <Card className="space-y-4 p-5">
          {side === 'sell' ? (
            <>
              <div>
                <div className="eyebrow mb-1.5">Receive Naira in</div>
                <Segmented value={payoutType} onChange={setPayoutType} options={[{ value: 'wallet', label: 'Naira wallet' }, { value: 'bank', label: 'Bank account' }]} />
                {payoutType === 'bank' && (
                  banks?.length ? (
                    <select value={bankId} onChange={(e) => setBankId(e.target.value)} className="mt-3 min-h-11 w-full rounded-2xl border border-line bg-surface-strong px-4 text-sm">
                      <option value="">Choose a bank account</option>
                      {banks.map((b) => <option key={b.id} value={b.id}>{b.bankName} · {b.masked}</option>)}
                    </select>
                  ) : <p className="mt-3 text-sm text-subtle">Add a bank account in Settings first.</p>
                )}
              </div>
              {asset?.monitoring === 'live' ? (
                <div className="rounded-2xl bg-muted p-3 text-sm">
                  {liveEligible ? (
                    <label className="flex items-start gap-3">
                      <input type="checkbox" className="mt-1 size-4" checked={useLive} onChange={(e) => setUseLive(e.target.checked)} />
                      <span><span className="font-semibold">Send real USDC from {address?.slice(0, 6)}...{address?.slice(-4)}</span><br /><span className="text-xs text-subtle">Arc Testnet transfer, watched live by the agent. Untick for a simulated deposit.</span></span>
                    </label>
                  ) : (
                    <span className="text-subtle">
                      {!config?.vaultConfigured ? 'The founder has not set a vault address yet, so this runs as a simulation.' : 'Connect a wallet to send a real USDC transaction on Arc Testnet, or continue as a simulation.'}
                    </span>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm text-subtle"><Sandbox label="Simulated chain" /> {symbol} deposits are simulated in this build.</div>
              )}
            </>
          ) : (
            <>
              <div>
                <div className="eyebrow mb-1.5">Pay with</div>
                <Segmented value={funding} onChange={setFunding} options={[{ value: 'wallet', label: 'Naira wallet' }, { value: 'bank_transfer', label: 'Bank transfer' }]} />
                {funding === 'bank_transfer' && <p className="mt-2 text-xs text-subtle">Sandbox virtual account. Confirmed through a signed webhook.</p>}
              </div>
              <Field label="Send crypto to (optional)" value={dest} onChange={(e) => setDest(e.target.value)} placeholder={`${symbol} address, or leave empty for your platform wallet`} className="mono !text-xs" hint="Sandbox: external sends are simulated and labelled." />
            </>
          )}

          <Button
            className="w-full"
            disabled={!quote || secondsLeft === 0 || needsBank || Boolean(cantPay)}
            loading={create.isPending}
            onClick={() => (needsPin ? setAskPin(true) : create.mutate(undefined))}
          >
            {cantPay ? 'Insufficient Naira balance' : 'Approve'}
          </Button>
          {quote && <p className="flex items-center justify-center gap-1.5 text-center text-xs text-subtle"><RefreshCw size={12} /> Quotes refresh automatically. {live ? <Badge kind="live">Live</Badge> : <Badge kind="sandbox">Sandbox</Badge>}</p>}
        </Card>
      </div>
      <ExchangeCredits />
      <Sheet open={askPin} onClose={() => setAskPin(false)} title="Confirm with your PIN">
        <PinPad key={pinRound} disabled={create.isPending} onComplete={(pin) => create.mutate(pin, { onSettled: () => setAskPin(false) })} />
      </Sheet>
    </>
  )
}
