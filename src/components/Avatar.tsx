import { initials } from '@/lib/profile'
import { cx } from './ui'

/** The user's picture, or their initials when they have not added one. */
export function Avatar({ name, url, className }: { name: string; url?: string | null; className?: string }) {
  return (
    <span className={cx('display grid shrink-0 place-items-center overflow-hidden rounded-full bg-surface-strong text-ink', className)} aria-hidden="true">
      {url ? <img src={url} alt="" className="size-full object-cover" /> : initials(name)}
    </span>
  )
}
