import { describe, expect, test } from 'bun:test'
import { TransactionReceiptNotFoundError } from 'viem'
import { MISS_LIMIT, confirmationsFor, isNotFoundError, lookup, registerMiss } from '../../server/chain/receipts'

describe('NB-04 receipt lookups never mistake a network error for a dropped transaction', () => {
  test('a transport error is an error, not "missing"', async () => {
    const r = await lookup(() => Promise.reject(new Error('HTTP request failed: 429')))
    expect(r.kind).toBe('error')
  })
  test('a genuine not-found answer is "missing", even when wrapped', async () => {
    const e = new TransactionReceiptNotFoundError({ hash: `0x${'1'.repeat(64)}` })
    expect(isNotFoundError(e)).toBe(true)
    expect(isNotFoundError(new Error('wrapped', { cause: e }))).toBe(true)
    expect((await lookup(() => Promise.reject(e))).kind).toBe('missing')
    expect((await lookup(() => Promise.resolve(null))).kind).toBe('missing')
    expect((await lookup(() => Promise.resolve({ ok: 1 }))).kind).toBe('found')
  })
  test('misses only count while the head advances, and only a run of them drops', () => {
    let s = { misses: 0, lastHead: null as bigint | null }
    let head = 100n
    const first = registerMiss(s, head)
    expect(first).toMatchObject({ misses: 1, drop: false })
    s = first
    for (let i = 0; i < 10; i++) s = registerMiss(s, head) // same block, many polls
    expect(s.misses).toBe(1)
    let dropped = false
    for (let i = 0; i < MISS_LIMIT; i++) {
      head += 1n
      const r = registerMiss(s, head)
      s = r
      dropped = r.drop
    }
    expect(dropped).toBe(true)
  })
})

describe('NB-20 confirmation counts never go below one for a mined transaction', () => {
  test('a head one block behind the receipt still reports 1', () => {
    expect(confirmationsFor(99n, 100n)).toBe(1)
    expect(confirmationsFor(100n, 100n)).toBe(1)
    expect(confirmationsFor(105n, 100n)).toBe(6)
    expect(confirmationsFor(50n, 100n)).toBe(1)
  })
})
