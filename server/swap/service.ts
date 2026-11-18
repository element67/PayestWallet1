/**
 * Circle swaps (App Kit) on Arc Testnet, signed by the user's app wallet after a transaction PIN.
 *
 * Safety rules enforced here:
 * - Arc Testnet only, and only USDC, EURC and cirBTC. The swap always pays out to the user's OWN wallet address.
 * - A slippage limit is always set (default 1%, never above 3%), so the swap fails instead of filling at a bad price.
 * - The per-swap limit set by the founder applies to the token being spent; a token with no limit cannot be swapped.
 * - Amounts, tokens and slippage are bound by a signed, 2-minute confirmation; the PIN is checked on every start.
 * - A repeated request with the same idempotency key returns the first swap and never swaps twice.
 * - The wallet key exists in memory only inside the signing callback. This module never starts a swap by itself.
 */
import { createHmac } from 'node:crypto'
import { AppKit } from '@circle-fin/app-kit'
import { createViemAdapterFromPrivateKey } from '@circle-fin/adapter-viem-v2'
import { bytesToHex } from 'viem'
import { CONFIG } from '../config'
import { HttpError, type User } from '../auth'
import { all, alert, audit, get, notify, now, run, setting, uid } from '../db'
import { fromUnits, toUnits } from '../money'
import { recordHistoryLeg, unitsOf, EXTRA_DECIMALS } from '../wallet/history'
import { syncUser } from '../wallet/service'
import { assertOperational, verifyPin } from '../naira/wallet'
import { scrub } from '../rpc'
import { ensureWallet, withEvmAccount } from '../wallet/keys'
import { walletLimits } from '../wallet/service'
import { labelOf, normalizeToken, SWAP_CHAIN, SWAP_CHAIN_NAME, SWAP_DECIMALS, tokenBalance, type SwapSymbol } from './chains'

export const DEFAULT_SLIPPAGE_BPS = 100
export const MAX_SLIPPAGE_BPS = 300
const MIN_SLIPPAGE_BPS = 10
/** Spending limit for a token that is not in the founder's token registry (cirBTC) or has no limit yet (EURC), in whole tokens. */
const FALLBACK_CAP: Record<string, string> = { CIRBTC: '0.0005', EURC: '500' }

export interface SwapInput { tokenIn: string; tokenOut: string; amount: string; slippageBps?: number }
export interface CheckedSwap { tokenIn: SwapSymbol; tokenOut: SwapSymbol; amount: string; slippageBps: number }

/** Validates everything the caller sent. Pure: no network, no database. */
export function checkSwapInput(i: SwapInput): CheckedSwap {
  const tokenIn = normalizeToken(i.tokenIn), tokenOut = normalizeToken(i.tokenOut)
  if (!tokenIn || !tokenOut) throw new HttpError(400, 'Choose USDC, EURC or cirBTC')
  if (tokenIn === tokenOut) throw new HttpError(400, 'Choose two different tokens')
  if (typeof i.amount !== 'string' || !/^\d{1,12}(\.\d{1,8})?$/.test(i.amount)) throw new HttpError(400, 'Enter a valid amount (up to 8 decimals)')
  if (!(Number(i.amount) > 0)) throw new HttpError(400, 'Enter an amount above zero')
  const slippageBps = i.slippageBps === undefined ? DEFAULT_SLIPPAGE_BPS : i.slippageBps
  if (!Number.isInteger(slippageBps) || slippageBps < MIN_SLIPPAGE_BPS || slippageBps > MAX_SLIPPAGE_BPS) {
    throw new HttpError(400, `Slippage must be between ${MIN_SLIPPAGE_BPS / 100}% and ${MAX_SLIPPAGE_BPS / 100}%`)
  }
  return { tokenIn, tokenOut, amount: i.amount, slippageBps }
}

/** A fee such as 0.0235855725 USDC has more decimals than the token, so it is rounded UP to the smallest unit: a fee is never under-counted. */
export function ceilUnits(input: string, decimals: number): bigint {
  const s = input.trim()
  if (!/^\d+(\.\d+)?$/.test(s)) throw new HttpError(502, 'The swap provider returned an unreadable fee')
  const [whole, frac = ''] = s.split('.')
  const kept = frac.slice(0, decimals).padEnd(decimals, '0')
  const base = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(kept || '0')
  return /[1-9]/.test(frac.slice(decimals)) ? base + 1n : base
}

export const swapConfirmToken = (userId: string, c: CheckedSwap, exp: number) =>
  createHmac('sha256', CONFIG.walletMasterKey).update(JSON.stringify(['circle-swap', userId, c.tokenIn, c.tokenOut, c.amount, c.slippageBps, exp])).digest('base64url')

interface Fee { token: string; amount: string; type: string }
interface Estimate {
  estimatedOutput?: { amount: string; token: string }
  stopLimit?: { amount: string; token: string }
  fees?: Fee[]
  fromAddress?: string
  route?: { provider?: string; steps?: { fromToken?: { address?: string; decimals?: number } }[] }
}

const USDC_ARC = '0x3600000000000000000000000000000000000000'

/** Runs `fn` with an App Kit adapter for the user's wallet. The key lives only inside this call. */
async function withAdapter<T>(userId: string, fn: (kit: AppKit, adapter: ReturnType<typeof createViemAdapterFromPrivateKey>) => Promise<T>): Promise<T> {
  return await withEvmAccount(userId, async (account) => {
    const adapter = createViemAdapterFromPrivateKey({ privateKey: bytesToHex(account.getHdKey().privateKey as Uint8Array) })
    return await fn(new AppKit(), adapter)
  })
}

async function capFor(symbol: string): Promise<string> {
  const limits = await walletLimits()
  const cap = limits.perTx[symbol] ?? limits.perTx[labelOf(symbol)] ?? FALLBACK_CAP[symbol]
  if (!cap) throw new HttpError(403, `Swapping ${labelOf(symbol)} is not switched on yet: no limit has been set for it.`)
  return cap
}

async function evaluate(user: User, c: CheckedSwap) {
  if (await setting('platform_paused') === 'true') throw new HttpError(503, 'Transfers are temporarily paused')
  const cap = await capFor(c.tokenIn)
  // The limit is checked before a quote is requested, so an over-limit swap never reaches the swap provider.
  if (toUnits(c.amount, SWAP_DECIMALS[c.tokenIn]) > toUnits(cap, SWAP_DECIMALS[c.tokenIn])) throw new HttpError(403, `Per-swap limit is ${cap} ${labelOf(c.tokenIn)}`)
  const addrs = await ensureWallet(user.id)
  const est = await withAdapter(user.id, (kit, adapter) =>
    kit.estimateSwap({ from: { adapter, chain: SWAP_CHAIN as never }, tokenIn: c.tokenIn as never, tokenOut: c.tokenOut as never, amountIn: c.amount, config: { slippageBps: c.slippageBps } } as never),
  ) as unknown as Estimate
  const step = est.route?.steps?.[0]?.fromToken
  const decimals = step?.decimals ?? 6
  const amountRaw = toUnits(c.amount, decimals)
  if (amountRaw > toUnits(cap, decimals)) throw new HttpError(403, `Per-swap limit is ${cap} ${labelOf(c.tokenIn)}`)
  const out = est.estimatedOutput
  if (!out || !(Number(out.amount) > 0)) throw new HttpError(422, 'No swap route is available for these tokens right now. Try a different pair or amount.')
  // Arc fees are paid in USDC from the same balance, so the fee has to fit as well as the amount.
  const gasFee = (est.fees ?? []).filter((f) => f.type === 'gas' && f.token === 'USDC').reduce((s, f) => s + ceilUnits(f.amount, 6), 0n)
  const tokenInAddr = step?.address ?? (c.tokenIn === 'USDC' ? USDC_ARC : '')
  if (!tokenInAddr) throw new HttpError(422, 'Could not work out the token to spend. Try again.')
  const held = await tokenBalance(tokenInAddr, addrs.evm)
  if (held < amountRaw) throw new HttpError(400, `Not enough ${labelOf(c.tokenIn)}. You have ${fromUnits(held, decimals)}.`)
  const usdc = c.tokenIn === 'USDC' ? held : await tokenBalance(USDC_ARC, addrs.evm)
  const usdcNeeded = gasFee + (c.tokenIn === 'USDC' ? amountRaw : 0n)
  if (usdc < usdcNeeded) throw new HttpError(400, `Arc pays network fees in USDC. You need about ${fromUnits(usdcNeeded, 6)} USDC for this swap and have ${fromUnits(usdc, 6)}.`)
  return { est, address: addrs.evm, decimals, held, gasFee }
}

/** A quote only: nothing is signed or sent. Returns what the user will review before confirming with their PIN. */
export async function quoteSwap(user: User, input: SwapInput) {
  const c = checkSwapInput(input)
  const e = await evaluate(user, c)
  const exp = now() + 120_000
  const out = e.est.estimatedOutput as { amount: string; token: string }
  return {
    confirmToken: swapConfirmToken(user.id, c, exp), expiresAt: exp, chain: SWAP_CHAIN_NAME,
    tokenIn: c.tokenIn, tokenOut: c.tokenOut, labelIn: labelOf(c.tokenIn), labelOut: labelOf(c.tokenOut), amount: c.amount, slippageBps: c.slippageBps,
    estimatedOut: out.amount, minimumOut: e.est.stopLimit?.amount ?? null, balance: fromUnits(e.held, e.decimals), address: e.address,
    fees: (e.est.fees ?? []).map((f) => ({ type: f.type, token: f.token === 'CIRBTC' ? 'cirBTC' : f.token, amount: f.amount })),
    provider: e.est.route?.provider ?? 'circle',
    warnings: [
      'This swap runs through an outside swap provider (Circle or an aggregator such as LiFi). The provider can change by route, and you are subject to its terms.',
      'Quotes are estimates. The price can move before the swap lands; the minimum shown is the least you will accept.',
      ...(c.tokenIn === 'USDC' ? ['Arc pays the network fee in USDC from the same balance.'] : []),
    ],
  }
}

export function opView(r: Record<string, unknown>) {
  return {
    id: r.id, chain: SWAP_CHAIN_NAME, tokenIn: r.token_in, tokenOut: r.token_out, labelIn: labelOf(String(r.token_in)), labelOut: labelOf(String(r.token_out)),
    amountIn: r.amount_in, amountOut: r.amount_out ?? null, slippageBps: r.slippage_bps, provider: r.provider ?? null, status: r.status as 'running' | 'completed' | 'failed',
    txHash: r.tx_hash ?? null, explorerUrl: r.explorer_url ?? null, fees: JSON.parse(String(r.fees)) as Fee[], error: r.error ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
  }
}

const running = new Set<string>()

/** Signs and sends the swap in the background. Progress lands in the database; the screen polls it. */
async function drive(opId: string, userId: string, c: CheckedSwap) {
  if (running.has(opId)) return
  running.add(opId)
  const beat = setInterval(() => void run("UPDATE swap_ops SET updated_at=? WHERE id=? AND status='running'", now(), opId), 15_000)
  try {
    await withAdapter(userId, async (kit, adapter) => {
      const r = await kit.swap({
        from: { adapter, chain: SWAP_CHAIN as never }, tokenIn: c.tokenIn as never, tokenOut: c.tokenOut as never, amountIn: c.amount,
        config: { slippageBps: c.slippageBps },
      } as never) as unknown as { amountOut?: string; txHash?: string; explorerUrl?: string; fees?: Fee[]; progress?: { status?: string } }
      const ok = r.progress?.status === 'DONE' || (Boolean(r.txHash) && r.progress?.status !== 'FAILED')
      await run('UPDATE swap_ops SET status=?, amount_out=?, tx_hash=?, explorer_url=?, fees=?, error=?, updated_at=? WHERE id=?',
        ok ? 'completed' : 'failed', r.amountOut ?? null, r.txHash ?? null, r.explorerUrl ?? null, JSON.stringify(r.fees ?? []), ok ? null : 'The swap did not finish. Check your balance before trying again.', now(), opId)
      if (ok && r.txHash) {
        // Both sides go to the History tab, and balances are refreshed now so the new token shows without waiting for the next sync.
        const wallet = (await get<{ address: string }>('SELECT address FROM swap_ops WHERE id=?', opId))?.address ?? ''
        const dIn = EXTRA_DECIMALS[c.tokenIn] ?? 6
        const dOut = EXTRA_DECIMALS[c.tokenOut] ?? 6
        await recordHistoryLeg({ userId, networkId: 'arc-testnet', symbol: labelOf(c.tokenIn), type: 'swapped', amountRaw: unitsOf(c.amount, dIn), from: wallet, to: 'Circle swap', hash: r.txHash, leg: 0, note: `Paid in a swap for ${labelOf(c.tokenOut)}` })
        if (r.amountOut) await recordHistoryLeg({ userId, networkId: 'arc-testnet', symbol: labelOf(c.tokenOut), type: 'swapped', amountRaw: unitsOf(r.amountOut, dOut), from: 'Circle swap', to: wallet, hash: r.txHash, leg: 1, note: `Received in a swap for ${labelOf(c.tokenIn)}` })
        void syncUser(userId)
      }
      if (ok) await notify(userId, 'order', 'Swap complete', `${c.amount} ${labelOf(c.tokenIn)} swapped to ${r.amountOut ?? labelOf(c.tokenOut)}.`)
      await audit(userId, ok ? 'circle_swap.completed' : 'circle_swap.failed', opId, undefined, { tokenIn: c.tokenIn, tokenOut: c.tokenOut, amount: c.amount, txHash: r.txHash })
    })
  } catch (e) {
    const msg = scrub(e)
    await run("UPDATE swap_ops SET status='failed', error=?, updated_at=? WHERE id=?", msg, now(), opId)
    await alert('warning', 'swap_failed', 'Circle swap failed', msg, userId)
    await audit(userId, 'circle_swap.failed', opId, undefined, { tokenIn: c.tokenIn, tokenOut: c.tokenOut, amount: c.amount })
  } finally {
    clearInterval(beat)
    running.delete(opId)
  }
}

export async function startSwap(user: User, input: SwapInput, confirmToken: string, expiresAt: number, pin: string, idem: string) {
  const dupe = await get<Record<string, unknown>>('SELECT * FROM swap_ops WHERE user_id=? AND idem_key=?', user.id, idem)
  if (dupe) return opView(dupe)
  const c = checkSwapInput(input)
  if (!Number.isFinite(expiresAt) || expiresAt < now()) throw new HttpError(410, 'This quote expired. Get a new quote.')
  if (swapConfirmToken(user.id, c, expiresAt) !== confirmToken) throw new HttpError(400, 'The details changed after the quote. Get a new quote.')
  await assertOperational(user.id)
  await verifyPin(user.id, pin)
  const e = await evaluate(user, c)
  const id = uid('swp')
  try {
    await run(
      "INSERT INTO swap_ops(id,user_id,chain,address,token_in,token_out,amount_in,slippage_bps,provider,status,idem_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      id, user.id, SWAP_CHAIN, e.address, c.tokenIn, c.tokenOut, c.amount, c.slippageBps, e.est.route?.provider ?? null, 'running', idem, now(), now(),
    )
  } catch {
    const again = await get<Record<string, unknown>>('SELECT * FROM swap_ops WHERE user_id=? AND idem_key=?', user.id, idem)
    if (again) return opView(again)
    throw new HttpError(409, 'Could not record this swap')
  }
  await audit(user.id, 'circle_swap.started', id, undefined, { tokenIn: c.tokenIn, tokenOut: c.tokenOut, amount: c.amount, slippageBps: c.slippageBps })
  void drive(id, user.id, c)
  return opView(await get<Record<string, unknown>>('SELECT * FROM swap_ops WHERE id=?', id) as Record<string, unknown>)
}

export async function getSwapOp(user: User, opId: string) {
  const row = await get<Record<string, unknown>>('SELECT * FROM swap_ops WHERE id=? AND user_id=?', opId, user.id)
  if (!row) throw new HttpError(404, 'Swap not found')
  return opView(row)
}

export const listSwapOps = async (user: User) =>
  (await all<Record<string, unknown>>('SELECT * FROM swap_ops WHERE user_id=? ORDER BY created_at DESC LIMIT 30', user.id)).map(opView)

/** A swap whose heartbeat stopped (its process restarted) is marked failed, with a plain instruction, instead of showing "running" forever. Run by the worker. */
export async function sweepStaleSwapOps() {
  await run("UPDATE swap_ops SET status='failed', error='The server restarted during this swap. Check your balance and the transaction link before trying again.', updated_at=? WHERE status='running' AND updated_at<?", now(), now() - 180_000)
}
