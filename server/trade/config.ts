/**
 * Settings and keys for the trade module. Keys come from the environment and are read only here, on the server; nothing in this
 * file is ever sent to the browser except yes/no flags saying whether a provider is configured.
 */
import { getAddress, isAddress } from 'viem'
import { all, run, setting } from '../db'
import type { Mode, ProviderId } from './types'

export const MAX_FEE_BPS = 100
export const DEFAULT_SLIPPAGE_BPS = 50
export const MAX_SLIPPAGE_BPS = 300
export const MIN_SLIPPAGE_BPS = 10

/**
 * ENABLE_MAINNET_INTEGRATIONS (default false). While it is not "true", swaps in the trade module are off for every provider (swap screens use Uniswap),
 * and LI.FI and AchSwap are off for bridges too. Circle bridging is unaffected. All of that code stays in place.
 */
export const mainnetIntegrationsEnabled = () => process.env.ENABLE_MAINNET_INTEGRATIONS === 'true'

export const tradeMode = async (): Promise<Mode> => ((await setting('trade_network_mode')) === 'mainnet' ? 'mainnet' : 'testnet')

/** The service fee in basis points and where it is paid. The fee is zero until a valid fee wallet is set. */
export async function tradeFee(): Promise<{ bps: number; wallet: string | null }> {
  const raw = Number(await setting('trade_fee_bps'))
  const wallet = (await setting('trade_fee_wallet')).trim()
  const bps = Number.isInteger(raw) && raw > 0 ? Math.min(raw, MAX_FEE_BPS) : 0
  return isAddress(wallet) && bps > 0 ? { bps, wallet: getAddress(wallet) } : { bps: 0, wallet: null }
}

export async function readTradeSettings() {
  return { mode: await tradeMode(), feeBps: Math.min(Math.max(Number(await setting('trade_fee_bps')) || 0, 0), MAX_FEE_BPS), feeWallet: (await setting('trade_fee_wallet')).trim() }
}

async function put(key: string, value: string) {
  await run('INSERT INTO settings(key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, value)
}
export const saveTradeMode = (m: Mode) => put('trade_network_mode', m)
export const saveTradeFee = async (bps: number, wallet: string) => { await put('trade_fee_bps', String(bps)); await put('trade_fee_wallet', wallet) }
export const listSettingKeys = async () => (await all<{ key: string }>("SELECT key FROM settings WHERE key LIKE 'trade_%'")).map((r) => r.key)

/** Provider keys. KIT_KEY and LIFI_API_KEY are optional; the AchSwap key is required for AchSwap. */
export const providerKey = (p: ProviderId): string | undefined => {
  const v = p === 'circle' ? process.env.KIT_KEY : p === 'lifi' ? process.env.LIFI_API_KEY : process.env.ACHSWAP_API_KEY
  return v && v.trim() ? v.trim() : undefined
}

/** Which providers are set up, as yes/no only. */
export const providerStatus = (): Record<ProviderId, { configured: boolean; keyed: boolean }> => ({
  circle: { configured: true, keyed: Boolean(providerKey('circle')) },
  lifi: { configured: true, keyed: Boolean(providerKey('lifi')) },
  achswap: { configured: Boolean(providerKey('achswap')), keyed: Boolean(providerKey('achswap')) },
})

/** Contract addresses LI.FI transactions may target, from LIFI_ALLOWED_TARGETS (comma separated). Empty means LI.FI cannot execute. */
export const lifiAllowedTargets = (): string[] => (process.env.LIFI_ALLOWED_TARGETS ?? '').split(',').map((a) => a.trim()).filter((a) => isAddress(a)).map((a) => a.toLowerCase())
export const lifiIntegrator = () => (process.env.LIFI_INTEGRATOR ?? 'nairabridge').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'nairabridge'
