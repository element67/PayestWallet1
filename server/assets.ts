/** Asset registry, seed data and quote pricing. Rates are founder-configured, integer kobo per whole unit. */
import { CONFIG } from './config'
import { all, get, now, run, setting, settingBig, settingNum, uid } from './db'
import { MoneyError, ceilDiv, fromUnits, toUnits } from './money'
import { post } from './ledger'

export interface Asset {
  symbol: string
  name: string
  chain: string
  kind: string
  contract: string | null
  decimals: number
  enabled: number
  monitoring: 'live' | 'simulated'
  buy_rate_kobo: string
  sell_rate_kobo: string
  min_ngn_kobo: string
  max_ngn_kobo: string
  rate_version: number
  rate_source: string
  updated_at: number
}

const NGN = (n: number) => String(BigInt(n) * 100n)

/** Seed assets. Rates are PLACEHOLDERS (not market data): the founder must set real rates. */
export async function seedAssets() {
  const t = now()
  const rows: Array<[string, string, string, string, string | null, number, string, number, number, number, number]> = [
    ['USDC', 'USD Coin', 'arc-testnet', 'erc20', CONFIG.arc.usdcAddress, CONFIG.arc.usdcDecimals, 'live', 1520, 1480, 1_000, 5_000_000],
    ['USDT', 'Tether USD', 'ethereum-sepolia', 'erc20', null, 6, 'simulated', 1525, 1478, 1_000, 5_000_000],
    ['BTC', 'Bitcoin', 'bitcoin-testnet', 'native', null, 8, 'simulated', 150_000_000, 148_000_000, 5_000, 20_000_000],
    ['SOL', 'Solana', 'solana-devnet', 'native', null, 9, 'simulated', 230_000, 226_000, 1_000, 10_000_000],
  ]
  for (const [symbol, name, chain, kind, contract, decimals, monitoring, buy, sell, min, max] of rows) {
    await run(
      `INSERT OR IGNORE INTO assets(symbol,name,chain,kind,contract,decimals,enabled,monitoring,buy_rate_kobo,sell_rate_kobo,min_ngn_kobo,max_ngn_kobo,updated_at)
       VALUES (?,?,?,?,?,?,1,?,?,?,?,?,?)`,
      symbol, name, chain, kind, contract, decimals, monitoring, NGN(buy), NGN(sell), NGN(min), NGN(max), t,
    )
  }
  // Sandbox platform liquidity (clearly simulated).
  const liq: Record<string, bigint> = { NGN: 5_000_000_000n, USDC: 20_000_000_000n, USDT: 20_000_000_000n, BTC: 200_000_000n, SOL: 500_000_000_000n }
  for (const [asset, amt] of Object.entries(liq)) await post({ owner: 'house', asset, delta: amt, reason: 'sandbox liquidity seed', idem: `seed:house:${asset}` })
}

export const listAssets = async () => await all<Asset>('SELECT * FROM assets ORDER BY symbol')
export const getAsset = async (symbol: string) => await get<Asset>('SELECT * FROM assets WHERE symbol=?', symbol)

export interface Pricing {
  side: 'sell' | 'buy'
  asset: Asset
  cryptoUnits: bigint
  grossKobo: bigint
  feeKobo: bigint
  netKobo: bigint
  rateKobo: bigint
  feeBps: number
  /** Founder-set gas fee for the asset's chain, already included in feeKobo. */
  gasKobo: bigint
}

/**
 * sell (crypto -> NGN): user gives crypto, gets gross - fee in NGN at the sell rate.
 * buy  (NGN -> crypto): user pays gross NGN, fee is taken from it, crypto = (gross - fee) / buy rate.
 */
/** Founder-configured gas fee (NGN) for a chain, in kobo. Missing or invalid values count as zero. */
export async function gasFeeKobo(chain: string): Promise<bigint> {
  try {
    const v = (JSON.parse(await setting('gas_fee_ngn') || '{}') as Record<string, string>)[chain]
    return v ? toUnits(v, 2) : 0n
  } catch {
    return 0n
  }
}

/**
 * `byCrypto` applies to the buy direction only: `amount` is then the crypto the user wants to receive and the Naira to pay is worked out
 * (fee and gas included), rounded up so the quote never delivers less than the amount asked for.
 */
export async function price(side: 'sell' | 'buy', symbol: string, amount: string, byCrypto = false): Promise<Pricing> {
  const asset = await getAsset(symbol)
  if (!asset || !asset.enabled) throw new MoneyError('Asset is not available')
  if (await setting('platform_paused') === 'true') throw new MoneyError('Trading is temporarily paused')
  const feeBps = await settingNum('fee_bps')
  const unit = 10n ** BigInt(asset.decimals)
  const gasKobo = await gasFeeKobo(asset.chain)
  let cryptoUnits: bigint, grossKobo: bigint, feeKobo: bigint, netKobo: bigint, rateKobo: bigint
  if (side === 'sell') {
    rateKobo = BigInt(asset.sell_rate_kobo)
    cryptoUnits = toUnits(amount, asset.decimals)
    grossKobo = (cryptoUnits * rateKobo) / unit
    feeKobo = ceilDiv(grossKobo * BigInt(feeBps), 10_000n) + gasKobo
    netKobo = grossKobo - feeKobo
  } else {
    rateKobo = BigInt(asset.buy_rate_kobo)
    if (byCrypto) {
      if (rateKobo <= 0n) throw new MoneyError('Rate not configured')
      if (feeBps >= 10_000) throw new MoneyError('Fees are not configured correctly')
      const target = toUnits(amount, asset.decimals)
      const needNet = ceilDiv(target * rateKobo, unit)
      grossKobo = ceilDiv((needNet + gasKobo) * 10_000n, 10_000n - BigInt(feeBps))
      feeKobo = ceilDiv(grossKobo * BigInt(feeBps), 10_000n) + gasKobo
      netKobo = grossKobo - feeKobo
      while (netKobo < needNet) { grossKobo += 1n; feeKobo = ceilDiv(grossKobo * BigInt(feeBps), 10_000n) + gasKobo; netKobo = grossKobo - feeKobo }
      cryptoUnits = (netKobo * unit) / rateKobo
    } else {
      grossKobo = toUnits(amount, 2)
      feeKobo = ceilDiv(grossKobo * BigInt(feeBps), 10_000n) + gasKobo
      netKobo = grossKobo - feeKobo
      cryptoUnits = (netKobo * unit) / rateKobo
    }
  }
  if (rateKobo <= 0n) throw new MoneyError('Rate not configured')
  if (cryptoUnits <= 0n || netKobo <= 0n) throw new MoneyError('Amount too small')
  if (grossKobo < BigInt(asset.min_ngn_kobo)) throw new MoneyError(`Minimum is NGN ${fromUnits(BigInt(asset.min_ngn_kobo), 2)} equivalent`)
  if (grossKobo > BigInt(asset.max_ngn_kobo)) throw new MoneyError(`Maximum is NGN ${fromUnits(BigInt(asset.max_ngn_kobo), 2)} equivalent`)
  return { side, asset, cryptoUnits, grossKobo, feeKobo, netKobo, rateKobo, feeBps, gasKobo }
}

export async function createQuote(userId: string, p: Pricing) {
  const id = uid('q')
  const expires = now() + await settingNum('quote_ttl_sec') * 1000
  await run(
    `INSERT INTO quotes(id,user_id,side,asset,crypto_amount,gross_kobo,fee_kobo,net_kobo,rate_kobo,rate_version,fee_bps,expires_at,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, userId, p.side, p.asset.symbol, p.cryptoUnits.toString(), p.grossKobo.toString(), p.feeKobo.toString(), p.netKobo.toString(),
    p.rateKobo.toString(), p.asset.rate_version, p.feeBps, expires, now(),
  )
  return { id, expiresAt: expires }
}

/**
 * One shared 24h volume for the KYC tier limit: exchange orders, crypto swaps and withdrawals all count,
 * so splitting activity across endpoints cannot multiply a user's limit.
 */
export async function dailyVolumeKobo(userId: string): Promise<bigint> {
  const since = now() - 86_400_000
  const sum = (rows: { v: string }[]) => rows.reduce((s, r) => s + BigInt(r.v), 0n)
  return (
    sum(await all<{ v: string }>("SELECT gross_kobo AS v FROM orders WHERE user_id=? AND created_at>? AND status NOT IN ('expired','cancelled','failed','rejected')", userId, since)) +
    sum(await all<{ v: string }>("SELECT value_kobo AS v FROM crypto_ops WHERE user_id=? AND kind='swap' AND status!='failed' AND created_at>?", userId, since)) +
    sum(await all<{ v: string }>("SELECT value_kobo AS v FROM withdrawals WHERE user_id=? AND status<>'failed' AND created_at>?", userId, since))
  )
}

export const instantLimitKobo = async () => await settingBig('instant_payout_limit_kobo')
export const countAssetsDb = async () => (await get<{ c: number }>('SELECT COUNT(*) c FROM assets')) ?? { c: 0 }
