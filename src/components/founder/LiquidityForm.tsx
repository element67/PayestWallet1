import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Button, Card, Field, Sandbox } from '../ui'

export function LiquidityForm() {
  const qc = useQueryClient()
  const { data: registry } = useQuery({ queryKey: ['a-assets-lite'], queryFn: () => api<{ assets: { symbol: string }[] }>('/api/admin/assets').then((r) => r.assets) })
  const [asset, setAsset] = useState('NGN')
  const [direction, setDirection] = useState<'add' | 'remove'>('add')
  const [amount, setAmount] = useState('')
  const m = useMutation({
    mutationFn: () => api('/api/admin/liquidity', { method: 'POST', body: { asset, direction, amount } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-overview'] })
      setAmount('')
      toast.success('Liquidity updated and audit-logged')
    },
    onError: (e) => toast.error(e.message),
  })
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2"><h2 className="display text-lg font-semibold">Adjust liquidity</h2><Sandbox /></div>
      <p className="mt-1 text-xs text-subtle">Sandbox ledger only. Real vault funding happens outside this app.</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="block"><span className="eyebrow">Asset</span>
          <select value={asset} onChange={(e) => setAsset(e.target.value)} className="mt-1.5 min-h-11 w-full rounded-2xl border border-line bg-surface-strong px-3 text-sm">
            {['NGN', ...(registry ?? []).map((a) => a.symbol)].map((a) => <option key={a}>{a}</option>)}
          </select>
        </label>
        <label className="block"><span className="eyebrow">Action</span>
          <select value={direction} onChange={(e) => setDirection(e.target.value as 'add' | 'remove')} className="mt-1.5 min-h-11 w-full rounded-2xl border border-line bg-surface-strong px-3 text-sm">
            <option value="add">Add</option><option value="remove">Remove</option>
          </select>
        </label>
        <Field label="Amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} wrapperClassName="col-span-2" />
      </div>
      <Button className="mt-3 w-full" disabled={!amount} loading={m.isPending} onClick={() => m.mutate()}>Apply</Button>
    </Card>
  )
}
