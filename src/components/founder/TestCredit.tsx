import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { ago, parseError } from '@/lib/format'
import { newKey } from '@/lib/naira'
import { Badge, Button, Card, Empty, Field, Sandbox } from '../ui'

interface UserRow { id: string; email: string; name: string }
interface Credit { at: number; userId: string; asset?: string; amount?: string; note?: string; to?: string }

/** Founder-only, sandbox-only. Adds test funds through a normal confirmed ledger entry, so swaps can be tried. */
export function TestCredit() {
  const qc = useQueryClient()
  const { data: users } = useQuery({ queryKey: ['a-users-lite'], queryFn: () => api<{ users: UserRow[] }>('/api/admin/users').then((r) => r.users) })
  const { data: hist } = useQuery({ queryKey: ['a-test-credits'], queryFn: () => api<{ credits: Credit[]; mode: string; cap: string }>('/api/admin/test-credit') })
  const { data: assets } = useQuery({ queryKey: ['a-assets-lite'], queryFn: () => api<{ assets: { symbol: string }[] }>('/api/admin/assets').then((r) => r.assets) })
  const [userId, setUserId] = useState('')
  const [asset, setAsset] = useState('USDC')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [key, setKey] = useState(newKey)
  const add = useMutation({
    mutationFn: () => api<{ balance: string; asset: string; duplicate: boolean }>('/api/admin/test-credit', { method: 'POST', body: { userId, asset, amount, note, idempotencyKey: key } }),
    onSuccess: (r) => {
      toast.success(`Added. New ${r.asset} balance: ${r.balance}`)
      setAmount(''); setNote(''); setKey(newKey())
      void qc.invalidateQueries({ queryKey: ['a-test-credits'] })
    },
    onError: (e) => toast.error(parseError(e)),
  })
  const symbols = ['NGN', ...(assets ?? []).map((a) => a.symbol)]
  const valid = userId && /^\d+(\.\d{1,9})?$/.test(amount) && Number(amount) > 0 && note.trim().length >= 5
  return (
    <div className="space-y-5">
      <Card className="space-y-4 p-5">
        <div className="flex items-center justify-between"><h2 className="display text-xl font-semibold">Test credit</h2><Sandbox label="Sandbox only" /></div>
        <p className="text-sm text-subtle">Adds sandbox funds to a user's exchange balance (or Naira wallet) so you can try swaps. It is a confirmed ledger entry, written to the audit log, and never touches a blockchain. Limit {hist ? hist.cap : '…'} NGN equivalent per credit.</p>
        <label className="block text-sm">
          <span className="eyebrow mb-1 block">User</span>
          <select value={userId} onChange={(e) => setUserId(e.target.value)} className="min-h-[44px] w-full rounded-2xl border border-line bg-bg px-3 text-sm">
            <option value="">Choose a user</option>
            {(users ?? []).map((u) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="eyebrow mb-1 block">Asset</span>
            <select value={asset} onChange={(e) => setAsset(e.target.value)} className="min-h-[44px] w-full rounded-2xl border border-line bg-bg px-3 text-sm">
              {symbols.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          <Field label="Amount" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
        </div>
        <Field label="Reason (audited)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="For example: trying swaps" />
        <Button className="w-full" disabled={!valid} loading={add.isPending} onClick={() => add.mutate()}>Add test funds</Button>
      </Card>
      <Card className="p-2">
        <div className="px-4 pt-3 pb-1 text-sm font-semibold">Recent test credits</div>
        {!hist?.credits.length && <Empty title="None yet" />}
        {hist?.credits.map((c, i) => (
          <div key={i} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
            <div className="min-w-0"><div className="truncate font-semibold">{c.amount} {c.asset} to {c.to}</div><div className="truncate text-xs text-subtle">{c.note} · {ago(c.at)}</div></div>
            <Badge kind="sandbox">test</Badge>
          </div>
        ))}
      </Card>
    </div>
  )
}
