/**
 * Founder-only "Test credit" for sandbox mode, so test wallets can be funded to try swaps.
 * It is a normal, balanced, confirmed ledger movement (from the sandbox mint), audited and logged.
 * It is refused outright unless the platform is in SANDBOX mode, and it never touches a chain.
 */
import { z } from 'zod'
import { HttpError } from './auth'
import { CONFIG } from './config'
import { all, alert, audit, get, notify } from './db'
import { body, route } from './http'
import { SYS, balanceOf, move } from './ledger'
import { fromUnits, toUnits } from './money'

const MAX_VALUE_KOBO = 5_000_000_000n // NGN 50,000,000 equivalent per credit

route('POST', '/api/admin/test-credit', 'founder', (c) => {
  if (CONFIG.paymentMode !== 'SANDBOX' || CONFIG.realMoney) throw new HttpError(403, 'Test credit is only available in sandbox mode')
  const b = body(c, z.object({
    userId: z.string().min(3).max(60),
    asset: z.string().regex(/^[A-Z]{2,6}$/),
    amount: z.string().regex(/^\d{1,12}(\.\d{1,9})?$/, 'Enter a valid amount'),
    note: z.string().trim().min(5, 'Say why you are adding test funds').max(200),
    idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  }))
  const target = get<{ id: string; email: string; name: string }>("SELECT id, email, name FROM users WHERE id=? AND status='active'", b.userId)
  if (!target) throw new HttpError(404, 'User not found')

  let decimals = 2
  let rateKobo = 100n // NGN counts 1:1 in kobo
  if (b.asset !== 'NGN') {
    const a = get<{ decimals: number; sell_rate_kobo: string }>('SELECT decimals, sell_rate_kobo FROM assets WHERE symbol=?', b.asset)
    if (!a) throw new HttpError(400, 'Unknown asset')
    decimals = a.decimals
    rateKobo = BigInt(a.sell_rate_kobo)
  }
  const raw = toUnits(b.amount, decimals)
  if (raw <= 0n) throw new HttpError(400, 'Amount must be above zero')
  const value = b.asset === 'NGN' ? raw : (raw * rateKobo) / 10n ** BigInt(decimals)
  if (value > MAX_VALUE_KOBO) throw new HttpError(400, `Test credits are capped at ${fromUnits(MAX_VALUE_KOBO, 2)} NGN equivalent each`)

  const txn = move({ from: SYS.mint, to: target.id, asset: b.asset, amount: raw, reason: `test credit: ${b.note}`, idem: `testcredit:${b.idempotencyKey}` })
  if (txn) {
    audit(c.user.id, 'admin.test_credit', target.id, undefined, { asset: b.asset, amount: b.amount, note: b.note, ledgerTxn: txn, to: target.email })
    alert('info', 'test_credit', 'Test credit added (sandbox)', `${b.amount} ${b.asset} to ${target.email}: ${b.note}`, target.id)
    notify(target.id, 'test_credit', 'Test funds added', `${b.amount} ${b.asset} of sandbox test funds were added to your account.`)
  }
  return { ok: true, duplicate: txn === null, asset: b.asset, balance: fromUnits(balanceOf(target.id, b.asset), decimals) }
}, [20, 60_000])

/** Recent test credits, newest first (from the audit trail). */
route('GET', '/api/admin/test-credit', 'founder', () => ({
  credits: all<{ at: number; target: string; after: string | null }>("SELECT at, target, after FROM audit_logs WHERE action='admin.test_credit' ORDER BY id DESC LIMIT 20")
    .map((r) => ({ at: r.at, userId: r.target, ...(r.after ? (JSON.parse(r.after) as Record<string, unknown>) : {}) })),
  mode: CONFIG.paymentMode,
  cap: fromUnits(MAX_VALUE_KOBO, 2),
}))
