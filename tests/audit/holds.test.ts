import { describe, expect, test } from 'bun:test'
import { api, fundNgn, insertOrder, makeUser, PIN, tokenFor } from '../helpers'
import { get, now, run, uid } from '../../server/db'
import { post } from '../../server/ledger'
import { bankKey, cryptoKey, releaseDueHolds, releaseHold } from '../../server/holds'
import { executeNgnPayout, executeRelease, getOrder } from '../../server/orders'
import { startBankTransfer } from '../../server/naira/transfers'
import { getTxn } from '../../server/naira/txns'
import { balanceOf } from '../../server/ledger'
import { encrypt } from '../../server/security'
import { toUnits } from '../../server/money'

const ADDR = '0x1111111111111111111111111111111111111111'
const ADDR2 = '0x2222222222222222222222222222222222222222'

async function withdrawer(usdc = '1000') {
  const u = await makeUser({ kyc: 2, pin: true })
  await post({ owner: u.id, asset: 'USDC', delta: toUnits(usdc, 6), reason: 'test funds', idem: `test:usdc:${uid('f')}` })
  return { u, token: await tokenFor(u) }
}
const withdraw = (token: string, amount: string, destAddress = ADDR) =>
  api('POST', '/api/withdrawals', { token, body: { idempotencyKey: uid('idem') + 'xxxx', asset: 'USDC', amount, destAddress, pin: PIN } })
const holdFor = async (userId: string) => await get<{ id: string; status: string; release_at: string; cp_key: string }>("SELECT * FROM payout_holds WHERE user_id=? ORDER BY created_at DESC LIMIT 1", userId)

describe('first-time counterparty hold: crypto withdrawals', () => {
  test('a large payout to a new address is held and the funds stay locked; a small one goes straight through', async () => {
    const { u, token } = await withdrawer()
    const small = await withdraw(token, '1')
    expect((small.json.withdrawal as { status: string }).status).toBe('completed')
    const big = await withdraw(token, '300', ADDR2)
    expect(big.status).toBe(200)
    expect((big.json.withdrawal as { status: string }).status).toBe('held')
    expect(await balanceOf(u.id, 'USDC')).toBe(toUnits('699', 6))
    const h = await holdFor(u.id)
    expect(h?.status).toBe('held')
    expect(Number(h?.release_at) - now()).toBeGreaterThan(50 * 60_000) // tier 2: about one hour
  })

  test('tier 1 accounts wait 24 hours', async () => {
    const u = await makeUser({ kyc: 2, pin: true })
    await run('UPDATE users SET kyc_tier=1 WHERE id=?', u.id)
    // Tier 1 cannot withdraw crypto at all; the window length is exercised through the setting helper instead.
    const { holdWindowMs } = await import('../../server/holds')
    expect(await holdWindowMs(1)).toBe(24 * 3_600_000)
    expect(await holdWindowMs(2)).toBe(3_600_000)
  })

  test('the customer can cancel with the PIN (wrong PIN refused) and gets the money back; nobody can cancel twice', async () => {
    const { u, token } = await withdrawer()
    await withdraw(token, '300')
    const h = await holdFor(u.id)
    const wrong = await api('POST', `/api/holds/${h!.id}/cancel`, { token, body: { pin: '1357' } })
    expect(wrong.status).toBeGreaterThanOrEqual(400)
    expect((await holdFor(u.id))?.status).toBe('held')
    const ok = await api('POST', `/api/holds/${h!.id}/cancel`, { token, body: { pin: PIN } })
    expect(ok.status).toBe(200)
    expect(await balanceOf(u.id, 'USDC')).toBe(toUnits('1000', 6))
    expect((await get<{ status: string }>('SELECT status FROM withdrawals WHERE user_id=?', u.id))?.status).toBe('cancelled')
    expect((await api('POST', `/api/holds/${h!.id}/cancel`, { token, body: { pin: PIN } })).status).toBe(409)
  })

  test("a customer cannot cancel or see another customer's hold, and there is no customer release route", async () => {
    const a = await withdrawer()
    const b = await withdrawer()
    await withdraw(a.token, '300')
    const h = await holdFor(a.u.id)
    expect((await api('POST', `/api/holds/${h!.id}/cancel`, { token: b.token, body: { pin: PIN } })).status).toBe(404)
    expect(((await api('GET', '/api/holds', { token: b.token })).json.holds as unknown[]).length).toBe(0)
    expect((await api('POST', `/api/holds/${h!.id}/release`, { token: a.token, body: {} })).status).toBeGreaterThanOrEqual(400)
    expect((await api('POST', `/api/admin/holds/${h!.id}/release`, { token: a.token, body: {} })).status).toBeGreaterThanOrEqual(403)
  })

  test('a founder can release it, the destination is remembered, and trust needs time as well as a completed payout', async () => {
    const { u, token } = await withdrawer()
    const founder = await makeUser({ role: 'founder', kyc: 2 })
    await withdraw(token, '300')
    const h = await holdFor(u.id)
    const rel = await api('POST', `/api/admin/holds/${h!.id}/release`, { token: await tokenFor(founder), body: {} })
    expect(rel.status).toBe(200)
    expect((await get<{ status: string }>('SELECT status FROM withdrawals WHERE user_id=?', u.id))?.status).toBe('completed')
    expect((await get<{ paid_count: number }>('SELECT paid_count FROM counterparties WHERE user_id=? AND cp_key=?', u.id, cryptoKey(ADDR)))?.paid_count).toBe(1)
    // Paid once, but the destination is brand new: another large payout is still held.
    const again = await withdraw(token, '300')
    expect((again.json.withdrawal as { status: string }).status).toBe('held')
    // Age the destination past the window: now it is trusted.
    await run('UPDATE counterparties SET first_seen_at=? WHERE user_id=? AND cp_key=?', now() - 2 * 3_600_000, u.id, cryptoKey(ADDR))
    const trusted = await withdraw(token, '100')
    expect((trusted.json.withdrawal as { status: string }).status).toBe('completed')
  })

  test('a founder can cancel with a reason, and cancelling twice is refused', async () => {
    const { u, token } = await withdrawer()
    const founder = await makeUser({ role: 'founder', kyc: 2 })
    await withdraw(token, '300')
    const h = await holdFor(u.id)
    expect((await api('POST', `/api/admin/holds/${h!.id}/cancel`, { token: await tokenFor(founder), body: {} })).status).toBe(400) // reason required
    expect((await api('POST', `/api/admin/holds/${h!.id}/cancel`, { token: await tokenFor(founder), body: { reason: 'looks wrong' } })).status).toBe(200)
    expect(await balanceOf(u.id, 'USDC')).toBe(toUnits('1000', 6))
    expect((await api('POST', `/api/admin/holds/${h!.id}/cancel`, { token: await tokenFor(founder), body: { reason: 'again please' } })).status).toBe(409)
  })

  test('holds release on their own when the time is up, but not while the account is frozen', async () => {
    const { u, token } = await withdrawer()
    const f = await withdrawer()
    await withdraw(token, '300')
    await withdraw(f.token, '300')
    await run('UPDATE payout_holds SET release_at=? WHERE user_id IN (?,?)', now() - 1000, u.id, f.u.id)
    await run("UPDATE naira_wallets SET status='frozen' WHERE user_id=?", f.u.id)
    await releaseDueHolds()
    expect((await holdFor(u.id))?.status).toBe('released')
    expect((await holdFor(f.u.id))?.status).toBe('held')
  })

  test('turning the feature off lets large payouts through', async () => {
    const { token } = await withdrawer()
    await run("UPDATE settings SET value='false' WHERE key='holds_enabled'")
    try {
      expect(((await withdraw(token, '300')).json.withdrawal as { status: string }).status).toBe('completed')
    } finally {
      await run("UPDATE settings SET value='true' WHERE key='holds_enabled'")
    }
  })
})

describe('first-time counterparty hold: Naira bank transfers', () => {
  const T = { bankCode: '044', accountNumber: '0123456789', pin: PIN }
  test('a large transfer to a new account is reserved and held; cancelling returns the money', async () => {
    const u = await makeUser({ kyc: 2, pin: true })
    await fundNgn(u.id, 100_000_000n)
    const r = await startBankTransfer(u, { ...T, amount: 30_000_000n, idem: uid('idem') + 'aaaa' })
    expect(r.txn.status).toBe('held')
    expect(await balanceOf(u.id, 'NGN')).toBeLessThan(100_000_000n - 30_000_000n + 1n) // reserved
    const h = await holdFor(u.id)
    expect(h?.status).toBe('held')
    const { cancelHold } = await import('../../server/holds')
    await cancelHold(h!.id, u.id, 'changed my mind')
    expect(await balanceOf(u.id, 'NGN')).toBe(100_000_000n)
    expect((await getTxn(r.txn.id))?.status).toBe('failed')
  })

  test('releasing a held transfer sends it on to be processed; a small transfer is never held', async () => {
    const u = await makeUser({ kyc: 2, pin: true })
    await fundNgn(u.id, 100_000_000n)
    const small = await startBankTransfer(u, { ...T, amount: 100_000n, idem: uid('idem') + 'bbbb' })
    expect(small.txn.status).toBe('processing')
    const big = await startBankTransfer(u, { ...T, accountNumber: '0123456781', amount: 30_000_000n, idem: uid('idem') + 'cccc' })
    expect(big.txn.status).toBe('held')
    await releaseHold((await holdFor(u.id))!.id, 'system')
    expect((await getTxn(big.txn.id))?.status).toBe('processing')
  })
})

describe('first-time counterparty hold: orders', () => {
  test('a buy delivered to a new outside address waits; cancelling refunds the Naira', async () => {
    const u = await makeUser({ kyc: 2, pin: true })
    await post({ owner: 'house', asset: 'USDC', delta: toUnits('100000', 6), reason: 'test liquidity', idem: `test:house:${uid('f')}` })
    await post({ owner: 'house', asset: 'NGN', delta: 5_000_000_000n, reason: 'test liquidity', idem: `test:houseN:${uid('f')}` })
    const id = await insertOrder({ user_id: u.id, side: 'buy', status: 'payment_verified', funding: 'wallet', dest_address: ADDR, gross_kobo: '30000000', crypto_amount: '200000000', net_kobo: '0' })
    await post({ owner: 'house', asset: 'NGN', delta: 30_000_000n, reason: 'test: buyer paid', idem: `test:paid:${id}` })
    await executeRelease(id)
    expect((await getOrder(id))?.status).toBe('release_held')
    const h = await holdFor(u.id)
    const { cancelHold } = await import('../../server/holds')
    await cancelHold(h!.id, u.id, 'wrong address')
    expect((await getOrder(id))?.status).toBe('cancelled')
    expect(await balanceOf(u.id, 'NGN')).toBe(30_000_000n)
  })

  test('a sell paid out to a new bank account waits; cancelling pays the Naira wallet instead', async () => {
    const u = await makeUser({ kyc: 2, pin: true })
    await post({ owner: 'house', asset: 'NGN', delta: 5_000_000_000n, reason: 'test liquidity', idem: `test:houseN:${uid('f')}` })
    const acct = uid('ba')
    await run('INSERT INTO bank_accounts(id,user_id,bank_name,account_name,account_last4,account_enc,created_at) VALUES (?,?,?,?,?,?,?)', acct, u.id, 'Access Bank', 'Test Name', '6789', encrypt('0123456789'), now())
    const id = await insertOrder({ user_id: u.id, payout_type: 'bank', bank_account_id: acct, status: 'detected', net_kobo: '30000000' })
    expect(await executeNgnPayout(id, false)).toBe('skipped')
    expect((await getOrder(id))?.status).toBe('payout_held')
    const h = await holdFor(u.id)
    expect(h?.cp_key).toBe(bankKey('Access Bank', '0123456789'))
    const { cancelHold } = await import('../../server/holds')
    await cancelHold(h!.id, u.id, 'use my wallet')
    const o = await getOrder(id)
    expect(o?.status).toBe('deposit_verified')
    expect(o?.payout_type).toBe('wallet')
    expect(await executeNgnPayout(id, false)).toBe('paid')
    expect(await balanceOf(u.id, 'NGN')).toBe(30_000_000n)
  })
})
