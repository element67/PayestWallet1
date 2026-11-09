import { useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { ApiError } from '@/lib/api'
import { parseError } from '@/lib/format'
import { newKey, useTxn, type Txn } from '@/lib/naira'
import { Button } from '../ui'
import { PinPad } from './PinPad'
import { Receipt } from './Receipt'
import { SetPinSheet } from './SetPin'

type Stage = { kind: 'review' } | { kind: 'pin' } | { kind: 'processing'; id: string } | { kind: 'receipt'; txn: Txn }

/**
 * Review -> PIN -> processing -> receipt, shared by every money movement.
 * One idempotency key per flow instance: a retry of the same payment can never charge twice.
 */
export function PaymentFlow({ review, confirmLabel = 'Confirm and enter PIN', run, onDone, onBack }: {
  review: ReactNode
  confirmLabel?: string
  run: (pin: string, idempotencyKey: string) => Promise<{ txn: Txn }>
  onDone: () => void
  onBack?: () => void
}) {
  const qc = useQueryClient()
  const [stage, setStage] = useState<Stage>({ kind: 'review' })
  const [idem] = useState(newKey)
  const [error, setError] = useState<string | null>(null)
  const [round, setRound] = useState(0)
  const [busy, setBusy] = useState(false)
  const [needPin, setNeedPin] = useState(false)

  const submit = async (pin: string) => {
    setBusy(true)
    setError(null)
    try {
      const { txn } = await run(pin, idem)
      void qc.invalidateQueries({ queryKey: ['naira'] })
      setStage(['success', 'failed', 'reversed', 'pending_review'].includes(txn.status) ? { kind: 'receipt', txn } : { kind: 'processing', id: txn.id })
    } catch (e) {
      if (e instanceof ApiError && e.data.code === 'PIN_REQUIRED') setNeedPin(true)
      setError(parseError(e))
      setRound((r) => r + 1)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {stage.kind === 'review' && (
        <>
          {review}
          <div className="flex gap-2">
            {onBack && <Button variant="soft" onClick={onBack}>Back</Button>}
            <Button className="flex-1" onClick={() => setStage({ kind: 'pin' })}>{confirmLabel}</Button>
          </div>
        </>
      )}
      {stage.kind === 'pin' && (
        <div className="space-y-3 py-2">
          <PinPad key={round} onComplete={(p) => void submit(p)} disabled={busy} error={error} />
          {busy && <p className="flex items-center justify-center gap-2 text-sm text-subtle"><Loader2 className="animate-spin" size={16} />Checking PIN</p>}
          <Button variant="ghost" className="w-full" disabled={busy} onClick={() => { setStage({ kind: 'review' }); setError(null) }}>Back to review</Button>
        </div>
      )}
      {stage.kind === 'processing' && <Processing id={stage.id} onResult={(txn) => setStage({ kind: 'receipt', txn })} />}
      {stage.kind === 'receipt' && <Receipt txn={stage.txn} onDone={onDone} />}
      <SetPinSheet open={needPin} onClose={() => setNeedPin(false)} hasPin={false} />
    </div>
  )
}

function Processing({ id, onResult }: { id: string; onResult: (t: Txn) => void }) {
  const { data } = useTxn(id)
  const qc = useQueryClient()
  if (data && ['success', 'failed', 'reversed', 'pending_review'].includes(data.status)) {
    queueMicrotask(() => {
      void qc.invalidateQueries({ queryKey: ['naira'] })
      onResult(data)
    })
  }
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center" aria-live="polite">
      <Loader2 className="animate-spin" size={40} />
      <div className="display text-xl font-semibold">Processing your payment</div>
      <p className="max-w-xs text-pretty text-sm text-subtle">Your money is reserved while the provider confirms. It is returned automatically if anything fails.</p>
    </div>
  )
}
