import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { parseError } from '@/lib/format'
import type { CryptoOp } from '@/lib/home'
import { newKey } from '@/lib/naira'
import { TokenField } from '../TokenPicker'
import { Button, Card, Field } from '../ui'
import { OpResult } from './OpResult'

interface Options { networks: { id: string; name: string }[]; assets: { symbol: string; network: string }[]; providerConnected: boolean }

function NetSelect({ label, value, onChange, nets }: { label: string; value: string; onChange: (v: string) => void; nets: { id: string; name: string }[] }) {
  return (
    <label className="block flex-1 text-sm">
      <span className="eyebrow mb-1 block">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="min-h-[44px] w-full rounded-2xl border border-line bg-bg px-3 text-sm font-semibold">
        {nets.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
      </select>
    </label>
  )
}

/** Bridge request. Validated on the server and recorded; without a connected provider nothing moves and the record says so. */
export function BridgeScreen({ onDone }: { onDone: () => void }) {
  const { data } = useQuery({ queryKey: ['bridge-options'], queryFn: () => api<Options>('/api/crypto/bridge/options') })
  const [symbol, setSymbol] = useState('USDC')
  const [fromNetwork, setFrom] = useState('arc-testnet')
  const [toNetwork, setTo] = useState('base-sepolia')
  const [amount, setAmount] = useState('')
  const [idem] = useState(newKey)
  const [op, setOp] = useState<CryptoOp | null>(null)
  const submit = useMutation({
    mutationFn: () => api<{ op: CryptoOp }>('/api/crypto/bridge', { method: 'POST', body: { symbol, fromNetwork: effFrom, toNetwork: effTo, amount, idempotencyKey: idem } }),
    onSuccess: (r) => setOp(r.op),
    onError: (e) => toast.error(parseError(e)),
  })
  if (op) return <OpResult op={op} onDone={onDone} />
  if (!data) return <div className="h-64 animate-pulse rounded-3xl bg-muted" aria-busy="true" />
  const onBoth = (n: string) => data.assets.some((a) => a.symbol === symbol && a.network === n)
  const nets = data.networks.filter((n) => onBoth(n.id))
  const effFrom = nets.some((n) => n.id === fromNetwork) ? fromNetwork : nets[0]?.id ?? ''
  const effTo = nets.some((n) => n.id === toNetwork) && toNetwork !== effFrom ? toNetwork : nets.find((n) => n.id !== effFrom)?.id ?? ''
  const valid = /^\d+(\.\d{1,9})?$/.test(amount) && Number(amount) > 0 && effFrom !== effTo && Boolean(effFrom) && Boolean(effTo)
  return (
    <div className="space-y-4">
      {!data.providerConnected && (
        <div className="rounded-2xl border border-warn/40 bg-warn/10 p-4 text-sm" role="note">
          <b>No bridge provider is connected yet.</b> Your request is checked and recorded, but nothing is moved and your balance stays the same.
        </div>
      )}
      <Card className="space-y-4 p-5">
        <TokenField label="Asset" value={symbol} onChange={setSymbol} balanceMode="onchain" reasonFor={(t) => (data.assets.filter((x) => x.symbol === t.symbol).length >= 2 ? null : 'Only on one network')} />
        <div className="flex items-end gap-2">
          <NetSelect label="From network" value={effFrom} onChange={setFrom} nets={nets} />
          <ArrowRight size={18} className="mb-3.5 shrink-0 text-subtle" />
          <NetSelect label="To network" value={effTo} onChange={setTo} nets={nets} />
        </div>
        <Field label="Amount" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
                {nets.length < 2 && <p className="text-sm text-subtle">{symbol} is only on one supported network, so there is nothing to bridge.</p>}
      </Card>
      <Button className="w-full" disabled={!valid} loading={submit.isPending} onClick={() => submit.mutate()}>Submit bridge request</Button>
    </div>
  )
}
