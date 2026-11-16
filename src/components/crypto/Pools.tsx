import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { parseError } from '@/lib/format'
import { previewDex, useDexConfig, useDexPools, type DexAction, type DexNetwork, type DexPool, type DexPreviewResponse } from '@/lib/nairaswap'
import { Badge, Button, Card, Empty, Field, ListSkeleton, Row, Segmented } from '../ui'
import { DexControls, useBrowserAddress, type Signer } from './DexControls'
import { DexReview } from './DexReview'

/** Liquidity pools: see every pool, add liquidity (which also creates a new pool), and take liquidity back out. */
export function Pools({ onDone }: { onDone: () => void }) {
  const { data: networks } = useDexConfig()
  const browserAddress = useBrowserAddress()
  const [networkId, setNetworkId] = useState<DexNetwork['id']>('arc-testnet')
  const [signer, setSigner] = useState<Signer>('app')
  const [pickA, setTokenA] = useState('')
  const [pickB, setTokenB] = useState('')
  const [amountA, setAmountA] = useState('')
  const [amountB, setAmountB] = useState('')
  const [review, setReview] = useState<DexPreviewResponse | null>(null)
  const pools = useDexPools(networkId)
  const net = networks?.find((n) => n.id === networkId)
  const tokens = net?.tokens ?? []
  const tokenA = tokens.some((t) => t.key === pickA) ? pickA : (tokens[0]?.key ?? '')
  const tokenB = tokens.some((t) => t.key === pickB) && pickB !== tokenA ? pickB : (tokens.find((t) => t.key !== tokenA)?.key ?? '')

  const preview = useMutation({
    mutationFn: (action: DexAction) => previewDex({ networkId, signer, address: signer === 'browser' ? browserAddress : undefined, slippageBps: 50, action }),
    onSuccess: setReview,
    onError: (e) => toast.error(parseError(e)),
  })

  if (!networks) return <ListSkeleton rows={3} label="Loading pools" />
  if (review) return <DexReview res={review} signer={signer} onBack={() => setReview(null)} onDone={() => { setReview(null); setAmountA(''); setAmountB(''); if (review.preview.kind === 'swap') onDone() }} />

  const amt = (v: string) => /^\d+(\.\d{1,18})?$/.test(v) && Number(v) > 0
  const canAdd = amt(amountA) && amt(amountB) && tokenA && tokenB && tokenA !== tokenB && (signer === 'app' || Boolean(browserAddress))
  const remove = (p: DexPool, percent: number) => {
    if (!p.token0.key || !p.token1.key) return
    preview.mutate({ kind: 'remove', tokenA: p.token0.key, tokenB: p.token1.key, percent })
  }
  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <DexControls networks={networks} networkId={networkId} onNetwork={setNetworkId} signer={signer} onSigner={setSigner} />
      </Card>

      <Card className="space-y-4 p-5">
        <div className="flex items-center justify-between"><span className="eyebrow">Add liquidity</span><Badge kind="info">Earn 0.25% of trades</Badge></div>
        <Segmented value={tokenA} onChange={setTokenA} options={tokens.map((t) => ({ value: t.key, label: t.symbol }))} />
        <Field label={`Amount of ${tokens.find((t) => t.key === tokenA)?.symbol ?? 'token'}`} inputMode="decimal" placeholder="0.00" value={amountA} onChange={(e) => setAmountA(e.target.value.replace(/[^0-9.]/g, ''))} />
        <Segmented value={tokenB} onChange={setTokenB} options={tokens.map((t) => ({ value: t.key, label: t.symbol }))} />
        <Field label={`Amount of ${tokens.find((t) => t.key === tokenB)?.symbol ?? 'token'}`} inputMode="decimal" placeholder="0.00" value={amountB} onChange={(e) => setAmountB(e.target.value.replace(/[^0-9.]/g, ''))} hint="If the pool already exists, the amounts are matched to its price." />
        <Button className="w-full" disabled={!canAdd} loading={preview.isPending} onClick={() => preview.mutate({ kind: 'add', tokenA, tokenB, amountA, amountB })}>Review deposit</Button>
      </Card>

      <div className="space-y-3">
        <span className="eyebrow">Pools on {networkId === 'arc-testnet' ? 'Arc Testnet' : 'Base Sepolia'}</span>
        {pools.isLoading && <ListSkeleton rows={2} label="Loading pools" />}
        {pools.data && pools.data.pools.length === 0 && <Empty title="No pools yet" body="Add liquidity above to create the first one." />}
        {pools.data?.pools.map((p) => (
          <Card key={p.pair} className="space-y-1 p-5">
            <h3 className="display text-lg">{p.token0.symbol} / {p.token1.symbol}</h3>
            <Row label={`${p.token0.symbol} in pool`} value={<span className="num">{p.reserve0}</span>} />
            <Row label={`${p.token1.symbol} in pool`} value={<span className="num">{p.reserve1}</span>} />
            <Row label="Your share" value={<span className="num font-semibold">{(p.yourShareBps / 100).toFixed(2)}%</span>} />
            {p.yourShareBps > 0 && (
              <div className="grid grid-cols-3 gap-2 pt-2">
                {[25, 50, 100].map((pc) => <Button key={pc} variant="soft" disabled={preview.isPending} onClick={() => remove(p, pc)}>Remove {pc}%</Button>)}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  )
}
