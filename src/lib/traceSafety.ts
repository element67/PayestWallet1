/**
 * Safety rules for the preview telemetry (src/tracing.ts, src/console-capture.ts). Telemetry may only ever be posted to
 * a parent window that is verified against an allowlist, and request and response bodies are scrubbed of secrets first.
 */

/** Origins that may receive telemetry: Arc Studio itself, plus any extra origins listed (comma separated) in `extra`. */
export function isTrustedParent(origin: string | null | undefined, extra = ''): boolean {
  if (!origin) return false
  let u: URL
  try {
    u = new URL(origin)
  } catch {
    return false
  }
  if (u.origin !== origin) return false
  const listed = extra.split(',').map((s) => s.trim()).filter(Boolean)
  if (listed.includes(origin)) return true
  return u.protocol === 'https:' && (u.hostname === 'studio.arc.io' || u.hostname.endsWith('.studio.arc.io'))
}

const SENSITIVE_KEY = /^(password|currentpassword|newpassword|pin|currentpin|newpin|otp|code|token|accesstoken|refreshtoken|devicetoken|usertoken|sessiontoken|authorization|cookie|setcookie|secret|apikey|privatekey|mnemonic|seedphrase|seed|signature)$|password|secret|mnemonic|private.?key|token$/i

export const REDACTED = '[redacted]'

/** Deep copy with the value of every sensitive key replaced. Strings that look like JSON are parsed and scrubbed too. */
export function redactSensitive(value: unknown, depth = 0): unknown {
  if (depth > 8) return REDACTED
  if (typeof value === 'string') {
    const t = value.trim()
    if (t.startsWith('{') || t.startsWith('[')) {
      try {
        return redactSensitive(JSON.parse(t), depth + 1)
      } catch {
        /* not JSON: fall through to text scrubbing */
      }
    }
    return redactText(value)
  }
  if (Array.isArray(value)) return value.map((v) => redactSensitive(v, depth + 1))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redactSensitive(v, depth + 1)
    return out
  }
  return value
}

/** Scrubs bearer tokens and "password=..." style pairs from free text. */
export function redactText(s: string): string {
  return s
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, `$1${REDACTED}`)
    .replace(/((?:password|pin|token|secret|authorization)["']?\s*[:=]\s*["']?)[^"'\s,&}]+/gi, `$1${REDACTED}`)
}

/** Endpoints whose bodies are never sent, whatever they contain. */
const PRIVATE_PATH = /\/api\/(auth|naira\/pin|wallet\/seed)|\/pin(\/|$|\?)/i

export const isPrivatePath = (url: string): boolean => PRIVATE_PATH.test(url)
