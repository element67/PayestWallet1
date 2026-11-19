/**
 * USDC a user holds on networks the wallet has no balance list for (HyperEVM, Monad, Linea and the other bridge networks).
 * The wallet's own balances only cover the networks it has assets on, so USDC bridged anywhere else was onchain but invisible.
 */
import { getAssetDef } from '../wallet/networks'
import { fromUnits } from '../money'
import { tokenBalance, tokensFor, tradeChains } from './chains'
import { tradeMode } from './config'
import type { Who } from './types'

export interface Holding { chain: string; name: string; family: string; raw: string; amount: string }

const cache = new Map<string, { at: number; list: Holding[] }>()
const TTL = 20_000

/** Never throws: a network whose endpoint is down is left out of the list rather than failing the whole screen. */
export async function bridgedHoldings(who: Who): Promise<Holding[]> {
  const mode = await tradeMode()
  const key = `${who.userId}:${mode}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit.list
  const chains = tradeChains(mode).filter((c) => !getAssetDef(`USDC@${c.id}`))
  const out = await Promise.all(chains.map(async (c): Promise<Holding | null> => {
    const usdc = tokensFor(c, 'bridge')[0]
    try {
      const raw = await Promise.race([tokenBalance(c, usdc, who), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000))])
      return raw && raw > 0n ? { chain: c.id, name: c.name, family: c.family, raw: raw.toString(), amount: fromUnits(raw, 6) } : null
    } catch { return null }
  }))
  const list = out.filter((h): h is Holding => h !== null)
  cache.set(key, { at: Date.now(), list })
  return list
}

export const forgetHoldings = (userId: string) => { for (const k of cache.keys()) if (k.startsWith(`${userId}:`)) cache.delete(k) }
