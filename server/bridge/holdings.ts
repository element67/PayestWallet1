/**
 * USDC a user holds on the test networks they have bridged to that the wallet does not list as an asset (HyperEVM, Monad,
 * Linea, Unichain and the rest). The wallet's own balances only cover the networks it has assets on, so USDC bridged anywhere
 * else was on chain but invisible. Reading it here shows it, and the Bridge screen sends it back.
 */
import { route } from '../http'
import { ensureWallet } from '../wallet/keys'
import { getAssetDef } from '../wallet/networks'
import { bridgeChains, usdcBalance, type BridgeChain } from './chains'

export interface Holding { chain: string; name: string; family: string; raw: string; amount: string }

const fmt = (raw: bigint) => {
  const s = raw.toString().padStart(7, '0')
  const whole = s.slice(0, -6)
  const frac = s.slice(-6).replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : whole
}

const cache = new Map<string, { at: number; list: Holding[] }>()
const TTL = 20_000

/** Never throws: a chain whose endpoint is down is left out of the list rather than failing the whole screen. */
export async function bridgedHoldings(userId: string): Promise<Holding[]> {
  const hit = cache.get(userId)
  if (hit && Date.now() - hit.at < TTL) return hit.list
  const addrs = await ensureWallet(userId)
  const chains = bridgeChains().filter((c: BridgeChain) => !getAssetDef(`USDC@${c.id}`))
  const out = await Promise.all(chains.map(async (c): Promise<Holding | null> => {
    const address = c.family === 'solana' ? addrs.solana : addrs.evm
    try {
      const raw = await Promise.race([usdcBalance(c, address), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000))])
      return raw > 0n ? { chain: c.id, name: c.name, family: c.family, raw: raw.toString(), amount: fmt(raw) } : null
    } catch {
      return null
    }
  }))
  const list = out.filter((h): h is Holding => h !== null)
  cache.set(userId, { at: Date.now(), list })
  return list
}

/** Called when a bridge finishes so the new balance shows at once. */
export const forgetHoldings = (userId: string) => void cache.delete(userId)

route('GET', '/api/bridge/holdings', 'user', async (c) => ({ holdings: await bridgedHoldings(c.user.id) }), [30, 60_000])
