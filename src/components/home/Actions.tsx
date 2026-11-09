import type { ReactNode } from 'react'
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, CircleMinus, CirclePlus, Landmark, Repeat, Waypoints } from 'lucide-react'
import { cx } from '../ui'

export interface ActionDef { id: string; label: string; icon: ReactNode; tone?: 'primary' }

export function ActionButton({ label, icon, onClick, primary }: { label: string; icon: ReactNode; onClick: () => void; primary?: boolean }) {
  return (
    <button onClick={onClick} className="group flex min-h-[44px] flex-col items-center gap-1.5 text-xs font-semibold" aria-label={label}>
      <span className={cx('grid size-14 place-items-center rounded-full transition group-active:scale-95', primary ? 'bg-accent text-accent-ink' : 'border border-line-strong text-ink group-hover:bg-muted')}>{icon}</span>
      {label}
    </button>
  )
}

export const HOME_ACTIONS = [
  { id: 'send', label: 'Send', icon: <ArrowUpRight size={22} />, primary: true },
  { id: 'receive', label: 'Receive', icon: <ArrowDownLeft size={22} />, primary: true },
  { id: 'transfer', label: 'Transfer', icon: <Landmark size={21} /> },
  { id: 'exchange', label: 'Exchange', icon: <ArrowLeftRight size={21} /> },
  { id: 'buy', label: 'Buy', icon: <CirclePlus size={21} /> },
  { id: 'sell', label: 'Sell', icon: <CircleMinus size={21} /> },
  { id: 'swap', label: 'Swap', icon: <Repeat size={21} /> },
  { id: 'bridge', label: 'Bridge', icon: <Waypoints size={21} /> },
] as const

export type HomeActionId = (typeof HOME_ACTIONS)[number]['id']

/** 4 columns by 2 rows. Transfer is for Naira; the rest are crypto. */
export function ActionGrid({ onPick }: { onPick: (id: HomeActionId) => void }) {
  return (
    <div className="grid grid-cols-4 gap-y-4">
      {HOME_ACTIONS.map((a) => <ActionButton key={a.id} label={a.label} icon={a.icon} primary={'primary' in a && a.primary} onClick={() => onPick(a.id)} />)}
    </div>
  )
}
