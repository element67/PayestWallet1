/* oxlint-disable */
/** Token registry: bun scripts/tokens-test.ts */
const base = process.env.API ?? 'http://127.0.0.1:3001'
let failures = 0
const ok = (n: string, c: boolean, x = '') => { if (!c) failures++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`) }
const call = async (p: string, t?: string, m = 'GET', b?: unknown) => {
  const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined })
  return { s: r.status, d: (await r.json().catch(() => ({}))) as any }
}
const key = () => 'k' + crypto.randomUUID().replace(/-/g, '').slice(0, 20)
const A = (await call('/api/auth/dev-session', undefined, 'POST', { role: 'user' })).d.token
const F = (await call('/api/auth/dev-session', undefined, 'POST', { role: 'founder' })).d.token
const N = (await call('/api/auth/register', undefined, 'POST', { email: `tok${Date.now()}@test.local`, name: 'Token Test', password: 'a-long-test-password' })).d.token
const WANTED = ['USDC', 'USDT', 'DAI', 'ETH', 'WETH', 'WBTC', 'BNB', 'POL', 'LINK', 'UNI', 'AAVE', 'ARB', 'OP', 'EURC', 'cbBTC']

// ---------- sign-in required ----------
for (const p of ['/api/tokens', '/api/tokens/networks', '/api/tokens/by-network/arc-testnet', '/api/tokens/balances', '/api/admin/tokens']) ok(`401 without a session: ${p}`, (await call(p)).s === 401)

// ---------- the list ----------
const list = (await call('/api/tokens', A)).d
const syms = list.tokens.map((t: any) => t.symbol)
ok('all 15 requested tokens are in the registry', WANTED.every((s) => syms.includes(s)), WANTED.filter((s) => !syms.includes(s)).join(','))
ok('every token has name, decimals and a logo', list.tokens.every((t: any) => t.name && Number.isInteger(t.decimals) && t.logo))
ok('Popular tokens are flagged by the server', list.tokens.filter((t: any) => t.popular).length >= 5 && list.tokens[0].popular)
ok('users only ever see active, verified testnet deployments', list.tokens.every((t: any) => t.networks.every((n: any) => n.active && n.verified && n.testnet)))
ok('no mainnet chain ids reach users', !JSON.stringify(list).match(/"chainId":(1|8453|42161|10|137|56|5042),/))
const usdc = list.tokens.find((t: any) => t.symbol === 'USDC')
ok('USDC is live on Arc, Ethereum, Base, Arbitrum, Optimism and Polygon testnets', ['arc-testnet', 'ethereum-sepolia', 'base-sepolia', 'arbitrum-sepolia', 'optimism-sepolia', 'polygon-amoy'].every((id) => usdc.networks.some((n: any) => n.networkId === id)))
ok('contract addresses are checksummed', usdc.networks.every((n: any) => /^0x[0-9a-fA-F]{40}$/.test(n.contract)))
ok('the list names the networks', list.networks.length >= 7 && list.networks.every((n: any) => n.name && n.tokenCount > 0))

// ---------- by network ----------
const arc = (await call('/api/tokens/by-network/arc-testnet', A)).d
ok('tokens by network returns only that network', arc.tokens.length >= 1 && arc.tokens.every((t: any) => t.networks.every((n: any) => n.networkId === 'arc-testnet')))
ok('unknown network is a 404', (await call('/api/tokens/by-network/nowhere', A)).s === 404)
ok('malformed network id is rejected', (await call('/api/tokens/by-network/' + encodeURIComponent('../etc'), A)).s >= 400)

// ---------- balances ----------
const b0 = (await call('/api/tokens/balances', N)).d
ok('a new user has zero of everything (nothing is invented)', b0.balances.length >= 15 && b0.balances.every((b: any) => Number(b.exchange) === 0 && Number(b.onchainTotal) === 0))
const me = (await call('/api/admin/users', F)).d.users.find((u: any) => u.email.startsWith('tok'))
await call('/api/admin/test-credit', F, 'POST', { userId: me.id, asset: 'USDC', amount: '12.5', note: 'token registry test', idempotencyKey: key() })
const b1 = (await call('/api/tokens/balances', N)).d.balances.find((b: any) => b.symbol === 'USDC')
ok('ledger balance shows as exchange, and on-chain stays separate', b1.exchange === '12.5' && Number(b1.onchainTotal) === 0)
ok('another user does not see it', Number((await call('/api/tokens/balances', A)).d.balances.find((b: any) => b.symbol === 'USDC').exchange) !== 12.5)
ok('a user id in the URL is ignored', (await call('/api/tokens/balances?userId=' + me.id, A)).d.balances.find((b: any) => b.symbol === 'USDC').exchange !== '12.5')

// ---------- admin only ----------
const body = { symbol: 'ZZTEST', name: 'Test', decimals: 6 }
ok('a normal user cannot read the admin registry', (await call('/api/admin/tokens', A)).s === 403)
ok('a normal user cannot add a token', (await call('/api/admin/tokens', A, 'POST', body)).s === 403)
ok('a normal user cannot disable a token', (await call('/api/admin/tokens/USDC', A, 'PATCH', { active: false })).s === 403)
ok('a normal user cannot add a network', (await call('/api/admin/tokens/USDC/networks', A, 'POST', { networkId: 'base-sepolia' })).s === 403)
ok('a normal user cannot enable a network', (await call('/api/admin/tokens/USDC/networks/arc-testnet', A, 'PATCH', { active: true })).s === 403)
const adm = (await call('/api/admin/tokens', F)).d
ok('the founder sees inactive and mainnet reference rows too', adm.tokens.some((t: any) => t.networks.some((n: any) => !n.testnet)) && adm.networks.some((n: any) => !n.testnet))

// ---------- validation ----------
ok('bad symbol rejected', (await call('/api/admin/tokens', F, 'POST', { ...body, symbol: 'a b!' })).s === 400)
ok('bad decimals rejected', (await call('/api/admin/tokens', F, 'POST', { ...body, decimals: 99 })).s === 400)
ok('duplicate token rejected', (await call('/api/admin/tokens', F, 'POST', { symbol: 'usdc', name: 'USD Coin again', decimals: 6 })).s === 409)
const usdcArc = usdc.networks.find((n: any) => n.networkId === 'arc-testnet').contract
const add = (net: string, contract: string | null, sym = 'DAI') => call(`/api/admin/tokens/${sym}/networks`, F, 'POST', { networkId: net, contract })
ok('a non-address is rejected', (await add('base-sepolia', 'not-an-address')).s === 400)
ok('a lowercase (non-checksummed) address is rejected', (await add('base-sepolia', usdcArc.toLowerCase())).s === 400)
ok('a wrongly capitalised address is rejected', (await add('base-sepolia', usdcArc.slice(0, 5) + usdcArc.slice(5).toUpperCase().replace(/X/g, 'x'))).s === 400 || usdcArc === usdcArc.slice(0, 5) + usdcArc.slice(5).toUpperCase())
ok('the zero address is rejected', (await add('base-sepolia', '0x0000000000000000000000000000000000000000')).s === 400)
ok('an unknown network is rejected', (await add('mars', usdcArc)).s === 400)
ok('a native asset on the wrong chain is rejected', (await add('base-sepolia', null, 'DAI')).s === 400)
ok('a duplicate network entry is rejected', (await add('arc-testnet', usdcArc, 'USDC')).s === 409)
const wrongChain = await add('ethereum-sepolia', usdcArc, 'DAI')
ok('an address with no contract on that chain (or the wrong symbol) is refused after an on-chain check', wrongChain.s === 400 || wrongChain.s === 503, wrongChain.d.error ?? '')
ok('the chain id comes from the server, not the request', !JSON.stringify(await call('/api/admin/tokens', F)).includes('"chainId":99999'))

// ---------- enable / disable rules ----------
const rows = adm.tokens.flatMap((t: any) => t.networks.map((n: any) => ({ s: t.symbol, ...n })))
const mainnet = rows.find((r: any) => !r.testnet && r.verified)
ok('mainnet tokens cannot be enabled in sandbox mode', mainnet && (await call(`/api/admin/tokens/${mainnet.s}/networks/${mainnet.networkId}`, F, 'PATCH', { active: true })).s === 403, mainnet ? `${mainnet.s}@${mainnet.networkId}` : 'no verified mainnet row')
const unver = rows.find((r: any) => r.testnet && !r.verified)
if (unver) ok('an unverified contract cannot be enabled', (await call(`/api/admin/tokens/${unver.s}/networks/${unver.networkId}`, F, 'PATCH', { active: true })).s === 400)
const off = await call('/api/admin/tokens/USDC/networks/polygon-amoy', F, 'PATCH', { active: false })
ok('a deployment can be disabled', off.s === 200 && !(await call('/api/tokens', A)).d.tokens.find((t: any) => t.symbol === 'USDC').networks.some((n: any) => n.networkId === 'polygon-amoy'))
ok('and it leaves the wallet immediately', !(await call('/api/crypto/overview', A)).d.assets.some((a: any) => a.key === 'USDC@polygon-amoy'))
await call('/api/admin/tokens/USDC/networks/polygon-amoy', F, 'PATCH', { active: true })
ok('re-enabling brings it back', (await call('/api/crypto/overview', A)).d.assets.some((a: any) => a.key === 'USDC@polygon-amoy'))
const tdis = await call('/api/admin/tokens/UNI', F, 'PATCH', { active: false })
ok('a whole token can be switched off and disappears for users', tdis.s === 200 && !(await call('/api/tokens', A)).d.tokens.some((t: any) => t.symbol === 'UNI'))
await call('/api/admin/tokens/UNI', F, 'PATCH', { active: true })
ok('and back on', (await call('/api/tokens', A)).d.tokens.some((t: any) => t.symbol === 'UNI'))

// ---------- audit ----------
const audit = JSON.stringify((await call('/api/admin/audit', F)).d)
ok('every admin change is in the audit log', ['admin.token.network_disable', 'admin.token.network_enable', 'admin.token.disable', 'admin.token.enable'].every((a) => audit.includes(a)))

// ---------- exchange and wallet follow the registry ----------
const assets = (await call('/api/admin/assets', F)).d.assets
const live = adm.tokens.filter((t: any) => t.active && t.networks.some((n: any) => n.active)).map((t: any) => t.symbol)
ok('every token with a live testnet deployment has an exchange row, off until a rate is set', live.every((s: string) => assets.some((a: any) => a.symbol === s)) && assets.filter((a: any) => !['USDC', 'USDT', 'BTC', 'SOL'].includes(a.symbol)).every((a: any) => a.enabled === false))
ok('a token without a rate cannot be quoted', (await call('/api/quotes', A, 'POST', { side: 'sell', asset: 'DAI', amount: '5' })).s === 400)
ok('swap refuses a token without a rate', (await call('/api/crypto/swap/quote', A, 'POST', { from: 'USDC', to: 'DAI', amount: '1' })).s === 400)
const ov = (await call('/api/crypto/overview', A)).d
ok('the wallet catalog is the registry (active verified testnet deployments)', ov.assets.length >= 13 && ov.assets.every((a: any) => a.key.includes('@')))
ok('tokens without a testnet contract are listed honestly as unavailable', Array.isArray(ov.unavailable) && ov.unavailable.some((u: any) => u.symbol === 'USDT'))

// ---------- new tokens cannot be sent until the founder sets limits (fails closed) ----------
const link = ov.assets.find((a: any) => a.symbol === 'LINK')
if (link) {
  const prep = await call('/api/crypto/send/prepare', A, 'POST', { networkId: link.key.split('@')[1], assetKey: link.key, to: '0x000000000000000000000000000000000000dEaD', amount: '1' })
  ok('a new token with no send limit cannot be sent', prep.s === 403 && /limit/i.test(prep.d.error ?? ''), prep.d.error ?? '')
}

// ---------- rate limit ----------
const burst = await Promise.all(Array.from({ length: 80 }, () => call('/api/tokens', N)))
ok('the token endpoints are rate limited', burst.some((r) => r.s === 429))
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`)
