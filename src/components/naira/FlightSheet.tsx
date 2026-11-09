import { useState } from 'react'
import { Minus, Plane, Plus } from 'lucide-react'
import { api } from '@/lib/api'
import { ngn, parseError } from '@/lib/format'
import { useNairaConfig, type NairaWallet, type Txn } from '@/lib/naira'
import { Badge, Button, Field, Row, Sandbox, cx } from '../ui'
import { PaymentFlow } from './PaymentFlow'
import { Sheet } from './Sheet'

interface Offer { id: string; airline: string; flightNo: string; from: string; to: string; date: string; departs: string; arrives: string; durationMin: number; priceKobo: number; seats: number; priceEach: number; total: number }
interface Results { outbound: Offer[]; inbound: Offer[]; passengers: number }

const today = () => new Date().toISOString().slice(0, 10)

export function FlightSheet({ open, onClose, wallet }: { open: boolean; onClose: () => void; wallet: NairaWallet }) {
  const [round, setRound] = useState(0)
  const close = () => { setRound((r) => r + 1); onClose() }
  return (
    <Sheet open={open} onClose={close} title="Flights">
      <FlightFlow key={round} wallet={wallet} onDone={close} />
    </Sheet>
  )
}

function OfferCard({ o, picked, onPick }: { o: Offer; picked: boolean; onPick: () => void }) {
  return (
    <button onClick={onPick} className={cx('w-full rounded-2xl border p-4 text-left transition', picked ? 'border-accent bg-muted' : 'border-line hover:bg-muted')}>
      <div className="flex items-center justify-between"><span className="font-semibold">{o.airline}</span><span className="num font-semibold">{ngn(o.priceEach)}</span></div>
      <div className="mt-1 flex items-center gap-2 text-sm text-ink-2"><span className="num">{o.departs}</span><Plane size={14} /><span className="num">{o.arrives}</span><span className="text-xs text-subtle">{o.durationMin} min · {o.flightNo}</span></div>
      <div className="mt-1 text-xs text-subtle">{o.seats} seats left · {ngn(o.total)} total</div>
    </button>
  )
}

function FlightFlow({ wallet, onDone }: { wallet: NairaWallet; onDone: () => void }) {
  const { data: cfg } = useNairaConfig()
  const [from, setFrom] = useState('LOS')
  const [to, setTo] = useState('ABV')
  const [date, setDate] = useState('')
  const [ret, setRet] = useState('')
  const [pax, setPax] = useState(1)
  const [res, setRes] = useState<Results | null>(null)
  const [out, setOut] = useState<Offer | null>(null)
  const [back, setBack] = useState<Offer | null>(null)
  const [names, setNames] = useState<{ firstName: string; lastName: string }[]>([{ firstName: '', lastName: '' }])
  const [phone, setPhone] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState<'search' | 'results' | 'passengers' | 'review'>('search')

  const search = async () => {
    setBusy(true)
    setErr(null)
    try {
      setRes(await api<Results>('/api/naira/flights/search', { method: 'POST', body: { from, to, date, returnDate: ret || undefined, passengers: pax } }))
      setOut(null)
      setBack(null)
      setStep('results')
    } catch (e) {
      setErr(parseError(e))
    } finally {
      setBusy(false)
    }
  }
  const setPaxCount = (n: number) => {
    const c = Math.min(6, Math.max(1, n))
    setPax(c)
    setNames((cur) => Array.from({ length: c }, (_, i) => cur[i] ?? { firstName: '', lastName: '' }))
  }

  const total = ((out?.priceKobo ?? 0) + (back?.priceKobo ?? 0)) * pax / 100
  const fee = Number(wallet.fees.bill)
  const namesOk = names.every((n) => n.firstName.trim().length >= 2 && n.lastName.trim().length >= 2) && /^0[789][01]\d{8}$/.test(phone)

  if (step === 'review' && out) {
    return (
      <PaymentFlow
        onBack={() => setStep('passengers')}
        onDone={onDone}
        review={
          <div className="space-y-3">
            <div className="rounded-2xl bg-muted p-4">
              <Row label="Outbound" value={`${out.from} to ${out.to}, ${out.date}, ${out.departs}`} />
              <Row label="Airline" value={`${out.airline} ${out.flightNo}`} />
              {back && <Row label="Return" value={`${back.from} to ${back.to}, ${back.date}, ${back.departs}`} />}
              <Row label="Passengers" value={names.map((n) => `${n.firstName} ${n.lastName}`).join(', ')} />
              <Row label="Fare" value={ngn(total)} />
              <Row label="Service fee" value={ngn(fee)} />
              <Row label="Total debit" value={ngn(total + fee)} />
            </div>
            <p className="text-xs text-subtle">Simulated inventory: no airline is contacted and no real ticket is issued.</p>
          </div>
        }
        run={(pin, idempotencyKey) =>
          api<{ txn: Txn }>('/api/naira/flights/book', {
            method: 'POST',
            body: { offerId: out.id, returnOfferId: back?.id, passengers: names.map((n) => ({ firstName: n.firstName.trim(), lastName: n.lastName.trim() })), contactPhone: phone, pin, idempotencyKey },
          })
        }
      />
    )
  }

  if (step === 'passengers') {
    return (
      <div className="space-y-4">
        {names.map((n, i) => (
          <div key={i} className="grid grid-cols-2 gap-2">
            <Field label={`Passenger ${i + 1}: first name`} value={n.firstName} onChange={(e) => setNames((c) => c.map((x, k) => (k === i ? { ...x, firstName: e.target.value } : x)))} />
            <Field label="Last name" value={n.lastName} onChange={(e) => setNames((c) => c.map((x, k) => (k === i ? { ...x, lastName: e.target.value } : x)))} />
          </div>
        ))}
        <Field label="Contact phone" inputMode="numeric" maxLength={11} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))} hint="Sandbox test: a number ending in 9999 makes the booking fail and refunds you." />
        <div className="flex gap-2">
          <Button variant="soft" onClick={() => setStep('results')}>Back</Button>
          <Button className="flex-1" disabled={!namesOk || total + fee > Number(wallet.balance)} onClick={() => setStep('review')}>Review booking</Button>
        </div>
        {total + fee > Number(wallet.balance) && <p className="text-sm text-danger" role="alert">Insufficient balance. Fund your wallet to continue.</p>}
      </div>
    )
  }

  if (step === 'results' && res) {
    const needBack = Boolean(ret)
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2"><Badge kind="sandbox">Simulated inventory</Badge><span className="text-xs text-subtle">{pax} passenger{pax > 1 ? 's' : ''}</span></div>
        <div className="eyebrow">Outbound: {from} to {to}</div>
        <div className="space-y-2">{res.outbound.map((o) => <OfferCard key={o.id} o={o} picked={out?.id === o.id} onPick={() => setOut(o)} />)}</div>
        {needBack && (
          <>
            <div className="eyebrow">Return: {to} to {from}</div>
            <div className="space-y-2">{res.inbound.map((o) => <OfferCard key={o.id} o={o} picked={back?.id === o.id} onPick={() => setBack(o)} />)}</div>
          </>
        )}
        <div className="flex gap-2">
          <Button variant="soft" onClick={() => setStep('search')}>Back</Button>
          <Button className="flex-1" disabled={!out || (needBack && !back)} onClick={() => setStep('passengers')}>Continue · {ngn(total)}</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        {([['From', from, setFrom], ['To', to, setTo]] as const).map(([label, val, set]) => (
          <label key={label} className="block">
            <span className="eyebrow mb-1.5 block">{label}</span>
            <select value={val} onChange={(e) => set(e.target.value)} className="min-h-12 w-full rounded-2xl border border-line bg-bg px-3 text-base">
              {cfg?.airports.map((a) => <option key={a.code} value={a.code}>{a.city} ({a.code})</option>)}
            </select>
          </label>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Departure" type="date" min={today()} value={date} onChange={(e) => setDate(e.target.value)} />
        <Field label="Return (optional)" type="date" min={date || today()} value={ret} onChange={(e) => setRet(e.target.value)} />
      </div>
      <div className="flex items-center justify-between rounded-2xl border border-line px-4 py-2">
        <span className="font-medium">Passengers</span>
        <span className="flex items-center gap-3">
          <button aria-label="Fewer passengers" className="grid size-11 place-items-center rounded-full bg-muted" onClick={() => setPaxCount(pax - 1)}><Minus size={16} /></button>
          <span className="num w-5 text-center font-semibold">{pax}</span>
          <button aria-label="More passengers" className="grid size-11 place-items-center rounded-full bg-muted" onClick={() => setPaxCount(pax + 1)}><Plus size={16} /></button>
        </span>
      </div>
      {err && <p className="text-sm text-danger" role="alert">{err}</p>}
      <Button className="w-full" loading={busy} disabled={!date || from === to} onClick={() => void search()}>Search flights</Button>
      <p className="flex items-center gap-2 text-xs text-subtle"><Sandbox />Flight inventory and prices are simulated.</p>
    </div>
  )
}
