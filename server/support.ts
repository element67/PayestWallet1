/**
 * Help and support. The channels are configured by the operator in the environment, so nothing here is invented:
 * a channel that is not configured is reported as null and the app shows it as not set up yet.
 *   SUPPORT_AI_URL        https address of the AI support agent (for example a hosted chat page)
 *   SUPPORT_TELEGRAM_URL  https address of the official Telegram community (https://t.me/...)
 *   SUPPORT_EMAIL         address that receives support mail
 */
import { route } from './http'

const httpsUrl = (v: string | undefined, hosts?: RegExp): string | null => {
  if (!v) return null
  try {
    const u = new URL(v.trim())
    if (u.protocol !== 'https:' || u.username || u.password) return null
    if (hosts && !hosts.test(u.hostname)) return null
    return u.toString()
  } catch {
    return null
  }
}
const emailAddr = (v: string | undefined): string | null => (v && /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/.test(v.trim()) ? v.trim() : null)

export const FAQS: { q: string; a: string }[] = [
  { q: 'Is this real money?', a: 'No. Payest Wallet runs in sandbox mode: Naira payouts, vault releases and non-Arc chains are simulated. USDC on Arc Testnet is the one live chain.' },
  { q: 'How do I add funds to test?', a: 'Use the Get test USDC button in the Arc Studio sidebar, or ask the founder for a Test credit.' },
  { q: 'Where is my transaction PIN?', a: 'More, Settings, Security. You set it once and use it for Naira payments, transfers and buys.' },
  { q: 'How do I scan a payment QR code?', a: 'Tap the scan icon at the top of the screen and point the camera at a wallet address QR code. You land on Send with the address filled in, and you still review and confirm the payment yourself.' },
  { q: 'How do I change my picture or details?', a: 'Tap your picture at the top of the screen, or open More, Profile. You can upload or change your picture and edit your name, email and phone.' },
  { q: 'How do I make the letters bigger?', a: 'More, Settings, Display, Text size. Pick Small, Medium, Large or Extra large. It is saved to your account.' },
  { q: 'How do I sign out?', a: 'More, Settings, Logout. You are asked to confirm first.' },
]

export function supportChannels() {
  return {
    ai: httpsUrl(process.env.SUPPORT_AI_URL),
    telegram: httpsUrl(process.env.SUPPORT_TELEGRAM_URL, /^(t\.me|telegram\.me|telegram\.org)$/i),
    email: emailAddr(process.env.SUPPORT_EMAIL),
  }
}

route('GET', '/api/support', 'user', () => ({ channels: supportChannels(), faqs: FAQS }), [60, 60_000])
