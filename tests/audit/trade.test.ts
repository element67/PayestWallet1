import { afterEach, describe, expect, test } from 'bun:test'
import '../../server/wallet/routes'
import '../../server/trade/routes'
import { api, count, makeUser, PIN, tokenFor } from '../helpers'
import { HttpError } from '../../server/auth'
import { get, now, run, uid } from '../../server/db'
import { setting } from '../../server/db'
import { providerStatus } from '../../server/trade/config'
import { confirmToken, buildRequest } from '../../server/trade/service'
import { activeProviders, collectQuotes, pickBest, preference, PROVIDERS } from '../../server/trade/router'
import { achswap } from '../../server/trade/providers/achswap'
import { lifi } from '../../server/trade/providers/lifi'
import { circle, ceilToUnits } from '../../server/trade/providers/circle'
import type { Provider, ProviderQuote } from '../../server/trade/types'
import { recordHistoryLeg, unitsOf } from '../../server/wallet/history'

const status = (fn: () => unknown) => { try { fn(); return 0 } catch (e) { return e instanceof HttpError ? e.status : -1 } }
const bridge = { kind: 'bridge', from: 'arc-testnet', to: 'base-sepolia', tokenIn: 'USDC', amount: '1' }
const swap = { kind: 'swap', from: 'arc-testnet', to: 'arc-testnet', tokenIn: 'USDC', tokenOut: 'EURC', amount: '1' }

describe('request validation', () => {
  test('valid bridge and swap requests are built from server-known chains and tokens only', () => {
    const b = buildRequest('testnet', bridge)
    expect(b.from.id).toBe('arc-testnet')
    expect(b.tokenOut.symbol).toBe('USDC')
    expect(b.amountRaw).toBe(1_000_000n)
    expect(buildRequest('testnet', swap).tokenOut.symbol).toBe('EURC')
  })
  test('unknown networks, other modes and odd ids are refused', () => {
    for (const from of ['ethereum', 'arc', '0x1', '', '../x', 'ARC-TESTNET']) expect(status(() => buildRequest('testnet', { ...bridge, from }))).toBe(400)
    expect(status(() => buildRequest('testnet', { ...bridge, kind: 'send' }))).toBe(400)
  })
  test('a swap stays on one network and a bridge needs two', () => {
    expect(status(() => buildRequest('testnet', { ...swap, to: 'base-sepolia' }))).toBe(400)
    expect(status(() => buildRequest('testnet', { ...bridge, to: 'arc-testnet' }))).toBe(400)
  })
  test('tokens must be ones the network offers; an address is never accepted as a token', () => {
    for (const tokenIn of ['USDT', 'DOGE', '0x3600000000000000000000000000000000000000', 'US DC', '__proto__']) expect(status(() => buildRequest('testnet', { ...bridge, tokenIn }))).toBe(400)
    expect(status(() => buildRequest('testnet', { ...swap, tokenOut: 'USDC' }))).toBe(400)
    expect(status(() => buildRequest('testnet', { ...swap, from: 'base-sepolia', to: 'base-sepolia', tokenOut: 'CIRBTC' }))).toBe(400)
  })
  test('bad amounts are refused', () => {
    for (const amount of ['0', '0.0', '-1', '1e3', '1,5', ' 1', '', 'abc', '1000000000000', '1.1234567890']) expect(status(() => buildRequest('testnet', { ...bridge, amount }))).toBe(400)
    expect(status(() => buildRequest('testnet', { ...bridge, amount: '1.1234567' }))).toBe(400) // USDC has 6 decimals
  })
  test('slippage is bounded: at least 0.1% and never above 3%', () => {
    expect(buildRequest('testnet', { ...swap, slippageBps: 300 }).slippageBps).toBe(300)
    for (const slippageBps of [0, 5, 301, 10_000, 1.5, -100, Number.NaN]) expect(status(() => buildRequest('testnet', { ...swap, slippageBps }))).toBe(400)
  })
  test('the confirmation changes with every detail the user saw', () => {
    const r = buildRequest('testnet', bridge)
    const t = confirmToken('u1', 'testnet', 'circle', r, 1000)
    expect(confirmToken('u1', 'testnet', 'circle', r, 1000)).toBe(t)
    expect(confirmToken('u2', 'testnet', 'circle', r, 1000)).not.toBe(t)
    expect(confirmToken('u1', 'mainnet', 'circle', r, 1000)).not.toBe(t)
    expect(confirmToken('u1', 'testnet', 'lifi', r, 1000)).not.toBe(t)
    expect(confirmToken('u1', 'testnet', 'circle', buildRequest('testnet', { ...bridge, amount: '2' }), 1000)).not.toBe(t)
    expect(confirmToken('u1', 'testnet', 'circle', buildRequest('testnet', { ...bridge, speed: 'slow' }), 1000)).not.toBe(t)
    expect(confirmToken('u1', 'testnet', 'circle', r, 1001)).not.toBe(t)
  })
})

const fake = (id: 'circle' | 'lifi' | 'achswap', o: { out?: bigint; fail?: string; unsupported?: string; slow?: boolean }): Provider => ({
  id, name: id,
  unsupported: () => o.unsupported ?? null,
  getQuote: async (): Promise<ProviderQuote> => {
    if (o.fail) throw new HttpError(502, o.fail)
    return { provider: id, providerName: id, amountOut: String(o.out ?? 0n), amountOutRaw: o.out ?? 0n, minOut: null, fees: [], etaSeconds: 10, route: [] }
  },
  checkApproval: async () => null,
  execute: async () => ({ ok: true, txHashes: [] }),
})
const who = { userId: 'u', evm: '0x0', solana: 's' }

describe('router', () => {
  test('the routing rules: Circle first for USDC and EURC bridges and Arc stablecoin swaps, AchSwap for other Arc tokens, LI.FI elsewhere', () => {
    expect(preference(buildRequest('testnet', bridge))).toEqual(['circle', 'lifi'])
    expect(preference(buildRequest('testnet', swap))).toEqual(['circle', 'achswap'])
  })
  test('a provider that fails or does not support the route is skipped and never stops the others', async () => {
    const req = buildRequest('testnet', bridge)
    const r = await collectQuotes(req, who, 'testnet', [fake('circle', { out: 900n }), fake('lifi', { fail: 'LI.FI is down' }), fake('achswap', { unsupported: 'swaps only' })])
    expect(r.quotes.map((q) => q.provider)).toEqual(['circle'])
    expect(r.skipped.map((s) => s.provider).sort()).toEqual(['achswap', 'lifi'])
    expect(r.skipped.find((s) => s.provider === 'lifi')?.reason).toContain('down')
  })
  test('when every provider fails the result is empty, not an exception', async () => {
    const r = await collectQuotes(buildRequest('testnet', bridge), who, 'testnet', [fake('circle', { fail: 'x' }), fake('lifi', { fail: 'y' })])
    expect(r.quotes).toEqual([])
    expect(pickBest(buildRequest('testnet', bridge), r.quotes).best).toBeNull()
  })
  test('the preferred provider is recommended even when another pays more, and the others are listed by output', () => {
    const req = buildRequest('testnet', bridge)
    const mk = (provider: ProviderQuote['provider'], out: bigint): ProviderQuote => ({ provider, providerName: provider, amountOut: String(out), amountOutRaw: out, minOut: null, fees: [], etaSeconds: null, route: [] })
    const { best, alternatives } = pickBest(req, [mk('lifi', 990_000n), mk('circle', 950_000n)])
    expect(best?.provider).toBe('circle')
    expect(alternatives.map((a) => a.provider)).toEqual(['lifi'])
    // With the preferred provider gone, the best of the rest is recommended.
    const swapReq = buildRequest('testnet', swap)
    expect(pickBest(swapReq, [mk('achswap', 5n), mk('lifi', 9n)]).best?.provider).toBe('achswap')
    expect(pickBest(swapReq, [mk('lifi', 5n), mk('lifi', 9n)]).best?.amountOutRaw).toBe(9n)
  })
  test('while the mainnet-integrations flag is off, swaps are off for every provider and only Circle can bridge', () => {
    const saved = process.env.ENABLE_MAINNET_INTEGRATIONS
    delete process.env.ENABLE_MAINNET_INTEGRATIONS
    try {
      expect(activeProviders(buildRequest('testnet', swap))).toEqual([])
      expect(activeProviders(buildRequest('testnet', bridge)).map((p) => p.id)).toEqual(['circle'])
      process.env.ENABLE_MAINNET_INTEGRATIONS = 'true'
      expect(activeProviders(buildRequest('testnet', swap)).map((p) => p.id).sort()).toEqual(['achswap', 'circle', 'lifi'])
    } finally { if (saved === undefined) delete process.env.ENABLE_MAINNET_INTEGRATIONS; else process.env.ENABLE_MAINNET_INTEGRATIONS = saved }
  })
  test('every provider in the registry answers the same interface', () => {
    for (const p of Object.values(PROVIDERS)) for (const fn of ['unsupported', 'getQuote', 'checkApproval', 'execute'] as const) expect(typeof p[fn]).toBe('function')
  })
})

describe('providers', () => {
  test('on the test network only Circle can run; LI.FI and AchSwap are mainnet only', () => {
    const r = buildRequest('testnet', bridge)
    expect(circle.unsupported(r, 'testnet')).toBeNull()
    expect(lifi.unsupported(r, 'testnet')).toMatch(/mainnet/)
    expect(achswap.unsupported(buildRequest('testnet', swap), 'testnet')).toMatch(/not set up|mainnet/)
  })
  test('Circle swaps on the test network are Arc Testnet only', () => {
    expect(circle.unsupported(buildRequest('testnet', { ...swap, from: 'base-sepolia', to: 'base-sepolia', tokenIn: 'USDC', tokenOut: 'EURC' }), 'testnet')).toMatch(/Arc Testnet/)
  })
  test('LI.FI refuses to sign anything until its allowed contracts are configured', async () => {
    const r = buildRequest('testnet', bridge)
    const saved = process.env.LIFI_ALLOWED_TARGETS
    delete process.env.LIFI_ALLOWED_TARGETS
    try {
      await expect(lifi.execute(r, {} as ProviderQuote, who, 'mainnet', { step: async () => undefined }, null)).rejects.toThrow(/LIFI_ALLOWED_TARGETS/)
    } finally { if (saved !== undefined) process.env.LIFI_ALLOWED_TARGETS = saved }
  })
  test('fees are rounded up to the token, never down', () => {
    expect(ceilToUnits('0.0235855725', 6)).toBe(23_586n)
    expect(ceilToUnits('0.052993', 6)).toBe(52_993n)
    expect(ceilToUnits('1', 6)).toBe(1_000_000n)
    expect(() => ceilToUnits('abc', 6)).toThrow()
  })
  test('provider keys are reported only as yes or no', () => {
    const s = JSON.stringify(providerStatus())
    expect(s).not.toMatch(/ach_dev|sk_|key":"/)
    expect(Object.keys(providerStatus()).sort()).toEqual(['achswap', 'circle', 'lifi'])
  })
})

describe('trade API', () => {
  test('every route needs a signed-in user', async () => {
    for (const [m, p] of [['GET', '/api/trade/config'], ['GET', '/api/trade/balances?chain=arc-testnet'], ['POST', '/api/trade/quote'], ['POST', '/api/trade/start'], ['GET', '/api/trade/ops'], ['GET', '/api/trade/ops/x'], ['POST', '/api/trade/ops/x/resume'], ['GET', '/api/trade/holdings']]) {
      expect((await api(m, p, { body: m === 'POST' ? bridge : undefined })).status).toBe(401)
    }
  })
  test('the config lists networks and tokens, marks the mode, and never carries a key', async () => {
    const t = await tokenFor(await makeUser({ pin: true }))
    const r = await api('GET', '/api/trade/config', { token: t })
    expect(r.status).toBe(200)
    expect(r.json.mode).toBe('testnet')
    const chains = r.json.chains as { id: string; swap: boolean; swapTokens: { symbol: string }[] }[]
    expect(chains.length).toBeGreaterThanOrEqual(10)
    expect(chains.filter((c) => c.swap).map((c) => c.id)).toEqual(['arc-testnet'])
    expect(chains.find((c) => c.id === 'arc-testnet')?.swapTokens.map((x) => x.symbol)).toEqual(['USDC', 'EURC', 'CIRBTC'])
    expect(JSON.stringify(r.json)).not.toMatch(/api[_-]?key|x-api-key/i)
  })
  test('quotes with bad input never reach a provider', async () => {
    const t = await tokenFor(await makeUser({ pin: true }))
    for (const body of [{ ...bridge, from: 'nope' }, { ...bridge, tokenIn: 'DOGE' }, { ...bridge, amount: '0' }, { ...swap, slippageBps: 5000 }, { ...swap, to: 'base-sepolia' }]) {
      expect((await api('POST', '/api/trade/quote', { token: t, body })).status).toBe(400)
    }
  })
  test('trading stops while the platform is paused', async () => {
    const t = await tokenFor(await makeUser({ pin: true }))
    await run("UPDATE settings SET value='true' WHERE key='platform_paused'")
    try { expect((await api('POST', '/api/trade/quote', { token: t, body: bridge })).status).toBe(503) } finally { await run("UPDATE settings SET value='false' WHERE key='platform_paused'") }
  })
  test('the per-trade limit is enforced before any balance or provider call', async () => {
    const t = await tokenFor(await makeUser({ pin: true }))
    const r = await api('POST', '/api/trade/quote', { token: t, body: { ...bridge, amount: '501' } })
    expect(r.status).toBe(403)
    expect(String(r.json.error)).toMatch(/limit/i)
  })
})

describe('trade start', () => {
  const start = (extra: Record<string, unknown>) => ({ ...bridge, slippageBps: 50, provider: 'circle', pin: PIN, idempotencyKey: `idem-${uid('k')}`, confirmToken: 'x', expiresAt: now() + 60_000, ...extra })

  test('an expired quote, a tampered quote, an unknown provider and a provider that cannot run the route are refused', async () => {
    const u = await makeUser({ pin: true })
    const t = await tokenFor(u)
    expect((await api('POST', '/api/trade/start', { token: t, body: start({ expiresAt: now() - 1000 }) })).status).toBe(410)
    expect((await api('POST', '/api/trade/start', { token: t, body: start({}) })).status).toBe(400)
    expect((await api('POST', '/api/trade/start', { token: t, body: start({ provider: 'uniswapx' }) })).status).toBe(400)
    const exp = now() + 60_000
    const sig = confirmToken(u.id, 'testnet', 'circle', buildRequest('testnet', bridge), exp)
    expect((await api('POST', '/api/trade/start', { token: t, body: start({ confirmToken: sig, expiresAt: exp, amount: '2' }) })).status).toBe(400)
    const lifiSig = confirmToken(u.id, 'testnet', 'lifi', buildRequest('testnet', bridge), exp)
    expect((await api('POST', '/api/trade/start', { token: t, body: start({ provider: 'lifi', confirmToken: lifiSig, expiresAt: exp }) })).status).toBe(422)
    expect(await count('SELECT COUNT(*) c FROM trade_ops WHERE user_id=?', u.id)).toBe(0)
  })
  test('a wrong PIN stops the trade before anything is recorded', async () => {
    const u = await makeUser({ pin: true })
    const exp = now() + 60_000
    const sig = confirmToken(u.id, 'testnet', 'circle', buildRequest('testnet', bridge), exp)
    const r = await api('POST', '/api/trade/start', { token: await tokenFor(u), body: start({ confirmToken: sig, expiresAt: exp, pin: '0000' }) })
    expect([400, 401, 403]).toContain(r.status)
    expect(await count('SELECT COUNT(*) c FROM trade_ops WHERE user_id=?', u.id)).toBe(0)
  })
  test('the same idempotency key returns the first trade and starts nothing new', async () => {
    const u = await makeUser({ pin: true })
    const t = await tokenFor(u)
    const key = `idem-${uid('k')}`
    await run(
      "INSERT INTO trade_ops(id,user_id,kind,provider,mode,from_chain,to_chain,token_in,token_out,amount_in,slippage_bps,speed,status,steps,tx_hashes,address,recipient,idem_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      'trd_first', u.id, 'bridge', 'circle', 'testnet', 'arc-testnet', 'base-sepolia', 'USDC', 'USDC', '1', 50, 'fast', 'completed', '[]', '[]', '0xme', '0xme', key, now(), now())
    const r = await api('POST', '/api/trade/start', { token: t, body: start({ idempotencyKey: key }) })
    expect(r.status).toBe(200)
    expect((r.json.op as { id: string }).id).toBe('trd_first')
    expect(await count('SELECT COUNT(*) c FROM trade_ops WHERE user_id=?', u.id)).toBe(1)
    expect(((await api('GET', '/api/trade/ops', { token: t })).json.ops as unknown[]).length).toBe(1)
    // Another user cannot read it.
    expect((await api('GET', '/api/trade/ops/trd_first', { token: await tokenFor(await makeUser({ pin: true })) })).status).toBe(404)
  })
  test('only a failed trade that kept its resume state can be resumed', async () => {
    const u = await makeUser({ pin: true })
    const t = await tokenFor(u)
    await run(
      "INSERT INTO trade_ops(id,user_id,kind,provider,mode,from_chain,to_chain,token_in,token_out,amount_in,slippage_bps,speed,status,steps,tx_hashes,address,recipient,idem_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      'trd_done', u.id, 'bridge', 'circle', 'testnet', 'arc-testnet', 'base-sepolia', 'USDC', 'USDC', '1', 50, 'fast', 'completed', '[]', '[]', '0xme', '0xme', `idem-${uid('k')}`, now(), now())
    expect((await api('POST', '/api/trade/ops/trd_done/resume', { token: t, body: { pin: PIN } })).status).toBe(409)
    expect((await api('POST', '/api/trade/ops/nope/resume', { token: t, body: { pin: PIN } })).status).toBe(404)
  })
})

describe('founder trade settings', () => {
  afterEach(async () => { await run("UPDATE settings SET value='testnet' WHERE key='trade_network_mode'"); await run("DELETE FROM settings WHERE key IN ('trade_fee_bps','trade_fee_wallet')") })

  test('customers cannot read or change them', async () => {
    const t = await tokenFor(await makeUser({ pin: true }))
    expect((await api('GET', '/api/admin/trade-settings', { token: t })).status).toBe(403)
    expect((await api('PUT', '/api/admin/trade-settings', { token: t, body: { feeBps: 50 } })).status).toBe(403)
  })
  test('switching networks needs the confirmation the screen shows, and is audit-logged', async () => {
    const t = await tokenFor(await makeUser({ role: 'founder', pin: true }))
    expect((await api('PUT', '/api/admin/trade-settings', { token: t, body: { mode: 'mainnet' } })).status).toBe(400)
    expect(await setting('trade_network_mode')).not.toBe('mainnet')
    const ok = await api('PUT', '/api/admin/trade-settings', { token: t, body: { mode: 'mainnet', confirmMode: true } })
    expect(ok.status).toBe(200)
    expect(ok.json.mode).toBe('mainnet')
    expect(await count("SELECT COUNT(*) c FROM audit_logs WHERE action='trade.mode_changed'")).toBeGreaterThan(0)
    // A customer now sees mainnet and no test tokens.
    const cfg = await api('GET', '/api/trade/config', { token: await tokenFor(await makeUser({ pin: true })) })
    expect(cfg.json.mode).toBe('mainnet')
  })
  test('the fee is capped at 1%, needs a valid wallet, and stays 0 until one is saved', async () => {
    const t = await tokenFor(await makeUser({ role: 'founder', pin: true }))
    expect((await api('PUT', '/api/admin/trade-settings', { token: t, body: { feeBps: 101, feeWallet: '0x1111111111111111111111111111111111111111' } })).status).toBe(400)
    expect((await api('PUT', '/api/admin/trade-settings', { token: t, body: { feeBps: 10 } })).status).toBe(400)
    expect((await api('PUT', '/api/admin/trade-settings', { token: t, body: { feeBps: 10, feeWallet: 'not-an-address' } })).status).toBe(400)
    const { tradeFee } = await import('../../server/trade/config')
    expect((await tradeFee()).bps).toBe(0)
    const ok = await api('PUT', '/api/admin/trade-settings', { token: t, body: { feeBps: 10, feeWallet: '0x1111111111111111111111111111111111111111' } })
    expect(ok.status).toBe(200)
    expect((await tradeFee()).bps).toBe(10)
    expect((await tradeFee()).wallet).toBe('0x1111111111111111111111111111111111111111')
  })
})

describe('swap and bridge history', () => {
  test('both sides of a swap are written once, with the right amounts, and show in the History list', async () => {
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
    const txs = (await api('GET', '/api/crypto/txs?type=swapped', { token })).json.txs as { symbol: string; amount: string; note: string }[]
    const by = Object.fromEntries(txs.map((t) => [t.symbol, t]))
    expect(by.USDC.amount).toBe('1')
    expect(by.EURC.amount).toBe('1.335728')
    expect(by.cirBTC.amount).toBe('0.00000464')
    expect(by.EURC.note).toMatch(/^Received/)
    expect(((await api('GET', '/api/crypto/txs?type=swapped', { token: await tokenFor(await makeUser({ pin: true })) })).json.txs as unknown[]).length).toBe(0)
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
    expect(((await api('GET', '/api/crypto/txs', { token })).json.txs as { type: string }[]).map((x) => x.type)).toEqual(['swapped'])
    expect(await get('SELECT 1 x FROM wallet_txs WHERE user_id=?', u.id)).toBeTruthy()
  })
})
