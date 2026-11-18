import { useQuery } from '@tanstack/react-query'
import { ArrowLeftRight } from 'lucide-react'
import { api } from '@/lib/api'
import { crypto } from '@/lib/format'
import { usePrivacy } from '@/lib/privacy'
import { NetworkLabel } from '../NetworkIcon'
import { Card, TokenIcon } from '../ui'

interface Holding { chain: string; name: string; amount: string }

/**
 * USDC the user holds on networks the wallet has no balance list for (HyperEVM, Monad, Linea and the other bridge networks).
 * Each row has one button that opens the Bridge on that network, so the money can be moved back or on.
 */
export function BridgedBalances({ onBridge }: { onBridge: (chainId: string) => void }) {
  const { mask } = usePrivacy('crypto')
  const { data } = useQuery({ queryKey: ['bridge-holdings'], queryFn: () => api<{ holdings: Holding[] }>('/api/bridge/holdings'), staleTime: 20_000, refetchInterval: 30_000 })
  const list = data?.holdings ?? []
  if (list.length === 0) return null
  return (
    <section aria-label="USDC on other networks">
      <h2 className="mb-2 text-sm font-bold">USDC on other networks</h2>
      <Card className="divide-y divide-line p-0">
        {list.map((h) => (
          <div key={h.chain} className="flex min-h-[64px] items-center gap-3 px-4 py-2.5">
            <TokenIcon symbol="USDC" size={36} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">USDC</div>
              <div className="text-xs text-subtle"><NetworkLabel id={h.chain} name={h.name} size={14} /></div>
            </div>
            <div className="num shrink-0 text-right text-sm font-semibold">{mask(`${crypto(h.amount)} USDC`)}</div>
            <button type="button" onClick={() => onBridge(h.chain)} aria-label={`Bridge USDC from ${h.name}`} className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-ink">
              <ArrowLeftRight size={16} />
            </button>
          </div>
        ))}
      </Card>
    </section>
  )
}
