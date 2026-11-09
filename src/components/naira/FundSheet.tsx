import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import { ArrowLeft, Info } from 'lucide-react'
import { api, type Order, type Quote } from '@/lib/api'
import { crypto, ngn, parseError } from '@/lib/format'
import { newKey } from '@/lib/naira'
import { useSession } from '@/lib/session'
import { TokenField } from '../TokenPicker'
import { Badge, Button, Field, Row, Sandbox } from '../ui'
import { OrderTracker } from '../OrderTracker'
import { Sheet } from './Sheet'

interface FundAsset {
  symbol: string; name: string; network: string; enabled: boolean; monitoring: 'live' | 'simulated'; rate: string; minNgn: string; maxNgn: string
  feeBps: number; gasEstimate: string | null; chainMode: string; testnet: boolean
}

/** Fund wallet. P2P only: sell crypto, the wallet is credited after the deposit is verified on its chain. */
export function FundSheet({ open, onClose, resumeOrder, title = 'Fund wallet' }: { open: boolean; onClose: () => void; resumeOrder?: string | null; title?: string }) {
  const qc = useQueryClient()
  const { config } = useSession()
  const { address, isConnected } = useAccount()
  const { data } = useQuery({ queryKey: ['fund-options'], queryFn: () => api<{ assets: FundAsset[]; note: string }>('/api/naira/fund/options'), enabled: open, staleTime: 15000 })
  const [symbol, setSymbol] = useState('USDC')
  const [amount, setAmount] = useState('')
  const [res, setRes] = useState<{ key: string; quote?: Quote; err?: string } | null>(null)
  const [orderId, setOrderId] = useState<string | null>(null)
  const active = resumeOrder ?? orderId

  const asset = data?.assets.find((a) => a.symbol === symbol)
  const key = `${symbol}|${amount}`
  const quote = res?.key === key ? (res.quote ?? null) : null
  const err = res?.key === key ? (res.err ?? null) : null

  useEffect(() => {
    if (!open || !amount || Number(amount) <= 0) return
    const t = setTimeout(() => {
      api<Quote>('/api/quotes', { method: 'POST', body: { side: 'sell', asset: symbol, amount } })
        .then((q) => setRes({ key, quote: q }))
        .catch((e: Error) => setRes({ key, err: e.message }))
    }, 450)
    return () => clearTimeout(t)
  }, [open, amount, symbol, key])

  const live = useMemo(() => symbol === 'USDC' && Boolean(config?.vaultConfigured) && isConnected, [symbol, config?.vaultConfigured, isConnected])
  const approve = useMutation({
    mutationFn: () =>
      api<{ order: Order }>('/api/crypto/sell', {
        method: 'POST',
        body: { quoteId: quote!.id, idempotencyKey: newKey(), payoutType: 'wallet', fromAddress: live ? address : undefined },
      }),
    onSuccess: (r) => {
      setOrderId(r.order.id)
      void qc.invalidateQueries({ queryKey: ['naira'] })
      void qc.invalidateQueries({ queryKey: ['p2p'] })
    },
  })

  const close = () => {
    setOrderId(null)
    setAmount('')
    onClose()
  }

  return (
    <Sheet open={open} onClose={close} title={active ? 'Your deposit' : title}>
      {active ? (
        <div className="-mx-1">
          <OrderTracker orderId={active} onBack={close} />
          <p className="mt-3 flex gap-2 text-pretty text-xs text-subtle"><Info size={14} className="mt-0.5 shrink-0" />Your wallet is credited only after the deposit is detected and verified on its network. Nothing you tap here can credit it.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-pretty text-sm text-subtle">Fund your Naira wallet by selling crypto. {data?.note}</p>
          <TokenField
            label="Crypto to sell" value={symbol} onChange={setSymbol} balanceMode="onchain"
            reasonFor={(t) => (data?.assets.some((a) => a.symbol === t.symbol && a.enabled) ? null : t.tradable ? 'Not available for funding' : 'No rate set yet')}
          />
          {asset && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-subtle">
              <Badge kind={asset.monitoring === 'live' ? 'live' : 'sandbox'}>{asset.monitoring === 'live' ? 'Live testnet' : 'Simulated network'}</Badge>
              <span>{asset.chainMode}</span>
            </div>
          )}
          <Field label={`Amount of ${symbol} to sell`} inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} hint={asset ? `Limits: ${ngn(asset.minNgn)} to ${ngn(asset.maxNgn)} per exchange` : undefined} />
          <div className="rounded-2xl bg-muted p-4">
            <Row label="Exchange rate" value={asset ? `${ngn(asset.rate)} per ${symbol}` : '...'} />
            {quote && <Row label="Platform fee" value={`${ngn(quote.platformFeeNgn)} (${(quote.feeBps / 100).toFixed(2)}%)`} />}
            {quote && <Row label="Network (gas) fee" value={ngn(quote.networkFeeNgn)} />}
            {asset?.gasEstimate && <Row label="Estimated network fee (you pay)" value={`${asset.gasEstimate} ${symbol}`} />}
            <div className="mt-2 border-t border-line pt-3">
              <div className="eyebrow">You receive</div>
              <div className="display num text-3xl font-semibold">{quote ? ngn(quote.netNgn) : '₦0.00'}</div>
              {quote && <div className="text-xs text-subtle">for {crypto(quote.cryptoAmount)} {symbol}, rate locked briefly</div>}
            </div>
          </div>
          {err && <p className="text-sm text-danger" role="alert">{err}</p>}
          {approve.error && <p className="text-sm text-danger" role="alert">{parseError(approve.error)}</p>}
          {symbol === 'USDC' && config?.vaultConfigured && !isConnected && <p className="text-xs text-subtle">Connect a wallet (top of the page) to send real testnet USDC. Without one, you can use the sandbox deposit instead.</p>}
          <Button className="w-full" disabled={!quote} loading={approve.isPending} onClick={() => approve.mutate()}>Approve and get deposit details</Button>
          <p className="flex items-center justify-center gap-2 text-xs text-subtle"><Sandbox />Testnet and sandbox assets have no real value.</p>
        </div>
      )}
      {active && <button className="mt-2 flex min-h-11 items-center gap-1 text-sm font-semibold text-subtle" onClick={close}><ArrowLeft size={14} />Close</button>}
    </Sheet>
  )
}
