import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { newKey } from '@/lib/naira'
import { useBalances } from '@/lib/queries'
import { crypto, parseError } from '@/lib/format'
import { Badge, Button, Card, Field, Sandbox, TokenIcon } from './ui'
import { PinPad } from './naira/PinPad'
import { Sheet } from './naira/Sheet'

/** Crypto you bought on the exchange sits here as sandbox exchange credit until you send it out. Needs your PIN. */
export function ExchangeCredits() {
  const { data } = useBalances()
  const qc = useQueryClient()
  const held = (data?.assets ?? []).filter((a) => Number(a.amount) > 0)
  const [asset, setAsset] = useState('')
  const [amount, setAmount] = useState('')
  const [dest, setDest] = useState('')
  const [pinOpen, setPinOpen] = useState(false)
  const [round, setRound] = useState(0)
  const [idem, setIdem] = useState(newKey)

  const send = useMutation({
    mutationFn: (pin: string) => api('/api/withdrawals', { method: 'POST', body: { asset, amount, destAddress: dest.trim(), pin, idempotencyKey: idem } }),
    onSuccess: () => {
      toast.success('Sent (sandbox)')
      setPinOpen(false)
      setAmount('')
      setDest('')
      setIdem(newKey())
      void qc.invalidateQueries({ queryKey: ['balances'] })
    },
    onError: (e) => {
      toast.error(parseError(e))
      setRound((r) => r + 1)
    },
  })

  if (held.length === 0) return null
  const current = held.find((a) => a.symbol === asset) ?? held[0]
  return (
    <Card className="mt-6 p-5">
      <div className="flex items-center justify-between"><h2 className="display text-lg font-semibold">Exchange credits</h2><Sandbox /></div>
      <p className="mt-1 text-sm text-subtle">Crypto delivered by Naira-to-crypto orders. This is a sandbox ledger balance, separate from your onchain wallet and your Naira wallet.</p>
      <ul className="mt-3 divide-y divide-line">
        {held.map((a) => (
          <li key={a.symbol} className="flex items-center justify-between py-2.5 text-sm">
            <span className="flex items-center gap-2"><TokenIcon symbol={a.symbol} size={22} />{a.symbol}</span>
            <span className="num font-semibold">{crypto(a.amount)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 grid gap-3">
        <div className="flex flex-wrap gap-2">
          {held.map((a) => <button key={a.symbol} onClick={() => setAsset(a.symbol)} className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${current.symbol === a.symbol ? 'border-accent bg-accent text-accent-ink' : 'border-line'}`}>{a.symbol}</button>)}
        </div>
        <Field label={`Amount of ${current.symbol}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
        <Field label="Destination address" value={dest} onChange={(e) => setDest(e.target.value)} />
        <Button disabled={!amount || !dest.trim()} onClick={() => { setAsset(current.symbol); setPinOpen(true) }}>Send out with PIN</Button>
        <Badge kind="sandbox">Simulated send: no onchain transfer happens</Badge>
      </div>
      <Sheet open={pinOpen} onClose={() => setPinOpen(false)} title="Confirm with your PIN">
        <PinPad key={round} disabled={send.isPending} onComplete={(pin) => send.mutate(pin)} />
      </Sheet>
    </Card>
  )
}
