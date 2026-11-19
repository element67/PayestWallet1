import { describe, expect, test } from 'bun:test'
import '../../server/wallet/routes'
import '../../server/uniswap/routes'
import { api, count, makeUser, PIN, tokenFor } from '../helpers'
import { HttpError } from '../../server/auth'
import { get, now, run, uid } from '../../server/db'
import { ASSETS } from '../../server/wallet/networks'
import { UNI_NETWORKS, uniNetwork } from '../../server/uniswap/config'
import { checkUniInput, uniConfirmToken, UNI_MAX_SLIPPAGE_BPS } from '../../server/uniswap/service'

const good = { networkId: 'ethereum-sepolia', tokenIn: 'USDC', tokenOut: 'EURC', amount: '1' }
const status = (fn: () => unknown) => { try { fn(); return 0 } catch (e) { return e instanceof HttpError ? e.status : -1 } }

describe('Uniswap input checks', () => {
  test('a valid request is accepted and symbols are normalised', () => {
    const c = checkUniInput({ ...good, tokenIn: 'usdc', tokenOut: ' weth ' })
    expect(c.tokenIn).toBe('USDC')
    expect(c.tokenOut).toBe('WETH')
    expect(c.slippageBps).toBe(50)
  })
  test('only networks on the server allow-list are accepted', () => {
    for (const networkId of ['arc-testnet', 'ethereum', 'base-sepolia', '', '../etc', '0x1']) expect(status(() => checkUniInput({ ...good, networkId }))).toBe(400)
    expect(UNI_NETWORKS.map((n) => n.id)).toEqual(['ethereum-sepolia'])
    expect(uniNetwork('ethereum-sepolia').router).toMatch(/^0x[0-9a-fA-F]{40}$/)
  })
  test('token symbols cannot smuggle addresses or odd text', () => {
    for (const tokenOut of ['0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', 'US DC', '', '__proto__', 'A']) expect(status(() => checkUniInput({ ...good, tokenOut }))).toBe(400)
    expect(status(() => checkUniInput({ ...good, tokenOut: 'USDC' }))).toBe(400)
  })
  test('bad amounts are refused', () => {
    for (const amount of ['0', '0.0', '-1', '1e3', '1,5', ' 1', '', 'abc', '1.1234567890123456789']) expect(status(() => checkUniInput({ ...good, amount }))).toBe(400)
  })
  test('slippage is always bounded: at least 0.1% and never above 1%', () => {
    expect(checkUniInput({ ...good, slippageBps: UNI_MAX_SLIPPAGE_BPS }).slippageBps).toBe(100)
    for (const slippageBps of [0, 5, 101, 300, 10_000, 1.5, -100, Number.NaN]) expect(status(() => checkUniInput({ ...good, slippageBps }))).toBe(400)
  })
})

describe('Uniswap API', () => {
  test('every route needs a signed-in user', async () => {
    for (const [m, p] of [['GET', '/api/uniswap/config'], ['POST', '/api/uniswap/quote'], ['POST', '/api/uniswap/start']]) {
      expect((await api(m, p, { body: m === 'POST' ? good : undefined })).status).toBe(401)
    }
  })
  test('a quote for a network that is not allowed, an unknown token or a bad amount never reaches the chain', async () => {
    const t = await tokenFor(await makeUser({ pin: true }))
    for (const body of [{ ...good, networkId: 'arc-testnet' }, { ...good, tokenOut: 'DOGE' }, { ...good, tokenOut: 'USDC' }, { ...good, amount: '0' }, { ...good, slippageBps: 500 }]) {
      expect((await api('POST', '/api/uniswap/quote', { token: t, body })).status).toBe(400)
    }
  })
  test('swaps stop while the platform is paused', async () => {
    const t = await tokenFor(await makeUser({ pin: true }))
    await run("UPDATE settings SET value='true' WHERE key='platform_paused'")
    try {
      expect((await api('POST', '/api/uniswap/quote', { token: t, body: good })).status).toBe(503)
    } finally {
      await run("UPDATE settings SET value='false' WHERE key='platform_paused'")
    }
  })
  test('the per-swap limit is enforced before any pool is read', async () => {
    const t = await tokenFor(await makeUser({ pin: true }))
    // The wallet's asset list is loaded at app start; here two entries stand in for it.
    const def = (symbol: string) => ({ key: `${symbol}@ethereum-sepolia`, symbol, name: symbol, network: 'ethereum-sepolia', kind: 'token', contract: `0x${symbol === 'USDC' ? '1' : '2'}`.padEnd(42, '0'), decimals: 6 }) as never
    ASSETS.push(def('USDC'), def('EURC'))
    try {
      const r = await api('POST', '/api/uniswap/quote', { token: t, body: { ...good, amount: '501' } })
      expect(r.status).toBe(403)
      expect(String(r.json.error)).toMatch(/limit/i)
    } finally {
      ASSETS.splice(ASSETS.length - 2, 2)
    }
  })
})

describe('Uniswap start', () => {
  const start = (extra: Record<string, unknown>) => ({ ...good, slippageBps: 50, feeTier: 500, minimumOutRaw: '900000', pin: PIN, idempotencyKey: `idem-${uid('k')}`, confirmToken: 'x', expiresAt: now() + 60_000, ...extra })

  test('an expired quote, a tampered quote and a bad fee tier are all refused', async () => {
    const u = await makeUser({ pin: true })
    const t = await tokenFor(u)
    expect((await api('POST', '/api/uniswap/start', { token: t, body: start({ expiresAt: now() - 1000 }) })).status).toBe(410)
    expect((await api('POST', '/api/uniswap/start', { token: t, body: start({}) })).status).toBe(400)
    expect((await api('POST', '/api/uniswap/start', { token: t, body: start({ feeTier: 777 }) })).status).toBe(400)
    // A confirmation signed for one minimum cannot be reused with a different minimum or amount.
    const exp = now() + 60_000
    const sig = uniConfirmToken(u.id, checkUniInput({ ...good, slippageBps: 50 }), 500, '900000', exp)
    expect((await api('POST', '/api/uniswap/start', { token: t, body: start({ confirmToken: sig, expiresAt: exp, minimumOutRaw: '1' }) })).status).toBe(400)
    expect((await api('POST', '/api/uniswap/start', { token: t, body: start({ confirmToken: sig, expiresAt: exp, amount: '2' }) })).status).toBe(400)
    expect(await count('SELECT COUNT(*) c FROM swap_ops WHERE user_id=?', u.id)).toBe(0)
  })

  test('a wrong PIN stops the swap before anything is recorded', async () => {
    const u = await makeUser({ pin: true })
    const exp = now() + 60_000
    const sig = uniConfirmToken(u.id, checkUniInput({ ...good, slippageBps: 50 }), 500, '900000', exp)
    const r = await api('POST', '/api/uniswap/start', { token: await tokenFor(u), body: start({ confirmToken: sig, expiresAt: exp, pin: '0000' }) })
    expect([400, 401, 403]).toContain(r.status)
    expect(await count('SELECT COUNT(*) c FROM swap_ops WHERE user_id=?', u.id)).toBe(0)
  })

  test('the same idempotency key returns the first swap and starts nothing new', async () => {
    const u = await makeUser({ pin: true })
    const t = await tokenFor(u)
    const key = `idem-${uid('k')}`
    await run(
      "INSERT INTO swap_ops(id,user_id,chain,address,token_in,token_out,amount_in,slippage_bps,provider,status,tx_hash,fees,idem_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      'swp_uni_first', u.id, 'ethereum-sepolia', '0xme', 'USDC', 'EURC', '1', 50, 'Uniswap v3 (0.05% pool)', 'completed', '0xabc', '[]', key, now(), now())
    const r = await api('POST', '/api/uniswap/start', { token: t, body: start({ idempotencyKey: key }) })
    expect(r.status).toBe(200)
    expect((r.json.op as { id: string }).id).toBe('swp_uni_first')
    expect((r.json.op as { chain: string }).chain).toBe('Ethereum Sepolia')
    expect(await count('SELECT COUNT(*) c FROM swap_ops WHERE user_id=?', u.id)).toBe(1)
    const ops = (await api('GET', '/api/uniswap/ops', { token: t })).json.ops as { provider: string }[]
    expect(ops[0].provider).toContain('Uniswap')
    expect((await get('SELECT 1 x FROM swap_ops WHERE id=?', 'swp_uni_first'))).toBeTruthy()
  })
})
