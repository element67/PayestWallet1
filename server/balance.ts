/**
 * Balance summary for the Home card. Every conversion happens here, in whole-kobo / whole-cent integer math,
 * using the exchange rate the founder set. The app only displays what this returns.
 */
import { z } from 'zod'
import { HttpError } from './auth'
import { all, audit, get, run } from './db'
import { body, route } from './http'
import { balancesFor } from './ledger'
import { fromUnits } from './money'
import { ensureNairaWallet } from './naira/wallet'
import { ensureWallet } from './wallet/keys'
import { assetRows, needsSync, portfolio, syncUser } from './wallet/service'

/** NGN per 1 USD, in kobo: the founder-set USDC rate, the same rate the exchange and swap use. */
export function ngnPerUsdKobo(): { rateKobo: bigint; updatedAt: number } {
  const r = get<{ sell_rate_kobo: string; updated_at: number }>("SELECT sell_rate_kobo, updated_at FROM assets WHERE symbol='USDC'")
  const rate = r ? BigInt(r.sell_rate_kobo) : 0n
  if (rate <= 0n) throw new HttpError(503, 'The USD rate is not set yet. Please try again shortly.')
  return { rateKobo: rate, updatedAt: r?.updated_at ?? 0 }
}

/** On-chain testnet holdings and sandbox exchange balances, valued in kobo at the founder's sell rates. Kept apart. */
export function cryptoTotals(userId: string) {
  let onchain = 0n
  for (const r of assetRows(userId)) if (r.balance !== null && Number(r.balance) > 0) onchain += r.valueKobo ?? 0n
  const bal = balancesFor(userId)
  let sandbox = 0n
  for (const a of all<{ symbol: string; decimals: number; sell_rate_kobo: string }>('SELECT symbol, decimals, sell_rate_kobo FROM assets')) {
    const raw = bal[a.symbol] ?? 0n
    if (raw > 0n) sandbox += (raw * BigInt(a.sell_rate_kobo)) / 10n ** BigInt(a.decimals)
  }
  return { onchain, sandbox }
}

const usd = (kobo: bigint, rateKobo: bigint) => fromUnits((kobo * 100n) / rateKobo, 2)

route('GET', '/api/balance/summary', 'user', (c) => {
  const userId = c.user.id // only ever the signed-in user; no id is read from the request
  ensureWallet(userId)
  ensureNairaWallet(userId)
  if (needsSync(userId)) void syncUser(userId)
  const p = portfolio(userId)
  const { rateKobo, updatedAt } = ngnPerUsdKobo()
  const { onchain, sandbox } = cryptoTotals(userId)
  const total = onchain + sandbox
  return {
    crypto: {
      usd: usd(total, rateKobo), ngn: fromUnits(total, 2),
      testnet: { usd: usd(onchain, rateKobo), ngn: fromUnits(onchain, 2), label: 'Testnet, onchain' },
      sandbox: { usd: usd(sandbox, rateKobo), ngn: fromUnits(sandbox, 2), label: 'Sandbox exchange balances' },
      includesSandbox: sandbox > 0n,
      unpricedSymbols: p.unpricedSymbols, syncing: p.syncing, syncedAt: p.syncedAt,
    },
    naira: { balance: fromUnits(balancesFor(userId).NGN ?? 0n, 2), currency: 'NGN', label: 'Sandbox funds' },
    rate: { ngnPerUsd: fromUnits(rateKobo, 2), source: 'USDC rate set by NairaBridge', updatedAt },
    preference: { cryptoCurrency: c.user.display_currency === 'NGN' ? 'NGN' : 'USD' },
    asOf: Date.now(),
  }
}, [60, 60_000])

route('PUT', '/api/me/preferences', 'user', (c) => {
  const b = body(c, z.object({ cryptoCurrency: z.enum(['USD', 'NGN']) }))
  run('UPDATE users SET display_currency=? WHERE id=?', b.cryptoCurrency, c.user.id)
  audit(c.user.id, 'user.preference', 'display_currency', { was: c.user.display_currency ?? 'USD' }, { now: b.cryptoCurrency })
  return { preference: { cryptoCurrency: b.cryptoCurrency } }
}, [30, 60_000])
