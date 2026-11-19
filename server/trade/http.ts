/** Calls to provider APIs: a timeout on every request, plain-words errors, and the key never written to an error or a log. */
import { HttpError } from '../auth'

export async function providerJson<T>(name: string, url: string, init: RequestInit = {}, timeoutMs = 12_000): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
  } catch {
    throw new HttpError(504, `${name} did not answer in time`)
  }
  const text = await res.text()
  let data: unknown = null
  try { data = text ? JSON.parse(text) : null } catch { /* a non-JSON answer is handled below */ }
  if (!res.ok) {
    const d = data as { message?: string; error?: string | { message?: string }; code?: string } | null
    const why = typeof d?.message === 'string' ? d.message : typeof d?.error === 'string' ? d.error : d?.error && typeof d.error === 'object' && typeof d.error.message === 'string' ? d.error.message : `HTTP ${res.status}`
    throw new HttpError(res.status === 429 ? 429 : 502, `${name}: ${String(why).slice(0, 200)}`)
  }
  if (data === null) throw new HttpError(502, `${name} returned an empty answer`)
  return data as T
}
