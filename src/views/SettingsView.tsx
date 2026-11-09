import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Landmark, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useBanks } from '@/lib/queries'
import { useNairaOverview } from '@/lib/naira'
import { useSession } from '@/lib/session'
import { SetPinSheet } from '@/components/naira/SetPin'
import { Badge, Button, Card, Empty, Field, PageTitle, Row } from '@/components/ui'

export function SettingsView() {
  const { user, theme, toggleTheme } = useSession()
  const { data: banks } = useBanks()
  const qc = useQueryClient()
  const [form, setForm] = useState({ bankName: '', accountName: '', accountNumber: '' })
  const { data: nw } = useNairaOverview()
  const { data: devices } = useQuery({ queryKey: ['devices'], queryFn: () => api<{ devices: { id: string; label: string; ip: string; lastSeen: number }[] }>('/api/naira/devices').then((r) => r.devices) })
  const [pinOpen, setPinOpen] = useState(false)
  const [profile, setProfile] = useState({ username: '', phone: '' })

  const add = useMutation({
    mutationFn: () => api('/api/bank-accounts', { method: 'POST', body: form }),
    onSuccess: () => {
      setForm({ bankName: '', accountName: '', accountNumber: '' })
      void qc.invalidateQueries({ queryKey: ['banks'] })
      toast.success('Bank account saved')
    },
    onError: (e) => toast.error(e.message),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/bank-accounts/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['banks'] }),
  })
  const saveProfile = useMutation({
    mutationFn: () => api('/api/naira/profile', { method: 'PUT', body: { ...(profile.username ? { username: profile.username } : {}), ...(profile.phone ? { phone: profile.phone } : {}) } }),
    onSuccess: () => {
      setProfile({ username: '', phone: '' })
      void qc.invalidateQueries({ queryKey: ['naira'] })
      toast.success('Profile updated')
    },
    onError: (e) => toast.error(e.message),
  })

  return (
    <>
      <PageTitle title="Settings" sub="Profile, payout accounts and preferences." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="display text-lg font-semibold">Profile</h2>
          <Row label="Name" value={user?.name} />
          <Row label="Email" value={user?.email} />
          <Row label="Role" value={<Badge>{user?.role}</Badge>} />
          <Row label="Verification tier" value={<Badge kind={user && user.kycTier >= 2 ? 'good' : 'warn'}>Tier {user?.kycTier}</Badge>} />
          <p className="mt-2 text-pretty text-xs text-subtle">
            Daily limits depend on your tier. Identity verification (BVN or NIN) through a licensed provider is required before real-money launch.
          </p>
          <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
            <span className="text-sm">Appearance</span>
            <Button variant="ghost" onClick={toggleTheme}>{theme === 'dark' ? 'Switch to light' : 'Switch to dark'}</Button>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-2"><KeyRound size={18} /><h2 className="display text-lg font-semibold">Wallet security</h2></div>
          <Row label="Transaction PIN" value={nw?.wallet.pin.set ? 'Set' : 'Not set'} />
          <Row label="Username" value={nw?.wallet.profile.username ? `@${nw.wallet.profile.username}` : 'Not set'} />
          <Row label="Phone" value={nw?.wallet.profile.phone ?? 'Not set'} />
          <Button className="mt-3 w-full" variant="soft" onClick={() => setPinOpen(true)}>{nw?.wallet.pin.set ? 'Change or reset PIN' : 'Create PIN'}</Button>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label="Username" placeholder="3 to 20 letters, numbers, _" value={profile.username} onChange={(e) => setProfile({ ...profile, username: e.target.value })} />
            <Field label="Phone" inputMode="numeric" maxLength={11} placeholder="08012345678" value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value.replace(/\D/g, '') })} />
          </div>
          <Button className="mt-3 w-full" variant="ghost" disabled={!profile.username && !profile.phone} loading={saveProfile.isPending} onClick={() => saveProfile.mutate()}>Save profile</Button>
          <div className="eyebrow mt-5">Signed-in devices</div>
          <ul className="mt-1 divide-y divide-line text-sm">
            {(devices ?? []).map((d) => <li key={d.id} className="flex items-center justify-between gap-3 py-2"><span className="truncate">{d.label}</span><span className="shrink-0 text-xs text-subtle">{d.ip}</span></li>)}
          </ul>
        </Card>
        <SetPinSheet open={pinOpen} onClose={() => setPinOpen(false)} hasPin={Boolean(nw?.wallet.pin.set)} />

        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center gap-2"><Landmark size={18} /><h2 className="display text-lg font-semibold">Payout bank accounts</h2></div>
          <p className="mt-1 text-sm text-subtle">Account numbers are encrypted at rest and only the last four digits are ever shown.</p>
          <div className="mt-3 divide-y divide-line">
            {!banks?.length && <Empty title="No bank accounts yet" body="Add one to receive Naira payouts in your bank." />}
            {(banks ?? []).map((b) => (
              <div key={b.id} className="flex items-center justify-between py-3">
                <div>
                  <div className="text-sm font-semibold">{b.bankName}</div>
                  <div className="num text-xs text-subtle">{b.accountName} · {b.masked}</div>
                </div>
                <button aria-label="Remove account" onClick={() => remove.mutate(b.id)} className="grid size-10 place-items-center rounded-xl text-danger hover:bg-muted"><Trash2 size={16} /></button>
              </div>
            ))}
          </div>
          <form
            className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault()
              add.mutate()
            }}
          >
            <Field label="Bank" value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} placeholder="e.g. GTBank" required />
            <Field label="Account name" value={form.accountName} onChange={(e) => setForm({ ...form, accountName: e.target.value })} required />
            <Field label="Account number" inputMode="numeric" maxLength={10} value={form.accountNumber} onChange={(e) => setForm({ ...form, accountNumber: e.target.value.replace(/\D/g, '') })} placeholder="10 digits" required />
            <Button type="submit" className="sm:col-span-3" loading={add.isPending}><Plus size={16} /> Save account</Button>
          </form>
        </Card>
      </div>
    </>
  )
}
