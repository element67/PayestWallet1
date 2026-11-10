import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cx } from '../ui'

/** A big tappable row: round icon, label, optional detail, chevron. Used by More and Settings. */
export function ListRow({ icon, label, detail, onClick, badge }: { icon: ReactNode; label: string; detail?: ReactNode; onClick: () => void; badge?: ReactNode }) {
  return (
    <button onClick={onClick} className="no-pop group flex min-h-[64px] w-full items-center gap-3 rounded-2xl px-3 py-2 text-left hover:bg-muted">
      <span className="grid size-11 shrink-0 place-items-center rounded-full border-2 border-outline bg-accent text-accent-ink">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-extrabold text-ink">{label}</span>
        {detail && <span className="block truncate text-xs font-medium text-subtle">{detail}</span>}
      </span>
      {badge}
      <ChevronRight size={20} className="shrink-0 text-ink" />
    </button>
  )
}

export function BackBar({ title, onBack, crumb = 'Back' }: { title: string; onBack: () => void; crumb?: string }) {
  return (
    <div className="mb-5">
      <button onClick={onBack} className="border border-outline mb-3 inline-flex min-h-11 items-center gap-1 rounded-full bg-card pl-2 pr-4 text-xs font-extrabold text-card-ink">
        <ChevronLeft size={18} /> {crumb}
      </button>
      <h1 className="plate display text-balance text-3xl">{title}</h1>
    </div>
  )
}

export function Divided({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('divide-y divide-line', className)}>{children}</div>
}
