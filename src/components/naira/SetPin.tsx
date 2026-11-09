import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { parseError } from '@/lib/format'
import { Button, Field } from '../ui'
import { PinPad } from './PinPad'
import { Sheet } from './Sheet'

/** Create a PIN (enter twice), change it, or reset it with a one-time code. */
export function SetPinSheet({ open, onClose, hasPin }: { open: boolean; onClose: () => void; hasPin: boolean }) {
  const qc = useQueryClient()
  const [mode, setMode] = useState<'set' | 'reset'>('set')
  const [first, setFirst] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [round, setRound] = useState(0)
  const [otp, setOtp] = useState('')
  const [resetSent, setResetSent] = useState(false)

  const save = useMutation({
    mutationFn: (pin: string) =>
      mode === 'reset'
        ? api('/api/naira/pin/reset/confirm', { method: 'POST', body: { otp, pin } })
        : api('/api/naira/pin', { method: 'POST', body: { pin } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['naira'] })
      void qc.invalidateQueries({ queryKey: ['notifications'] })
      setFirst(null)
      setError(null)
      onClose()
    },
    onError: (e) => {
      setError(parseError(e))
      setFirst(null)
      setRound((r) => r + 1)
    },
  })
  const request = useMutation({
    mutationFn: () => api('/api/naira/pin/reset/request', { method: 'POST' }),
    onSuccess: () => {
      setResetSent(true)
      void qc.invalidateQueries({ queryKey: ['notifications'] })
    },
    onError: (e) => setError(parseError(e)),
  })

  const onPin = (pin: string) => {
    if (first === null) {
      setFirst(pin)
      setError(null)
      setRound((r) => r + 1)
    } else if (first !== pin) {
      setFirst(null)
      setError('The two PINs did not match. Start again.')
      setRound((r) => r + 1)
    } else {
      save.mutate(pin)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={mode === 'reset' ? 'Reset PIN' : hasPin ? 'Change PIN' : 'Create your PIN'}>
      <div className="space-y-4">
        {mode === 'reset' && !resetSent && (
          <>
            <p className="text-pretty text-sm text-subtle">We will send a one-time code. In the sandbox it appears in your Alerts. A live build sends it by SMS or email.</p>
            <Button className="w-full" loading={request.isPending} onClick={() => request.mutate()}>Send reset code</Button>
          </>
        )}
        {(mode === 'set' || resetSent) && (
          <>
            {mode === 'reset' && <Field label="One-time code" inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} />}
            <p className="text-center text-sm font-medium">{first === null ? 'Choose a 4-digit PIN' : 'Enter it again to confirm'}</p>
            <PinPad key={round} onComplete={onPin} disabled={save.isPending || (mode === 'reset' && otp.length !== 6)} error={error} />
          </>
        )}
        {hasPin && mode === 'set' && (
          <button className="mx-auto block min-h-11 text-sm font-semibold text-subtle underline" onClick={() => { setMode('reset'); setError(null) }}>Forgot your PIN?</button>
        )}
        {mode === 'reset' && <p className="text-center text-xs text-subtle">Avoid repeated or sequential digits such as 1234.</p>}
      </div>
    </Sheet>
  )
}
