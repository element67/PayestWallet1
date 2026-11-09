import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Button, Card, Field } from '../ui'

interface Cfg { limits: { perTx: Record<string, string>; daily: Record<string, string> }; ethRateNgn: string; wallets: number; assets: { key: string }[] }

function Form({ initial }: { initial: Cfg }) {
  const qc = useQueryClient()
  const [perTx, setPerTx] = useState(initial.limits.perTx)
  const [daily, setDaily] = useState(initial.limits.daily)
  const [eth, setEth] = useState(initial.ethRateNgn)
  const save = useMutation({
    mutationFn: () => api('/api/admin/wallet-config', { method: 'PUT', body: { perTx, daily, ethRateNgn: eth } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['wallet-config'] })
      toast.success('Wallet policy saved and audit-logged')
    },
    onError: (e) => toast.error(e.message),
  })
  const num = (v: string) => v.replace(/[^\d.]/g, '')
  return (
    <Card className="p-5">
      <h2 className="display text-lg font-semibold">Crypto wallet policy</h2>
      <p className="mt-1 text-xs text-subtle">{initial.wallets} wallets created. Limits are per user, in the asset's own units, and are enforced before any transfer is signed.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[...new Set(initial.assets.map((a) => a.key.split('@')[0]))].map((s) => (
          <div key={s} className="space-y-2">
            <Field label={`${s} per transfer`} inputMode="decimal" value={perTx[s] ?? ''} onChange={(e) => setPerTx({ ...perTx, [s]: num(e.target.value) })} />
            <Field label={`${s} per day`} inputMode="decimal" value={daily[s] ?? ''} onChange={(e) => setDaily({ ...daily, [s]: num(e.target.value) })} />
          </div>
        ))}
      </div>
      <Field wrapperClassName="mt-3 block max-w-xs" label="ETH value in NGN (optional)" inputMode="decimal" value={eth} onChange={(e) => setEth(num(e.target.value))} hint="Used only to value ETH in portfolios. Empty means ETH is shown as unpriced." />
      <Button className="mt-4" loading={save.isPending} onClick={() => save.mutate()}>Save wallet policy</Button>
    </Card>
  )
}

export function WalletPolicy() {
  const { data } = useQuery({ queryKey: ['wallet-config'], queryFn: () => api<Cfg>('/api/admin/wallet-config') })
  return data ? <Form initial={data} /> : null
}
