/**
 * Wallet service: portfolio from verified on-chain balances, asset visibility, send preparation and execution.
 * Signing happens only here (via keys.withEvmAccount) after deterministic checks. The AI agent can read and
 * flag activity, but it has no path to sign or move funds.
 */
import { createHmac } from 'node:crypto'
import { createWalletClient, encodeFunctionData, erc20Abi, http, isAddress } from 'viem'
import { CONFIG } from '../config'
import { HttpError, type User } from '../auth'
import { all, alert, audit, get, notify, now, run, setting, uid } from '../db'
import { fromUnits, toUnits } from '../money'
import { scrub } from '../rpc'
import { evmChain, evmClient, evmRpcUrl, readBalance } from './chains'
import { ensureWallet, withEvmAccount, type WalletAddresses } from './keys'
import { ASSETS, UNAVAILABLE, getAssetDef, getNetwork, verifiedTokens, type AssetDef, type NetworkDef } from './networks'

export const addressForNetwork = (net: NetworkDef, a: WalletAddresses) => (net.family === 'evm' ? a.evm : net.family === 'solana' ? a.solana : a.bitcoin)

export function walletDecision(kind: string, decision: string, o: { txId?: string; score?: number; reasons?: string[] } = {}) {
  run('INSERT INTO agent_decisions(at, order_id, tx_id, kind, decision, score, reasons) VALUES (?,?,?,?,?,?,?)', now(), null, o.txId ?? null, `wallet.${kind}`, decision, o.score ?? 0, JSON.stringify(o.reasons ?? []))
}

/* ---------- balances and portfolio ---------- */
const syncErrors = new Map<string, string>()
const lastSync = new Map<string, number>()

const inflight = new Map<string, Promise<void>>()

/** One chain-read pass per user at a time; concurrent callers share the same pass. */
export function syncUser(userId: string): Promise<void> {
  const running = inflight.get(userId)
  if (running) return running
  const p = doSync(userId).finally(() => {
    inflight.delete(userId)
    portfolioCache.delete(userId)
  })
  inflight.set(userId, p)
  return p
}

export const isSyncing = (userId: string) => inflight.has(userId)
export const hasBalances = (userId: string) => Boolean(get('SELECT 1 FROM wallet_balances WHERE user_id=? LIMIT 1', userId))

async function doSync(userId: string): Promise<void> {
  const addrs = ensureWallet(userId)
  lastSync.set(userId, Date.now())
  // Networks are read side by side, but the tokens of one network one after another, so a free public RPC is not flooded.
  const byNetwork = new Map<string, AssetDef[]>()
  for (const def of ASSETS) byNetwork.set(def.network, [...(byNetwork.get(def.network) ?? []), def])
  await Promise.all(
    [...byNetwork.entries()].map(async ([networkId, defs]) => {
      const net = getNetwork(networkId)
      if (!net) return
      for (const def of defs) {
        const k = `${userId}:${def.key}`
        try {
          // Free public RPCs rate-limit bursts: wait a moment and try once more before calling the balance degraded.
          const r = await readBalance(def, addressForNetwork(net, addrs)).catch(async (e: unknown) => {
            if (!/429|exceeded|rate/i.test(String(e))) throw e
            await new Promise((ok) => setTimeout(ok, 1500))
            return readBalance(def, addressForNetwork(net, addrs))
          })
          run('INSERT INTO wallet_balances(user_id,asset_key,raw,verified_at,block_ref) VALUES (?,?,?,?,?) ON CONFLICT(user_id,asset_key) DO UPDATE SET raw=excluded.raw, verified_at=excluded.verified_at, block_ref=excluded.block_ref', userId, def.key, r.raw.toString(), now(), r.ref)
          syncErrors.delete(k)
        } catch (e) {
          syncErrors.set(k, scrub(e))
        }
      }
    }),
  )
}

export const needsSync = (userId: string) => Date.now() - (lastSync.get(userId) ?? 0) > 15_000

/** Founder-configured value of one whole unit, in kobo. Null when no rate is set. */
function rateKobo(symbol: string): bigint | null {
  if (symbol === 'ETH') {
    try {
      const v = toUnits(setting('eth_rate_ngn') || '0', 2)
      return v > 0n ? v : null
    } catch {
      return null
    }
  }
  const r = get<{ sell_rate_kobo: string }>('SELECT sell_rate_kobo FROM assets WHERE symbol=?', symbol)
  return r && BigInt(r.sell_rate_kobo) > 0n ? BigInt(r.sell_rate_kobo) : null
}

interface AssetRowView {
  key: string; symbol: string; name: string; network: string; kind: string; contract: string | null; decimals: number; info: string
  balance: string | null; verifiedAt: number | null; blockRef: string | null; rateNgn: string | null; valueNgn: string | null; valueKobo: bigint | null; error: string | null
}

export function assetRows(userId: string): AssetRowView[] {
  return ASSETS.map((def) => {
    const bal = get<{ raw: string; verified_at: number; block_ref: string | null }>('SELECT * FROM wallet_balances WHERE user_id=? AND asset_key=?', userId, def.key)
    const rate = rateKobo(def.symbol)
    const valueKobo = bal && rate !== null ? (BigInt(bal.raw) * rate) / 10n ** BigInt(def.decimals) : null
    return {
      key: def.key, symbol: def.symbol, name: def.name, network: def.network, kind: def.kind, contract: def.contract ?? null, decimals: def.decimals,
      info: def.info, balance: bal ? fromUnits(BigInt(bal.raw), def.decimals) : null, verifiedAt: bal?.verified_at ?? null,
      blockRef: bal?.block_ref ?? null, rateNgn: rate !== null ? fromUnits(rate, 2) : null, valueNgn: valueKobo !== null ? fromUnits(valueKobo, 2) : null, valueKobo,
      error: syncErrors.get(`${userId}:${def.key}`) ?? null,
    }
  })
}

/** Dropped whenever the token registry changes, so the wallet reflects it immediately. */
export const clearPortfolioCache = () => portfolioCache.clear()
const portfolioCache = new Map<string, { at: number; data: ReturnType<typeof buildPortfolio> }>()

/** Everything Overview needs in one payload. Cached for 2 seconds per user; sync completion and asset changes invalidate it. */
export function portfolio(userId: string) {
  const hit = portfolioCache.get(userId)
  if (hit && Date.now() - hit.at < 2000) return hit.data
  const data = buildPortfolio(userId)
  portfolioCache.set(userId, { at: Date.now(), data })
  return data
}

function buildPortfolio(userId: string) {
  const addrs = ensureWallet(userId)
  const rows = assetRows(userId)
  const held = rows.filter((r) => r.balance !== null && Number(r.balance) > 0)
  const total = held.reduce((sum, r) => sum + (r.valueKobo ?? 0n), 0n)
  const recent = all<Record<string, unknown>>('SELECT * FROM wallet_txs WHERE user_id=? ORDER BY created_at DESC LIMIT 5', userId)
  return {
    addresses: addrs,
    assets: rows.map(({ valueKobo: _omit, ...r }) => r),
    totalValueNgn: fromUnits(total, 2),
    unpricedSymbols: [...new Set(held.filter((r) => r.valueNgn === null).map((r) => r.symbol))],
    heldCount: held.length,
    assetCount: rows.length,
    syncedAt: lastSync.get(userId) ?? null,
    syncing: isSyncing(userId),
    unavailable: UNAVAILABLE,
    networks: networksView(addrs),
    recentTxs: recent.map(txView),
  }
}

export function networksView(addrs: WalletAddresses) {
  return ['arc-testnet', 'ethereum-sepolia', 'base-sepolia', 'solana-devnet', 'bitcoin-testnet'].map((id) => {
    const n = getNetwork(id) as NetworkDef
    const m = get<{ status: string; head_block: number | null; error: string | null; last_poll_at: number | null }>('SELECT * FROM monitor_state WHERE chain=?', `wallet:${id}`)
    return {
      id: n.id, name: n.name, family: n.family, nativeSymbol: n.nativeSymbol, address: addressForNetwork(n, addrs), canSend: n.canSend, sendNote: n.sendNote ?? null,
      faucet: n.faucet ?? null, explorerAddress: n.explorerAddress(addressForNetwork(n, addrs)),
      monitor: m ? { status: m.status, head: m.head_block, error: m.error, lastPollAt: m.last_poll_at } : { status: 'starting', head: null, error: null, lastPollAt: null },
    }
  })
}

/* ---------- limits and risk ---------- */
interface Limits { perTx: Record<string, string>; daily: Record<string, string> }
export const walletLimits = (): Limits => JSON.parse(setting('wallet_limits')) as Limits

function sentToday(userId: string, symbol: string): bigint {
  const rows = all<{ amount: string }>("SELECT amount FROM wallet_txs WHERE user_id=? AND type='sent' AND symbol=? AND status<>'failed' AND created_at>?", userId, symbol, now() - 86_400_000)
  return rows.reduce((s, r) => s + BigInt(r.amount), 0n)
}

/* ---------- send ---------- */
export interface SendInput { networkId: string; assetKey: string; to: string; amount: string }

const tokenSig = (u: string, i: SendInput, amountRaw: bigint, exp: number) =>
  createHmac('sha256', CONFIG.walletMasterKey).update(JSON.stringify([u, i.networkId, i.assetKey, i.to.toLowerCase(), amountRaw.toString(), exp])).digest('base64url')

async function evaluate(user: User, input: SendInput) {
  const net = getNetwork(input.networkId)
  const def = getAssetDef(input.assetKey)
  if (!net || !def || def.network !== net.id) throw new HttpError(400, 'That asset is not available on the selected network')
  if (!net.canSend) throw new HttpError(400, net.sendNote ?? 'Sending is not enabled on this network')
  if (setting('platform_paused') === 'true') throw new HttpError(503, 'Sending is temporarily paused')
  if (!isAddress(input.to)) throw new HttpError(400, `That is not a valid ${net.name} address (check every character, or the checksum casing)`)
  const to = input.to as `0x${string}`
  if (/^0x0{40}$/i.test(to)) throw new HttpError(400, 'Sending to the zero address would burn your funds')
  if (verifiedTokens(net.id).has(to.toLowerCase())) throw new HttpError(400, 'That address is a token contract. Sending there would lose your funds.')
  const addrs = ensureWallet(user.id)
  const from = addrs.evm as `0x${string}`
  const amountRaw = toUnits(input.amount, def.decimals)
  if (amountRaw <= 0n) throw new HttpError(400, 'Enter an amount above zero')

  // Policy first: limits are checked before any network call or balance check.
  const limits = walletLimits()
  // Fail closed: a token with no limits set by the founder cannot be sent at all (new registry tokens start this way).
  if (!limits.perTx[def.symbol] || !limits.daily[def.symbol]) throw new HttpError(403, `Sending ${def.symbol} is not switched on yet: no send limit has been set for it.`)
  const perTx = toUnits(limits.perTx[def.symbol], def.decimals)
  const daily = toUnits(limits.daily[def.symbol], def.decimals)
  if (amountRaw > perTx) throw new HttpError(403, `Per-transaction limit is ${limits.perTx[def.symbol]} ${def.symbol}`)
  if (sentToday(user.id, def.symbol) + amountRaw > daily) throw new HttpError(403, `Daily send limit is ${limits.daily[def.symbol]} ${def.symbol}`)


  const client = evmClient(net.id)
  const [bal, gasPrice] = await Promise.all([readBalance(def, from), client.estimateFeesPerGas().catch(() => null)])
  const data = def.kind === 'token' ? encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [to, amountRaw] }) : undefined
  let gas: bigint
  try {
    gas = await client.estimateGas({ account: from, to: def.kind === 'token' ? (def.contract as `0x${string}`) : to, data, value: def.kind === 'native' ? amountRaw : 0n })
  } catch (e) {
    const msg = scrub(e)
    if (/insufficient|exceeds balance/i.test(msg)) throw new HttpError(400, `Not enough ${def.symbol} (plus network fee) in your wallet`)
    throw new HttpError(502, `Could not estimate the network fee: ${msg}`)
  }
  const perGas = gasPrice?.maxFeePerGas ?? (await client.getGasPrice())
  const feeWei = gas * perGas
  const sameGasPool = net.id === 'arc-testnet' // Arc gas is native USDC: the same pool as the USDC token balance
  const feeSymbol = net.nativeSymbol
  const feeDecimals = net.nativeDecimals
  // Balance needed on the asset itself, and on the gas asset.
  let needed = amountRaw
  if (def.kind === 'native') needed += feeWei
  if (sameGasPool) needed += feeWei / 10n ** BigInt(feeDecimals - def.decimals)
  if (bal.raw < needed) throw new HttpError(400, `Insufficient balance. You have ${fromUnits(bal.raw, def.decimals)} ${def.symbol}; this needs about ${fromUnits(needed, def.decimals)} including the network fee.`)
  if (def.kind === 'token' && !sameGasPool) {
    const gasBal = await client.getBalance({ address: from })
    if (gasBal < feeWei) throw new HttpError(400, `You need about ${fromUnits(feeWei, feeDecimals)} ${feeSymbol} in this network to pay the fee. You have ${fromUnits(gasBal, feeDecimals)}.`)
  }

  // Deterministic fraud rules.
  const flags: string[] = []
  let score = 0
  if (!get("SELECT 1 FROM wallet_txs WHERE user_id=? AND type='sent' AND lower(to_addr)=lower(?) AND status<>'failed' LIMIT 1", user.id, to)) { score += 15; flags.push('new_destination') }
  const recent = get<{ c: number }>("SELECT COUNT(*) c FROM wallet_txs WHERE user_id=? AND type='sent' AND created_at>?", user.id, now() - 3_600_000)
  if ((recent?.c ?? 0) >= 5) { score += 40; flags.push('high_velocity') }
  if (perTx !== null && amountRaw * 10n >= perTx * 8n) { score += 10; flags.push('near_per_tx_limit') }
  if (!user.dev_preview && now() - user.created_at < 86_400_000) { score += 15; flags.push('new_account') }
  if (to.toLowerCase() === from.toLowerCase()) flags.push('self_send')
  const block = Number(setting('risk_block_score'))
  if (score >= block) throw new HttpError(403, 'This transfer was held by our fraud checks. Contact support if this is expected.', { flags })

  return { net, def, from, to, amountRaw, gas, feeWei, feeSymbol, feeDecimals, perGas, balance: bal.raw, flags, score }
}

export async function prepareSend(user: User, input: SendInput) {
  const e = await evaluate(user, input)
  const exp = now() + 120_000
  return {
    confirmToken: tokenSig(user.id, input, e.amountRaw, exp), expiresAt: exp,
    network: e.net.name, networkId: e.net.id, asset: e.def.symbol, assetKey: e.def.key, amount: fromUnits(e.amountRaw, e.def.decimals), from: e.from, to: e.to,
    fee: fromUnits(e.feeWei, e.feeDecimals), feeSymbol: e.feeSymbol, gasUnits: e.gas.toString(), gasPriceGwei: fromUnits(e.perGas, 9),
    balance: fromUnits(e.balance, e.def.decimals), flags: e.flags, riskScore: e.score,
    warnings: [
      ...(e.flags.includes('new_destination') ? ['You have not sent to this address before. Blockchain transfers cannot be reversed.'] : []),
      ...(e.flags.includes('self_send') ? ['This is your own wallet address.'] : []),
    ],
  }
}

const locks = new Map<string, Promise<unknown>>()
const serial = <T>(key: string, fn: () => Promise<T>): Promise<T> => {
  const next = (locks.get(key) ?? Promise.resolve()).catch(() => undefined).then(fn)
  locks.set(key, next)
  return next
}

export function txView(t: Record<string, unknown>) {
  const net = getNetwork(String(t.network))
  const def = t.asset_key ? getAssetDef(String(t.asset_key)) : undefined
  const decimals = def?.decimals ?? 18
  const hash = String(t.tx_hash)
  const real = !hash.startsWith('sim:') && !hash.startsWith('pending:')
  return {
    id: t.id, type: t.type, network: net?.name ?? t.network, networkId: t.network, symbol: t.symbol, assetKey: t.asset_key, tokenRef: t.token_ref,
    amount: fromUnits(BigInt(String(t.amount)), decimals), from: t.from_addr, to: t.to_addr, hash: real ? hash : null, simulated: hash.startsWith('sim:'),
    fee: t.fee_raw ? fromUnits(BigInt(String(t.fee_raw)), net?.nativeDecimals ?? 18) : null, feeSymbol: t.fee_symbol, status: t.status, verdict: t.verdict,
    confirmations: t.confirmations, finalConfirmations: net?.finalConfirmations ?? 1, riskScore: t.risk_score, riskFlags: JSON.parse(String(t.risk_flags)) as string[], note: t.note,
    url: real && net ? net.explorerTx(hash) : null, createdAt: t.created_at, detectedAt: t.detected_at, finalizedAt: t.finalized_at,
  }
}

export async function executeSend(user: User, input: SendInput, confirmToken: string, expiresAt: number, idemKey: string) {
  const existing = get<Record<string, unknown>>('SELECT * FROM wallet_txs WHERE user_id=? AND idem_key=?', user.id, idemKey)
  if (existing) return txView(existing)
  if (expiresAt < now()) throw new HttpError(410, 'This confirmation expired. Review the details again.')
  const probe = toUnits(input.amount, getAssetDef(input.assetKey)?.decimals ?? 18)
  if (tokenSig(user.id, input, probe, expiresAt) !== confirmToken) throw new HttpError(400, 'The transfer details changed after confirmation. Review them again.')

  return serial(user.id, async () => {
    const e = await evaluate(user, input)
    const id = uid('wtx')
    const placeholder = `pending:${id}`
    try {
      run(
        `INSERT INTO wallet_txs(id,user_id,network,asset_key,token_ref,symbol,type,amount,from_addr,to_addr,tx_hash,fee_symbol,status,risk_score,risk_flags,idem_key,detected_at,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id, user.id, e.net.id, e.def.key, e.def.contract ?? null, e.def.symbol, 'sent', e.amountRaw.toString(), e.from, e.to, placeholder, e.feeSymbol, 'signing',
        e.score, JSON.stringify(e.flags), idemKey, now(), now(), now(),
      )
    } catch {
      const dupe = get<Record<string, unknown>>('SELECT * FROM wallet_txs WHERE user_id=? AND idem_key=?', user.id, idemKey)
      if (dupe) return txView(dupe)
      throw new HttpError(409, 'Could not record this transfer')
    }
    try {
      const hash = await withEvmAccount(user.id, async (account) => {
        const wc = createWalletClient({ account, chain: evmChain(e.net.id), transport: http(evmRpcUrl(e.net.id), { timeout: 15_000 }) })
        return e.def.kind === 'native'
          ? wc.sendTransaction({ to: e.to, value: e.amountRaw })
          : wc.writeContract({ address: e.def.contract as `0x${string}`, abi: erc20Abi, functionName: 'transfer', args: [e.to, e.amountRaw] })
      })
      run("UPDATE wallet_txs SET tx_hash=?, status='pending', updated_at=? WHERE id=?", hash, now(), id)
      audit(user.id, 'wallet.send', id, undefined, { network: e.net.id, asset: e.def.symbol, amount: e.amountRaw.toString(), to: e.to, hash })
      walletDecision('send', `Authorized and broadcast ${e.def.symbol} transfer`, { txId: id, score: e.score, reasons: e.flags })
      notify(user.id, 'order', 'Transfer broadcast', `${input.amount} ${e.def.symbol} sent on ${e.net.name}. Waiting for confirmation.`)
    } catch (err) {
      const msg = scrub(err)
      run("UPDATE wallet_txs SET status='failed', note=?, updated_at=? WHERE id=?", msg, now(), id)
      alert('warning', 'wallet_send_failed', 'Wallet transfer failed to broadcast', msg, user.id)
      throw new HttpError(502, `The network rejected the transfer: ${msg}`)
    }
    return txView(get<Record<string, unknown>>('SELECT * FROM wallet_txs WHERE id=?', id) as Record<string, unknown>)
  })
}

/** Development preview only: labelled, never touches balances or the chain. Exercises alerts and the AI monitor. */
export function recordSimulated(user: User, kind: 'unverified_token' | 'failed_send') {
  if (!CONFIG.devPreview || !user.dev_preview) throw new HttpError(403, 'Simulated events are only available in the development preview')
  const addrs = ensureWallet(user.id)
  const id = uid('wtx')
  const hash = `sim:0x${uid('h')}${uid('h')}`.slice(0, 66)
  const base = [id, user.id, 'ethereum-sepolia', hash, now(), now(), now()]
  if (kind === 'unverified_token') {
    run(
      `INSERT INTO wallet_txs(id,user_id,network,token_ref,symbol,type,amount,from_addr,to_addr,tx_hash,status,verdict,risk_score,risk_flags,note,detected_at,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, user.id, 'ethereum-sepolia', '0x000000000000000000000000000000000000dEaD', 'FAKEUSDC', 'received', '1000000000000000000', '0x000000000000000000000000000000000000bEEF', addrs.evm, hash, 'confirmed', 'unverified_token', 90, '["unverified_token"]', 'SIMULATED event (development preview)', base[4], base[5], base[6],
    )
    walletDecision('verify', 'REJECT (simulated): token is not in the verified catalog', { txId: id, score: 90, reasons: ['unverified_token', 'simulated'] })
    alert('warning', 'wallet_unverified_token', 'Unverified token received (SIMULATED)', 'Development preview test event. No real token was sent.', user.id)
    notify(user.id, 'security', 'Unverified token received (simulated)', 'This is a labelled test event from the development preview.')
  } else {
    run(
      `INSERT INTO wallet_txs(id,user_id,network,asset_key,symbol,type,amount,from_addr,to_addr,tx_hash,status,verdict,note,detected_at,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, user.id, 'ethereum-sepolia', 'ETH@ethereum-sepolia', 'ETH', 'sent', '1000000000000000', addrs.evm, '0x000000000000000000000000000000000000bEEF', hash, 'failed', 'genuine', 'SIMULATED failure (development preview)', base[4], base[5], base[6],
    )
    walletDecision('monitor', 'Transaction failed (simulated)', { txId: id, score: 60, reasons: ['simulated'] })
    alert('warning', 'wallet_tx_failed', 'Wallet transaction failed (SIMULATED)', 'Development preview test event.', user.id)
  }
  return { id }
}
