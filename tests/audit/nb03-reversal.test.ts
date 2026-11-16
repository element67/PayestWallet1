import { describe, expect, test } from 'bun:test'
import { count, insertOrder, makeUser } from '../helpers'
import { get, uid } from '../../server/db'
import { SYS, balanceOf } from '../../server/ledger'
import { executeNgnPayout, getOrder, handlePaymentEvent, reverseOrder } from '../../server/orders'

const NET = 1_465_200n
const bankSale = async () => {
  const u = await makeUser()
  const id = await insertOrder({ user_id: u.id, payout_type: 'bank', status: 'detected', net_kobo: NET.toString() })
  return { u, id }
}
const evt = (type: 'payout.failed' | 'payout.succeeded', orderId: string) => ({ id: uid('evt'), type, reference: `SBX-OUT-${orderId}`, amountKobo: NET.toString(), ts: Date.now() })

describe('NB-03 bank payout reversal and late provider events', () => {
  test('an unsettled bank payout is cancelled and returned to the house, not taken from the user', async () => {
    const { u, id } = await bankSale()
    const bankBefore = await balanceOf(SYS.bank, 'NGN')
    const houseBefore = await balanceOf('house', 'NGN')
    expect(await executeNgnPayout(id, false)).toBe('paid')
    expect(await balanceOf(SYS.bank, 'NGN') - bankBefore).toBe(NET)
    await reverseOrder(id, 'deposit dropped')
    expect(await balanceOf(u.id, 'NGN')).toBe(0n) // never negative
    expect(await balanceOf(SYS.bank, 'NGN')).toBe(bankBefore)
    expect(await balanceOf('house', 'NGN')).toBe(houseBefore)
    expect((await getOrder(id))?.status).toBe('reversed')
    expect((await get<{ status: string }>("SELECT status FROM payments WHERE order_id=? AND direction='out'", id))?.status).toBe('cancelled')
  })

  test('a late payout webhook cannot reopen a reversed order', async () => {
    const { id } = await bankSale()
    await executeNgnPayout(id, false)
    await reverseOrder(id, 'deposit dropped')
    expect(await handlePaymentEvent(evt('payout.failed', id))).toContain('ignored')
    expect((await getOrder(id))?.status).toBe('reversed')
    expect(await handlePaymentEvent(evt('payout.succeeded', id))).toContain('ignored')
    expect((await getOrder(id))?.status).toBe('reversed')
  })

  test('money already settled to the bank is not clawed back from the wallet; a person is alerted', async () => {
    const { u, id } = await bankSale()
    await executeNgnPayout(id, false)
    expect(await handlePaymentEvent(evt('payout.succeeded', id))).toBe('ok')
    const before = await count("SELECT COUNT(*) c FROM alerts WHERE order_id=? AND kind='reversal_manual'", id)
    await reverseOrder(id, 'deposit failed after settlement')
    expect(await balanceOf(u.id, 'NGN')).toBe(0n)
    expect(await count("SELECT COUNT(*) c FROM alerts WHERE order_id=? AND kind='reversal_manual'", id)).toBe(before + 1)
    expect((await getOrder(id))?.status).toBe('reversed')
  })

  test('a wallet payout is still clawed back from the wallet that was credited', async () => {
    const u = await makeUser()
    const id = await insertOrder({ user_id: u.id, payout_type: 'wallet', status: 'detected', net_kobo: NET.toString() })
    await executeNgnPayout(id, false)
    expect(await balanceOf(u.id, 'NGN')).toBe(NET)
    await reverseOrder(id, 'deposit failed')
    expect(await balanceOf(u.id, 'NGN')).toBe(0n)
  })
})
