import { ArrowRight, ShieldCheck } from 'lucide-react'
import { Card } from '../ui'

/** Entry to the P2P exchange. Both buttons open the verified swap flow. */
export function P2PCard({ onPick }: { onPick: (side: 'sell' | 'buy') => void }) {
  return (
    <Card className="border border-accent/40 p-4">
      <div className="flex items-center gap-2">
        <span className="grid size-9 place-items-center rounded-xl bg-accent text-accent-ink"><ShieldCheck size={18} /></span>
        <div>
          <h2 className="display text-lg font-semibold leading-tight">Payest P2P Exchange</h2>
          <p className="text-xs text-subtle">Swap crypto and Naira, fast and verified.</p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button onClick={() => onPick('sell')} className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-2xl bg-accent px-3 text-sm font-semibold text-accent-ink transition hover:opacity-90 active:scale-[0.98]">
          Crypto to Naira <ArrowRight size={15} />
        </button>
        <button onClick={() => onPick('buy')} className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-2xl border border-line-strong px-3 text-sm font-semibold transition hover:bg-muted active:scale-[0.98]">
          Naira to Crypto <ArrowRight size={15} />
        </button>
      </div>
    </Card>
  )
}
