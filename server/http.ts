/** Minimal router: auth, RBAC, rate limiting, body limits, validation errors, uniform JSON. */
import { ZodError, type ZodType } from 'zod'
import { HttpError, userFromToken, type User } from './auth'
import { InsufficientFunds } from './ledger'
import { MoneyError } from './money'
import { rateLimit } from './security'
import { alert, audit } from './db'

export interface Ctx {
  req: Request
  url: URL
  params: Record<string, string>
  user: User
  token: string
  ip: string
  raw: string
}
type Access = 'public' | 'user' | 'founder'
interface Route {
  method: string
  re: RegExp
  keys: string[]
  access: Access
  limit: [number, number]
  handler: (c: Ctx) => unknown | Promise<unknown>
}

const routes: Route[] = []
const MAX_BODY = 64 * 1024

export function route(method: string, path: string, access: Access, handler: Route['handler'], limit: [number, number] = [120, 60_000]) {
  const keys: string[] = []
  const re = new RegExp(`^${path.replace(/:(\w+)/g, (_, k: string) => (keys.push(k), '([^/]+)'))}$`)
  routes.push({ method, re, keys, access, limit, handler })
}

export function body<T>(c: Ctx, schema: ZodType<T>): T {
  let json: unknown = {}
  if (c.raw) {
    try {
      json = JSON.parse(c.raw)
    } catch {
      throw new HttpError(400, 'Request body must be valid JSON')
    }
  }
  return schema.parse(json)
}

const SECURITY_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
}

const json = (status: number, data: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { ...SECURITY_HEADERS, ...extra } })

/** Failed and unauthorized requests are written to the audit log, at most once a minute per caller, path and status. */
const deniedSeen = new Map<string, number>()
function logDenied(status: number, path: string, ip: string, userId: string | null, reason: string) {
  const key = `${userId ?? ip}|${path}|${status}`
  const t = Date.now()
  if ((deniedSeen.get(key) ?? 0) > t - 60_000) return
  if (deniedSeen.size > 5000) deniedSeen.clear()
  deniedSeen.set(key, t)
  audit(userId, 'security.request_denied', `${status} ${path}`, undefined, { ip, reason })
}

export async function handle(req: Request, ip: string): Promise<Response> {
  const url = new URL(req.url)
  let who: string | null = null
  try {
    for (const r of routes) {
      if (r.method !== req.method) continue
      const m = r.re.exec(url.pathname)
      if (!m) continue
      // Coarse per-IP bucket first (cheap, before any database work), then a per-user bucket per route.
      const ipCap = rateLimit(`ip:${ip}`, 900, 60_000)
      if (!ipCap.ok) return json(429, { error: 'Too many requests. Slow down.' }, { 'retry-after': String(ipCap.retryAfterSec) })
      const auth = req.headers.get('authorization')
      const token = auth?.startsWith('Bearer ') ? auth.slice(7) : ''
      const user = userFromToken(token)
      who = user?.id ?? null
      const rl = rateLimit(`${user?.id ?? ip}:${r.method}:${r.re.source}`, r.limit[0], r.limit[1])
      if (!rl.ok) {
        logDenied(429, url.pathname, ip, who, 'rate limit')
        return json(429, { error: 'Too many requests. Slow down.' }, { 'retry-after': String(rl.retryAfterSec) })
      }
      if (r.access !== 'public' && !user) {
        logDenied(401, url.pathname, ip, null, token ? 'invalid or expired session' : 'no session')
        return json(401, { error: 'Sign in required' })
      }
      if (r.access === 'founder' && user?.role !== 'founder') {
        alert('warning', 'rbac', 'Blocked non-founder admin access', `${url.pathname} by ${user?.email}`, user?.id)
        logDenied(403, url.pathname, ip, who, 'not a founder')
        return json(403, { error: 'Founder access required' })
      }
      const raw = req.method === 'GET' || req.method === 'DELETE' ? '' : await req.text()
      if (raw.length > MAX_BODY) return json(413, { error: 'Request too large' })
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]))
      const out = await r.handler({ req, url, params, user: user as User, token, ip, raw })
      return out instanceof Response ? out : json(200, out ?? { ok: true })
    }
    return json(404, { error: 'Not found' })
  } catch (e) {
    if (e instanceof HttpError) {
      if (who && [403, 404, 423].includes(e.status)) logDenied(e.status, url.pathname, ip, who, e.message)
      return json(e.status, { error: e.message, ...e.extra })
    }
    if (e instanceof ZodError) return json(400, { error: e.issues[0]?.message ?? 'Invalid request', field: e.issues[0]?.path.join('.') })
    if (e instanceof MoneyError) return json(400, { error: e.message })
    if (e instanceof InsufficientFunds) return json(400, { error: e.message })
    console.error('[api] unhandled', url.pathname, e instanceof Error ? e.stack : e)
    return json(500, { error: 'Something went wrong on our side' })
  }
}
