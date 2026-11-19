import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { parseError } from '@/lib/format'
import { Sheet } from '../naira/Sheet'
import { Badge, Button, Card, Field } from '../ui'

interface Settings {
  mode: 'testnet' | 'mainnet'; feeBps: number; feeWallet: string; maxFeeBps: number
  providers: Record<'circle' | 'lifi' | 'achswap', { configured: boolean; keyed: boolean }>
}

const NAMES = { circle: 'Circle App Kit', lifi: 'LI.FI', achswap: 'AchSwap' } as const

/** The founder's controls for the swap and bridge module: testnet or mainnet (with a confirmation), the service fee, and which providers are set up. */
export function TradeSettings() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['trade-settings'], queryFn: () => api<Settings>('/api/admin/trade-settings') })
  const [bps, setBps] = useState<string | null>(null)
  const [wallet, setWallet] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'testnet' | 'mainnet' | null>(null)
  const done = (r: Settings) => { qc.setQueryData(['trade-settings'], r); void qc.invalidateQueries({ queryKey: ['admin-onchain'] }); void qc.invalidateQueries({ queryKey: ['trade-config'] }) }
  const save = useMutation({
    mutationFn: (b: Record<string, unknown>) => api<Settings>('/api/admin/trade-settings', { method: 'PUT', body: b }),
    onSuccess: (r) => { done(r); setConfirm(null); setBps(null); setWallet(null); toast.success('Saved and audit-logged') },
    onError: (e) => toast.error(parseError(e)),
  })
  if (!data) return <div className="h-40 animate-pulse rounded-3xl bg-muted" aria-busy="true" />
  const pct = bps ?? String(data.feeBps / 100)
  const feeBps = Math.round(Number(pct) * 100)
  const validFee = Number.isFinite(feeBps) && feeBps >= 0 && feeBps <= data.maxFeeBps
  const next = data.mode === 'mainnet' ? 'testnet' : 'mainnet'

  return (
    <Card className="space-y-5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-extrabold">Swap and bridge network</h3>
          <p className="text-sm text-subtle">Testnet uses test tokens. Mainnet uses real funds and switches on LI.FI and AchSwap.</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge kind={data.mode === 'mainnet' ? 'warn' : 'info'}>{data.mode === 'mainnet' ? 'Mainnet' : 'Testnet'}</Badge>
          <Button variant="soft" onClick={() => setConfirm(next)}>{data.mode === 'mainnet' ? 'Switch to testnet' : 'Switch to mainnet'}</Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`Service fee (%), 0 to ${data.maxFeeBps / 100}. Recommended 0.05 to 0.15`} inputMode="decimal" value={pct} onChange={(e) => setBps(e.target.value.replace(/[^0-9.]/g, ''))} />
        <Field label="Fee wallet (a wallet you control)" value={wallet ?? data.feeWallet} onChange={(e) => setWallet(e.target.value.trim())} placeholder="0x…" />
      </div>
      <p className="text-xs text-subtle">The fee is taken by LI.FI and AchSwap in the same transaction and is shown to the customer before they confirm. It stays at 0 until a valid fee wallet is saved. Circle swaps and bridges charge no service fee.</p>
      <Button disabled={!validFee || (bps === null && wallet === null)} loading={save.isPending} onClick={() => save.mutate({ feeBps, feeWallet: wallet ?? data.feeWallet })}>Save fee</Button>

      <div className="flex flex-wrap gap-2 text-sm">
        {(Object.keys(NAMES) as (keyof typeof NAMES)[]).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5"><b>{NAMES[k]}</b><Badge kind={data.providers[k].configured ? 'good' : 'warn'}>{data.providers[k].configured ? (data.providers[k].keyed ? 'key set' : 'ready') : 'key missing'}</Badge></span>
        ))}
      </div>

      <Sheet open={confirm !== null} onClose={() => setConfirm(null)} title={confirm === 'mainnet' ? 'Switch to mainnet?' : 'Switch to testnet?'}>
        {confirm === 'mainnet' ? (
          <div className="space-y-3 text-sm">
            <p className="flex gap-2"><AlertTriangle size={18} className="mt-0.5 shrink-0 text-danger" /><span>Customers will swap and bridge with real funds, and transactions cannot be undone once sent. Only continue after your own review, testing on testnet and an independent audit.</span></p>
            <p className="text-subtle">Trading a token on mainnet also needs a per-trade limit that you have set for it.</p>
          </div>
        ) : <p className="text-sm">Customers will go back to test tokens. Trades already started keep running.</p>}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Button variant="soft" onClick={() => setConfirm(null)}>Cancel</Button>
          <Button loading={save.isPending} onClick={() => confirm && save.mutate({ mode: confirm, confirmMode: true })}>{confirm === 'mainnet' ? 'Switch to mainnet' : 'Switch to testnet'}</Button>
        </div>
      </Sheet>
    </Card>
  )
}
