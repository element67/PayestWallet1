import { describe, expect, test } from 'bun:test'
import { count, insertOrder, makeUser, mustReject } from '../helpers'
import { ingest, type Observation } from '../../server/agent'
import { getAsset } from '../../server/assets'
import { get, run, uid } from '../../server/db'
import { getOrder } from '../../server/orders'

const usdc = async () => (await getAsset('USDC'))?.contract?.toLowerCase() as string
const VAULT = `0x${'9'.repeat(40)}`
const hex = (n: string) => `0x${n.repeat(64).slice(0, 64)}`
const addr = () => `0x${uid('a').replace(/\W/g, '').padEnd(40, '0').slice(0, 40)}`

async function liveOrder(from: string) {
  const u = await makeUser()
  const id = await insertOrder({ user_id: u.id, mode: 'live', from_address: from.toLowerCase(), deposit_address: VAULT, crypto_amount: '10000000' })
  return { u, id }
}
const obs = async (o: Partial<Observation> & { txHash: string; from: string }): Promise<Observation> => ({
  chain: 'arc-testnet', tokenAddress: await usdc(), to: VAULT, amount: 10_000_000n, blockNumber: 5, status: 'confirmed', confirmations: 1, simulated: false, visibleAtMs: null, ...o,
})

describe('NB-05 two transfers in one transaction are both recorded', () => {
  test('different log indexes make two rows; the same log is not duplicated', async () => {
    const h = hex('a')
    await ingest(await obs({ txHash: h, from: addr(), logIndex: 0, amount: 1_000_000n }))
    await ingest(await obs({ txHash: h, from: addr(), logIndex: 1, amount: 2_000_000n }))
    await ingest(await obs({ txHash: h, from: addr(), logIndex: 1, amount: 2_000_000n }))
    expect(await count('SELECT COUNT(*) c FROM chain_txs WHERE tx_hash=?', h)).toBe(2)
  })

  test('a pending hint is adopted by the first mined log instead of being counted twice', async () => {
    const { id } = await liveOrder('0x' + '1'.repeat(40))
    const h = hex('b')
    await ingest(await obs({ txHash: h, from: '0x' + '1'.repeat(40), status: 'pending', blockNumber: null, confirmations: 0, orderHint: id }))
    await ingest(await obs({ txHash: h, from: '0x' + '1'.repeat(40), logIndex: 7 }))
    expect(await count('SELECT COUNT(*) c FROM chain_txs WHERE tx_hash=?', h)).toBe(1)
    expect((await get<{ log_index: number }>('SELECT log_index FROM chain_txs WHERE tx_hash=?', h))?.log_index).toBe(7)
  })

  test('wallet_txs is unique per log index', async () => {
    const u = await makeUser()
    const ins = (log: number) => async () =>
      await run(`INSERT INTO wallet_txs(id,user_id,network,type,amount,tx_hash,status,detected_at,created_at,updated_at,log_index) VALUES (?,?,?,?,?,?,?,?,?,?,?)`, uid('w'), u.id, 'arc-testnet', 'received', '1', hex('c'), 'confirmed', 1, 1, 1, log)
    await ins(0)()
    await ins(1)()
    await mustReject(ins(1)())
  })
})

describe('NB-06 a stranger cannot lock somebody else\'s order', () => {
  const victim = '0x' + '2'.repeat(40)

  test('a fake token that names the order is recorded, never bound to it', async () => {
    const { id } = await liveOrder(victim)
    await ingest(await obs({ txHash: hex('d'), from: victim, tokenAddress: '0x' + 'f'.repeat(40), orderHint: id }))
    const o = await getOrder(id)
    expect(o?.status).toBe('awaiting_deposit')
    expect(o?.tx_hash).toBeNull()
    expect(await count("SELECT COUNT(*) c FROM alerts WHERE kind='fake_token' AND detail LIKE ?", `%${hex('d')}%`)).toBe(1)
  })

  test('a hint from the wrong sender does not touch the order', async () => {
    const { id } = await liveOrder(victim)
    await ingest(await obs({ txHash: hex('e'), from: '0x' + '3'.repeat(40), orderHint: id }))
    expect((await getOrder(id))?.status).toBe('awaiting_deposit')
    expect((await getOrder(id))?.tx_hash).toBeNull()
  })

  test('a wrong amount is held for review but the order stays open for its real deposit', async () => {
    const from = '0x' + '4'.repeat(40)
    const { id } = await liveOrder(from)
    await ingest(await obs({ txHash: hex('1'), from, amount: 1n }))
    expect((await getOrder(id))?.status).toBe('awaiting_deposit')
    expect((await getOrder(id))?.tx_hash).toBeNull()
    await ingest(await obs({ txHash: hex('2'), from }))
    expect((await getOrder(id))?.status).toBe('detected')
    expect((await getOrder(id))?.tx_hash).toBe(hex('2'))
  })

  test('an order is not matched by amount alone, or from an unknown sender', async () => {
    const { id } = await liveOrder('0x' + '5'.repeat(40))
    await ingest(await obs({ txHash: hex('3'), from: '0x' + '6'.repeat(40) }))
    expect((await getOrder(id))?.status).toBe('awaiting_deposit')
  })

  test('a user whose reported hash was bogus can still receive the real deposit', async () => {
    const from = '0x' + '7'.repeat(40)
    const u = await makeUser()
    const id = await insertOrder({ user_id: u.id, mode: 'live', from_address: from, deposit_address: VAULT, status: 'deposit_reported', tx_hash: hex('9') })
    await ingest(await obs({ txHash: hex('4'), from }))
    expect((await getOrder(id))?.status).toBe('detected')
    expect((await getOrder(id))?.tx_hash).toBe(hex('4'))
  })
})
