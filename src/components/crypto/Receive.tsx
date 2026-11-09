import { useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { QRCodeSVG } from 'qrcode.react'
import { Check, ChevronDown, Copy, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import type { CryptoOverview } from '@/lib/crypto'
import { short } from '@/lib/format'
import { useNairaOverview } from '@/lib/naira'
import { Badge, Card, TokenIcon, cx } from '../ui'

interface RowProps {
  id: string
  icon: ReactNode
  title: string
  network: string
  /** What is copied. Never anything secret: addresses and account numbers only. */
  value: string
  /** Shortened form shown while collapsed. */
  preview: string
  warning: string
  expanded: boolean
  onToggle: () => void
  copied: boolean
  onCopy: () => void
  children?: ReactNode
  qr?: boolean
  explorer?: string
}

function ReceiveRow({ id, icon, title, network, value, preview, warning, expanded, onToggle, copied, onCopy, children, qr = true, explorer }: RowProps) {
  return (
    <li>
      <div className="flex items-center gap-1 pr-2">
        <button
          onClick={onToggle} aria-expanded={expanded} aria-controls={`recv-${id}`}
          className="flex min-h-[72px] min-w-0 flex-1 items-center gap-3 rounded-2xl px-4 py-3 text-left transition hover:bg-muted/60 active:bg-muted"
        >
          <span className="shrink-0">{icon}</span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="text-sm font-semibold">{title}</span>
              <Badge kind="live">{network}</Badge>
            </span>
            <span className="mono mt-0.5 block truncate text-xs text-ink-2">{preview}</span>
            <span className="mt-0.5 block text-[11px] leading-snug text-warn">{warning}</span>
          </span>
          <ChevronDown size={16} aria-hidden className={cx('shrink-0 text-subtle transition', expanded && 'rotate-180')} />
        </button>
        <button
          onClick={onCopy} aria-label={`Copy ${title} ${network} ${qr ? 'address' : 'account number'}`}
          className="flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-2xl border border-line-strong px-3 text-xs font-semibold hover:bg-muted active:scale-95"
        >
          {copied ? <Check size={15} className="text-success" /> : <Copy size={15} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            id={`recv-${id}`} initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }} className="overflow-hidden"
          >
            <div className="px-4 pb-5 pt-1 text-center">
              {qr && (
                <div className="mx-auto w-fit rounded-3xl bg-white p-3">
                  <QRCodeSVG value={value} size={176} level="M" />
                </div>
              )}
              {children}
              <div className="mono mt-3 break-all rounded-2xl bg-muted px-3 py-2.5 text-xs" data-testid={`address-${id}`}>{value}</div>
              {explorer && (
                <a href={explorer} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 text-xs font-semibold underline">
                  <ExternalLink size={13} /> View on explorer
                </a>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  )
}

/** One list of every receiving address and the Naira account. One row open at a time; copy works from the collapsed row. */
export function Receive({ data }: { data: CryptoOverview }) {
  const { data: naira } = useNairaOverview()
  const [open, setOpen] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const copy = (id: string, text: string) => {
    navigator.clipboard.writeText(text)
      .then(() => {
        setCopied(id)
        setTimeout(() => setCopied((c) => (c === id ? null : c)), 1600)
      })
      .catch(() => toast.error('Copy is blocked here. Open the row and select the address instead.'))
  }
  const toggle = (id: string) => setOpen((o) => (o === id ? null : id))
  const acct = naira?.wallet.account

  return (
    <div className="mx-auto max-w-xl space-y-3">
      <p className="text-pretty text-sm text-subtle">Tap a row to see its QR code and full address, or tap Copy. Send only the asset shown, on the network shown.</p>
      <Card className="overflow-hidden !p-0">
        <ul className="divide-y divide-line">
          {acct ? (
            <ReceiveRow
              id="naira" icon={<TokenIcon symbol="NGN" size={40} />} title="Naira account" network="Sandbox" value={acct.number} preview={acct.number}
              warning="Sandbox account number. Your Naira wallet is funded only by selling crypto." qr={false}
              expanded={open === 'naira'} onToggle={() => toggle('naira')} copied={copied === 'naira'} onCopy={() => copy('naira', acct.number)}
            >
              <dl className="mt-1 space-y-2 text-left text-sm">
                <div className="flex justify-between gap-3"><dt className="text-subtle">Bank</dt><dd className="font-semibold">{acct.bank}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-subtle">Account name</dt><dd className="font-semibold">{acct.name}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-subtle">Account number</dt><dd className="mono font-semibold">{acct.number}</dd></div>
              </dl>
            </ReceiveRow>
          ) : (
            <li className="m-3 h-16 animate-pulse rounded-2xl bg-muted" aria-busy="true" aria-label="Loading Naira account" />
          )}
          {data.assets.map((a) => {
            const net = data.networks.find((n) => n.id === a.network)
            if (!net) return null
            return (
              <ReceiveRow
                key={a.key} id={a.key} icon={<TokenIcon symbol={a.symbol} size={40} />} title={a.symbol === 'ETH' ? 'Ethereum' : a.symbol === 'BTC' ? 'Bitcoin' : a.symbol === 'SOL' ? 'Solana' : a.symbol}
                network={net.name} value={net.address} preview={short(net.address, 8, 6)} explorer={net.explorerAddress}
                warning={`Only send ${a.symbol} on ${net.name}. Other assets or networks may be lost.`}
                expanded={open === a.key} onToggle={() => toggle(a.key)} copied={copied === a.key} onCopy={() => copy(a.key, net.address)}
              />
            )
          })}
        </ul>
      </Card>
      <p className="text-xs text-subtle">These are public receiving addresses. Your private keys and recovery phrase never leave the server and are never shown.</p>
    </div>
  )
}
