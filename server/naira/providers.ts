/**
 * Provider adapters for the Naira wallet. Everything here is a clearly labelled SANDBOX simulation:
 * no bank, telco, utility or airline is contacted and no real money moves. Each adapter implements a small
 * interface, so a production provider can be swapped in without touching the wallet, ledger or UI.
 *
 * Deterministic test hooks (documented in the UI):
 *  - account / meter / phone / smartcard numbers ending in 0000 are "not found" at verification
 *  - numbers ending in 9999 verify fine but the provider rejects the payment, which triggers an automatic reversal
 */
import { createHash } from 'node:crypto'
import { CONFIG } from '../config'

if (CONFIG.realMoney) throw new Error('Sandbox adapters must never run with real money enabled')

export const PAYMENT_MODE = CONFIG.paymentMode

/* The CBN bank codes below are the real codes of these banks; verification and transfers are simulated. */
export const BANKS = [
  { code: '044', name: 'Access Bank' },
  { code: '058', name: 'Guaranty Trust Bank' },
  { code: '011', name: 'First Bank of Nigeria' },
  { code: '033', name: 'United Bank for Africa' },
  { code: '057', name: 'Zenith Bank' },
  { code: '232', name: 'Sterling Bank' },
  { code: '070', name: 'Fidelity Bank' },
  { code: '050', name: 'Ecobank Nigeria' },
  { code: '032', name: 'Union Bank of Nigeria' },
  { code: '035', name: 'Wema Bank' },
] as const

const NAMES = [
  'ADEBAYO OLUWASEUN TUNDE', 'CHIDINMA GRACE OKAFOR', 'IBRAHIM MUSA BELLO', 'FATIMA ZAINAB YUSUF', 'EMEKA CHUKWUDI NWOSU',
  'BLESSING OMOWUMI ADEYEMI', 'TUNDE BABATUNDE ALABI', 'HALIMA AISHA SULEIMAN', 'KELECHI IFEOMA EZE', 'SAMUEL DAVID AKPAN',
  'NGOZI PATIENCE OBI', 'YUSUF ABDULLAHI GARBA',
]
const hash = (s: string) => createHash('sha256').update(s).digest()
const pick = <T,>(arr: readonly T[], seed: string): T => arr[hash(seed)[0] % arr.length]

export interface Resolved { name: string; sandbox: true }

export const bankProvider = {
  id: 'sandbox-bank',
  label: 'Sandbox bank network (simulated)',
  resolveAccount(bankCode: string, accountNumber: string): Resolved | null {
    if (!BANKS.some((b) => b.code === bankCode) || !/^\d{10}$/.test(accountNumber)) return null
    if (accountNumber.endsWith('0000')) return null
    return { name: pick(NAMES, `${bankCode}:${accountNumber}`), sandbox: true }
  },
  transfer(reference: string, bankCode: string, accountNumber: string): { ok: boolean; providerRef?: string; reason?: string } {
    if (accountNumber.endsWith('9999')) return { ok: false, reason: 'The beneficiary bank rejected the transfer (sandbox failure test).' }
    return { ok: true, providerRef: `SBX-BANK-${hash(reference + bankCode + accountNumber).toString('hex').slice(0, 12).toUpperCase()}` }
  },
}

export const billProvider = {
  id: 'sandbox-bills',
  label: 'Sandbox bill provider (simulated)',
  validate(category: string, provider: string, ref: string): { name: string; detail?: string } | null {
    if (!ref || ref.endsWith('0000')) return null
    const name = pick(NAMES, `${category}:${provider}:${ref}`)
    const detail = category === 'electricity' ? `${pick(['12 Adeola Odeku Street', '5 Ahmadu Bello Way', '24 Okpara Avenue', '9 Aminu Kano Crescent'], ref)} (sandbox address)` : undefined
    return { name, detail }
  },
  purchase(reference: string, category: string, provider: string, ref: string, amountKobo: bigint, variant?: string): { ok: boolean; providerRef?: string; reason?: string; token?: string; units?: string } {
    if (ref.endsWith('9999')) return { ok: false, reason: 'The provider could not complete this payment (sandbox failure test).' }
    const providerRef = `SBX-BILL-${hash(reference + ref).toString('hex').slice(0, 12).toUpperCase()}`
    if (category === 'electricity' && variant === 'prepaid') {
      const digits = Array.from(hash(`token:${reference}`)).map((b) => b % 10).join('').slice(0, 20)
      const units = (Number(amountKobo) / 100 / 68).toFixed(1) // illustrative sandbox tariff
      return { ok: true, providerRef, token: digits.match(/.{4}/g)?.join('-'), units }
    }
    if (category === 'education') {
      const pin = Array.from(hash(`pin:${reference}`)).map((b) => b % 10).join('').slice(0, 12)
      return { ok: true, providerRef, token: pin.match(/.{4}/g)?.join('-') }
    }
    return { ok: true, providerRef }
  },
}
