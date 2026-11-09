/** Token registry: queries for users, admin changes with validation, and the glue that keeps the wallet and exchange in step. */
import { getAddress, isAddress } from 'viem'
import { HttpError } from '../auth'
import { CONFIG } from '../config'
import { all, audit, get, now, run } from '../db'
import { balancesFor } from '../ledger'
import { fromUnits } from '../money'
import { refreshAssets } from '../wallet/networks'
import { assetRows, clearPortfolioCache } from '../wallet/service'
import { REG_NETWORKS, explorerAddress, networkLabel, regNetwork } from './networks'
import { verifyOnChain } from './verify'

interface TokenRow { symbol: string; name: string; decimals: number; logo: string; is_active: number; popular: number; sort: number }
interface DepRow { id: number; symbol: string; network_id: string; chain_id: number | null; is_testnet: number; contract: string | null; decimals: number; is_active: number; verified: number; verified_at: number | null; verify_note: string | null; source: string }

const deployView = (d: DepRow) => {
  const n = regNetwork(d.network_id)
  return {
    networkId: d.network_id, network: n ? networkLabel(n) : d.network_id, group: n?.group ?? '', chainId: d.chain_id, testnet: Boolean(d.is_testnet),
    contract: d.contract, native: d.contract === null, decimals: d.decimals, active: Boolean(d.is_active), verified: Boolean(d.verified),
    note: d.verify_note, explorer: n && d.contract ? explorerAddress(n, d.contract) : null,
  }
}

/** Whether the exchange can trade this symbol right now (founder enabled it and set a rate). */
const tradable = new Map<string, boolean>()
function loadTradable() {
  tradable.clear()
  for (const a of all<{ symbol: string; enabled: number; sell_rate_kobo: string; buy_rate_kobo: string }>('SELECT symbol, enabled, sell_rate_kobo, buy_rate_kobo FROM assets')) {
    tradable.set(a.symbol, a.enabled === 1 && BigInt(a.sell_rate_kobo) > 0n && BigInt(a.buy_rate_kobo) > 0n)
  }
}

/** Tokens for users: active tokens with their ACTIVE deployments only. Mainnet and unverified rows are never exposed here. */
export function listTokens(networkId?: string) {
  loadTradable()
  const tokens = all<TokenRow>('SELECT * FROM tokens WHERE is_active=1 ORDER BY sort, symbol')
  const deps = all<DepRow>('SELECT * FROM token_networks WHERE is_active=1 AND verified=1 ORDER BY id')
  return tokens
    .map((t) => ({
      symbol: t.symbol, name: t.name, decimals: t.decimals, logo: t.logo, popular: Boolean(t.popular), tradable: tradable.get(t.symbol) === true,
      networks: deps.filter((d) => d.symbol === t.symbol && (!networkId || d.network_id === networkId)).map(deployView),
    }))
    .filter((t) => !networkId || t.networks.length > 0)
}

export function listNetworks(includeEmpty = false) {
  const counts = new Map(all<{ network_id: string; c: number }>('SELECT network_id, COUNT(*) c FROM token_networks WHERE is_active=1 AND verified=1 GROUP BY network_id').map((r) => [r.network_id, r.c]))
  return REG_NETWORKS.map((n) => ({ id: n.id, name: networkLabel(n), group: n.group, chainId: n.chainId, testnet: n.testnet, family: n.family, tokenCount: counts.get(n.id) ?? 0 }))
    .filter((n) => includeEmpty || n.tokenCount > 0)
}

/**
 * The signed-in user's balances per token. On-chain figures are the verified chain reads; the exchange figure is the ledger.
 * They are returned separately and never added together.
 */
export function userTokenBalances(userId: string) {
  const rows = assetRows(userId)
  const ledger = balancesFor(userId)
  const decimals = new Map(all<{ symbol: string; decimals: number }>('SELECT symbol, decimals FROM tokens').map((t) => [t.symbol, t.decimals]))
  const symbols = [...new Set(all<{ symbol: string }>('SELECT symbol FROM tokens WHERE is_active=1').map((t) => t.symbol))]
  return symbols.map((symbol) => {
    const onchain = rows.filter((r) => r.symbol === symbol).map((r) => ({ networkId: r.network, key: r.key, balance: r.balance, verifiedAt: r.verifiedAt, error: r.error }))
    const canon = decimals.get(symbol) ?? 18
    let total = 0n
    for (const r of rows) {
      if (r.symbol !== symbol || r.balance === null) continue
      const [w, f = ''] = r.balance.split('.')
      total += BigInt(w + f.padEnd(canon, '0').slice(0, canon))
    }
    const raw = ledger[symbol] ?? 0n
    return { symbol, onchain, onchainTotal: fromUnits(total, canon), exchange: fromUnits(raw, canon) }
  })
}

/* ---------------- admin ---------------- */

/** Everything the registry holds, including inactive, unverified and mainnet reference rows. */
export function adminTokens() {
  loadTradable()
  const deps = all<DepRow>('SELECT * FROM token_networks ORDER BY id')
  return all<TokenRow>('SELECT * FROM tokens ORDER BY sort, symbol').map((t) => ({
    symbol: t.symbol, name: t.name, decimals: t.decimals, logo: t.logo, active: Boolean(t.is_active), popular: Boolean(t.popular),
    tradable: tradable.get(t.symbol) === true, networks: deps.filter((d) => d.symbol === t.symbol).map(deployView),
  }))
}

/** Keep the wallet catalog and the exchange asset table in step with the registry. Safe to call any time. */
export function onRegistryChange() {
  refreshAssets()
  syncExchangeAssets()
  clearPortfolioCache()
}

/** Every registry token gets an exchange row (disabled, no rate) so the founder can price and enable it. Nothing is tradable until then. */
export function syncExchangeAssets() {
  const t = now()
  for (const tok of all<TokenRow>('SELECT * FROM tokens WHERE is_active=1')) {
    if (get('SELECT 1 FROM assets WHERE symbol=?', tok.symbol)) continue
    const first = get<DepRow>('SELECT * FROM token_networks WHERE symbol=? AND is_testnet=1 AND is_active=1 ORDER BY id LIMIT 1', tok.symbol)
    if (!first) continue
    run(
      `INSERT OR IGNORE INTO assets(symbol,name,chain,kind,contract,decimals,enabled,monitoring,buy_rate_kobo,sell_rate_kobo,min_ngn_kobo,max_ngn_kobo,updated_at)
       VALUES (?,?,?,?,?,?,0,'simulated','0','0','100000','500000000',?)`,
      tok.symbol, tok.name, first.network_id, first.contract ? 'erc20' : 'native', first.contract, first.decimals, t,
    )
  }
}

const SYMBOL = /^[A-Za-z0-9]{2,10}$/

export function addToken(actor: string, b: { symbol: string; name: string; decimals: number; logo?: string; popular?: boolean }) {
  const symbol = b.symbol.trim()
  if (!SYMBOL.test(symbol)) throw new HttpError(400, 'Symbol must be 2 to 10 letters or digits')
  if (get('SELECT 1 FROM tokens WHERE symbol=? COLLATE NOCASE', symbol)) throw new HttpError(409, 'That token already exists')
  const t = now()
  run('INSERT INTO tokens(symbol,name,decimals,logo,is_active,popular,sort,created_at,updated_at) VALUES (?,?,?,?,1,?,100,?,?)', symbol, b.name.trim(), b.decimals, (b.logo ?? symbol).trim(), b.popular ? 1 : 0, t, t)
  audit(actor, 'admin.token.add', symbol, undefined, { name: b.name, decimals: b.decimals })
  onRegistryChange()
}

/**
 * Add a deployment. The contract must be an exact EIP-55 checksummed address, the chain id comes from OUR registry (never from the
 * request), and an ERC-20 must exist on that chain with the same symbol and decimals before it is saved. It is saved switched off.
 */
export async function addDeployment(actor: string, b: { symbol: string; networkId: string; contract?: string | null }) {
  const token = get<TokenRow>('SELECT * FROM tokens WHERE symbol=?', b.symbol)
  if (!token) throw new HttpError(404, 'Unknown token')
  const net = regNetwork(b.networkId)
  if (!net) throw new HttpError(400, 'Unknown network')
  if (get('SELECT 1 FROM token_networks WHERE symbol=? AND network_id=?', token.symbol, net.id)) throw new HttpError(409, 'That token is already registered on this network')
  let contract: string | null = null
  let note = ''
  if (!b.contract) {
    if (net.native !== token.symbol) throw new HttpError(400, `${token.symbol} is not the native asset of ${networkLabel(net)}. Provide its contract address.`)
    note = 'Native asset of the chain'
  } else {
    if (net.family !== 'evm') throw new HttpError(400, 'Contract tokens are only supported on EVM networks')
    if (!isAddress(b.contract, { strict: false })) throw new HttpError(400, 'That is not a valid address')
    const checksummed = getAddress(b.contract.toLowerCase())
    if (checksummed !== b.contract) throw new HttpError(400, 'The address checksum is wrong. Copy the address exactly, with its capital letters.')
    if (/^0x0{40}$/i.test(b.contract)) throw new HttpError(400, 'The zero address is not a token')
    const res = await verifyOnChain(net.id, checksummed, token.symbol, token.decimals)
    if (!res.ok) throw new HttpError(res.transient ? 503 : 400, res.note)
    contract = checksummed
    note = res.note
  }
  run(
    `INSERT INTO token_networks(symbol,network_id,chain_id,is_testnet,contract,decimals,is_active,verified,verified_at,verify_note,source)
     VALUES (?,?,?,?,?,?,0,1,?,?,'admin')`,
    token.symbol, net.id, net.chainId, net.testnet ? 1 : 0, contract, token.decimals, now(), note,
  )
  audit(actor, 'admin.token.add_network', `${token.symbol}@${net.id}`, undefined, { contract, chainId: net.chainId, note })
  onRegistryChange()
}

export function setTokenActive(actor: string, symbol: string, active: boolean) {
  const t = get<TokenRow>('SELECT * FROM tokens WHERE symbol=?', symbol)
  if (!t) throw new HttpError(404, 'Unknown token')
  run('UPDATE tokens SET is_active=?, updated_at=? WHERE symbol=?', active ? 1 : 0, now(), symbol)
  audit(actor, active ? 'admin.token.enable' : 'admin.token.disable', symbol, { active: Boolean(t.is_active) }, { active })
  onRegistryChange()
}

export function setTokenMeta(actor: string, symbol: string, b: { name?: string; popular?: boolean; logo?: string }) {
  const t = get<TokenRow>('SELECT * FROM tokens WHERE symbol=?', symbol)
  if (!t) throw new HttpError(404, 'Unknown token')
  run('UPDATE tokens SET name=?, popular=?, logo=?, updated_at=? WHERE symbol=?', b.name?.trim() ?? t.name, b.popular === undefined ? t.popular : b.popular ? 1 : 0, b.logo?.trim() ?? t.logo, now(), symbol)
  audit(actor, 'admin.token.edit', symbol, { name: t.name, popular: t.popular, logo: t.logo }, b)
  onRegistryChange()
}

export function setDeploymentActive(actor: string, symbol: string, networkId: string, active: boolean) {
  const d = get<DepRow>('SELECT * FROM token_networks WHERE symbol=? AND network_id=?', symbol, networkId)
  if (!d) throw new HttpError(404, 'That token is not registered on this network')
  if (active) {
    // Sandbox rules, enforced here and not only in the UI: verified testnet deployments only.
    if (!d.is_testnet && (CONFIG.paymentMode === 'SANDBOX' || CONFIG.realMoney === false)) throw new HttpError(403, 'Mainnet tokens cannot be enabled while the platform is in sandbox mode')
    if (!d.verified) throw new HttpError(400, 'This contract has not been verified on-chain yet, so it cannot be enabled')
  }
  // 'admin' source stops the background verifier from switching it back on by itself.
  run('UPDATE token_networks SET is_active=?, source=? WHERE id=?', active ? 1 : 0, 'admin', d.id)
  audit(actor, active ? 'admin.token.network_enable' : 'admin.token.network_disable', `${symbol}@${networkId}`, { active: Boolean(d.is_active) }, { active })
  onRegistryChange()
}
