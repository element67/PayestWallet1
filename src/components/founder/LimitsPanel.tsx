import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Button, Card, Field } from '../ui'
import { WalletPolicy } from './WalletPolicy'

interface Settings {
  feeBps: number; quoteTtlSec: number; riskBlockScore: number; riskReviewScore: number; confirmationsRequired: number; orderExpiryMin: number
  instantPayoutsEnabled: boolean; platformPaused: boolean; instantLimitNgn: string; dailyLimitTier1Ngn: string; dailyLimitTier2Ngn: string; dailyWithdrawLimitNgn: string; vaultAddressArc: string
}

function Form({ initial }: { initial: Settings }) {
  const qc = useQueryClient()
  const [s, setS] = useState(initial)
  const num = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [k]: Number(e.target.value.replace(/\D/g, '')) })
  const str = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [k]: e.target.value.replace(/[^\d.]/g, '') })
  const save = useMutation({
    mutationFn: () => api('/api/admin/settings', { method: 'PUT', body: s }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-settings'] })
      void qc.invalidateQueries({ queryKey: ['config'] })
      toast.success('Settings saved and audit-logged')
    },
    onError: (e) => toast.error(e.message),
  })
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="space-y-3 p-5">
        <h2 className="display text-lg font-semibold">Fees and quotes</h2>
        <Field label="Platform fee (basis points)" hint={`${(s.feeBps / 100).toFixed(2)}% on every exchange`} inputMode="numeric" value={s.feeBps} onChange={num('feeBps')} />
        <Field label="Quote lifetime (seconds)" inputMode="numeric" value={s.quoteTtlSec} onChange={num('quoteTtlSec')} />
        <Field label="Order expiry (minutes)" inputMode="numeric" value={s.orderExpiryMin} onChange={num('orderExpiryMin')} />
      </Card>
      <Card className="space-y-3 p-5">
        <h2 className="display text-lg font-semibold">Limits</h2>
        <Field label="Instant payout limit (NGN)" hint="Above this, payouts wait for final confirmation" inputMode="decimal" value={s.instantLimitNgn} onChange={str('instantLimitNgn')} />
        <Field label="Daily limit, tier 1 (NGN)" inputMode="decimal" value={s.dailyLimitTier1Ngn} onChange={str('dailyLimitTier1Ngn')} />
        <Field label="Daily limit, tier 2 (NGN)" inputMode="decimal" value={s.dailyLimitTier2Ngn} onChange={str('dailyLimitTier2Ngn')} />
        <Field label="Daily withdrawal limit per user (NGN equivalent)" inputMode="decimal" value={s.dailyWithdrawLimitNgn} onChange={str('dailyWithdrawLimitNgn')} />
      </Card>
      <Card className="space-y-3 p-5">
        <h2 className="display text-lg font-semibold">Agent risk policy</h2>
        <Field label="Hold for final confirmation at score" hint="Below this, eligible payouts are instant" inputMode="numeric" value={s.riskReviewScore} onChange={num('riskReviewScore')} />
        <Field label="Block and flag at score" inputMode="numeric" value={s.riskBlockScore} onChange={num('riskBlockScore')} />
        <Field label="Confirmations required for final" inputMode="numeric" value={s.confirmationsRequired} onChange={num('confirmationsRequired')} />
        <label className="flex min-h-11 items-center gap-2 text-sm font-medium"><input type="checkbox" className="size-4" checked={s.instantPayoutsEnabled} onChange={(e) => setS({ ...s, instantPayoutsEnabled: e.target.checked })} /> Instant payouts enabled</label>
        <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-danger"><input type="checkbox" className="size-4" checked={s.platformPaused} onChange={(e) => setS({ ...s, platformPaused: e.target.checked })} /> Pause all trading (kill switch)</label>
      </Card>
      <Card className="space-y-3 p-5">
        <h2 className="display text-lg font-semibold">Arc Testnet vault</h2>
        <Field label="Vault address (watch only)" className="mono !text-xs" value={s.vaultAddressArc} onChange={(e) => setS({ ...s, vaultAddressArc: e.target.value.trim() })} placeholder="0x..." hint="The agent watches USDC transfers to this address. Use an address you control. No private key is ever entered here." />
      </Card>
      <Button className="lg:col-span-2" onClick={() => save.mutate()} loading={save.isPending}>Save all settings</Button>
    </div>
  )
}

export function LimitsPanel() {
  const { data } = useQuery({ queryKey: ['admin-settings'], queryFn: () => api<{ settings: Settings }>('/api/admin/settings').then((r) => r.settings) })
  if (!data) return <p className="text-subtle">Loading...</p>
  return (
    <div className="space-y-5">
      <Form initial={data} />
      <WalletPolicy />
    </div>
  )
}
