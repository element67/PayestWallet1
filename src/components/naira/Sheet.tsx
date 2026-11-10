import { useEffect, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'

/** Bottom sheet on mobile, centered panel on large screens. Escape or the backdrop closes it. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-40 flex items-end justify-center lg:items-center">
          <motion.div className="scrim absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="sticker relative flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-3xl lg:rounded-3xl"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 320 }}
          >
            <div className="mx-auto mt-2 h-2 w-14 rounded-full border-2 border-outline bg-accent lg:hidden" />
            <div className="flex items-center justify-between px-5 pb-2 pt-3">
              <h2 className="display text-2xl">{title}</h2>
              <button aria-label="Close" onClick={onClose} className="border border-outline grid size-11 place-items-center rounded-full bg-accent text-accent-ink"><X size={18} /></button>
            </div>
            <div className="overflow-y-auto px-5 pb-6">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
