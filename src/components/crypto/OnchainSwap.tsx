import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ArrowDownUp } from 'lucide-react'
import { toast } from 'sonner'
import { parseError } from '@/lib/format'
import { previewDex, useDexConfig, type DexNetwork, type DexPreviewResponse } from '@/lib/nairaswap'
import { Button, Card, Field, ListSkeleton, Segmented } from '../ui'
import { DexControls, useBrowserAddress, type Signer } from './DexControls'
import { DexReview } from './DexReview'

const SLIPPAGE = [{ value: '30', label: '0.3%' }, { value: '50', label: '0.5%' }, { value: '100', label: '1%' }]

/** Swap tokens through your own NairaSwap pools, signed by the app wallet or the user's browser wallet. */
export function OnchainSwap({ onDone }: { onDone: () => void }) {
  const { data: networks } = useDexConfig()
  const browserAddress = useBrowserAddress()
  const [networkId, setNetworkId] = useState<DexNetwork['id']>('arc-testnet')
  const [signer, setSigner] = useState<Signer>('app')
  const [pickIn, setTokenIn] = useState('')
  const [pickOut, setTokenOut] = useState('')
  const [amount, setAmount] = useState('')
  const [slip, setSlip] = useState('50')
  const [review, setReview] = useState<DexPreviewResponse | null>(null)

  const net = networks?.find((n) => n.id === networkId)
  const tokens = net?.tokens ?? []
  // Selections that are not valid on the chosen network fall back to the first two tokens, with no effect needed.
  const tokenIn = tokens.some((t) => t.key === pickIn) ? pickIn : (tokens[0]?.key ?? '')
  const tokenOut = tokens.some((t) => t.key === pickOut) && pickOut !== tokenIn ? pickOut : (tokens.find((t) => t.key !== tokenIn)?.key ?? '')

  const preview = useMutation({
    mutationFn: () => previewDex({ networkId, signer, address: signer === 'browser' ? browserAddress : undefined, slippageBps: Number(slip), action: { kind: 'swap', tokenIn, tokenOut, amount } }),
    onSuccess: setReview,
    onError: (e) => toast.error(parseError(e)),
  })

  if (!networks) return <ListSkeleton rows={3} label="Loading exchange" />
  if (review) return <DexReview res={review} signer={signer} onBack={() => setReview(null)} onDone={onDone} />

  const valid = /^\d+(\.\d{1,18})?$/.test(amount) && Number(amount) > 0 && tokenIn && tokenOut && tokenIn !== tokenOut && (signer === 'app' || Boolean(browserAddress))
  const flip = () => { setTokenIn(tokenOut); setTokenOut(tokenIn) }
  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <DexControls networks={networks} networkId={networkId} onNetwork={setNetworkId} signer={signer} onSigner={setSigner} />
      </Card>
      <Card className="space-y-4 p-5">
        <span className="eyebrow">You pay</span>
        <Segmented value={tokenIn} onChange={setTokenIn} options={tokens.map((t) => ({ value: t.key, label: t.symbol }))} />
        <Field label="Amount" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
        <div className="flex justify-center"><button onClick={flip} aria-label="Swap direction" className="grid size-11 place-items-center rounded-full border border-line-strong hover:bg-muted"><ArrowDownUp size={18} /></button></div>
        <span className="eyebrow">You receive</span>
        <Segmented value={tokenOut} onChange={setTokenOut} options={tokens.map((t) => ({ value: t.key, label: t.symbol }))} />
        <div>
          <span className="eyebrow mb-2 block">Slippage limit</span>
          <Segmented value={slip} onChange={setSlip} options={SLIPPAGE} />
        </div>
      </Card>
      <Button className="w-full" disabled={!valid} loading={preview.isPending} onClick={() => preview.mutate()}>Get quote</Button>
      <p className="text-center text-xs text-subtle">Trades run on the NairaSwap contracts you own. Testnet pools are small, so large trades are refused.</p>
    </div>
  )
}
