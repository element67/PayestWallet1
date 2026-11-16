/**
 * Confirmation rules shared by every route that creates an exchange order (/api/orders, buy, sell and both P2P directions),
 * so a rule can never be skipped by choosing a different endpoint.
 *
 * - Paying from the Naira wallet: wallet must not be frozen, and the transaction PIN is required.
 * - Money or crypto leaving the platform (a buy sent to an external address, or a sell paid out to a bank account):
 *   the PIN is required even when the order is funded another way.
 * - Large orders (at or above the founder's large-order flag): the PIN, KYC tier 2 and an account at least a day old.
 */
import { HttpError, type User } from './auth'
import { get, now, setting } from './db'
import { fromUnits } from './money'
import { assertOperational, verifyPin } from './naira/wallet'

export interface OrderConfirmInput { quoteId: string; funding?: 'wallet' | 'bank_transfer'; payoutType?: 'bank' | 'wallet'; destAddress?: string; pin?: string }

export async function assertOrderConfirmed(user: User, input: OrderConfirmInput, idemKey: string): Promise<void> {
  if (await get('SELECT 1 FROM orders WHERE user_id=? AND idem_key=?', user.id, idemKey)) return // a replay creates nothing new
  const q = await get<{ side: string; gross_kobo: string }>('SELECT side, gross_kobo FROM quotes WHERE id=? AND user_id=?', input.quoteId, user.id)
  if (!q) return // the order engine reports an unknown or expired quote
  const walletFunded = q.side === 'buy' && (input.funding ?? 'wallet') === 'wallet'
  const external = (q.side === 'buy' && Boolean(input.destAddress)) || (q.side === 'sell' && input.payoutType === 'bank')
  const threshold = BigInt(await setting('large_flag_kobo'))
  const large = BigInt(q.gross_kobo) >= threshold

  if (walletFunded) await assertOperational(user.id)
  if (walletFunded || external || large) await verifyPin(user.id, input.pin)
  if (large && !user.dev_preview) {
    if (user.kyc_tier < 2) throw new HttpError(403, `Orders of NGN ${fromUnits(threshold, 2)} or more need KYC tier 2.`, { code: 'KYC_REQUIRED' })
    if (now() - user.created_at < 86_400_000) throw new HttpError(403, `Orders of NGN ${fromUnits(threshold, 2)} or more open 24 hours after you create your account.`, { code: 'ACCOUNT_TOO_NEW' })
  }
}
