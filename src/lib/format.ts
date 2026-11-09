export const ngn = (v: string | number) => {
  const n = Number(v)
  return `₦${n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export const crypto = (v: string, max = 8) => {
  const [w, f = ''] = v.split('.')
  const whole = Number(w).toLocaleString('en-US')
  const frac = f.slice(0, max).replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : whole
}

export const short = (s: string | null | undefined, a = 6, b = 4) => (s ? (s.length > a + b + 3 ? `${s.slice(0, a)}...${s.slice(-b)}` : s) : '')

export const ago = (ms: number) => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export const duration = (ms: number | null | undefined) => {
  if (ms === null || ms === undefined) return 'n/a'
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
}

export const STATUS_LABEL: Record<string, string> = {
  awaiting_deposit: 'Waiting for your deposit',
  deposit_reported: 'Transaction broadcast',
  detected: 'Detected, verifying',
  payout_processing: 'Paying out',
  payout_completed: 'Paid out',
  awaiting_finality: 'Paid, awaiting final confirmation',
  completed: 'Completed',
  awaiting_payment: 'Waiting for your Naira payment',
  payment_verified: 'Payment verified',
  awaiting_liquidity: 'Waiting for vault liquidity',
  flagged: 'Held for review',
  reversed: 'Reversed',
  failed: 'Failed',
  expired: 'Expired',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
}

export const tone = (status: string): 'good' | 'bad' | 'warn' | 'info' => {
  if (status === 'completed') return 'good'
  if (['failed', 'reversed', 'rejected'].includes(status)) return 'bad'
  if (['flagged', 'expired', 'cancelled', 'awaiting_liquidity'].includes(status)) return 'warn'
  return 'info'
}

export function parseError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  const m = msg.toLowerCase()
  if (m.includes('user rejected') || m.includes('denied')) return 'Transaction cancelled.'
  if (m.includes('insufficient funds') || m.includes('exceeds balance')) return 'Insufficient balance in your wallet.'
  if (m.includes('reverted')) return 'The transaction failed onchain. Please try again.'
  return msg.length > 140 ? 'Something went wrong. Please try again.' : msg
}

/** Display only: the server already did the conversion and rounding. */
export const usd = (v: string | number) => `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
