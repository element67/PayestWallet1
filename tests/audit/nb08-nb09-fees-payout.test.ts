import { describe, expect, test } from 'bun:test'
import { count, insertOrder, makeUser, PIN } from '../helpers'
import { reconcile } from '../../server/agent'
import { adminOverview } from '../../server/metrics'
import { get, now, run, uid } from '../../server/db'
import { SYS, balanceOf, exchangeFeesBooked } from '../../server/ledger'
import { fromUnits } from '../../server/money'
import { executeNgnPayout, executeRelease, getOrder, maybeComplete } from '../../server/orders'
import { api, tokenFor } from '../helpers'

describe('NB-08 exchange and swap fees are booked to sys:fees', () => {
  test('a completed sell books its fee once', async () => {
    const u = await makeUser()
    const id = await insertOrder({ user_id: u.id, payout_type: 'wallet', status: 'detected', fee_kobo: '14800' })
    const before = await balanceOf(SYS.fees, 'NGN')
    await executeNgnPayout(id, false)
    await run("INSERT INTO chain_txs(id,chain,tx_hash,log_index,status,verdict,order_id,first_seen_at,updated_at) VALUES (?,?,?,0,'finalized','genuine',?,?,?)", uid('ctx'), 'arc-testnet', `0x${uid('h')}`, id, now(), now())
    await maybeComplete(id)
    await maybeComplete(id) // a repeat must not book twice
    expect((await getOrder(id))?.status).toBe('completed')
    expect(await balanceOf(SYS.fees, 'NGN') - before).toBe(14_800n)
  })

  test('a completed buy books its fee', async () => {
    const u = await makeUser()
    const id = await insertOrder({ user_id: u.id, side: 'buy', funding: 'wallet', status: 'payment_verified', fee_kobo: '9900', gross_kobo: '990000', net_kobo: '980100', crypto_amount: '650000' })
    const before = await balanceOf(SYS.fees, 'NGN')
    await executeRelease(id)
    expect((await getOrder(id))?.status).toBe('completed')
    expect(await balanceOf(SYS.fees, 'NGN') - before).toBe(9_900n)
  })

  test('a swap books its fee and the founder total matches the fee account', async () => {
    const u = await makeUser({ pin: true })
    // give the user 20 USDC through the ledger
    const { post } = await import('../../server/ledger')
    await post({ owner: u.id, asset: 'USDC', delta: 20_000_000n, reason: 'test funds', idem: `test:usdc:${u.id}` })
    const before = await balanceOf(SYS.fees, 'NGN')
    const r = await api('POST', '/api/crypto/swap', { token: await tokenFor(u), body: { from: 'USDC', to: 'USDT', amount: '10', idempotencyKey: 'swap-nb08-0001', pin: PIN } })
    expect(r.status).toBe(200)
    expect(await balanceOf(SYS.fees, 'NGN') - before).toBeGreaterThan(0n)
    const ov = await adminOverview()
    expect(ov.feesNgn).toBe(fromUnits(await exchangeFeesBooked(), 2)) // the dashboard reads the books
  })
})

describe('NB-09 one payout job per order and no second dispatch', () => {
  test('finalizing a detected deposit uses the single canonical job key', async () => {
    const u = await makeUser()
    const id = await insertOrder({ user_id: u.id, status: 'detected', payout_type: 'bank' })
    await run("INSERT INTO chain_txs(id,chain,tx_hash,log_index,asset,amount,status,verdict,confirmations,order_id,first_seen_at,updated_at) VALUES (?,?,?,0,'USDC','10000000','confirmed','genuine',9,?,?,?)", uid('ctx'), 'arc-testnet', `0x${uid('h')}`, id, now(), now())
    await run('INSERT OR IGNORE INTO jobs(uniq,kind,payload,run_at,created_at) VALUES (?,?,?,?,?)', `order.payout:${id}`, 'order.payout', JSON.stringify({ orderId: id, instant: true }), now(), now())
    await reconcile()
    expect(await count("SELECT COUNT(*) c FROM jobs WHERE uniq LIKE ?", `order.payout:${id}%`)).toBe(1)
  })

  test('running the payout twice sends one bank payout and moves the money once', async () => {
    const u = await makeUser()
    const id = await insertOrder({ user_id: u.id, status: 'detected', payout_type: 'bank' })
    const bank = await balanceOf(SYS.bank, 'NGN')
    expect(await executeNgnPayout(id, true)).toBe('paid')
    expect(await executeNgnPayout(id, false)).toBe('skipped')
    expect(await count("SELECT COUNT(*) c FROM payments WHERE order_id=? AND direction='out'", id)).toBe(1)
    expect(await balanceOf(SYS.bank, 'NGN') - bank).toBe(1_465_200n)
    expect((await get<{ status: string }>('SELECT status FROM orders WHERE id=?', id))?.status).toBe('payout_processing')
  })
})
