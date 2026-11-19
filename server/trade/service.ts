/**
 * Swap and bridge orchestration. Validates the request, asks the router for quotes, shows them with a signed confirmation, and on
 * the user's PIN runs the chosen provider in the background while recording every step.
 *
 * Safety rules enforced here:
 * - Chains and tokens come only from the server's own lists; the browser never supplies a contract address.
 * - The output always goes to the user's OWN address. There is no recipient field.
 * - The founder's per-transaction limit applies to the token being sent. On mainnet a token with no limit cannot be traded.
 * - Everything the user saw (provider, tokens, networks, amount, slippage, speed) is bound by a signed, 2-minute confirmation.
 * - The PIN is checked on every start and every resume. A repeated request with the same idempotency key returns the first trade.
 * - Nothing runs by itself: this module starts a trade only from start() and resume().
 */
import { createHmac } from 'node:crypto'
import { CONFIG } from '../config'
import { HttpError, type User } from '../auth'
import { all, alert, audit, get, notify, now, run, setting, uid } from '../db'
import { fromUnits, toUnits } from '../money'
import { assertOperational, verifyPin } from '../naira/wallet'
import { scrub } from '../rpc'
import { ensureWallet } from '../wallet/keys'
import { syncUser, walletLimits } from '../wallet/service'
import { DEFAULT_SLIPPAGE_BPS, MAX_SLIPPAGE_BPS, MIN_SLIPPAGE_BPS, tradeFee, tradeMode } from './config'
import { findTradeChain, hasGas, tokenBalance, tokensFor, tradeChains } from './chains'
import { recordTradeHistory } from './history'
import { PROVIDERS, activeProviders, collectQuotes, pickBest } from './router'
import type { Kind, Mode, ProviderId, ProviderQuote, Speed, TradeRequest, Who } from './types'

export interface TradeInput { kind: string; from: string; to: string; tokenIn: string; tokenOut?: string; amount: string; slippageBps?: number; speed?: string }
/** Spending limit, in whole tokens, for test-network tokens the founder's registry does not list. Never used on mainnet. */
const TESTNET_FALLBACK_CAP: Record<string, string> = { CIRBTC: '0.0005', EURC: '500', USDC: '500' }

/** Validates everything the caller sent and turns it into a request made only of server-known chains and tokens. Pure apart from reading the server's lists. */
export function buildRequest(mode: Mode, i: TradeInput): TradeRequest {
  const kind = i.kind === 'swap' || i.kind === 'bridge' ? (i.kind as Kind) : null
  if (!kind) throw new HttpError(400, 'Choose swap or bridge')
  const from = findTradeChain(mode, i.from), to = findTradeChain(mode, i.to)
  if (!from || !to) throw new HttpError(400, `Choose a supported ${mode} network`)
  if (kind === 'swap' && from.id !== to.id) throw new HttpError(400, 'A swap happens on one network. Use Bridge to move tokens between networks.')
  if (kind === 'bridge' && from.id === to.id) throw new HttpError(400, 'Choose two different networks')
  const sym = (v: unknown) => (typeof v === 'string' ? v.trim().toUpperCase() : '')
  const tokenIn = tokensFor(from, kind).find((t) => t.symbol === sym(i.tokenIn))
  const tokenOut = kind === 'bridge' ? tokensFor(to, 'bridge').find((t) => t.symbol === sym(i.tokenIn)) : tokensFor(to, 'swap').find((t) => t.symbol === sym(i.tokenOut))
  if (!tokenIn || !tokenOut) throw new HttpError(400, 'Choose a token this network offers')
  if (kind === 'swap' && tokenIn.symbol === tokenOut.symbol) throw new HttpError(400, 'Choose two different tokens')
  if (typeof i.amount !== 'string' || !/^\d{1,12}(\.\d{1,8})?$/.test(i.amount)) throw new HttpError(400, 'Enter a valid amount')
  let amountRaw: bigint
  try { amountRaw = toUnits(i.amount, tokenIn.decimals) } catch { throw new HttpError(400, `${tokenIn.label} has at most ${tokenIn.decimals} decimals`) }
  if (amountRaw <= 0n) throw new HttpError(400, 'Enter an amount above zero')
  const slippageBps = i.slippageBps === undefined ? DEFAULT_SLIPPAGE_BPS : i.slippageBps
  if (!Number.isInteger(slippageBps) || slippageBps < MIN_SLIPPAGE_BPS || slippageBps > MAX_SLIPPAGE_BPS) throw new HttpError(400, `Slippage must be between ${MIN_SLIPPAGE_BPS / 100}% and ${MAX_SLIPPAGE_BPS / 100}%`)
  const speed: Speed = i.speed === 'slow' ? 'slow' : 'fast'
  return { kind, from, to, tokenIn, tokenOut, amount: i.amount, amountRaw, slippageBps, speed }
}

export const confirmToken = (userId: string, mode: Mode, provider: ProviderId, r: TradeRequest, exp: number) =>
  createHmac('sha256', CONFIG.walletMasterKey).update(JSON.stringify(['trade', userId, mode, provider, r.kind, r.from.id, r.to.id, r.tokenIn.symbol, r.tokenOut.symbol, r.amount, r.slippageBps, r.speed, exp])).digest('base64url')

async function whoIs(userId: string): Promise<Who> {
  const a = await ensureWallet(userId)
  return { userId, evm: a.evm, solana: a.solana }
}

async function capFor(mode: Mode, symbol: string): Promise<string> {
  const limits = await walletLimits()
  const cap = limits.perTx[symbol] ?? (mode === 'testnet' ? TESTNET_FALLBACK_CAP[symbol] : undefined)
  if (!cap) throw new HttpError(403, `Trading ${symbol} is not switched on yet: the founder has not set a limit for it.`)
  return cap
}

/** Everything that must hold before a quote or a start: not paused, within the limit, enough balance, enough for fees. */
async function checkAllowed(mode: Mode, req: TradeRequest, who: Who) {
  if (await setting('platform_paused') === 'true') throw new HttpError(503, 'Trading is temporarily paused')
  const cap = await capFor(mode, req.tokenIn.symbol)
  if (req.amountRaw > toUnits(cap, req.tokenIn.decimals)) throw new HttpError(403, `Per-trade limit is ${cap} ${req.tokenIn.label}`)
  const held = await tokenBalance(req.from, req.tokenIn, who)
  if (held !== null && held < req.amountRaw) throw new HttpError(400, `Not enough ${req.tokenIn.label} on ${req.from.name}. You have ${fromUnits(held, req.tokenIn.decimals)}.`)
  if (!(await hasGas(req.from, who))) throw new HttpError(400, `Your wallet has no ${req.from.gasSymbol} on ${req.from.name} to pay the network fee. Add a little first.`)
  return { held }
}

const publicQuote = (q: ProviderQuote, token: string) => ({
  provider: q.provider, providerName: q.providerName, amountOut: q.amountOut, minOut: q.minOut, fees: q.fees, etaSeconds: q.etaSeconds, otherSpeed: q.otherSpeed ?? null,
  priceImpactBps: q.priceImpactBps ?? null, route: q.route, confirmToken: token,
})

/** A quote only: nothing is signed or sent. Returns what the user reviews, the recommended provider and the alternatives. */
export async function quoteTrade(user: User, input: TradeInput) {
  const mode = await tradeMode()
  const req = buildRequest(mode, input)
  const who = await whoIs(user.id)
  const { held } = await checkAllowed(mode, req, who)
  const { quotes, skipped } = await collectQuotes(req, who, mode, activeProviders(req))
  const { best, alternatives } = pickBest(req, quotes)
  if (!best) throw new HttpError(422, `No provider could quote this ${req.kind} right now. ${skipped.map((s) => `${s.name}: ${s.reason}`).join(' ')}`.trim())
  const exp = now() + 120_000
  const fee = await tradeFee()
  const withToken = (q: ProviderQuote) => publicQuote(q, confirmToken(user.id, mode, q.provider, req, exp))
  const impact = best.priceImpactBps ?? 0
  return {
    mode, expiresAt: exp, kind: req.kind, from: req.from.id, to: req.to.id, fromName: req.from.name, toName: req.to.name,
    tokenIn: req.tokenIn.symbol, tokenOut: req.tokenOut.symbol, labelIn: req.tokenIn.label, labelOut: req.tokenOut.label, amount: req.amount, slippageBps: req.slippageBps, speed: req.speed,
    balance: held === null ? null : fromUnits(held, req.tokenIn.decimals), recipient: req.to.family === 'solana' ? who.solana : who.evm,
    recommended: withToken(best), alternatives: alternatives.map(withToken), skipped, serviceFeeBps: fee.bps,
    warnings: [
      ...(mode === 'mainnet' ? ['Mainnet: this uses real funds and cannot be undone once sent.'] : ['Test network: these tokens have no market value.']),
      ...(impact > 100 ? [`High price impact (${(impact / 100).toFixed(2)}%). You may get much less than the market price.`] : []),
      ...(req.kind === 'bridge' ? ['The tokens arrive at your own address on the destination network.'] : ['The swap pays out to your own wallet. If the price moves past your slippage limit, the swap fails instead of filling.']),
    ],
  }
}

export interface Step { name: string; state: 'pending' | 'success' | 'error'; txHash?: string; explorerUrl?: string; error?: string }

export function opView(r: Record<string, unknown>) {
  const mode = r.mode as Mode
  return {
    id: r.id, kind: r.kind, provider: r.provider, providerName: PROVIDERS[r.provider as ProviderId]?.name ?? String(r.provider), mode,
    from: r.from_chain, to: r.to_chain, fromName: findTradeChain(mode, r.from_chain)?.name ?? String(r.from_chain), toName: findTradeChain(mode, r.to_chain)?.name ?? String(r.to_chain),
    tokenIn: r.token_in, tokenOut: r.token_out, amountIn: r.amount_in, amountOut: r.amount_out ?? null, minOut: r.min_out ?? null, slippageBps: r.slippage_bps, speed: r.speed ?? null,
    status: r.status as 'running' | 'completed' | 'failed', steps: JSON.parse(String(r.steps)) as Step[], txHashes: JSON.parse(String(r.tx_hashes)) as string[],
    explorerUrl: r.explorer_url ?? null, error: r.error ?? null, canResume: r.status === 'failed' && Boolean(r.resume), fees: JSON.parse(String(r.fees)), createdAt: r.created_at, updatedAt: r.updated_at,
  }
}

const running = new Set<string>()

/** Runs (or resumes) the trade in the background. Progress lands in the database; the screen polls it. */
async function drive(opId: string, userId: string, req: TradeRequest, provider: ProviderId, mode: Mode, resume: unknown | null) {
  if (running.has(opId)) return
  running.add(opId)
  // A heartbeat shows the trade is alive. If this process stops, the heartbeat stops and the sweep below marks it interrupted.
  const beat = setInterval(() => void run("UPDATE trade_ops SET updated_at=? WHERE id=? AND status='running'", now(), opId), 15_000)
  const steps = new Map<string, Step>()
  const progress = {
    step: async (name: string, state: Step['state'], extra: { txHash?: string; explorerUrl?: string; error?: string } = {}) => {
      steps.set(name, { name, state, ...extra })
      await run('UPDATE trade_ops SET steps=?, updated_at=? WHERE id=?', JSON.stringify([...steps.values()]), now(), opId)
    },
  }
  try {
    const who = await whoIs(userId)
    const p = PROVIDERS[provider]
    // A resumed bridge carries its own state, so it needs no new quote. Anything else is priced again right before it is signed.
    const quote = resume ? ({ provider, providerName: p.name, amountOut: req.amount, amountOutRaw: req.amountRaw, minOut: null, fees: [], etaSeconds: null, route: [] } as ProviderQuote) : await p.getQuote(req, who, mode)
    const r = await p.execute(req, quote, who, mode, progress, resume)
    const all_ = [...steps.values()]
    await run('UPDATE trade_ops SET status=?, amount_out=?, tx_hashes=?, explorer_url=?, error=?, resume=?, steps=?, updated_at=? WHERE id=?',
      r.ok ? 'completed' : 'failed', r.amountOut ?? null, JSON.stringify(r.txHashes), r.explorerUrl ?? null, r.ok ? null : (r.error ?? 'The trade did not finish'),
      r.ok || !r.resume ? null : JSON.stringify(r.resume), JSON.stringify(all_), now(), opId)
    if (r.ok) {
      await recordTradeHistory(userId, req, who, r, p.name, all_)
      void syncUser(userId)
      await notify(userId, 'order', `${req.kind === 'swap' ? 'Swap' : 'Bridge'} complete`, `${req.amount} ${req.tokenIn.label} ${req.kind === 'swap' ? `swapped to ${r.amountOut ?? req.tokenOut.label}` : `sent to ${req.to.name}`}.`)
    } else await alert('warning', 'trade_failed', `${req.kind} stopped`, r.error ?? 'Unknown', userId)
    await audit(userId, r.ok ? 'trade.completed' : 'trade.failed', opId, undefined, { kind: req.kind, provider, from: req.from.id, to: req.to.id, amount: req.amount })
  } catch (e) {
    const msg = scrub(e)
    await run("UPDATE trade_ops SET status='failed', error=?, steps=?, updated_at=? WHERE id=?", msg, JSON.stringify([...steps.values()]), now(), opId)
    await alert('warning', 'trade_failed', `${req.kind} failed`, msg, userId)
    await audit(userId, 'trade.failed', opId, undefined, { kind: req.kind, provider })
  } finally {
    clearInterval(beat)
    running.delete(opId)
  }
}

export async function startTrade(user: User, input: TradeInput, provider: string, token: string, expiresAt: number, pin: string, idem: string) {
  const dupe = await get<Record<string, unknown>>('SELECT * FROM trade_ops WHERE user_id=? AND idem_key=?', user.id, idem)
  if (dupe) return opView(dupe)
  const mode = await tradeMode()
  const req = buildRequest(mode, input)
  const p = PROVIDERS[provider as ProviderId]
  if (!p) throw new HttpError(400, 'Choose one of the offered providers')
  if (!Number.isFinite(expiresAt) || expiresAt < now()) throw new HttpError(410, 'This quote expired. Get a new quote.')
  if (confirmToken(user.id, mode, p.id, req, expiresAt) !== token) throw new HttpError(400, 'The details changed after the quote. Get a new quote.')
  if (!activeProviders(req).includes(p)) throw new HttpError(422, `${p.name} is on hold until mainnet`)
  const why = p.unsupported(req, mode)
  if (why) throw new HttpError(422, `${p.name} cannot run this: ${why}`)
  await assertOperational(user.id)
  await verifyPin(user.id, pin)
  const who = await whoIs(user.id)
  await checkAllowed(mode, req, who)
  const fee = p.id === 'circle' ? { bps: 0 } : await tradeFee()
  const id = uid('trd')
  try {
    await run(
      `INSERT INTO trade_ops(id,user_id,kind,provider,mode,from_chain,to_chain,token_in,token_out,amount_in,slippage_bps,speed,fee_bps,status,address,recipient,idem_key,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, user.id, req.kind, p.id, mode, req.from.id, req.to.id, req.tokenIn.symbol, req.tokenOut.symbol, req.amount, req.slippageBps, req.kind === 'bridge' ? req.speed : null, fee.bps, 'running',
      req.from.family === 'solana' ? who.solana : who.evm, req.to.family === 'solana' ? who.solana : who.evm, idem, now(), now(),
    )
  } catch {
    const again = await get<Record<string, unknown>>('SELECT * FROM trade_ops WHERE user_id=? AND idem_key=?', user.id, idem)
    if (again) return opView(again)
    throw new HttpError(409, 'Could not record this trade')
  }
  await audit(user.id, 'trade.started', id, undefined, { kind: req.kind, provider: p.id, mode, from: req.from.id, to: req.to.id, tokenIn: req.tokenIn.symbol, tokenOut: req.tokenOut.symbol, amount: req.amount, slippageBps: req.slippageBps })
  void drive(id, user.id, req, p.id, mode, null)
  return opView(await get<Record<string, unknown>>('SELECT * FROM trade_ops WHERE id=?', id) as Record<string, unknown>)
}

/** Resumes a bridge that stopped part-way, from the point it reached. Needs the PIN again. */
export async function resumeTrade(user: User, opId: string, pin: string) {
  const row = await get<Record<string, unknown>>('SELECT * FROM trade_ops WHERE id=? AND user_id=?', opId, user.id)
  if (!row) throw new HttpError(404, 'Trade not found')
  if (row.status !== 'failed' || !row.resume) throw new HttpError(409, 'This trade cannot be resumed')
  await assertOperational(user.id)
  await verifyPin(user.id, pin)
  const mode = row.mode as Mode
  const req = buildRequest(mode, { kind: String(row.kind), from: String(row.from_chain), to: String(row.to_chain), tokenIn: String(row.token_in), tokenOut: String(row.token_out), amount: String(row.amount_in), slippageBps: Number(row.slippage_bps), speed: String(row.speed ?? 'fast') })
  await run("UPDATE trade_ops SET status='running', error=NULL, updated_at=? WHERE id=?", now(), opId)
  void drive(opId, user.id, req, row.provider as ProviderId, mode, JSON.parse(String(row.resume)))
  return opView(await get<Record<string, unknown>>('SELECT * FROM trade_ops WHERE id=?', opId) as Record<string, unknown>)
}

export async function getTradeOp(user: User, opId: string) {
  const row = await get<Record<string, unknown>>('SELECT * FROM trade_ops WHERE id=? AND user_id=?', opId, user.id)
  if (!row) throw new HttpError(404, 'Trade not found')
  return opView(row)
}

export const listTradeOps = async (user: User) =>
  (await all<Record<string, unknown>>('SELECT * FROM trade_ops WHERE user_id=? ORDER BY created_at DESC LIMIT 30', user.id)).map(opView)

/** A trade whose heartbeat stopped (its process restarted) is marked failed with a plain instruction, instead of showing "running" forever. Run by the worker. */
export async function sweepStaleTrades() {
  await run("UPDATE trade_ops SET status='failed', error='The server restarted during this trade. Check your balance and any transaction link before trying again.', updated_at=? WHERE status='running' AND updated_at<?", now(), now() - 180_000)
}

export { tradeChains }
