import { useEffect, useRef, useState, type ComponentType } from 'react'
import {
  NetworkArbitrumOne, NetworkArc, NetworkAvalanche, NetworkBase, NetworkBinanceSmartChain, NetworkBitcoin, NetworkCodex, NetworkEthereum, NetworkHyperEvm,
  NetworkLinea, NetworkMonad, NetworkOptimism, NetworkPlume, NetworkPolygon, NetworkSolana, NetworkSonic, NetworkUnichain,
} from '@web3icons/react'
import { Check, ChevronDown } from 'lucide-react'
import { cx } from './ui'

type Logo = ComponentType<{ variant?: 'branded' | 'mono' | 'background'; size?: number | string; className?: string }>

/** The logo of each chain family. A testnet shows the same logo as its mainnet, so Sepolia, Fuji, Amoy and Devnet are all recognisable. */
const LOGOS: Record<string, Logo> = {
  arbitrum: NetworkArbitrumOne, arc: NetworkArc, avalanche: NetworkAvalanche, base: NetworkBase, bnb: NetworkBinanceSmartChain, bitcoin: NetworkBitcoin,
  codex: NetworkCodex, ethereum: NetworkEthereum, hyperevm: NetworkHyperEvm, linea: NetworkLinea, monad: NetworkMonad, optimism: NetworkOptimism,
  plume: NetworkPlume, polygon: NetworkPolygon, solana: NetworkSolana, sonic: NetworkSonic, unichain: NetworkUnichain,
}

/** Finds the chain family from an id ("base-sepolia") or a display name ("Polygon Amoy Testnet"). */
export function networkKey(idOrName: string | null | undefined): string | null {
  const s = (idOrName ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  if (!s) return null
  const first = s.split(' ')[0]
  if (first === 'bsc' || first === 'binance') return 'bnb'
  if (first === 'arb') return 'arbitrum'
  if (first === 'op') return 'optimism'
  return first
}

/** A chain's logo, or a letter badge for a chain with no published logo (for example Edge Testnet). */
export function NetworkIcon({ id, name, size = 24, className }: { id?: string | null; name?: string | null; size?: number; className?: string }) {
  const key = networkKey(id ?? name)
  const L = key ? LOGOS[key] : undefined
  const label = name ?? id ?? 'Network'
  if (L) return <span className={cx('inline-grid shrink-0 place-items-center', className)} style={{ width: size, height: size }} role="img" aria-label={label}><L variant="branded" size={size} /></span>
  return (
    <span className={cx('inline-grid shrink-0 place-items-center rounded-full bg-surface-strong font-extrabold text-ink', className)} style={{ width: size, height: size, fontSize: Math.max(12, size * 0.5) }} role="img" aria-label={label}>
      {label.trim().slice(0, 1).toUpperCase() || '?'}
    </span>
  )
}

/** A logo plus the name, for lines of text that name a network. */
export function NetworkLabel({ id, name, size = 18, className }: { id?: string | null; name: string; size?: number; className?: string }) {
  return (
    <span className={cx('inline-flex min-w-0 items-center gap-1.5 align-middle', className)}>
      <NetworkIcon id={id} name={name} size={size} />
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{name}</span>
    </span>
  )
}

export interface PickerNetwork { id: string; name: string; note?: string }

/** A network chooser that shows every network's logo (a native select cannot). Keyboard and screen reader friendly. */
export function NetworkPicker({ label, value, options, onChange }: { label: string; value: string; options: PickerNetwork[]; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const current = options.find((o) => o.id === value) ?? options[0]

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent | TouchEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', away)
    document.addEventListener('touchstart', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('touchstart', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  return (
    <div ref={root} className="relative">
      <span className="eyebrow mb-2 block">{label}</span>
      <button
        type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={label} data-value={current?.id}
        onClick={() => setOpen((o) => !o)}
        className="border border-line flex min-h-12 w-full items-center gap-3 rounded-2xl bg-surface-strong px-3 text-left text-base font-extrabold"
      >
        {current && <NetworkIcon id={current.id} name={current.name} size={26} />}
        <span className="min-w-0 flex-1">{current?.name ?? 'Choose a network'}</span>
        <ChevronDown size={18} className={cx('shrink-0', open && 'rotate-180')} />
      </button>
      {open && (
        <ul role="listbox" aria-label={`${label} networks`} className="border border-line absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-2xl bg-card p-1 text-card-ink">
          {options.map((o) => (
            <li key={o.id} role="option" aria-selected={o.id === value}>
              <button
                type="button" data-network={o.id}
                onClick={() => { onChange(o.id); setOpen(false) }}
                className={cx('flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-base font-extrabold hover:bg-muted', o.id === value && 'bg-muted')}
              >
                <NetworkIcon id={o.id} name={o.name} size={26} />
                <span className="min-w-0 flex-1">{o.name}{o.note && <span className="block text-xs font-semibold text-subtle">{o.note}</span>}</span>
                {o.id === value && <Check size={18} className="shrink-0" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
