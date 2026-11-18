import { describe, expect, test } from 'bun:test'
import '../../server/wallet/routes'
import { api, count, makeUser, PIN, tokenFor } from '../helpers'
import '../../server/swap/routes'
import { HttpError } from '../../server/auth'
import { get, now, run, uid } from '../../server/db'
import { ceilUnits, checkSwapInput, swapConfirmToken, DEFAULT_SLIPPAGE_BPS, MAX_SLIPPAGE_BPS } from '../../server/swap/service'
import { normalizeToken, SWAP_TOKENS } from '../../server/swap/chains'

const status = (fn: () => unknown) => { try { fn() } catch (e) { return (e as HttpError).status } return 0 }
const good = { tokenIn: 'USDC', tokenOut: 'EURC', amount: '1.5' }

describe('Circle swap input checks', () => {
  test('a valid swap is accepted with the default 1% slippage', () => {
    expect(checkSwapInput(good)).toEqual({ tokenIn: 'USDC', tokenOut: 'EURC', amount: '1.5', slippageBps: DEFAULT_SLIPPAGE_BPS })
    expect(checkSwapInput({ ...good, tokenIn: 'usdc', tokenOut: 'cirBTC', slippageBps: 50 }).tokenOut).toBe('CIRBTC')
  })
  test('only USDC, EURC and cirBTC can be swapped', () => {
    expect(SWAP_TOKENS.map((t) => t.symbol)).toEqual(['USDC', 'EURC', 'CIRBTC'])
    for (const bad of ['USDT', 'DAI', 'WETH', 'NATIVE', '', '0x3600000000000000000000000000000000000000', '__proto__']) {
      expect(normalizeToken(bad)).toBeNull()
      expect(status(() => checkSwapInput({ ...good, tokenOut: bad }))).toBe(400)
    }
  })
  test('the same token on both sides is refused', () => {
    expect(status(() => checkSwapInput({ ...good, tokenOut: 'USDC' }))).toBe(400)
  })
  test('bad amounts are refused', () => {
    for (const amount of ['0', '0.0', '-1', '1e3', '1,5', ' 1', '1.123456789', '', 'abc', '1000000000000']) {
      expect(status(() => checkSwapInput({ ...good, amount }))).toBe(400)
    }
  })
  test('slippage is always bounded: at least 0.1% and never above 3%', () => {
    expect(checkSwapInput({ ...good, slippageBps: MAX_SLIPPAGE_BPS }).slippageBps).toBe(300)
    for (const slippageBps of [0, 5, 301, 10_000, 1.5, -100, Number.NaN]) expect(status(() => checkSwapInput({ ...good, slippageBps }))).toBe(400)
  })
})

describe('Circle swap API', () => {
  test('every route needs a signed-in user', async () => {
    for (const [m, p] of [['GET', '/api/swap/config'], ['POST', '/api/swap/quote'], ['POST', '/api/swap/start'], ['GET', '/api/swap/ops'], ['GET', '/api/swap/ops/x']]) {
      expect((await api(m, p, { body: m === 'POST' ? good : undefined })).status).toBe(401)
    }
  })
  test('the config offers Arc Testnet and the three tokens only', async () => {
    const u = await makeUser({ pin: true })
    const r = await api('GET', '/api/swap/config', { token: await tokenFor(u) })
    expect(r.status).toBe(200)
    expect(r.json.network).toBe('testnet')
    expect((r.json.tokens as { symbol: string }[]).map((t) => t.symbol)).toEqual(['USDC', 'EURC', 'CIRBTC'])
  })
  test('a quote for an unknown token, the same token or a bad amount never reaches the network', async () => {
    const t = await tokenFor(await makeUser({ pin: true }))
    for (const body of [{ ...good, tokenOut: 'USDT' }, { ...good, tokenOut: 'USDC' }, { ...good, amount: '0' }, { ...good, slippageBps: 5000 }]) {
      expect((await api('POST', '/api/swap/quote', { token: t, body })).status).toBe(400)
    }
  })
  test('swaps stop while the platform is paused', async () => {
    const t = await tokenFor(await makeUser({ pin: true }))
    await run("UPDATE settings SET value='true' WHERE key='platform_paused'")
    try {
      expect((await api('POST', '/api/swap/quote', { token: t, body: good })).status).toBe(503)
    } finally {
      await run("UPDATE settings SET value='false' WHERE key='platform_paused'")
    }
  })
  test('a per-swap limit is enforced before any network call', async () => {
    const t = await tokenFor(await makeUser({ pin: true }))
    const r = await api('POST', '/api/swap/quote', { token: t, body: { tokenIn: 'USDC', tokenOut: 'EURC', amount: '501' } })
    expect(r.status).toBe(403)
    const c = await api('POST', '/api/swap/quote', { token: t, body: { tokenIn: 'CIRBTC', tokenOut: 'USDC', amount: '0.001' } })
    expect(c.status).toBe(403)
  })
})

describe('Circle swap start is guarded', () => {
  const body = (extra: Record<string, unknown>) => ({ ...good, slippageBps: 100, pin: PIN, idempotencyKey: `idem-${uid('k')}`, ...extra })

  test('an expired confirmation is refused', async () => {
    const u = await makeUser({ pin: true }), t = await tokenFor(u)
    const exp = now() - 1000
    const token = swapConfirmToken(u.id, checkSwapInput(good), exp)
    expect((await api('POST', '/api/swap/start', { token: t, body: body({ confirmToken: token, expiresAt: exp }) })).status).toBe(410)
  })
  test('a confirmation for different details, or another user, is refused', async () => {
    const u = await makeUser({ pin: true }), other = await makeUser({ pin: true }), t = await tokenFor(u)
    const exp = now() + 60_000
    const forOther = swapConfirmToken(other.id, checkSwapInput(good), exp)
    expect((await api('POST', '/api/swap/start', { token: t, body: body({ confirmToken: forOther, expiresAt: exp }) })).status).toBe(400)
    const forSmaller = swapConfirmToken(u.id, checkSwapInput({ ...good, amount: '1' }), exp)
    expect((await api('POST', '/api/swap/start', { token: t, body: body({ confirmToken: forSmaller, expiresAt: exp }) })).status).toBe(400)
    const forOtherSlippage = swapConfirmToken(u.id, checkSwapInput({ ...good, slippageBps: 300 }), exp)
    expect((await api('POST', '/api/swap/start', { token: t, body: body({ confirmToken: forOtherSlippage, expiresAt: exp }) })).status).toBe(400)
  })
  test('a wrong PIN stops the swap before anything is recorded', async () => {
    const u = await makeUser({ pin: true }), t = await tokenFor(u)
    const exp = now() + 60_000
    const token = swapConfirmToken(u.id, checkSwapInput(good), exp)
    const r = await api('POST', '/api/swap/start', { token: t, body: body({ confirmToken: token, expiresAt: exp, pin: '1357' }) })
    expect([400, 401, 403, 423, 429]).toContain(r.status)
    expect(await count('SELECT COUNT(*) AS c FROM swap_ops WHERE user_id=?', u.id)).toBe(0)
  })
  test('a PIN that is not four digits is refused', async () => {
    const u = await makeUser({ pin: true }), t = await tokenFor(u)
    expect((await api('POST', '/api/swap/start', { token: t, body: body({ confirmToken: 'x', expiresAt: now() + 1000, pin: '12' }) })).status).toBe(400)
  })
  test('the same idempotency key returns the first swap and never starts another', async () => {
    const u = await makeUser({ pin: true }), t = await tokenFor(u)
    const id = uid('swp'), key = 'idem-repeat-0001'
    await run(
      "INSERT INTO swap_ops(id,user_id,chain,address,token_in,token_out,amount_in,slippage_bps,provider,status,idem_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      id, u.id, 'Arc_Testnet', '0x0000000000000000000000000000000000000001', 'USDC', 'EURC', '1.5', 100, 'lifi', 'completed', key, now(), now(),
    )
    const r = await api('POST', '/api/swap/start', { token: t, body: body({ confirmToken: 'anything', expiresAt: 1, idempotencyKey: key }) })
    expect(r.status).toBe(200)
    expect((r.json.op as { id: string }).id).toBe(id)
    expect(await count('SELECT COUNT(*) AS c FROM swap_ops WHERE user_id=?', u.id)).toBe(1)
  })
  test('one user cannot read another user\'s swap', async () => {
    const a = await makeUser({ pin: true }), b = await makeUser({ pin: true })
    const id = uid('swp')
    await run(
      "INSERT INTO swap_ops(id,user_id,chain,address,token_in,token_out,amount_in,slippage_bps,status,idem_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      id, a.id, 'Arc_Testnet', '0x0000000000000000000000000000000000000002', 'USDC', 'EURC', '1', 100, 'completed', `idem-${id}`, now(), now(),
    )
    expect((await api('GET', `/api/swap/ops/${id}`, { token: await tokenFor(a) })).status).toBe(200)
    expect((await api('GET', `/api/swap/ops/${id}`, { token: await tokenFor(b) })).status).toBe(404)
    expect(((await api('GET', '/api/swap/ops', { token: await tokenFor(b) })).json.ops as unknown[]).length).toBe(0)
    expect((await get<{ id: string }>('SELECT id FROM swap_ops WHERE id=?', id))?.id).toBe(id)
  })
})

describe('Circle swap fees', () => {
  test('a fee with more decimals than the token is rounded up, never down, and never throws', () => {
    expect(ceilUnits('0.0235855725', 6)).toBe(23_586n)
    expect(ceilUnits('0.0002', 6)).toBe(200n)
    expect(ceilUnits('1', 6)).toBe(1_000_000n)
    expect(ceilUnits('0.0000001', 6)).toBe(1n)
    expect(ceilUnits('0.000000', 6)).toBe(0n)
  })
  test('an unreadable fee from the provider is refused', () => {
    expect(() => ceilUnits('abc', 6)).toThrow()
    expect(() => ceilUnits('1e-5', 6)).toThrow()
  })
})

describe('swap and bridge history', () => {
  test('both sides of a swap are written once, with the right amounts, and show in the History list', async () => {
    const { recordHistoryLeg, unitsOf } = await import('../../server/wallet/history')
    const { get } = await import('../../server/db')
    const u = await makeUser({ pin: true })
    const token = await tokenFor(u)
    const hash = `0x${'ab'.repeat(32)}`
    const base = { userId: u.id, networkId: 'arc-testnet', type: 'swapped' as const, hash }
    expect(unitsOf('1.3357289999', 6)).toBe(1_335_728n)
    expect(unitsOf('0.00000464', 8)).toBe(464n)
    for (let i = 0; i < 2; i++) {
      await recordHistoryLeg({ ...base, symbol: 'USDC', amountRaw: 1_000_000n, from: '0xme', to: 'Circle swap', leg: 0, note: 'Paid in a swap for EURC' })
      await recordHistoryLeg({ ...base, symbol: 'EURC', amountRaw: 1_335_728n, from: 'Circle swap', to: '0xme', leg: 1, note: 'Received in a swap for USDC' })
      await recordHistoryLeg({ userId: u.id, networkId: 'arc-testnet', type: 'swapped', hash: `0x${'cd'.repeat(32)}`, symbol: 'cirBTC', amountRaw: 464n, from: 'Circle swap', to: '0xme', leg: 1, note: 'Received in a swap for USDC' })
    }
    expect(await count("SELECT COUNT(*) c FROM wallet_txs WHERE user_id=? AND type='swapped'", u.id)).toBe(3)
    const r = await api('GET', '/api/crypto/txs?type=swapped', { token })
    const txs = r.json.txs as { symbol: string; amount: string; note: string }[]
    const by = Object.fromEntries(txs.map((t) => [t.symbol, t]))
    expect(by.USDC.amount).toBe('1')
    expect(by.EURC.amount).toBe('1.335728')
    expect(by.cirBTC.amount).toBe('0.00000464')
    expect(by.EURC.note).toMatch(/^Received/)
    // The entry points at the wallet's own EURC asset when that asset is loaded, and reads correctly either way.
    expect([null, 'EURC@arc-testnet'] as (string | null | undefined)[]).toContain((await get<{ asset_key: string | null }>("SELECT asset_key FROM wallet_txs WHERE user_id=? AND symbol='EURC'", u.id))?.asset_key)
    // Another user never sees these entries.
    const other = await makeUser({ pin: true })
    expect(((await api('GET', '/api/crypto/txs?type=swapped', { token: await tokenFor(other) })).json.txs as unknown[]).length).toBe(0)
  })
})

describe('exchange swaps and bridged balances', () => {
  const pad = (a: string) => `0x${'0'.repeat(24)}${a.toLowerCase().replace('0x', '')}`
  const T = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

  test('an older NairaSwap swap is rebuilt from its receipt: what left the wallet and what arrived', async () => {
    const { recordDexHistory } = await import('../../server/wallet/history')
    const { ASSETS } = await import('../../server/wallet/networks')
    const { ensureWallet } = await import('../../server/wallet/keys')
    const u = await makeUser({ pin: true })
    const token = await tokenFor(u)
    const me = (await ensureWallet(u.id)).evm
    const usdc = '0x3600000000000000000000000000000000000000', eurc = '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a', pair = '0x1111111111111111111111111111111111111111', lp = '0x2222222222222222222222222222222222222222'
    const def = (symbol: string, contract: string) => ({ key: `${symbol}@arc-testnet`, symbol, name: symbol, network: 'arc-testnet', kind: 'erc20', contract, decimals: 6 }) as never
    ASSETS.push(def('USDC', usdc), def('EURC', eurc))
    const hash = `0x${'12'.repeat(32)}`
    const receipt = { status: 'success', logs: [
      { address: usdc, topics: [T, pad(me), pad(pair)], data: `0x${(2_500_000n).toString(16)}`, logIndex: 3 },
      { address: eurc, topics: [T, pad(pair), pad(me)], data: `0x${(2_100_000n).toString(16)}`, logIndex: 4 },
      { address: lp, topics: [T, pad(pair), pad(me)], data: '0x01', logIndex: 5 }, // a token the wallet does not list: ignored
      { address: eurc, topics: [T, pad(pair), pad(pair)], data: '0x01', logIndex: 6 }, // not touching the wallet: ignored
    ] }
    try {
      expect(await recordDexHistory(u.id, 'arc-testnet', [hash], 'swap', async () => receipt)).toBe(2)
      expect(await recordDexHistory(u.id, 'arc-testnet', [hash], 'swap', async () => receipt)).toBe(2) // run again: still two entries
      expect(await count("SELECT COUNT(*) c FROM wallet_txs WHERE user_id=? AND tx_hash=?", u.id, hash)).toBe(2)
      const txs = (await api('GET', '/api/crypto/txs', { token })).json.txs as { symbol: string; amount: string; note: string }[]
      const by = Object.fromEntries(txs.map((t) => [t.symbol, t]))
      expect(by.USDC.amount).toBe('2.5')
      expect(by.USDC.note).toMatch(/^Paid/)
      expect(by.EURC.amount).toBe('2.1')
      expect(by.EURC.note).toMatch(/^Received/)
    } finally {
      ASSETS.splice(ASSETS.length - 2, 2)
    }
  })

  test('the plain deposit the monitor also saw for a swap is not listed twice', async () => {
    const u = await makeUser({ pin: true })
    const token = await tokenFor(u)
    const hash = `0x${'34'.repeat(32)}`
    const t = Date.now()
    const ins = (type: string, leg: number) => run(
      `INSERT INTO wallet_txs(id,user_id,network,symbol,type,amount,from_addr,to_addr,tx_hash,status,verdict,confirmations,risk_score,risk_flags,detected_at,created_at,updated_at,log_index) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      `wtx_${type}_${leg}_${t}`, u.id, 'arc-testnet', 'EURC', type, '1000000', '0xa', '0xb', hash, 'finalized', 'genuine', 1, 0, '[]', t, t, t, leg)
    await ins('received', 7)
    await ins('swapped', 1)
    const txs = (await api('GET', '/api/crypto/txs', { token })).json.txs as { type: string }[]
    expect(txs.map((x) => x.type)).toEqual(['swapped'])
  })

  test('bridged balances need a login and never include networks the wallet already lists', async () => {
    await import('../../server/bridge/holdings')
    expect((await api('GET', '/api/bridge/holdings')).status).toBe(401)
    const { bridgeChains } = await import('../../server/bridge/chains')
    const { getAssetDef } = await import('../../server/wallet/networks')
    const unlisted = bridgeChains().filter((c) => !getAssetDef(`USDC@${c.id}`))
    expect(unlisted.some((c) => c.id === 'hyperevm-testnet')).toBe(true)
  })
})

describe('older bridge transfers', () => {
  test('a bridge that finished before History existed gets its two entries once', async () => {
    const { backfillBridgeHistory } = await import('../../server/bridge/history')
    const u = await makeUser({ pin: true })
    const token = await tokenFor(u)
    const burn = `0x${'56'.repeat(32)}`, mint = `0x${'78'.repeat(32)}`
    await run(
      `INSERT INTO bridge_ops(id,user_id,from_chain,to_chain,amount,status,steps,recipient,idem_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      uid('brg'), u.id, 'arc-testnet', 'hyperevm-testnet', '10', 'completed',
      JSON.stringify([{ name: 'approve', txHash: `0x${'aa'.repeat(32)}` }, { name: 'burn', txHash: burn }, { name: 'mint', txHash: mint }]), '0xme', `idem-${uid('k')}`, now(), now())
    await backfillBridgeHistory()
    await backfillBridgeHistory()
    const txs = (await api('GET', '/api/crypto/txs?type=bridged', { token })).json.txs as { amount: string; network: string; note: string }[]
    expect(txs.length).toBe(2)
    expect(txs.every((t) => t.amount === '10')).toBe(true)
    expect(txs.map((t) => t.note).sort()[0]).toMatch(/^Paid/)
  })
})
