import { useQuery } from '@tanstack/react-query'
import { FlaskConical } from 'lucide-react'
import { api } from '@/lib/api'
import type { TradeConfig } from '@/lib/trade'
import { Badge, Card } from '../ui'
import { PoweredBy } from './PoweredBy'
import { UniswapSwap } from './UniswapSwap'

/** The Swap screen: one swap card and a quiet "Powered by" row. Swaps always run on Uniswap. */
export function SwapHub({ onDone }: { onDone: () => void }) {
  const { data: cfg } = useQuery({ queryKey: ['trade-config'], queryFn: () => api<TradeConfig>('/api/trade/config'), staleTime: 30_000 })
  const testnet = cfg?.testnet ?? true
  return (
    <div className="space-y-3">
      {testnet && (
        <div className="flex justify-end">
          <Badge kind="info"><FlaskConical size={12} className="mr-1 inline" />Testnet · Sandbox rates</Badge>
        </div>
      )}
      {cfg && !testnet
        ? <Card className="p-5 text-sm">Swaps on mainnet are not switched on yet. Uniswap swaps run on the test network until they are.</Card>
        : <UniswapSwap onDone={onDone} />}
      <PoweredBy />
    </div>
  )
}
