import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import { ngn } from '@/lib/format'
import { useNairaConfig, type Category, type NairaWallet, type Txn } from '@/lib/naira'
import { Button, Field, Row, Sandbox, cx } from '../ui'
import { PaymentFlow } from './PaymentFlow'
import { Sheet } from './Sheet'

/** One screen for airtime, data, electricity, cable TV, water, internet and education. The server owns prices and validation. */
export function BillSheet({ categoryId, onClose, wallet }: { categoryId: string | null; onClose: () => void; wallet: NairaWallet }) {
  const { data: cfg } = useNairaConfig()
  const cat = cfg?.categories.find((c) => c.id === categoryId)
  return (
    <Sheet open={Boolean(cat)} onClose={onClose} title={cat?.label ?? ''}>
      {cat && <BillForm key={cat.id} cat={cat} wallet={wallet} onDone={onClose} />}
    </Sheet>
  )
}

function Chips({ items, value, onChange }: { items: { id: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((i) => (
        <button key={i.id} onClick={() => onChange(i.id)} className={cx('min-h-11 rounded-full border px-4 text-sm font-semibold transition', value === i.id ? 'border-accent bg-accent text-accent-ink' : 'border-line hover:bg-muted')}>{i.label}</button>
      ))}
    </div>
  )
}

function BillForm({ cat, wallet, onDone }: { cat: Category; wallet: NairaWallet; onDone: () => void }) {
  const qc = useQueryClient()
  const [provider, setProvider] = useState(cat.providers.length === 1 ? cat.providers[0].id : '')
  const [variant, setVariant] = useState(cat.variants?.[0]?.id ?? '')
  const [ref, setRef] = useState('')
  const [pkg, setPkg] = useState('')
  const [amount, setAmount] = useState('')
  const [step, setStep] = useState<'details' | 'review'>('details')
  const [ver, setVer] = useState<{ key: string; name?: string | null; detail?: string | null; err?: string } | null>(null)

  const refOk = new RegExp(cat.customerPattern).test(ref)
  const vKey = `${provider}|${variant}|${ref}`
  const verified = ver?.key === vKey ? ver : null
  useEffect(() => {
    if (!cat.verify || !provider || !refOk) return
    let live = true
    api<{ customerName: string | null; detail: string | null }>(`/api/naira/bills/${cat.id}/verify`, { method: 'POST', body: { provider, customerRef: ref, variant: variant || undefined } })
      .then((r) => live && setVer({ key: vKey, name: r.customerName, detail: r.detail }))
      .catch((e: Error) => live && setVer({ key: vKey, err: e.message }))
    return () => { live = false }
  }, [cat.id, cat.verify, provider, variant, ref, refOk, vKey])

  const packages = cat.packages?.[provider] ?? cat.packages?.['*'] ?? []
  const chosen = packages.find((p) => p.id === pkg)
  const priceNgn = cat.mode === 'package' ? (chosen ? chosen.priceKobo / 100 : 0) : Number(amount)
  const fee = Number(wallet.fees.bill)
  const min = (cat.minKobo ?? 0) / 100
  const max = (cat.maxKobo ?? 0) / 100
  const amountErr = cat.mode === 'amount' && amount && (priceNgn < min || priceNgn > max ? `Enter between ${ngn(min)} and ${ngn(max)}` : null)
  const insufficient = priceNgn > 0 && priceNgn + fee > Number(wallet.balance)
  const verifiedOk = !cat.verify || Boolean(verified?.name)
  const ready = Boolean(provider) && refOk && verifiedOk && priceNgn > 0 && !amountErr && !insufficient

  const providerLabel = cat.providers.find((p) => p.id === provider)?.label ?? ''

  if (step === 'review') {
    return (
      <PaymentFlow
        onBack={() => setStep('details')}
        onDone={onDone}
        review={
          <div className="rounded-2xl bg-muted p-4">
            <Row label="Service" value={`${cat.label}: ${providerLabel}`} />
            {variant && <Row label="Account type" value={cat.variants?.find((v) => v.id === variant)?.label ?? variant} />}
            {chosen && <Row label="Package" value={`${chosen.label}${chosen.validity ? ` · ${chosen.validity}` : ''}`} />}
            <Row label={cat.customerLabel} value={ref} mono />
            {verified?.name && <Row label="Customer" value={verified.name} />}
            {verified?.detail && <Row label="Address" value={verified.detail} />}
            <Row label="Amount" value={ngn(priceNgn)} />
            <Row label="Service fee" value={ngn(fee)} />
            <Row label="Total debit" value={ngn(priceNgn + fee)} />
          </div>
        }
        run={(pin, idempotencyKey) =>
          api<{ txn: Txn }>(`/api/naira/bills/${cat.id}/pay`, {
            method: 'POST',
            body: { provider, customerRef: ref, variant: variant || undefined, packageId: cat.mode === 'package' ? pkg : undefined, amount: cat.mode === 'amount' ? amount : undefined, pin, idempotencyKey },
          }).then((r) => {
            void qc.invalidateQueries({ queryKey: ['naira'] })
            return r
          })
        }
      />
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="eyebrow mb-1.5">{cat.id === 'airtime' || cat.id === 'data' ? 'Network' : 'Provider'}</div>
        <Chips items={cat.providers} value={provider} onChange={(v) => { setProvider(v); setPkg('') }} />
      </div>
      {cat.variants && (
        <div>
          <div className="eyebrow mb-1.5">Account type</div>
          <Chips items={cat.variants} value={variant} onChange={setVariant} />
        </div>
      )}
      <Field label={cat.customerLabel} inputMode="numeric" value={ref} onChange={(e) => setRef(e.target.value.replace(/\D/g, '').slice(0, 13))} hint={ref && !refOk ? `Enter a valid ${cat.customerLabel.toLowerCase()}` : undefined} />
      {cat.verify && refOk && provider && !verified && <p className="flex items-center gap-2 text-sm text-subtle"><Loader2 className="animate-spin" size={14} />Verifying</p>}
      {verified?.name && (
        <div className="rounded-2xl bg-success/10 p-3 text-sm">
          <div className="flex items-center gap-2 font-semibold text-success"><BadgeCheck size={18} />{verified.name}<Sandbox label="Sandbox name" /></div>
          {verified.detail && <div className="mt-1 text-subtle">{verified.detail}</div>}
        </div>
      )}
      {verified?.err && <p className="text-sm text-danger" role="alert">{verified.err}</p>}

      {cat.mode === 'package' && provider && (
        <div>
          <div className="eyebrow mb-1.5">Choose a package</div>
          <div className="grid gap-2">
            {packages.map((p) => (
              <button key={p.id} onClick={() => setPkg(p.id)} className={cx('flex min-h-14 items-center justify-between rounded-2xl border px-4 text-left transition', pkg === p.id ? 'border-accent bg-muted' : 'border-line hover:bg-muted')}>
                <span><span className="font-semibold">{p.label}</span>{p.validity && <span className="ml-2 text-xs text-subtle">{p.validity}</span>}</span>
                <span className="num font-semibold">{ngn(p.priceKobo / 100)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {cat.mode === 'amount' && (
        <>
          <Field label="Amount (₦)" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} hint={`Between ${ngn(min)} and ${ngn(max)}`} />
        </>
      )}
      {amountErr && <p className="text-sm text-danger" role="alert">{amountErr}</p>}
      {insufficient && <p className="text-sm text-danger" role="alert">Insufficient balance. Fund your wallet to continue.</p>}
      <Button className="w-full" disabled={!ready} onClick={() => setStep('review')}>Review payment</Button>
      <p className="text-xs text-subtle">{cat.note} Sandbox test: numbers ending in 0000 are not found; ending in 9999 fail at the provider and are refunded automatically.</p>
    </div>
  )
}
