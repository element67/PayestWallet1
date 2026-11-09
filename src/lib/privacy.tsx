import { useSyncExternalStore } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useSession } from './session'
import { cx } from '@/components/ui'

/**
 * Amounts are masked by default. The choice is remembered per person on this device,
 * separately for the crypto side and the Naira side so each eye only controls its own amounts.
 */
export type PrivacyScope = 'crypto' | 'naira'
export const MASK = '••••'
const listeners = new Set<() => void>()
const storageKey = (scope: PrivacyScope, userId: string) => (scope === 'crypto' ? `nb_balances_shown:${userId}` : `nb_balances_shown:naira:${userId}`)
const subscribe = (cb: () => void) => {
  listeners.add(cb)
  window.addEventListener('storage', cb)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('storage', cb)
  }
}

export function usePrivacy(scope: PrivacyScope = 'crypto') {
  const { user } = useSession()
  const id = user?.id ?? 'anonymous'
  const shown = useSyncExternalStore(subscribe, () => localStorage.getItem(storageKey(scope, id)) === '1')
  return {
    shown,
    toggle: () => {
      localStorage.setItem(storageKey(scope, id), shown ? '0' : '1')
      listeners.forEach((l) => l())
    },
    /** Returns the text as-is when amounts are shown, otherwise the mask. */
    mask: (text: string) => (shown ? text : MASK),
  }
}

/** Eye icon only: open eye when masked (tap to reveal), crossed-out eye when revealed (tap to mask). */
export function EyeToggle({ scope = 'crypto', className }: { scope?: PrivacyScope; className?: string }) {
  const { shown, toggle } = usePrivacy(scope)
  return (
    <button
      onClick={toggle}
      aria-pressed={shown}
      aria-label={shown ? 'Mask amounts' : 'Reveal amounts'}
      className={cx('grid size-11 shrink-0 place-items-center rounded-xl border border-line hover:bg-muted', className)}
    >
      {shown ? <EyeOff size={18} /> : <Eye size={18} />}
    </button>
  )
}
