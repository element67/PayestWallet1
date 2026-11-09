import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Gift, Minus, Package, Plus, ShoppingCart } from 'lucide-react'
import { api } from '@/lib/api'
import { ngn } from '@/lib/format'
import type { NairaWallet, Txn } from '@/lib/naira'
import { Badge, Button, Empty, Field, Row, Sandbox, cx } from '../ui'
import { PaymentFlow } from './PaymentFlow'
import { Sheet } from './Sheet'

interface Product { id: string; category: string; name: string; description: string; price: number; kind: 'physical' | 'giftcard' }

export function ShopSheet({ open, onClose, wallet }: { open: boolean; onClose: () => void; wallet: NairaWallet }) {
  const [round, setRound] = useState(0)
  const close = () => { setRound((r) => r + 1); onClose() }
  return (
    <Sheet open={open} onClose={close} title="Shopping">
      {open && <Shop key={round} wallet={wallet} onDone={close} />}
    </Sheet>
  )
}

function Shop({ wallet, onDone }: { wallet: NairaWallet; onDone: () => void }) {
  const { data } = useQuery({ queryKey: ['shop'], queryFn: () => api<{ categories: string[]; products: Product[] }>('/api/naira/shop/products'), staleTime: 60_000 })
  const [cat, setCat] = useState('All')
  const [cart, setCart] = useState<Record<string, number>>({})
  const [step, setStep] = useState<'browse' | 'cart' | 'review'>('browse')
  const [del, setDel] = useState({ name: '', phone: '', address: '', city: '' })

  const products = data?.products ?? []
  const lines = Object.entries(cart).filter(([, q]) => q > 0).map(([id, qty]) => ({ p: products.find((x) => x.id === id)!, qty })).filter((l) => l.p)
  const count = lines.reduce((s, l) => s + l.qty, 0)
  const subtotal = lines.reduce((s, l) => s + l.p.price * l.qty, 0)
  const fee = Number(wallet.fees.bill)
  const needsDelivery = lines.some((l) => l.p.kind === 'physical')
  const deliveryOk = !needsDelivery || (del.name.trim().length >= 2 && /^0[789][01]\d{8}$/.test(del.phone) && del.address.trim().length >= 5 && del.city.trim().length >= 2)
  const add = (id: string, d: number) => setCart((c) => ({ ...c, [id]: Math.min(10, Math.max(0, (c[id] ?? 0) + d)) }))

  if (step === 'review') {
    return (
      <PaymentFlow
        onBack={() => setStep('cart')}
        onDone={onDone}
        review={
          <div className="space-y-3">
            <div className="rounded-2xl bg-muted p-4">
              {lines.map((l) => <Row key={l.p.id} label={`${l.qty}× ${l.p.name}`} value={ngn(l.p.price * l.qty)} />)}
              <Row label="Service fee" value={ngn(fee)} />
              <Row label="Total debit" value={ngn(subtotal + fee)} />
              {needsDelivery && <Row label="Deliver to" value={`${del.name}, ${del.address}, ${del.city}`} />}
            </div>
            <p className="text-xs text-subtle">Sandbox store: nothing is shipped. Gift card codes are shown after payment is confirmed.</p>
          </div>
        }
        run={(pin, idempotencyKey) =>
          api<{ txn: Txn }>('/api/naira/shop/checkout', { method: 'POST', body: { items: lines.map((l) => ({ productId: l.p.id, qty: l.qty })), delivery: needsDelivery ? del : undefined, pin, idempotencyKey } })
        }
      />
    )
  }

  if (step === 'cart') {
    return (
      <div className="space-y-4">
        {lines.length === 0 && <Empty title="Your cart is empty" body="Add something from the shop." />}
        {lines.map((l) => (
          <div key={l.p.id} className="flex items-center justify-between gap-3 rounded-2xl border border-line p-3">
            <div className="min-w-0"><div className="truncate font-semibold">{l.p.name}</div><div className="num text-sm text-subtle">{ngn(l.p.price)} each</div></div>
            <div className="flex items-center gap-2">
              <button aria-label="Remove one" className="grid size-11 place-items-center rounded-full bg-muted" onClick={() => add(l.p.id, -1)}><Minus size={14} /></button>
              <span className="num w-5 text-center">{l.qty}</span>
              <button aria-label="Add one" className="grid size-11 place-items-center rounded-full bg-muted" onClick={() => add(l.p.id, 1)}><Plus size={14} /></button>
            </div>
          </div>
        ))}
        {needsDelivery && (
          <div className="space-y-3">
            <div className="eyebrow">Delivery details</div>
            <Field label="Full name" value={del.name} onChange={(e) => setDel({ ...del, name: e.target.value })} />
            <Field label="Phone" inputMode="numeric" maxLength={11} value={del.phone} onChange={(e) => setDel({ ...del, phone: e.target.value.replace(/\D/g, '') })} />
            <Field label="Address" value={del.address} onChange={(e) => setDel({ ...del, address: e.target.value })} />
            <Field label="City" value={del.city} onChange={(e) => setDel({ ...del, city: e.target.value })} />
          </div>
        )}
        {lines.length > 0 && subtotal + fee > Number(wallet.balance) && <p className="text-sm text-danger" role="alert">Insufficient balance. Fund your wallet to check out.</p>}
        <div className="flex gap-2">
          <Button variant="soft" onClick={() => setStep('browse')}>Keep shopping</Button>
          <Button className="flex-1" disabled={!lines.length || !deliveryOk || subtotal + fee > Number(wallet.balance)} onClick={() => setStep('review')}>Checkout · {ngn(subtotal)}</Button>
        </div>
      </div>
    )
  }

  const shown = products.filter((p) => cat === 'All' || p.category === cat)
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Badge kind="sandbox">Simulated store</Badge>
        <button onClick={() => setStep('cart')} className="relative flex min-h-11 items-center gap-2 rounded-full border border-line px-4 text-sm font-semibold hover:bg-muted"><ShoppingCart size={16} />Cart{count > 0 && <span className="grid size-5 place-items-center rounded-full bg-accent text-xs text-accent-ink">{count}</span>}</button>
      </div>
      <div className="scroll-thin -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {['All', ...(data?.categories ?? [])].map((c) => (
          <button key={c} onClick={() => setCat(c)} className={cx('min-h-11 shrink-0 rounded-full border px-4 text-sm font-semibold', cat === c ? 'border-accent bg-accent text-accent-ink' : 'border-line')}>{c}</button>
        ))}
      </div>
      {!data && <div className="h-40 animate-pulse rounded-2xl bg-muted" />}
      <div className="grid gap-2">
        {shown.map((p) => (
          <div key={p.id} className="flex items-center gap-3 rounded-2xl border border-line p-3">
            <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-muted">{p.kind === 'giftcard' ? <Gift size={20} /> : <Package size={20} />}</div>
            <div className="min-w-0 flex-1"><div className="truncate font-semibold">{p.name}</div><div className="truncate text-xs text-subtle">{p.description}</div><div className="num text-sm font-semibold">{ngn(p.price)}</div></div>
            <Button variant="soft" className="!px-3" onClick={() => add(p.id, 1)} aria-label={`Add ${p.name} to cart`}><Plus size={16} />{cart[p.id] ? cart[p.id] : ''}</Button>
          </div>
        ))}
      </div>
      <p className="flex items-center gap-2 text-xs text-subtle"><Sandbox />Products and gift cards are simulated inventory.</p>
    </div>
  )
}
