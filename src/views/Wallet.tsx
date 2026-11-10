import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  ArrowDownToLine, ArrowLeftRight, ArrowUpRight, Check, Copy, Droplets, GraduationCap, Globe, KeyRound, Landmark, Lock, Plane, ReceiptText,
  ShieldAlert, ShoppingBag, Smartphone, Tv, Wifi, Zap, type LucideIcon,
} from 'lucide-react'
import { api } from '@/lib/api'
import { ago, ngn } from '@/lib/format'
import { EyeToggle, usePrivacy } from '@/lib/privacy'
import { TXN_STATUS, TYPE_LABEL, useNairaOverview, useTxn, type Txn } from '@/lib/naira'
import { Badge, Button, Card, Empty, Sandbox, cx } from '@/components/ui'
import { ActivitySheet } from '@/components/naira/ActivitySheet'
import { BillSheet } from '@/components/naira/BillSheet'
import { FlightSheet } from '@/components/naira/FlightSheet'
import { FundSheet } from '@/components/naira/FundSheet'
import { Receipt } from '@/components/naira/Receipt'
import { SetPinSheet } from '@/components/naira/SetPin'
import { Sheet } from '@/components/naira/Sheet'
import { ShopSheet } from '@/components/naira/ShopSheet'
import { TransferSheet } from '@/components/naira/TransferSheet'

const SERVICES: { id: string; label: string; icon: LucideIcon }[] = [
  { id: 'airtime', label: 'Airtime', icon: Smartphone }, { id: 'data', label: 'Data', icon: Wifi }, { id: 'electricity', label: 'Electricity', icon: Zap },
  { id: 'cable', label: 'Cable TV', icon: Tv }, { id: 'water', label: 'Water', icon: Droplets }, { id: 'internet', label: 'Internet', icon: Globe },
  { id: 'education', label: 'Education', icon: GraduationCap }, { id: 'flights', label: 'Flights', icon: Plane }, { id: 'shopping', label: 'Shopping', icon: ShoppingBag },
]

const ICON: Record<string, LucideIcon> = {
  p2p_deposit: ArrowDownToLine, internal_credit: ArrowDownToLine, bank_transfer: Landmark, internal_transfer: ArrowLeftRight, bill: Zap, flight: Plane, shopping: ShoppingBag, adjustment: ReceiptText,
}

export function TxnRow({ t, onOpen }: { t: Txn; onOpen: () => void }) {
  const { mask } = usePrivacy('naira')
  const Icon = ICON[t.type] ?? ReceiptText
  const credit = t.direction === 'credit'
  const st = TXN_STATUS[t.status]
  return (
    <button onClick={onOpen} className="flex min-h-[64px] w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition hover:bg-muted">
      <div className={cx('grid size-11 shrink-0 place-items-center rounded-full', credit ? 'bg-success/15 text-success' : 'bg-muted text-ink-2')}><Icon size={18} /></div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{t.title}</div>
        <div className="flex items-center gap-2 text-xs text-subtle"><span>{TYPE_LABEL[t.type] ?? t.type}</span><span>·</span><span>{ago(t.createdAt)}</span></div>
      </div>
      <div className="shrink-0 text-right">
        <div className={cx('num text-sm font-semibold', credit && t.status === 'success' ? 'text-success' : t.status === 'failed' || t.status === 'reversed' ? 'text-subtle line-through' : '')}>
          {mask(`${credit ? '+' : '-'}${ngn(t.amount)}`)}
        </div>
        {t.status !== 'success' && st && <Badge kind={st.kind}>{st.label}</Badge>}
      </div>
    </button>
  )
}

export function ReceiptSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data } = useTxn(id)
  return (
    <Sheet open={Boolean(id)} onClose={onClose} title="Receipt">
      {data ? <Receipt txn={data} onDone={onClose} /> : <div className="h-64 animate-pulse rounded-2xl bg-muted" aria-busy="true" />}
    </Sheet>
  )
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true" aria-label="Loading wallet">
      <div className="h-48 rounded-3xl bg-muted" /><div className="h-24 rounded-3xl bg-muted" /><div className="h-56 rounded-3xl bg-muted" /><div className="h-64 rounded-3xl bg-muted" />
    </div>
  )
}

export function Wallet({ openTransfer = false }: { openTransfer?: boolean }) {
  const { data, isLoading, isError, refetch } = useNairaOverview()
  const { mask } = usePrivacy('naira')
  const { data: p2p } = useQuery({ queryKey: ['p2p'], queryFn: () => api<{ orders: { id: string; orderId: string; asset: string; expected: string; status: string }[] }>('/api/naira/p2p'), refetchInterval: 5000 })
  const [sheet, setSheet] = useState<'fund' | 'transfer' | 'activity' | 'pin' | 'flights' | 'shopping' | null>(openTransfer ? 'transfer' : null)
  const [bill, setBill] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<string | null>(null)
  const [resume, setResume] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  if (isLoading) return <Skeleton />
  if (isError || !data) {
    return <Card className="p-6 text-center"><p className="mb-3 text-sm text-danger">We could not load your wallet.</p><Button onClick={() => void refetch()}>Try again</Button></Card>
  }
  const w = data.wallet
  const pending = (p2p?.orders ?? []).filter((o) => o.status === 'pending')
  const frozen = w.status === 'frozen'
  const locked = Boolean(w.pin.lockedUntil)
  const copy = () => {
    navigator.clipboard.writeText(w.account.number).then(() => { setCopied(true); toast.success('Account number copied'); setTimeout(() => setCopied(false), 1500) }).catch(() => toast.error('Copy is blocked here. Select the number instead.'))
  }
  const open = (id: string) => {
    if (id === 'flights') setSheet('flights')
    else if (id === 'shopping') setSheet('shopping')
    else setBill(id)
  }
  const closeAll = () => { setSheet(null); setResume(null) }

  return (
    <div className="mx-auto max-w-md space-y-5 pb-4">
      <div className="flex items-end justify-between">
        <div><h1 className="plate display text-3xl">Naira wallet</h1><p className="plate-sub mt-3 text-sm font-semibold">Balance, transfers and bills</p></div>
        <Sandbox label="Sandbox mode" />
      </div>

      {frozen && (
        <div className="flex gap-3 rounded-2xl border border-danger/40 bg-danger/10 p-4 text-sm" role="alert">
          <ShieldAlert className="mt-0.5 shrink-0 text-danger" size={18} />
          <div><div className="font-semibold text-danger">Wallet frozen</div><div className="text-ink-2">{w.freezeReason ?? 'Contact support.'} You can see your balance, but money cannot move.</div></div>
        </div>
      )}
      {!w.pin.set && (
        <button onClick={() => setSheet('pin')} className="flex min-h-14 w-full items-center gap-3 rounded-2xl border border-warn/40 bg-warn/10 p-4 text-left text-sm">
          <KeyRound size={18} className="shrink-0 text-warn" /><span><span className="font-semibold">Create your transaction PIN.</span> You need it to send money or pay bills.</span>
        </button>
      )}
      {locked && <div className="flex items-center gap-3 rounded-2xl border border-danger/40 bg-danger/10 p-4 text-sm" role="alert"><Lock size={18} className="text-danger" />Money movement is locked after repeated wrong PINs. Reset your PIN or wait.</div>}

      <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-3xl p-5 shadow-card">
        <div className="eyebrow">Available balance</div>
        <div className="mt-1 flex items-center justify-between gap-3">
          <div className="display num min-w-0 truncate text-5xl font-semibold" aria-live="polite">{mask(ngn(w.balance))}</div>
          <EyeToggle scope="naira" />
        </div>
        <div className="mt-1 text-xs text-subtle">Daily limit left {mask(ngn(w.limits.remaining))}</div>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Button disabled={frozen} onClick={() => setSheet('transfer')}><ArrowUpRight size={18} />Transfer</Button>
          <Button variant="soft" onClick={() => setSheet('fund')}><ArrowDownToLine size={18} />Fund wallet</Button>
        </div>
      </motion.section>

      <Card className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="eyebrow">Your NairaBridge account</div>
            <div className="mono num mt-0.5 text-2xl font-semibold tracking-wider">{w.account.number}</div>
            <div className="truncate text-xs text-subtle">{w.account.bank} · {w.account.name}</div>
          </div>
          <button onClick={copy} aria-label="Copy account number" className="grid size-11 shrink-0 place-items-center rounded-xl border border-line hover:bg-muted">{copied ? <Check size={18} /> : <Copy size={18} />}</button>
        </div>
        <p className="mt-3 text-pretty text-xs text-subtle">This is an account identifier. It is not a way to add money: the only way to fund your wallet is to sell crypto for Naira.</p>
      </Card>

      <section>
        <h2 className="display mb-3 text-xl font-semibold">Bills &amp; services</h2>
        <div className="grid grid-cols-3 gap-3">
          {SERVICES.map((s) => (
            <button key={s.id} disabled={frozen} onClick={() => open(s.id)} className="glass flex min-h-[92px] flex-col items-center justify-center gap-2 rounded-2xl text-sm font-semibold transition hover:bg-muted active:scale-95 disabled:opacity-50">
              <s.icon size={22} />{s.label}
            </button>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="display text-xl font-semibold">Recent activity</h2>
          <button className="min-h-11 px-2 text-sm font-semibold text-subtle hover:text-ink" onClick={() => setSheet('activity')}>See all</button>
        </div>
        <Card className="p-2">
          {pending.map((o) => (
            <button key={o.id} onClick={() => { setResume(o.orderId); setSheet('fund') }} className="flex min-h-[64px] w-full items-center gap-3 rounded-2xl px-3 py-2 text-left hover:bg-muted">
              <div className="grid size-11 place-items-center rounded-full bg-muted"><ArrowDownToLine size={18} /></div>
              <div className="flex-1"><div className="text-sm font-semibold">Deposit in progress ({o.asset})</div><div className="text-xs text-subtle">Tap to see deposit details and status</div></div>
              <div className="text-right"><div className="num text-sm font-semibold">{mask(ngn(o.expected))}</div><Badge kind="info">Pending</Badge></div>
            </button>
          ))}
          {data.recent.length === 0 && pending.length === 0 && <Empty title="No activity yet" body="Fund your wallet by selling crypto, then your transfers and bill payments show up here." />}
          {data.recent.map((t) => <TxnRow key={t.id} t={t} onOpen={() => setReceipt(t.id)} />)}
        </Card>
      </section>

      <FundSheet open={sheet === 'fund'} onClose={closeAll} resumeOrder={resume} />
      <TransferSheet open={sheet === 'transfer'} onClose={closeAll} wallet={w} />
      <ActivitySheet open={sheet === 'activity'} onClose={closeAll} onOpen={(id) => { setSheet(null); setReceipt(id) }} />
      <SetPinSheet open={sheet === 'pin'} onClose={closeAll} hasPin={w.pin.set} />
      <FlightSheet open={sheet === 'flights'} onClose={closeAll} wallet={w} />
      <ShopSheet open={sheet === 'shopping'} onClose={closeAll} wallet={w} />
      <BillSheet categoryId={bill} onClose={() => setBill(null)} wallet={w} />
      <ReceiptSheet id={receipt} onClose={() => setReceipt(null)} />
    </div>
  )
}
