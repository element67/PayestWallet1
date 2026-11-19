/**
 * Chooses which provider handles a trade. Every provider that supports the route is asked for a quote at the same time; one that
 * fails, times out or does not support the route is skipped and never stops the others. The routing rules say which provider is
 * preferred; the quotes of the others are kept as alternatives, ordered by what the user would receive.
 */
import { HttpError } from '../auth'
import { scrub } from '../rpc'
import { mainnetIntegrationsEnabled } from './config'
import { achswap } from './providers/achswap'
import { circle } from './providers/circle'
import { lifi } from './providers/lifi'
import type { Mode, Provider, ProviderId, ProviderQuote, TradeRequest, Who } from './types'

export const PROVIDERS: Record<ProviderId, Provider> = { circle, lifi, achswap }
const STABLES = new Set(['USDC', 'EURC', 'CIRBTC', 'USDT', 'USDE', 'DAI', 'PYUSD'])
const isArc = (id: string) => id === 'arc' || id === 'arc-testnet'
export const QUOTE_TIMEOUT_MS = 15_000

/** The routing rules, as an order of preference. A provider earlier in the list wins whenever it can quote the route. */
export function preference(req: TradeRequest): ProviderId[] {
  if (req.kind === 'bridge') return req.tokenIn.symbol === 'USDC' || req.tokenIn.symbol === 'EURC' ? ['circle', 'lifi'] : ['lifi']
  if (isArc(req.from.id)) return STABLES.has(req.tokenIn.symbol) && STABLES.has(req.tokenOut.symbol) ? ['circle', 'achswap'] : ['achswap', 'circle']
  return ['lifi']
}

export interface Skipped { provider: ProviderId; name: string; reason: string }

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new HttpError(504, 'did not answer in time')), ms))])

export async function collectQuotes(req: TradeRequest, who: Who, mode: Mode, providers: Provider[] = Object.values(PROVIDERS)) {
  const skipped: Skipped[] = []
  const asked: Provider[] = []
  for (const p of providers) {
    const why = p.unsupported(req, mode)
    if (why) skipped.push({ provider: p.id, name: p.name, reason: why })
    else asked.push(p)
  }
  const settled = await Promise.allSettled(asked.map((p) => withTimeout(p.getQuote(req, who, mode), QUOTE_TIMEOUT_MS)))
  const quotes: ProviderQuote[] = []
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') quotes.push(s.value)
    else skipped.push({ provider: asked[i].id, name: asked[i].name, reason: s.reason instanceof HttpError ? s.reason.message : scrub(s.reason) })
  })
  return { quotes, skipped }
}

/** The recommended quote, and the others ordered by what the user would receive. Null when no provider could quote. */
export function pickBest(req: TradeRequest, quotes: ProviderQuote[]) {
  if (quotes.length === 0) return { best: null, alternatives: [] as ProviderQuote[] }
  const order = preference(req)
  const rank = (q: ProviderQuote) => { const i = order.indexOf(q.provider); return i === -1 ? order.length : i }
  const sorted = [...quotes].sort((a, b) => rank(a) - rank(b) || (b.amountOutRaw > a.amountOutRaw ? 1 : b.amountOutRaw < a.amountOutRaw ? -1 : 0))
  const [best, ...rest] = sorted
  return { best, alternatives: rest.sort((a, b) => (b.amountOutRaw > a.amountOutRaw ? 1 : b.amountOutRaw < a.amountOutRaw ? -1 : 0)) }
}

/** The providers allowed to run a request. While the mainnet-integrations flag is off, swaps are off for every provider here and LI.FI and AchSwap are off for bridges too. */
export function activeProviders(req: TradeRequest): Provider[] {
  if (mainnetIntegrationsEnabled()) return Object.values(PROVIDERS)
  return Object.values(PROVIDERS).filter((p) => req.kind === 'bridge' && p.id === 'circle')
}
