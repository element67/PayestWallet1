/** Transfers: to a bank account (sandbox bank network) and to another NairaBridge user (instant, atomic). */
import { HttpError, type User } from '../auth'
import { all, audit, db, get, notify, now, run, setting, uid } from '../db'
import { SYS, move, InsufficientFunds } from '../ledger'
import { fromUnits } from '../money'
import { decrypt, encrypt } from '../security'
import { BANKS, bankProvider } from './providers'
import { registerFulfiller, startPayment } from './pay'
import { createTxn, findByIdem, getTxn, patchTxn, txnView } from './txns'
import { assertOperational, assertWithinDailyLimit, assessMovement, ensureNairaWallet, verifyPin } from './wallet'

export const MIN_KOBO = 10_000n // NGN 100 (sent to the app in /api/naira/config; the app never hardcodes it)

export function verifyBankAccount(bankCode: string, accountNumber: string) {
  const bank = BANKS.find((b) => b.code === bankCode)
  if (!bank) throw new HttpError(400, 'Choose a bank')
  if (!/^\d{10}$/.test(accountNumber)) throw new HttpError(400, 'Account number must be 10 digits')
  const r = bankProvider.resolveAccount(bankCode, accountNumber)
  if (!r) throw new HttpError(404, 'We could not verify this account. Check the bank and account number.')
  return { accountName: r.name, bankName: bank.name, bankCode, last4: accountNumber.slice(-4), sandbox: true, provider: bankProvider.label }
}

export function startBankTransfer(user: User, b: { bankCode: string; accountNumber: string; amount: bigint; note?: string; pin: unknown; idem: string; save?: boolean }) {
  if (b.amount < MIN_KOBO) throw new HttpError(400, 'The minimum transfer is NGN 100')
  // Always re-verify on the server: the name shown on screen is never trusted.
  const acct = verifyBankAccount(b.bankCode, b.accountNumber)
  const fee = BigInt(setting('bank_transfer_fee_kobo'))
  const res = startPayment({
    user, pin: b.pin, idem: b.idem, type: 'bank_transfer', title: `Transfer to ${acct.accountName}`, amount: b.amount, fee,
    counterparty: `${acct.accountName} · ${acct.bankName} ••${acct.last4}`, note: b.note,
    meta: { bankCode: b.bankCode, bankName: acct.bankName, accountName: acct.accountName, last4: acct.last4, accountEnc: encrypt(b.accountNumber), provider: bankProvider.label },
  })
  if (b.save && !res.replay) saveBankBeneficiary(user.id, b.bankCode, acct.bankName, b.accountNumber, acct.accountName)
  return res
}

registerFulfiller('bank_transfer', (t, meta) => {
  const r = bankProvider.transfer(t.reference, String(meta.bankCode), decrypt(String(meta.accountEnc)))
  const providerRef = r.providerRef ?? `SBX-BANK-FAIL-${t.reference}`
  run(
    'INSERT OR IGNORE INTO provider_callbacks(provider, event_id, kind, payload, received_at, processed_at, result) VALUES (?,?,?,?,?,?,?)',
    bankProvider.id, `${providerRef}:${t.id}`, r.ok ? 'transfer.completed' : 'transfer.failed', JSON.stringify({ reference: t.reference, amountKobo: t.amount_kobo }), now(), now(), r.ok ? 'ok' : (r.reason ?? 'failed'),
  )
  return r.ok ? { ok: true, providerRef, meta: { settledAt: now() } } : { ok: false, reason: r.reason }
})

/* ---------------- beneficiaries ---------------- */

function saveBankBeneficiary(userId: string, bankCode: string, bankName: string, accountNumber: string, name: string) {
  const dup = all<{ account_enc: string; bank_code: string }>("SELECT account_enc, bank_code FROM beneficiaries WHERE user_id=? AND kind='bank'", userId).some(
    (r) => r.bank_code === bankCode && decrypt(r.account_enc) === accountNumber,
  )
  if (dup) return
  run(
    "INSERT INTO beneficiaries(id,user_id,kind,label,bank_code,bank_name,account_enc,account_last4,account_name,created_at) VALUES (?,?, 'bank', ?,?,?,?,?,?,?)",
    uid('ben'), userId, name, bankCode, bankName, encrypt(accountNumber), accountNumber.slice(-4), name, now(),
  )
}

export function listBeneficiaries(userId: string) {
  return all<{ id: string; kind: string; label: string; bank_code: string | null; bank_name: string | null; account_enc: string | null; account_last4: string | null; account_name: string | null; target_user_id: string | null }>(
    'SELECT * FROM beneficiaries WHERE user_id=? ORDER BY created_at DESC LIMIT 50', userId,
  ).map((b) => ({
    id: b.id, kind: b.kind, label: b.label, bankCode: b.bank_code, bankName: b.bank_name, last4: b.account_last4, accountName: b.account_name,
    // The full number is only returned to its owner so they can re-use it; it is encrypted at rest.
    accountNumber: b.account_enc ? decrypt(b.account_enc) : null, recipientId: b.target_user_id,
  }))
}

export function deleteBeneficiary(userId: string, id: string) {
  run('DELETE FROM beneficiaries WHERE id=? AND user_id=?', id, userId)
}

/* ---------------- NairaBridge users ---------------- */

const normalizePhone = (q: string) => {
  const d = q.replace(/[\s()-]/g, '')
  if (/^\+234\d{10}$/.test(d)) return `0${d.slice(4)}`
  if (/^234\d{10}$/.test(d)) return `0${d.slice(3)}`
  return /^0\d{10}$/.test(d) ? d : null
}

/** Exact match on username or phone only, so the directory cannot be browsed. */
export function searchRecipient(user: User, q: string) {
  const term = q.trim().replace(/^@/, '').toLowerCase()
  if (term.length < 3) throw new HttpError(400, 'Enter a full username or phone number')
  const phone = normalizePhone(q)
  const r = get<{ id: string; name: string; username: string | null; phone: string | null }>(
    "SELECT id, name, username, phone FROM users WHERE status='active' AND (lower(username)=? OR (? IS NOT NULL AND phone=?)) LIMIT 1", term, phone, phone,
  )
  if (!r || r.id === user.id) throw new HttpError(404, 'No NairaBridge user found with that username or phone number')
  return { id: r.id, name: r.name, username: r.username, phoneMasked: r.phone ? `${r.phone.slice(0, 4)}•••${r.phone.slice(-3)}` : null }
}

export function internalTransfer(user: User, b: { recipientId: string; amount: bigint; note?: string; pin: unknown; idem: string; save?: boolean }) {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(b.idem)) throw new HttpError(400, 'A valid idempotency key is required')
  const prior = findByIdem(user.id, b.idem)
  if (prior) return { txn: txnView(prior), replay: true }
  if (b.amount < MIN_KOBO) throw new HttpError(400, 'The minimum transfer is NGN 100')
  if (b.recipientId === user.id) throw new HttpError(400, 'You cannot send money to yourself')
  const rec = get<{ id: string; name: string; username: string | null; status: string }>('SELECT id, name, username, status FROM users WHERE id=?', b.recipientId)
  if (!rec || rec.status !== 'active') throw new HttpError(404, 'Recipient not found')
  assertOperational(user.id)
  const rw = ensureNairaWallet(rec.id)
  if (rw.status === 'frozen') throw new HttpError(409, 'This recipient cannot receive money right now')
  verifyPin(user.id, b.pin)
  assertWithinDailyLimit(user.id, b.amount)
  const risk = assessMovement(user.id, b.amount, 'internal_transfer')
  try {
    const out = db.transaction(() => {
      const label = rec.username ? `${rec.name} (@${rec.username})` : rec.name
      const t = createTxn({ userId: user.id, type: 'internal_transfer', direction: 'debit', amount: b.amount, status: 'success', title: `Transfer to ${rec.name}`, counterparty: label, note: b.note, idemKey: b.idem, meta: { recipientId: rec.id, riskFlags: risk.flags } })
      const ltx = move({ from: user.id, to: rec.id, asset: 'NGN', amount: b.amount, reason: `transfer ${t.reference}`, idem: `txn:${t.id}:internal` })
      patchTxn(t.id, { ledgerTxnId: ltx })
      const sender = get<{ name: string; username: string | null }>('SELECT name, username FROM users WHERE id=?', user.id)
      createTxn({
        userId: rec.id, type: 'internal_credit', direction: 'credit', amount: b.amount, status: 'success', title: `Received from ${sender?.name ?? 'a NairaBridge user'}`,
        counterparty: sender?.username ? `${sender.name} (@${sender.username})` : sender?.name, note: b.note, idemKey: `in:${t.id}`, ledgerTxnId: ltx, meta: { senderId: user.id, reference: t.reference },
      })
      return t
    })()
    if (b.save) {
      const exists = get("SELECT 1 FROM beneficiaries WHERE user_id=? AND kind='user' AND target_user_id=?", user.id, rec.id)
      if (!exists) run("INSERT INTO beneficiaries(id,user_id,kind,label,account_name,target_user_id,created_at) VALUES (?,?, 'user', ?,?,?,?)", uid('ben'), user.id, rec.username ? `@${rec.username}` : rec.name, rec.name, rec.id, now())
    }
    notify(rec.id, 'payout', 'Money received', `You received NGN ${fromUnits(b.amount, 2)} from a NairaBridge user.`)
    audit(user.id, 'transfer.internal', out.reference, undefined, { to: rec.id, amount: b.amount.toString() })
    return { txn: txnView(getTxn(out.id)!), replay: false }
  } catch (e) {
    if (e instanceof InsufficientFunds) throw new HttpError(400, 'Insufficient Naira balance')
    const again = findByIdem(user.id, b.idem)
    if (again) return { txn: txnView(again), replay: true }
    throw e
  }
}

export { SYS }
