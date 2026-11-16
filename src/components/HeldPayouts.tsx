import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Hourglass } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError } from '@/lib/api'
import { ngn } from '@/lib/format'
import { Badge, Button, Card } from '@/components/ui'
import { PinPad } from '@/components/naira/PinPad'
import { Sheet } from '@/components/naira/Sheet'

export interface HeldPayout {
  id: string
  kind: 'withdrawal' | 'naira_bank' | 'bank_payout' | 'buy_release'
  label: string
  amountKobo: string
  status: 'held' | 'released' | 'cancelled'
  releaseAt: number
  createdAt: number
  resolvedAt: number | null
  note: string | null
}

export const KIND_LABEL: Record<HeldPayout['kind'], string> = {
  withdrawal: 'Crypto withdrawal',
  naira_bank: 'Bank transfer',
  bank_payout: 'Payout for your sale',
  buy_release: 'Crypto delivery',
}

export const useHolds = () =>
  useQuery({ queryKey: ['holds'], queryFn: () => api<{ holds: HeldPayout[] }>('/api/holds').then((r) => r.holds), refetchInterval: 15_000 })

/** "in 42 min" / "in 3 h" for a future time. */
export function untilText(ms: number) {
  const s = Math.max(0, Math.round((ms - Date.now()) / 1000))
  if (s < 90) return 'in under a minute'
  if (s < 5400) return `in ${Math.round(s / 60)} min`
  return `in ${Math.round(s / 3600)} h`
}

/** Payouts waiting out the first-time destination hold. The customer can cancel with the PIN; they cannot release early. */
export function HeldPayouts() {
  const { data } = useHolds()
  const qc = useQueryClient()
  const [target, setTarget] = useState<HeldPayout | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [padKey, setPadKey] = useState(0)

  const cancel = useMutation({
    mutationFn: ({ id, pin }: { id: string; pin: string }) => api(`/api/holds/${id}/cancel`, { method: 'POST', body: { pin } }),
    onSuccess: () => {
      toast.success('Payout cancelled')
      setTarget(null)
      void qc.invalidateQueries()
    },
    onError: (e) => {
      setError(e instanceof ApiError ? e.message : 'Could not cancel')
      setPadKey((k) => k + 1)
    },
  })

  const held = (data ?? []).filter((h) => h.status === 'held')
  if (held.length === 0) return null

  return (
    <>
      <Card className="mb-4 p-4" aria-live="polite">
        <div className="mb-3 flex items-center gap-2">
          <Hourglass className="size-4 text-warn" aria-hidden />
          <h2 className="display text-base font-semibold">On hold for your safety</h2>
        </div>
        <ul className="space-y-3">
          {held.map((h) => (
            <li key={h.id} className="rounded-2xl bg-muted p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{KIND_LABEL[h.kind]} to {h.label}</p>
                  <p className="text-xs text-subtle">{ngn(Number(h.amountKobo) / 100)} · first time to this destination · sends {untilText(h.releaseAt)}</p>
                </div>
                <Badge kind="warn">Held</Badge>
              </div>
              <Button variant="soft" className="mt-3 w-full" onClick={() => { setError(null); setPadKey((k) => k + 1); setTarget(h) }}>
                {h.kind === 'bank_payout' ? 'Cancel and pay my Naira wallet instead' : 'Cancel this payout'}
              </Button>
            </li>
          ))}
        </ul>
      </Card>
      <Sheet open={Boolean(target)} onClose={() => setTarget(null)} title="Cancel held payout">
        {target && (
          <div className="space-y-4">
            <p className="text-sm text-subtle">
              {target.kind === 'bank_payout'
                ? 'Your sale will be paid into your Naira wallet instead of the new bank account.'
                : 'The money goes back to your balance and nothing is sent to this destination.'}
            </p>
            <PinPad key={padKey} disabled={cancel.isPending} error={error} onComplete={(pin) => cancel.mutate({ id: target.id, pin })} />
          </div>
        )}
      </Sheet>
    </>
  )
}
