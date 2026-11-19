/**
 * Uniswap v3 swaps on a test network, signed by the user's app wallet after a transaction PIN.
 *
 * Rules enforced here:
 * - Quotes are live: every fee tier with liquidity is quoted on chain and the best output wins. Empty pools are skipped.
 * - Price impact is measured against the pool's own mid price (not the fee). Above 1% the user is warned; above 5% the swap is refused.
 * - A deadline (20 minutes) is always set, slippage is capped at 1%, and the minimum output is never zero.
 * - The swap is simulated first. If the simulation reverts, nothing is sent and the reason is shown.
 * - The router that is called is the one in the server's allow-list, checked on chain; the swap always pays out to the user's OWN address.
 * - Amounts, tokens, fee tier and the minimum output are bound by a signed 2-minute confirmation; the PIN is checked on every start.
 * - The founder's per-swap limit applies to the token being spent. A repeated request with the same idempotency key never swaps twice.
 * - The wallet key exists in memory only inside the signing callback.
 */
import { createHmac } from 'node:crypto'
import { createWalletClient, encodeFunctionData, formatEther, http, parseEventLogs, type Address } from 'viem'
import { CONFIG } from '../config'
import { HttpError, type User } from '../auth'
import { alert, audit, get, notify, now, run, setting, uid } from '../db'
import { fromUnits, toUnits } from '../money'
import { assertOperational, verifyPin } from '../naira/wallet'
import { scrub } from '../rpc'
import { capFor, opView } from './shared'
import { evmBroadcastUrl, evmChain, evmClient, readBalance } from '../wallet/chains'
import { recordHistoryLeg } from '../wallet/history'
import { ensureWallet, withEvmAccount } from '../wallet/keys'
import { ASSETS, type AssetDef } from '../wallet/networks'
import { syncUser } from '../wallet/service'
import { erc20Abi, factoryAbi, FEE_TIERS, poolAbi, quoterAbi, routerAbi, uniNetwork, verifyDeployment, ZERO, type UniNetwork } from './config'

export const UNI_DEFAULT_SLIPPAGE_BPS = 50
export const UNI_MAX_SLIPPAGE_BPS = 100
const MIN_SLIPPAGE_BPS = 10
const WARN_IMPACT_BPS = 100
const BLOCK_IMPACT_BPS = 500
const DEADLINE_SECONDS = 1200

export interface UniInput { networkId: string; tokenIn: string; tokenOut: string; amount: string; slippageBps?: number }
export interface CheckedUni { networkId: string; tokenIn: string; tokenOut: string; amount: string; slippageBps: number }

/** Validates what the caller sent. Pure: no network, no database. */
export function checkUniInput(i: UniInput): CheckedUni {
  uniNetwork(i.networkId)
  const sym = (v: unknown) => (typeof v === 'string' && /^[A-Za-z0-9]{2,12}$/.test(v.trim()) ? v.trim().toUpperCase() : '')
  const tokenIn = sym(i.tokenIn), tokenOut = sym(i.tokenOut)
  if (!tokenIn || !tokenOut) throw new HttpError(400, 'Choose the tokens to swap')
  if (tokenIn === tokenOut) throw new HttpError(400, 'Choose two different tokens')
  if (typeof i.amount !== 'string' || !/^\d{1,18}(\.\d{1,18})?$/.test(i.amount)) throw new HttpError(400, 'Enter a valid amount')
  if (!(Number(i.amount) > 0)) throw new HttpError(400, 'Enter an amount above zero')
  const slippageBps = i.slippageBps === undefined ? UNI_DEFAULT_SLIPPAGE_BPS : i.slippageBps
  if (!Number.isInteger(slippageBps) || slippageBps < MIN_SLIPPAGE_BPS || slippageBps > UNI_MAX_SLIPPAGE_BPS) {
    throw new HttpError(400, `Slippage must be between ${MIN_SLIPPAGE_BPS / 100}% and ${UNI_MAX_SLIPPAGE_BPS / 100}%`)
  }
  return { networkId: i.networkId, tokenIn, tokenOut, amount: i.amount, slippageBps }
}

/** The tokens a network offers: the verified tokens in the wallet's own asset list, so every symbol and decimal count is the registry's. */
export const uniTokens = (networkId: string): AssetDef[] => ASSETS.filter((a) => a.network === networkId && a.kind === 'token' && a.contract)

function tokenOf(networkId: string, symbol: string): AssetDef {
  const t = uniTokens(networkId).find((a) => a.symbol.toUpperCase() === symbol)
  if (!t) throw new HttpError(400, `${symbol} is not available for swaps on this network`)
  return t
}

export const uniConfirmToken = (userId: string, c: CheckedUni, tier: number, minOutRaw: string, exp: number) =>
  createHmac('sha256', CONFIG.walletMasterKey).update(JSON.stringify(['uniswap-v3', userId, c.networkId, c.tokenIn, c.tokenOut, c.amount, c.slippageBps, tier, minOutRaw, exp])).digest('base64url')

interface Route { fee: number; pool: Address; out: bigint; gas: bigint; impactBps: number }

/** Quotes every fee tier that has liquidity and returns the best one, with its price impact against the pool's mid price. */
export async function bestRoute(net: UniNetwork, tIn: AssetDef, tOut: AssetDef, amountIn: bigint): Promise<Route | null> {
  const c = evmClient(net.id)
  const a = tIn.contract as Address, b = tOut.contract as Address
  const routes: Route[] = []
  for (const fee of FEE_TIERS) {
    const pool = await c.readContract({ address: net.factory, abi: factoryAbi, functionName: 'getPool', args: [a, b, fee] })
    if (pool === ZERO) continue
    if ((await c.readContract({ address: pool, abi: poolAbi, functionName: 'liquidity' })) === 0n) continue // initialised but empty: a quote would revert
    try {
      const { result } = await c.simulateContract({ address: net.quoter, abi: quoterAbi, functionName: 'quoteExactInputSingle', args: [{ tokenIn: a, tokenOut: b, amountIn, fee, sqrtPriceLimitX96: 0n }] })
      if (result[0] === 0n) continue
      const [sqrt] = await c.readContract({ address: pool, abi: poolAbi, functionName: 'slot0' })
      // token0 is the lower address. mid = token1 per token0 in raw units = (sqrtPriceX96 / 2^96)^2.
      const mid = (Number(sqrt) / 2 ** 96) ** 2
      const inIsToken0 = BigInt(a) < BigInt(b)
      const expected = (inIsToken0 ? Number(amountIn) * mid : Number(amountIn) / mid) * (1 - fee / 1_000_000)
      const impactBps = expected > 0 ? Math.max(0, Math.round((1 - Number(result[0]) / expected) * 10_000)) : 0
      routes.push({ fee, pool, out: result[0], gas: result[3], impactBps })
    } catch { /* this tier cannot fill the amount: skip it */ }
  }
  return routes.sort((x, y) => (y.out > x.out ? 1 : y.out < x.out ? -1 : 0))[0] ?? null
}

async function guard(user: User, c: CheckedUni) {
  if (await setting('platform_paused') === 'true') throw new HttpError(503, 'Transfers are temporarily paused')
  const net = uniNetwork(c.networkId)
  const tIn = tokenOf(c.networkId, c.tokenIn), tOut = tokenOf(c.networkId, c.tokenOut)
  const amountRaw = toUnits(c.amount, tIn.decimals)
  // Limits come first, so an over-limit swap is refused without any request to the chain.
  const cap = await capFor(tIn.symbol)
  if (amountRaw > toUnits(cap, tIn.decimals)) throw new HttpError(403, `Per-swap limit is ${cap} ${tIn.symbol}`)
  await verifyDeployment(net)
  const addrs = await ensureWallet(user.id)
  const held = (await readBalance(tIn, addrs.evm)).raw
  if (held < amountRaw) throw new HttpError(400, `Not enough ${tIn.symbol}. You have ${fromUnits(held, tIn.decimals)}.`)
  return { net, tIn, tOut, amountRaw, held, address: addrs.evm as Address }
}

/** A quote only: nothing is signed or sent. */
export async function quoteUni(user: User, input: UniInput) {
  const c = checkUniInput(input)
  const g = await guard(user, c)
  const client = evmClient(g.net.id)
  const route = await bestRoute(g.net, g.tIn, g.tOut, g.amountRaw)
  if (!route) throw new HttpError(422, `No Uniswap pool can fill ${g.tIn.symbol} to ${g.tOut.symbol} for this amount on ${g.net.name}. Try a different pair or a smaller amount.`)
  if (route.impactBps > BLOCK_IMPACT_BPS) throw new HttpError(422, `Price impact would be ${(route.impactBps / 100).toFixed(2)}%, which is too high. Try a smaller amount.`)
  const minOut = (route.out * BigInt(10_000 - c.slippageBps)) / 10_000n
  const allowance = await client.readContract({ address: g.tIn.contract as Address, abi: erc20Abi, functionName: 'allowance', args: [g.address, g.net.router] })
  const needsApproval = allowance < g.amountRaw
  const gasPrice = await client.getGasPrice()
  const gasUnits = (needsApproval ? 70_000n : 0n) + (route.gas * 13n) / 10n + 60_000n
  const feeWei = gasUnits * gasPrice
  const eth = await client.getBalance({ address: g.address })
  if (eth < feeWei + feeWei / 2n) throw new HttpError(400, `You need about ${formatEther(feeWei)} Sepolia ETH to pay the network fee, and have ${formatEther(eth)}.`)
  const exp = now() + 120_000
  const poolFee = (g.amountRaw * BigInt(route.fee)) / 1_000_000n
  return {
    confirmToken: uniConfirmToken(user.id, c, route.fee, minOut.toString(), exp), expiresAt: exp, chain: g.net.name, networkId: g.net.id,
    tokenIn: c.tokenIn, tokenOut: c.tokenOut, labelIn: g.tIn.symbol, labelOut: g.tOut.symbol, amount: c.amount, slippageBps: c.slippageBps,
    estimatedOut: fromUnits(route.out, g.tOut.decimals), minimumOut: fromUnits(minOut, g.tOut.decimals), minimumOutRaw: minOut.toString(), feeTier: route.fee,
    balance: fromUnits(g.held, g.tIn.decimals), address: g.address, priceImpactBps: route.impactBps, needsApproval,
    fees: [
      { type: 'provider', token: g.tIn.symbol, amount: fromUnits(poolFee, g.tIn.decimals) },
      { type: 'gas', token: 'ETH', amount: formatEther(feeWei) },
    ],
    provider: `Uniswap v3 (${route.fee / 10_000}% pool)`,
    warnings: [
      'Uniswap is an open exchange protocol. The price comes from its pools and can move before the swap lands; the minimum shown is the least you will accept.',
      ...(route.impactBps > WARN_IMPACT_BPS ? [`High price impact: this swap moves the pool price by ${(route.impactBps / 100).toFixed(2)}%. A smaller amount gets a better price.`] : []),
      ...(needsApproval ? [`The first time, the router must be allowed to spend your ${g.tIn.symbol}: that is a second transaction for exactly this amount.`] : []),
      'This is a test network: the tokens have no market value and pool prices can be far from real prices.',
    ],
  }
}

const running = new Set<string>()

async function drive(opId: string, userId: string, c: CheckedUni, tier: number, minOutRaw: bigint) {
  if (running.has(opId)) return
  running.add(opId)
  const beat = setInterval(() => void run("UPDATE swap_ops SET updated_at=? WHERE id=? AND status='running'", now(), opId), 15_000)
  try {
    const net = uniNetwork(c.networkId)
    const tIn = tokenOf(c.networkId, c.tokenIn), tOut = tokenOf(c.networkId, c.tokenOut)
    const amountRaw = toUnits(c.amount, tIn.decimals)
    const client = evmClient(net.id)
    const addrs = await ensureWallet(userId)
    const me = addrs.evm as Address
    const hashes: `0x${string}`[] = []
    let feeWei = 0n
    const swapHash = await withEvmAccount(userId, async (account) => {
      const wc = createWalletClient({ account, chain: evmChain(net.id), transport: http(evmBroadcastUrl(net.id), { timeout: 20_000 }) })
      const allowance = await client.readContract({ address: tIn.contract as Address, abi: erc20Abi, functionName: 'allowance', args: [me, net.router] })
      if (allowance < amountRaw) {
        const ah = await wc.writeContract({ address: tIn.contract as Address, abi: erc20Abi, functionName: 'approve', args: [net.router, amountRaw] })
        hashes.push(ah)
        const ar = await client.waitForTransactionReceipt({ hash: ah, timeout: 120_000 })
        if (ar.status !== 'success') throw new Error('The approval failed on chain')
        feeWei += ar.gasUsed * ar.effectiveGasPrice
      }
      const head = await client.getBlock()
      const deadline = head.timestamp + BigInt(DEADLINE_SECONDS)
      const data = encodeFunctionData({ abi: routerAbi, functionName: 'exactInputSingle', args: [{ tokenIn: tIn.contract as Address, tokenOut: tOut.contract as Address, fee: tier, recipient: me, amountIn: amountRaw, amountOutMinimum: minOutRaw, sqrtPriceLimitX96: 0n }] })
      // Simulate first: a revert here (price moved past the minimum, deadline, pool change) means nothing is sent.
      const { request } = await client.simulateContract({ account, address: net.router, abi: routerAbi, functionName: 'multicall', args: [deadline, [data]] })
      const sh = await wc.writeContract(request)
      hashes.push(sh)
      const sr = await client.waitForTransactionReceipt({ hash: sh, timeout: 120_000 })
      if (sr.status !== 'success') throw new Error('The swap failed on chain')
      feeWei += sr.gasUsed * sr.effectiveGasPrice
      const received = parseEventLogs({ abi: erc20Abi, eventName: 'Transfer', logs: sr.logs })
        .filter((l) => l.address.toLowerCase() === (tOut.contract as string).toLowerCase() && String(l.args.to).toLowerCase() === me.toLowerCase())
        .reduce((s, l) => s + (l.args.value as bigint), 0n)
      return { hash: sh, received }
    })
    const outHuman = fromUnits(swapHash.received, tOut.decimals)
    await run('UPDATE swap_ops SET status=?, amount_out=?, tx_hash=?, explorer_url=?, fees=?, error=NULL, updated_at=? WHERE id=?',
      'completed', outHuman, swapHash.hash, net.explorerTx + swapHash.hash, JSON.stringify([{ type: 'gas', token: 'ETH', amount: formatEther(feeWei) }]), now(), opId)
    await recordHistoryLeg({ userId, networkId: net.id, symbol: tIn.symbol, type: 'swapped', amountRaw, from: me, to: 'Uniswap v3', hash: swapHash.hash, leg: 0, note: `Paid in a swap for ${tOut.symbol}` })
    await recordHistoryLeg({ userId, networkId: net.id, symbol: tOut.symbol, type: 'swapped', amountRaw: swapHash.received, from: 'Uniswap v3', to: me, hash: swapHash.hash, leg: 1, note: `Received in a swap for ${tIn.symbol}` })
    void syncUser(userId)
    await notify(userId, 'order', 'Swap complete', `${c.amount} ${tIn.symbol} swapped to ${outHuman} ${tOut.symbol}.`)
    await audit(userId, 'uniswap.completed', opId, undefined, { network: net.id, tokenIn: c.tokenIn, tokenOut: c.tokenOut, amount: c.amount, tx: swapHash.hash, approvals: hashes.length - 1 })
  } catch (e) {
    const msg = scrub(e)
    await run("UPDATE swap_ops SET status='failed', error=?, updated_at=? WHERE id=?", msg, now(), opId)
    await alert('warning', 'swap_failed', 'Uniswap swap failed', msg, userId)
    await audit(userId, 'uniswap.failed', opId, undefined, { network: c.networkId, tokenIn: c.tokenIn, tokenOut: c.tokenOut, amount: c.amount })
  } finally {
    clearInterval(beat)
    running.delete(opId)
  }
}

export async function startUni(user: User, input: UniInput, feeTier: number, minOutRaw: string, confirmToken: string, expiresAt: number, pin: string, idem: string) {
  const dupe = await get<Record<string, unknown>>('SELECT * FROM swap_ops WHERE user_id=? AND idem_key=?', user.id, idem)
  if (dupe) return opView(dupe)
  const c = checkUniInput(input)
  if (!Number.isFinite(expiresAt) || expiresAt < now()) throw new HttpError(410, 'This quote expired. Get a new quote.')
  if (!(FEE_TIERS as readonly number[]).includes(feeTier) || !/^\d{1,40}$/.test(minOutRaw) || BigInt(minOutRaw) <= 0n) throw new HttpError(400, 'The quote is not valid. Get a new quote.')
  if (uniConfirmToken(user.id, c, feeTier, minOutRaw, expiresAt) !== confirmToken) throw new HttpError(400, 'The details changed after the quote. Get a new quote.')
  await assertOperational(user.id)
  await verifyPin(user.id, pin)
  const g = await guard(user, c)
  const id = uid('swp')
  try {
    await run(
      'INSERT INTO swap_ops(id,user_id,chain,address,token_in,token_out,amount_in,slippage_bps,provider,status,idem_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      id, user.id, c.networkId, g.address, g.tIn.symbol, g.tOut.symbol, c.amount, c.slippageBps, `Uniswap v3 (${feeTier / 10_000}% pool)`, 'running', idem, now(), now(),
    )
  } catch {
    const again = await get<Record<string, unknown>>('SELECT * FROM swap_ops WHERE user_id=? AND idem_key=?', user.id, idem)
    if (again) return opView(again)
    throw new HttpError(409, 'Could not record this swap')
  }
  await audit(user.id, 'uniswap.started', id, undefined, { network: c.networkId, tokenIn: c.tokenIn, tokenOut: c.tokenOut, amount: c.amount, slippageBps: c.slippageBps, feeTier })
  void drive(id, user.id, c, feeTier, BigInt(minOutRaw))
  return opView(await get<Record<string, unknown>>('SELECT * FROM swap_ops WHERE id=?', id) as Record<string, unknown>)
}
