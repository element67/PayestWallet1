import { ChevronRight } from 'lucide-react'
import { crypto, ngn } from '@/lib/format'
import type { HomeAsset } from '@/lib/home'
import { usePrivacy } from '@/lib/privacy'
import { Badge, Card, TokenIcon } from '../ui'

function Row({ a }: { a: HomeAsset }) {
  const { mask } = usePrivacy(a.kind === 'naira' ? 'naira' : 'crypto')
  const isNaira = a.kind === 'naira'
  return (
    <div className="flex min-h-[64px] items-center gap-3 px-4 py-2.5">
      <TokenIcon symbol={a.symbol} size={36} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm font-semibold">{a.name}{a.kind === 'credit' && <Badge kind="sandbox">Sandbox</Badge>}</div>
        <div className="truncate text-xs text-subtle">{a.chain}</div>
      </div>
      <div className="shrink-0 text-right">
        <div className="num text-sm font-semibold">{mask(isNaira ? ngn(a.amount) : `${crypto(a.amount)} ${a.symbol}`)}</div>
        <div className="num text-xs text-subtle">{isNaira ? 'Available' : a.valueNgn !== null ? mask(ngn(a.valueNgn)) : 'No rate set'}</div>
      </div>
    </div>
  )
}

/** Naira is the first row of the same list. Only assets with a balance above zero appear. */
export function AssetsList({ assets, onViewAll }: { assets?: HomeAsset[]; onViewAll: () => void }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="display text-xl font-semibold">Your assets</h2>
        <button onClick={onViewAll} className="flex min-h-[44px] items-center gap-0.5 px-1 text-sm font-semibold underline">View all tokens <ChevronRight size={15} /></button>
      </div>
      <Card className="divide-y divide-line overflow-hidden !p-0">
        {!assets && [0, 1].map((i) => <div key={i} className="m-3 h-12 animate-pulse rounded-2xl bg-muted" />)}
        {assets?.map((a) => <Row key={a.id} a={a} />)}
        {assets && assets.length === 1 && <p className="px-4 py-3 text-sm text-subtle">No crypto yet. Receive or buy crypto and it shows here.</p>}
      </Card>
      <p className="mt-2 text-xs text-subtle">Only assets with a balance show here. Add more tokens in Crypto.</p>
    </section>
  )
}
