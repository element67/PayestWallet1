import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, Loader2, Search, UserRound } from 'lucide-react'
import { api } from '@/lib/api'
import { ngn, parseError } from '@/lib/format'
import { useNairaConfig, type NairaWallet, type Txn } from '@/lib/naira'
import { Badge, Button, Field, Row, Sandbox, Segmented, cx } from '../ui'
import { PaymentFlow } from './PaymentFlow'
import { Sheet } from './Sheet'

interface Beneficiary { id: string; kind: string; label: string; bankCode: string | null; bankName: string | null; last4: string | null; accountName: string | null; accountNumber: string | null; recipientId: string | null }
interface Recipient { id: string; name: string; username: string | null; phoneMasked: string | null }

export function TransferSheet({ open, onClose, wallet }: { open: boolean; onClose: () => void; wallet: NairaWallet }) {
  const [tab, setTab] = useState<'bank' | 'user'>('bank')
  const [round, setRound] = useState(0)
  const close = () => {
    setRound((r) => r + 1) // remounts the forms so nothing from the last transfer is left behind
    onClose()
  }
  return (
    <Sheet open={open} onClose={close} title="Transfer">
      <div className="space-y-4">
        <Segmented value={tab} onChange={setTab} options={[{ value: 'bank', label: 'To bank' }, { value: 'user', label: 'To NairaBridge user' }]} />
        {tab === 'bank' ? <BankForm key={`b${round}`} wallet={wallet} onDone={close} /> : <UserForm key={`u${round}`} wallet={wallet} onDone={close} />}
      </div>
    </Sheet>
  )
}

const toKobo = (v: string) => Math.round(Number(v) * 100)

function BankForm({ wallet, onDone }: { wallet: NairaWallet; onDone: () => void }) {
  const { data: cfg } = useNairaConfig()
  const qc = useQueryClient()
  const { data: bens } = useQuery({ queryKey: ['beneficiaries'], queryFn: () => api<{ beneficiaries: Beneficiary[] }>('/api/naira/beneficiaries').then((r) => r.beneficiaries) })
  const [bank, setBank] = useState('')
  const [acct, setAcct] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [save, setSave] = useState(true)
  const [step, setStep] = useState<'details' | 'review'>('details')
  const [ver, setVer] = useState<{ key: string; name?: string; bankName?: string; err?: string } | null>(null)

  const vKey = `${bank}|${acct}`
  const verified = ver?.key === vKey ? ver : null
  useEffect(() => {
    if (!bank || !/^\d{10}$/.test(acct)) return
    let live = true
    api<{ accountName: string; bankName: string }>('/api/naira/transfer/bank/verify', { method: 'POST', body: { bankCode: bank, accountNumber: acct } })
      .then((r) => live && setVer({ key: vKey, name: r.accountName, bankName: r.bankName }))
      .catch((e: Error) => live && setVer({ key: vKey, err: e.message }))
    return () => { live = false }
  }, [bank, acct, vKey])

  const kobo = toKobo(amount)
  const fee = Number(wallet.fees.bankTransfer)
  const balance = Number(wallet.balance)
  const minKobo = Math.round(Number(cfg?.minTransferNgn ?? 0) * 100)
  const amountErr = amount && (kobo < minKobo ? `The minimum transfer is ${ngn(cfg?.minTransferNgn ?? 0)}` : kobo / 100 + fee > balance ? 'Insufficient balance' : null)
  const ready = Boolean(verified?.name) && kobo > 0 && kobo >= minKobo && !amountErr

  if (step === 'review' && verified?.name) {
    return (
      <PaymentFlow
        onBack={() => setStep('details')}
        onDone={onDone}
        review={
          <div className="space-y-3">
            <div className="rounded-2xl bg-muted p-4">
              <Row label="To" value={verified.name} />
              <Row label="Bank" value={verified.bankName ?? ''} />
              <Row label="Account number" value={acct} mono />
              <Row label="Amount" value={ngn(amount)} />
              <Row label="Fee" value={ngn(fee)} />
              <Row label="Total debit" value={ngn(Number(amount) + fee)} />
              {note && <Row label="Note" value={note} />}
            </div>
            <p className="text-xs text-subtle">Sandbox bank network: no real bank is contacted.</p>
          </div>
        }
        run={(pin, idempotencyKey) =>
          api<{ txn: Txn }>('/api/naira/transfer/bank', { method: 'POST', body: { bankCode: bank, accountNumber: acct, amount, note: note || undefined, pin, idempotencyKey, saveBeneficiary: save } }).then((r) => {
            void qc.invalidateQueries({ queryKey: ['beneficiaries'] })
            return r
          })
        }
      />
    )
  }

  return (
    <div className="space-y-4">
      {(bens ?? []).filter((b) => b.kind === 'bank').length > 0 && (
        <div>
          <div className="eyebrow mb-1.5">Saved beneficiaries</div>
          <div className="scroll-thin -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {bens!.filter((b) => b.kind === 'bank').map((b) => (
              <button key={b.id} onClick={() => { setBank(b.bankCode ?? ''); setAcct(b.accountNumber ?? '') }} className="flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-line px-3 text-sm font-medium hover:bg-muted">
                <UserRound size={14} />{b.accountName?.split(' ')[0]} ••{b.last4}
              </button>
            ))}
          </div>
        </div>
      )}
      <label className="block">
        <span className="eyebrow mb-1.5 block">Bank</span>
        <select value={bank} onChange={(e) => setBank(e.target.value)} className="min-h-12 w-full rounded-2xl border border-line bg-surface-strong px-3 text-base">
          <option value="">Select a bank</option>
          {cfg?.banks.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
        </select>
      </label>
      <Field label="Account number" inputMode="numeric" maxLength={10} placeholder="10 digits" value={acct} onChange={(e) => setAcct(e.target.value.replace(/\D/g, ''))} />
      {/^\d{10}$/.test(acct) && bank && !verified && <p className="flex items-center gap-2 text-sm text-subtle"><Loader2 className="animate-spin" size={14} />Verifying account</p>}
      {verified?.name && <div className="flex items-center gap-2 rounded-2xl bg-success/10 p-3 text-sm font-semibold text-success"><BadgeCheck size={18} />{verified.name}<Sandbox label="Sandbox name" /></div>}
      {verified?.err && <p className="text-sm text-danger" role="alert">{verified.err}</p>}
      <Field label="Amount (₦)" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} hint={`Fee ${ngn(wallet.fees.bankTransfer)}. Daily limit left ${ngn(wallet.limits.remaining)}.`} />
      {amountErr && <p className="text-sm text-danger" role="alert">{amountErr}</p>}
      <Field label="Note (optional)" maxLength={100} value={note} onChange={(e) => setNote(e.target.value)} />
      <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="size-5" checked={save} onChange={(e) => setSave(e.target.checked)} />Save as beneficiary</label>
      <Button className="w-full" disabled={!ready} onClick={() => setStep('review')}>Review transfer</Button>
      <p className="text-xs text-subtle">Sandbox test: account numbers ending in 0000 are not found; ending in 9999 fail at the bank and are refunded automatically.</p>
    </div>
  )
}

function UserForm({ wallet, onDone }: { wallet: NairaWallet; onDone: () => void }) {
  const { data: cfg } = useNairaConfig()
  const [q, setQ] = useState('')
  const [rec, setRec] = useState<Recipient | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [step, setStep] = useState<'find' | 'review'>('find')

  const find = async () => {
    setBusy(true)
    setErr(null)
    setRec(null)
    try {
      setRec((await api<{ recipient: Recipient }>(`/api/naira/recipients/search?q=${encodeURIComponent(q)}`)).recipient)
    } catch (e) {
      setErr(parseError(e))
    } finally {
      setBusy(false)
    }
  }
  const kobo = toKobo(amount)
  const minKobo = Math.round(Number(cfg?.minTransferNgn ?? 0) * 100)
  const amountErr = amount && (kobo < minKobo ? `The minimum transfer is ${ngn(cfg?.minTransferNgn ?? 0)}` : kobo / 100 > Number(wallet.balance) ? 'Insufficient balance' : null)

  if (step === 'review' && rec) {
    return (
      <PaymentFlow
        onBack={() => setStep('find')}
        onDone={onDone}
        review={
          <div className="rounded-2xl bg-muted p-4">
            <Row label="To" value={rec.name} />
            {rec.username && <Row label="Username" value={`@${rec.username}`} />}
            <Row label="Amount" value={ngn(amount)} />
            <Row label="Fee" value={ngn(0)} />
            <Row label="Total debit" value={ngn(amount)} />
            {note && <Row label="Note" value={note} />}
          </div>
        }
        run={(pin, idempotencyKey) => api<{ txn: Txn }>('/api/naira/transfer/internal', { method: 'POST', body: { recipientId: rec.id, amount, note: note || undefined, pin, idempotencyKey, saveBeneficiary: true } })}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2">
        <div className="flex-1"><Field label="Username or phone number" placeholder="@username or 0803…" value={q} onChange={(e) => { setQ(e.target.value); setRec(null) }} onKeyDown={(e) => e.key === 'Enter' && q.length >= 3 && void find()} /></div>
        <Button variant="soft" loading={busy} disabled={q.trim().length < 3} onClick={() => void find()} aria-label="Find recipient"><Search size={18} /></Button>
      </div>
      {err && <p className="text-sm text-danger" role="alert">{err}</p>}
      {rec && (
        <div className="flex items-center gap-3 rounded-2xl bg-muted p-4">
          <div className="grid size-11 place-items-center rounded-full bg-accent text-accent-ink font-bold">{rec.name[0]}</div>
          <div className="min-w-0"><div className="truncate font-semibold">{rec.name}</div><div className="text-xs text-subtle">{rec.username ? `@${rec.username}` : ''} {rec.phoneMasked ?? ''}</div></div>
          <Badge kind="good">Found</Badge>
        </div>
      )}
      {rec && (
        <>
          <Field label="Amount (₦)" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} hint="No fee between NairaBridge users." />
          {amountErr && <p className="text-sm text-danger" role="alert">{amountErr}</p>}
          <Field label="Note (optional)" maxLength={100} value={note} onChange={(e) => setNote(e.target.value)} />
          <Button className={cx('w-full')} disabled={kobo <= 0 || kobo < minKobo || Boolean(amountErr)} onClick={() => setStep('review')}>Review transfer</Button>
        </>
      )}
      <p className="text-xs text-subtle">Search needs an exact username or phone number. Sandbox users: demo_user and demo_founder.</p>
    </div>
  )
}
