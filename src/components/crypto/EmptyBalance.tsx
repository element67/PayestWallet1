import { useState } from 'react'
import { Check, Copy, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { short } from '@/lib/format'
import { Button, Card } from '../ui'

/** Shown while the crypto balance is zero: explains it, shows the real wallet address and offers Deposit. */
export function EmptyBalance({ address, onDeposit }: { address: string; onDeposit: () => void }) {
  const [done, setDone] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(address).then(() => { setDone(true); toast.success('Address copied'); setTimeout(() => setDone(false), 1500) }).catch(() => toast.error('Copy is blocked here. Select the address instead.'))
  }
  return (
    <Card className="p-5 text-center">
      <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-muted"><Wallet size={22} aria-hidden /></span>
      <h2 className="display mt-3 text-xl font-semibold">Your crypto wallet is empty</h2>
      <p className="mx-auto mt-1 max-w-xs text-pretty text-sm text-subtle">Deposit testnet crypto to this address and it shows here once the network confirms it. Nothing is added until then.</p>
      <div className="mx-auto mt-4 flex min-h-[44px] max-w-sm items-center justify-between gap-2 rounded-2xl bg-muted px-3 text-left">
        <div className="min-w-0">
          <div className="eyebrow">Your address (EVM networks)</div>
          <div className="mono truncate text-xs" title={address}>{short(address, 10, 6)}</div>
        </div>
        <button onClick={copy} aria-label="Copy address" className="grid size-11 shrink-0 place-items-center rounded-xl hover:bg-surface">
          {done ? <Check size={16} className="text-success" /> : <Copy size={16} />}
        </button>
      </div>
      <Button className="mt-4 w-full max-w-sm" onClick={onDeposit}>Deposit</Button>
    </Card>
  )
}
