import { describe, expect, test } from 'bun:test'
import '../helpers'
import { balanceOf, balancesFor, post, verifyLedger } from '../../server/ledger'
import { get } from '../../server/db'
import { uid } from '../../server/db'

describe('NB-01 ledger uses exact BigInt sums', () => {
  test('1 ETH + 123 wei is exact (no float drift)', async () => {
    const o = uid('usr')
    await post({ owner: o, asset: 'ETH', delta: 1_000_000_000_000_000_123n, reason: 't', idem: `nb01:${o}:a` })
    expect(await balanceOf(o, 'ETH')).toBe(1_000_000_000_000_000_123n)
    await post({ owner: o, asset: 'ETH', delta: 1n, reason: 't', idem: `nb01:${o}:b` })
    expect(await balanceOf(o, 'ETH')).toBe(1_000_000_000_000_000_124n)
    const last = await get<{ balance_after: string }>("SELECT balance_after FROM ledger_entries WHERE owner=? ORDER BY id DESC LIMIT 1", o)
    expect(last?.balance_after).toBe('1000000000000000124')
  })

  test('10 ETH (above the signed 64-bit limit) does not overflow', async () => {
    const o = uid('usr')
    await post({ owner: o, asset: 'ETH', delta: 10n ** 19n, reason: 't', idem: `nb01:${o}:big` })
    await post({ owner: o, asset: 'ETH', delta: 10n ** 19n + 7n, reason: 't', idem: `nb01:${o}:big2` })
    expect(await balanceOf(o, 'ETH')).toBe(2n * 10n ** 19n + 7n)
    expect((await balancesFor(o)).ETH).toBe(2n * 10n ** 19n + 7n)
  })

  test('the ledger verifier agrees and reports no mismatch', async () => {
    const v = await verifyLedger()
    expect(v.unbalanced).toEqual([])
    expect(v.mismatched).toEqual([])
    expect(v.ok).toBe(true)
  })
})
