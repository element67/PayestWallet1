/** Integer money math. All amounts are bigint base units; NGN uses kobo (2 decimals). */
export const NGN_DECIMALS = 2

export class MoneyError extends Error {}

export function toUnits(input: string, decimals: number): bigint {
  const s = input.trim()
  if (!/^\d+(\.\d+)?$/.test(s)) throw new MoneyError('Invalid amount')
  const [whole, frac = ''] = s.split('.')
  if (frac.length > decimals) throw new MoneyError(`Too many decimal places (max ${decimals})`)
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0')
}

export function fromUnits(v: bigint, decimals: number): string {
  const neg = v < 0n
  const abs = neg ? -v : v
  const base = 10n ** BigInt(decimals)
  const whole = abs / base
  const frac = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '')
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`
}

export const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b
