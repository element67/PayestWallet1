import type { Intent } from './nav'

/**
 * What a scanned payment QR code means in this app. Wallet receive codes carry a plain chain address, optionally inside a
 * payment link such as ethereum:0x... or bitcoin:bc1...?amount=1. Both end up on the existing Send screen with the address
 * filled in; nothing is paid until the user reviews and confirms there.
 */
export type ScanResult =
  | { kind: 'crypto'; family: 'evm' | 'solana' | 'bitcoin'; address: string }
  | { kind: 'unknown'; text: string }

const EVM = /^0x[0-9a-fA-F]{40}$/
const BTC = /^(?:bc1|tb1)[02-9ac-hj-np-z]{11,87}$|^[mn2][1-9A-HJ-NP-Za-km-z]{25,34}$|^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/
const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

export function parseScan(raw: string): ScanResult {
  const text = raw.trim()
  let body = text
  const link = /^([a-z][a-z0-9+.-]{1,20}):(?:\/\/)?(?:pay-)?(.+)$/i.exec(text)
  if (link && ['ethereum', 'bitcoin', 'solana'].includes(link[1].toLowerCase())) body = link[2]
  // Drop payment-link parameters and any chain id suffix (0xabc@5042).
  const address = body.split(/[?&#]/)[0].split('@')[0]
  if (EVM.test(address)) return { kind: 'crypto', family: 'evm', address }
  if (BTC.test(address)) return { kind: 'crypto', family: 'bitcoin', address }
  if (SOL.test(address)) return { kind: 'crypto', family: 'solana', address }
  return { kind: 'unknown', text: text.slice(0, 120) }
}

export const scanIntent = (r: Extract<ScanResult, { kind: 'crypto' }>): Intent => ({ screen: 'send', address: r.address })
