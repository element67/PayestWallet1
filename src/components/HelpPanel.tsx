import { useState, type ReactNode } from 'react'
import { Bot, ChevronDown, Mail, Send } from 'lucide-react'
import { useSupport } from '@/lib/profile'
import { Sheet } from './naira/Sheet'
import { cx } from './ui'

function Channel({ icon, label, detail, href }: { icon: ReactNode; label: string; detail: string; href: string | null }) {
  const body = (
    <>
      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-surface-strong text-ink">{icon}</span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-base font-extrabold text-ink">{label}</span>
        <span className="block text-xs font-medium text-subtle">{href ? detail : 'Not set up yet'}</span>
      </span>
    </>
  )
  const cls = 'no-pop flex min-h-[64px] w-full items-center gap-3 rounded-2xl px-3 py-2'
  if (!href) return <div className={cx(cls, 'opacity-60')} aria-disabled="true">{body}</div>
  return <a href={href} target={href.startsWith('mailto:') ? undefined : '_blank'} rel="noopener noreferrer" className={cx(cls, 'hover:bg-muted')}>{body}</a>
}

/** AI support agent, Telegram community, contact support and the FAQs. Channels come from the server's configuration. */
export function HelpPanel() {
  const { data, isLoading, isError, refetch } = useSupport()
  const [open, setOpen] = useState<number | null>(null)

  if (isLoading) return <div className="h-48 animate-pulse rounded-3xl bg-muted" aria-busy="true" />
  if (isError || !data) {
    return (
      <div className="space-y-3 text-center">
        <p className="text-sm font-semibold text-danger">Could not load help right now.</p>
        <button onClick={() => void refetch()} className="border border-outline min-h-11 rounded-full bg-surface-strong px-5 text-sm font-semibold text-ink">Try again</button>
      </div>
    )
  }
  const { channels, faqs } = data
  return (
    <div className="space-y-5">
      <div className="divide-y divide-line">
        <Channel icon={<Bot size={20} />} label="AI support agent" detail="Ask a question and get an answer now" href={channels.ai} />
        <Channel icon={<Send size={20} />} label="Official Telegram community" detail="Join other Payest users and the team" href={channels.telegram} />
        <Channel icon={<Mail size={20} />} label="Contact support" detail={channels.email ?? ''} href={channels.email ? `mailto:${channels.email}?subject=${encodeURIComponent('Payest support')}` : null} />
      </div>
      <div>
        <div className="eyebrow mb-2 px-1">FAQs</div>
        <div className="divide-y divide-line">
          {faqs.map((f, i) => (
            <div key={f.q}>
              <button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i} className="no-pop flex min-h-12 w-full items-center justify-between gap-3 px-3 py-3 text-left text-base font-extrabold text-ink">
                {f.q}
                <ChevronDown size={18} className={cx('shrink-0', open === i && 'rotate-180')} />
              </button>
              {open === i && <p className="text-pretty px-3 pb-3 text-sm font-medium text-ink-2">{f.a}</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function HelpSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Help">
      <HelpPanel />
    </Sheet>
  )
}
