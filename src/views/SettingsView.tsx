import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, Landmark, LifeBuoy, KeyRound, Link2, MonitorSmartphone, Palette, Plus, ShieldCheck, Trash2, Type } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useBanks } from '@/lib/queries'
import { useNairaOverview } from '@/lib/naira'
import { useBalanceSummary } from '@/lib/home'
import type { SettingsPage } from '@/lib/nav'
import { useTheme } from '@/lib/theme'
import { useTextSize } from '@/lib/textSize'
import { SetPinSheet } from '@/components/naira/SetPin'
import { AppearancePicker } from '@/components/settings/AppearancePicker'
import { TextSizePicker } from '@/components/settings/TextSizePicker'
import { BackBar, ListRow } from '@/components/settings/Pieces'
import { Button, Card, Empty, Field, PageTitle, Row, Segmented } from '@/components/ui'
import { Alerts } from './Alerts'

function Display({ open }: { open: (p: SettingsPage) => void }) {
  const { theme } = useTheme()
  const { size } = useTextSize()
  const qc = useQueryClient()
  const { data: sum } = useBalanceSummary()
  const cur = sum?.preference.cryptoCurrency ?? 'USD'
  const setCur = useMutation({
    mutationFn: (cryptoCurrency: 'USD' | 'NGN') => api('/api/me/preferences', { method: 'PUT', body: { cryptoCurrency } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['balance-summary'] }),
    onError: (e) => toast.error(e.message),
  })
  return (
    <div className="space-y-5">
      <Card className="p-2">
        <ListRow icon={<Palette size={20} />} label="Appearance" detail={`${theme.name} theme`} onClick={() => open('appearance')} />
        <ListRow icon={<Type size={20} />} label="Text size" detail={`${size.label}, ${size.percent}%`} onClick={() => open('textsize')} />
      </Card>
      <Card className="p-5">
        <div className="eyebrow">Crypto balances shown in</div>
        <div className="mt-3">
          <Segmented value={cur} onChange={(v) => setCur.mutate(v)} options={[{ value: 'USD', label: 'US dollars' }, { value: 'NGN', label: 'Naira' }]} />
        </div>
      </Card>
    </div>
  )
}

function Security() {
  const { data: nw } = useNairaOverview()
  const qc = useQueryClient()
  const { data: devices } = useQuery({ queryKey: ['devices'], queryFn: () => api<{ devices: { id: string; label: string; ip: string; lastSeen: number }[] }>('/api/naira/devices').then((r) => r.devices) })
  const [pinOpen, setPinOpen] = useState(false)
  const [profile, setProfile] = useState({ username: '', phone: '' })
  const saveProfile = useMutation({
    mutationFn: () => api('/api/naira/profile', { method: 'PUT', body: { ...(profile.username ? { username: profile.username } : {}), ...(profile.phone ? { phone: profile.phone } : {}) } }),
    onSuccess: () => {
      setProfile({ username: '', phone: '' })
      void qc.invalidateQueries({ queryKey: ['naira'] })
      void qc.invalidateQueries({ queryKey: ['profile'] })
      toast.success('Profile updated')
    },
    onError: (e) => toast.error(e.message),
  })
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2"><KeyRound size={20} /><h2 className="display text-xl">Wallet security</h2></div>
      <Row label="Transaction PIN" value={nw?.wallet.pin.set ? 'Set' : 'Not set'} />
      <Row label="Username" value={nw?.wallet.profile.username ? `@${nw.wallet.profile.username}` : 'Not set'} />
      <Row label="Phone" value={nw?.wallet.profile.phone ?? 'Not set'} />
      <Button className="mt-3 w-full" variant="soft" onClick={() => setPinOpen(true)}>{nw?.wallet.pin.set ? 'Change or reset PIN' : 'Create PIN'}</Button>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Username" placeholder="3 to 20 letters, numbers, _" value={profile.username} onChange={(e) => setProfile({ ...profile, username: e.target.value })} />
        <Field label="Phone" inputMode="numeric" maxLength={11} placeholder="08012345678" value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value.replace(/\D/g, '') })} />
      </div>
      <Button className="mt-3 w-full" variant="ghost" disabled={!profile.username && !profile.phone} loading={saveProfile.isPending} onClick={() => saveProfile.mutate()}>Save username and phone</Button>
      <div className="eyebrow mt-6 flex items-center gap-1.5"><MonitorSmartphone size={14} /> Signed-in devices</div>
      <ul className="mt-1 divide-y divide-line text-sm">
        {(devices ?? []).map((d) => <li key={d.id} className="flex items-center justify-between gap-3 py-2.5"><span className="truncate font-bold">{d.label}</span><span className="shrink-0 text-xs font-medium text-subtle">{d.ip}</span></li>)}
        {devices?.length === 0 && <li className="py-3 text-xs font-medium text-subtle">No devices recorded yet.</li>}
      </ul>
      <SetPinSheet open={pinOpen} onClose={() => setPinOpen(false)} hasPin={Boolean(nw?.wallet.pin.set)} />
    </Card>
  )
}

function Linked() {
  const { data: banks } = useBanks()
  const qc = useQueryClient()
  const [form, setForm] = useState({ bankName: '', accountName: '', accountNumber: '' })
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
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2"><Landmark size={20} /><h2 className="display text-xl">Payout bank accounts</h2></div>
      <p className="mt-2 text-sm font-medium text-subtle">Account numbers are encrypted at rest and only the last four digits are ever shown.</p>
      <div className="mt-3 divide-y divide-line">
        {!banks?.length && <Empty title="No bank accounts yet" body="Add one to receive Naira payouts in your bank." />}
        {(banks ?? []).map((b) => (
          <div key={b.id} className="flex items-center justify-between py-3">
            <div>
              <div className="text-sm font-extrabold">{b.bankName}</div>
              <div className="num text-xs font-medium text-subtle">{b.accountName} · {b.masked}</div>
            </div>
            <button aria-label="Remove account" onClick={() => remove.mutate(b.id)} className="border border-outline grid size-11 place-items-center rounded-full bg-danger text-on-danger"><Trash2 size={16} /></button>
          </div>
        ))}
      </div>
      <form className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); add.mutate() }}>
        <Field label="Bank" value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} placeholder="e.g. GTBank" required />
        <Field label="Account name" value={form.accountName} onChange={(e) => setForm({ ...form, accountName: e.target.value })} required />
        <Field label="Account number" inputMode="numeric" maxLength={10} value={form.accountNumber} onChange={(e) => setForm({ ...form, accountNumber: e.target.value.replace(/\D/g, '') })} placeholder="10 digits" required />
        <Button type="submit" className="sm:col-span-3" loading={add.isPending}><Plus size={16} /> Save account</Button>
      </form>
    </Card>
  )
}

const HELP: [string, string][] = [
  ['Is this real money?', 'No. NairaBridge runs in sandbox mode: Naira payouts, vault releases and non-Arc chains are simulated. USDC on Arc Testnet is the one live chain.'],
  ['How do I add funds to test?', 'Use the Get test USDC button in the Arc Studio sidebar, or ask the founder for a Test credit.'],
  ['Where is my transaction PIN?', 'Settings, Security. You set it once and use it for Naira payments, transfers and buys.'],
  ['How do I change the colours?', 'Settings, Display, Appearance. Your choice is saved to your account.'],
  ['How do I make the letters bigger?', 'Settings, Display, Text size. Pick Small, Medium, Large or Extra large. It is saved to your account.'],
]

function Help() {
  return (
    <Card className="divide-y divide-line p-2">
      {HELP.map(([q, a]) => (
        <div key={q} className="px-3 py-3">
          <div className="text-base font-extrabold">{q}</div>
          <p className="mt-1 text-pretty text-sm font-medium text-ink-2">{a}</p>
        </div>
      ))}
    </Card>
  )
}

const TITLES: Record<SettingsPage, string> = {
  list: 'Settings', display: 'Display', appearance: 'Appearance', textsize: 'Text size', notifications: 'Notifications', security: 'Security', linked: 'Linked accounts', help: 'Help and support',
}
const PARENT: Partial<Record<SettingsPage, SettingsPage>> = { display: 'list', appearance: 'display', textsize: 'display', notifications: 'list', security: 'list', linked: 'list', help: 'list' }

export function SettingsView({ initial = 'list' }: { initial?: SettingsPage }) {
  const [page, setPage] = useState<SettingsPage>(initial)
  const parent = PARENT[page]

  return (
    <>
      {parent ? <BackBar title={TITLES[page]} crumb={TITLES[parent]} onBack={() => setPage(parent)} /> : <PageTitle title="Settings" sub="Display, notifications, security and help." />}
      {page === 'list' && (
        <Card className="divide-y divide-line p-2">
          <ListRow icon={<Palette size={20} />} label="Display" detail="Appearance, text size and balance currency" onClick={() => setPage('display')} />
          <ListRow icon={<Bell size={20} />} label="Notifications" detail="Payout updates and security alerts" onClick={() => setPage('notifications')} />
          <ListRow icon={<ShieldCheck size={20} />} label="Security" detail="Transaction PIN and signed-in devices" onClick={() => setPage('security')} />
          <ListRow icon={<Link2 size={20} />} label="Linked accounts" detail="Payout bank accounts" onClick={() => setPage('linked')} />
          <ListRow icon={<LifeBuoy size={20} />} label="Help and support" detail="Answers to common questions" onClick={() => setPage('help')} />
        </Card>
      )}
      {page === 'display' && <Display open={setPage} />}
      {page === 'appearance' && <AppearancePicker />}
      {page === 'textsize' && <TextSizePicker />}
      {page === 'notifications' && <Alerts bare />}
      {page === 'security' && <Security />}
      {page === 'linked' && <Linked />}
      {page === 'help' && <Help />}
    </>
  )
}

