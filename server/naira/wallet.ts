/** Naira wallet account: virtual account number, transaction PIN, freeze state, daily limits and fraud flags. */
import { createHmac, randomInt } from 'node:crypto'
import { CONFIG } from '../config'
import { HttpError } from '../auth'
import { alert, audit, get, now, notify, run, setting } from '../db'
import { fromUnits } from '../money'
import { balanceOf } from '../ledger'
import { sha256 } from '../security'

export interface NairaWallet {
  user_id: string
  account_number: string
  status: 'active' | 'frozen'
  freeze_reason: string | null
  pin_hash: string | null
  pin_set_at: number | null
  pin_attempts: number
  pin_locked_until: number | null
  reset_otp_hash: string | null
  reset_otp_expires: number | null
  reset_otp_attempts: number
  created_at: number
}

export const BANK_NAME = 'Payest Wallet Sandbox MFB'
const MAX_PIN_ATTEMPTS = 5

/** Sandbox virtual account identifier. Not a funding method: all funding is crypto-to-Naira. */
async function newAccountNumber(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const n = `99${String(randomInt(0, 100_000_000)).padStart(8, '0')}`
    if (!await get('SELECT 1 FROM naira_wallets WHERE account_number=?', n)) return n
  }
  throw new Error('Could not allocate an account number')
}

export async function ensureNairaWallet(userId: string): Promise<NairaWallet> {
  const w = await get<NairaWallet>('SELECT * FROM naira_wallets WHERE user_id=?', userId)
  if (w) return w
  await run('INSERT OR IGNORE INTO naira_wallets(user_id, account_number, created_at) VALUES (?,?,?)', userId, await newAccountNumber(), now())
  await audit(userId, 'naira_wallet.create', userId)
  return await get<NairaWallet>('SELECT * FROM naira_wallets WHERE user_id=?', userId) as NairaWallet
}

/* ---------------- PIN ---------------- */

const pinMaterial = (userId: string, pin: string) => createHmac('sha256', CONFIG.encryptionKey).update(`${userId}:${pin}`).digest('hex')
const WEAK = new Set(['0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999', '1234', '4321', '0123', '3210', '1212', '2580'])

export function assertPinFormat(pin: unknown): asserts pin is string {
  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) throw new HttpError(400, 'PIN must be exactly 4 digits')
}

export async function setPin(userId: string, pin: string, currentPin?: string) {
  assertPinFormat(pin)
  if (WEAK.has(pin)) throw new HttpError(400, 'Choose a less obvious PIN (not repeated or sequential digits)')
  const w = await ensureNairaWallet(userId)
  if (w.pin_hash) {
    if (!currentPin) throw new HttpError(400, 'Enter your current PIN to change it')
    await verifyPin(userId, currentPin)
  }
  await run('UPDATE naira_wallets SET pin_hash=?, pin_set_at=?, pin_attempts=0, pin_locked_until=NULL WHERE user_id=?', Bun.password.hashSync(pinMaterial(userId, pin), { algorithm: 'argon2id' }), now(), userId)
  await audit(userId, w.pin_hash ? 'security.pin_changed' : 'security.pin_set', userId)
  await notify(userId, 'security', w.pin_hash ? 'Transaction PIN changed' : 'Transaction PIN created', 'If this was not you, freeze your wallet and contact support.')
}

/** Throws unless the PIN is right. Five wrong attempts lock all money movement. */
export async function verifyPin(userId: string, pin: unknown): Promise<void> {
  assertPinFormat(pin)
  const w = await ensureNairaWallet(userId)
  if (!w.pin_hash) throw new HttpError(428, 'Create a transaction PIN first', { code: 'PIN_REQUIRED' })
  if (w.pin_locked_until && w.pin_locked_until > now()) {
    throw new HttpError(423, `Too many wrong PIN attempts. Try again in ${Math.ceil((w.pin_locked_until - now()) / 60000)} minutes, or reset your PIN.`, { code: 'PIN_LOCKED', lockedUntil: w.pin_locked_until })
  }
  if (Bun.password.verifySync(pinMaterial(userId, pin), w.pin_hash)) {
    if (w.pin_attempts) await run('UPDATE naira_wallets SET pin_attempts=0, pin_locked_until=NULL WHERE user_id=?', userId)
    return
  }
  // Counted atomically in the database, so parallel wrong guesses cannot undercount.
  const bumped = await get<{ pin_attempts: number }>('UPDATE naira_wallets SET pin_attempts=pin_attempts+1 WHERE user_id=? RETURNING pin_attempts', userId)
  const attempts = bumped?.pin_attempts ?? w.pin_attempts + 1
  if (attempts >= MAX_PIN_ATTEMPTS) {
    const until = now() + Number(await setting('pin_lock_minutes') || 30) * 60_000
    await run('UPDATE naira_wallets SET pin_attempts=0, pin_locked_until=? WHERE user_id=?', until, userId)
    await audit(userId, 'security.pin_locked', userId)
    await alert('warning', 'pin_lockout', 'Transaction PIN locked after repeated failures', `User ${userId}`, userId)
    await notify(userId, 'security', 'Transaction PIN locked', 'Five wrong PIN attempts. Money movement is paused. Reset your PIN or wait for the lock to expire.')
    throw new HttpError(423, 'Too many wrong PIN attempts. Money movement is locked for a while.', { code: 'PIN_LOCKED', lockedUntil: until })
  }
  await audit(userId, 'security.pin_failed', userId, undefined, { attempts })
  throw new HttpError(401, `Wrong PIN. ${MAX_PIN_ATTEMPTS - attempts} attempt${MAX_PIN_ATTEMPTS - attempts === 1 ? '' : 's'} left.`, { code: 'PIN_WRONG', attemptsLeft: MAX_PIN_ATTEMPTS - attempts })
}

/** Reset: a one-time code is delivered through the notification channel (sandbox; a production build sends SMS or email). */
export async function requestPinReset(userId: string) {
  await ensureNairaWallet(userId)
  const otp = String(randomInt(0, 1_000_000)).padStart(6, '0')
  await run('UPDATE naira_wallets SET reset_otp_hash=?, reset_otp_expires=?, reset_otp_attempts=0 WHERE user_id=?', sha256(`${userId}:${otp}`), now() + 10 * 60_000, userId)
  await audit(userId, 'security.pin_reset_requested', userId)
  await notify(userId, 'security', 'PIN reset code (sandbox)', `Your one-time code is ${otp}. It expires in 10 minutes. In production this arrives by SMS or email.`)
}

export async function confirmPinReset(userId: string, otp: string, newPin: string) {
  assertPinFormat(newPin)
  if (WEAK.has(newPin)) throw new HttpError(400, 'Choose a less obvious PIN (not repeated or sequential digits)')
  const w = await ensureNairaWallet(userId)
  if (!w.reset_otp_hash || !w.reset_otp_expires || w.reset_otp_expires < now()) throw new HttpError(400, 'That code expired. Request a new one.')
  if (w.reset_otp_attempts >= 5) throw new HttpError(429, 'Too many wrong codes. Request a new one.')
  if (sha256(`${userId}:${otp.trim()}`) !== w.reset_otp_hash) {
    await run('UPDATE naira_wallets SET reset_otp_attempts=reset_otp_attempts+1 WHERE user_id=?', userId)
    throw new HttpError(400, 'Wrong code')
  }
  await run(
    'UPDATE naira_wallets SET pin_hash=?, pin_set_at=?, pin_attempts=0, pin_locked_until=NULL, reset_otp_hash=NULL, reset_otp_expires=NULL WHERE user_id=?',
    Bun.password.hashSync(pinMaterial(userId, newPin), { algorithm: 'argon2id' }), now(), userId,
  )
  await audit(userId, 'security.pin_reset', userId)
  await notify(userId, 'security', 'Transaction PIN reset', 'Your PIN was reset with a one-time code.')
}

/* ---------------- guards ---------------- */

export async function assertOperational(userId: string) {
  const w = await ensureNairaWallet(userId)
  if (w.status === 'frozen') throw new HttpError(403, 'Your wallet is frozen. Contact support.', { code: 'FROZEN' })
}

const DEBIT_TYPES = "('bank_transfer','internal_transfer','bill','flight','shopping')"

/** Rolling 24h total of money that left the wallet (amount + fee), excluding failed and reversed. */
export async function spentLast24h(userId: string): Promise<bigint> {
  const rows = await get<{ s: string }>(
    `SELECT COALESCE(SUM(CAST(amount_kobo AS INTEGER) + CAST(fee_kobo AS INTEGER)), 0) AS s FROM transactions
      WHERE user_id=? AND direction='debit' AND type IN ${DEBIT_TYPES} AND status NOT IN ('failed','reversed') AND created_at>?`,
    userId, now() - 86_400_000,
  )
  return BigInt(rows?.s ?? 0)
}

export async function dailyLimitKobo(): Promise<bigint> {
  return BigInt(await setting('daily_spend_limit_kobo'))
}

export async function assertWithinDailyLimit(userId: string, total: bigint) {
  const limit = await dailyLimitKobo()
  const spent = await spentLast24h(userId)
  if (spent + total > limit) {
    throw new HttpError(403, `This would exceed your daily limit of NGN ${fromUnits(limit, 2)} (NGN ${fromUnits(limit - spent < 0n ? 0n : limit - spent, 2)} left).`, { code: 'DAILY_LIMIT' })
  }
}

/** Flags unusual activity. Returns whether the movement should wait for founder review. */
export async function assessMovement(userId: string, amount: bigint, label: string): Promise<{ review: boolean; flags: string[] }> {
  const flags: string[] = []
  const recent = (await get<{ n: number }>("SELECT COUNT(*) n FROM transactions WHERE user_id=? AND direction='debit' AND created_at>?", userId, now() - 10 * 60_000))?.n ?? 0
  if (recent >= Number(await setting('velocity_block_count'))) throw new HttpError(429, 'Unusual activity: too many payments in a short time. Try again in a few minutes.', { code: 'VELOCITY' })
  if (recent >= Number(await setting('velocity_flag_count'))) flags.push('rapid_payments')
  if (amount >= BigInt(await setting('large_flag_kobo'))) flags.push('large_amount')
  if (flags.length) {
    await alert('warning', 'naira_fraud_flag', `Flagged ${label}`, `User ${userId}: ${flags.join(', ')} (NGN ${fromUnits(amount, 2)})`, userId)
    await audit(userId, 'security.flagged_movement', label, undefined, { flags, amount: amount.toString() })
  }
  return { review: label === 'bank_transfer' && amount >= BigInt(await setting('review_threshold_kobo')), flags }
}

export const nairaBalance = async (userId: string) => await balanceOf(userId, 'NGN')

export async function walletView(userId: string) {
  const w = await ensureNairaWallet(userId)
  const u = await get<{ username: string | null; phone: string | null; name: string }>('SELECT username, phone, name FROM users WHERE id=?', userId)
  const limit = await dailyLimitKobo()
  const spent = await spentLast24h(userId)
  return {
    balance: fromUnits(await nairaBalance(userId), 2),
    currency: 'NGN',
    account: { number: w.account_number, bank: BANK_NAME, name: u?.name ?? '', sandbox: true },
    status: w.status,
    freezeReason: w.freeze_reason,
    pin: { set: Boolean(w.pin_hash), lockedUntil: w.pin_locked_until && w.pin_locked_until > now() ? w.pin_locked_until : null },
    profile: { username: u?.username ?? null, phone: u?.phone ?? null },
    limits: { daily: fromUnits(limit, 2), spent24h: fromUnits(spent, 2), remaining: fromUnits(limit > spent ? limit - spent : 0n, 2) },
    fees: { bankTransfer: fromUnits(BigInt(await setting('bank_transfer_fee_kobo')), 2), bill: fromUnits(BigInt(await setting('bill_fee_kobo')), 2) },
    mode: 'SANDBOX',
  }
}
