/**
 * AchSwap Developer API: swaps on Arc mainnet. The API only prepares transactions: it quotes, then builds a ready-to-sign swap that it
 * has already simulated from the sender. This adapter checks that the transaction targets AchSwap's route executor (AchRouteExecutorV2)
 * before anything is signed. Our own fee (0 to 1%) is passed as feeBps and paid in the output token to the fee wallet in the same
 * transaction. AchSwap's own fee comes on top and is shown as reported. Needs ACHSWAP_API_KEY, which stays on the server.
 */
import { HttpError } from '../../auth'
import { fromUnits } from '../../money'
import { providerKey, tradeFee } from '../config'
import { explorerLink, isNative, withEvm, approveIfNeeded } from '../evm'
import { providerJson } from '../http'
import type { Approval, ExecResult, FeeLine, Provider, ProviderQuote, TradeRequest } from '../types'

const BASE = 'https://trade.achswap.app/api/v1'
/** AchRouteExecutorV2 on Arc mainnet, from AchSwap's developer docs. Override with ACHSWAP_EXECUTOR only if AchSwap publishes a new one. */
const EXECUTOR = (process.env.ACHSWAP_EXECUTOR ?? '0xF69036De0e32566CfF7C79c29229D441cdE3e48E').toLowerCase() // arc-studio-allow-onchain-literal
const ARC_MAINNET = 5042
const ZERO = '0x0000000000000000000000000000000000000000'

interface AchQuote {
  amountOut?: string; minAmountOut?: string; grossAmountOut?: string; protocolBps?: number
  fees?: { type?: string; name?: string; amount?: string; token?: string; bps?: number }[]
  route?: unknown; routeSummary?: string
}
interface AchSwap extends AchQuote {
  tx?: { to?: string; data?: string; value?: string; gas?: string | null }
  approval?: { token?: string; spender?: string; amount?: string } | null
  simulated?: boolean
}

const headers = () => ({ 'x-api-key': providerKey('achswap') as string, 'content-type': 'application/json', accept: 'application/json' })

async function body(req: TradeRequest, extra: Record<string, unknown> = {}) {
  const fee = await tradeFee()
  return JSON.stringify({
    tokenIn: isNative(req.tokenIn.address) ? ZERO : req.tokenIn.address, tokenOut: isNative(req.tokenOut.address) ? ZERO : req.tokenOut.address,
    amountIn: req.amountRaw.toString(), slippageBps: req.slippageBps, chainId: ARC_MAINNET, ...(fee.bps > 0 && fee.wallet ? { feeBps: fee.bps, feeRecipient: fee.wallet } : {}), ...extra,
  })
}

export const achswap: Provider = {
  id: 'achswap',
  name: 'AchSwap',

  unsupported(req, mode) {
    if (!providerKey('achswap')) return 'AchSwap is not set up (ACHSWAP_API_KEY is missing)'
    if (mode !== 'mainnet') return 'AchSwap works on Arc mainnet only'
    if (req.kind !== 'swap') return 'AchSwap swaps only; it has no bridge'
    if (req.from.chainId !== ARC_MAINNET || req.to.chainId !== ARC_MAINNET) return 'AchSwap runs on Arc mainnet only'
    return null
  },

  async getQuote(req): Promise<ProviderQuote> {
    const [r, fee] = [await providerJson<AchQuote>('AchSwap', `${BASE}/quote`, { method: 'POST', headers: headers(), body: await body(req) }), await tradeFee()]
    if (!r.amountOut) throw new HttpError(422, 'AchSwap has no route for this swap right now')
    const out = BigInt(r.amountOut)
    // Both fees come out of the swap's own output, so the amount shown is already net of them. Their sizes are worked back from it.
    const lines: FeeLine[] = []
    const protocolBps = r.protocolBps ?? 25
    const gross = (out * 10_000n) / BigInt(Math.max(10_000 - protocolBps - fee.bps, 1))
    const amt = (bps: number) => fromUnits((gross * BigInt(bps)) / 10_000n, req.tokenOut.decimals)
    lines.push({ type: 'provider', label: `AchSwap fee (${protocolBps / 100}%)`, token: req.tokenOut.label, amount: amt(protocolBps) })
    if (fee.bps > 0) lines.push({ type: 'service', label: `Service fee (${fee.bps / 100}%)`, token: req.tokenOut.label, amount: amt(fee.bps) })
    return {
      provider: 'achswap', providerName: 'AchSwap', amountOutRaw: out, amountOut: fromUnits(out, req.tokenOut.decimals),
      minOut: r.minAmountOut ? fromUnits(BigInt(r.minAmountOut), req.tokenOut.decimals) : null, fees: lines, etaSeconds: 5,
      route: [req.tokenIn.label, r.routeSummary ?? 'AchSwap route', req.tokenOut.label],
    }
  },

  async checkApproval(req, _q, who): Promise<Approval | null> {
    if (isNative(req.tokenIn.address)) return null
    const s = await providerJson<AchSwap>('AchSwap', `${BASE}/swap`, { method: 'POST', headers: headers(), body: await body(req, { sender: who.evm }) })
    if (!s.approval?.token || !s.approval.spender) return null
    if (s.approval.spender.toLowerCase() !== EXECUTOR) throw new HttpError(403, 'AchSwap asked to approve a contract that is not its route executor, so nothing was sent')
    return { token: s.approval.token, spender: s.approval.spender, amountRaw: BigInt(s.approval.amount ?? req.amountRaw), symbol: req.tokenIn.label }
  },

  async execute(req, quote, who, _mode, progress): Promise<ExecResult> {
    // Built right before signing, as AchSwap recommends, and simulated by AchSwap from the sender.
    const s = await providerJson<AchSwap>('AchSwap', `${BASE}/swap`, { method: 'POST', headers: headers(), body: await body(req, { sender: who.evm, recipient: who.evm }) })
    const tx = s.tx
    if (!tx?.to || !tx.data) throw new HttpError(422, 'AchSwap did not return a transaction')
    if (tx.to.toLowerCase() !== EXECUTOR) throw new HttpError(403, 'AchSwap returned a contract that is not its route executor, so nothing was sent')
    if (s.simulated === false) throw new HttpError(409, 'AchSwap could not simulate this swap, so nothing was sent')
    if (s.approval?.spender && s.approval.spender.toLowerCase() !== EXECUTOR) throw new HttpError(403, 'AchSwap asked to approve a contract that is not its route executor, so nothing was sent')
    const hashes: string[] = []
    return await withEvm(who.userId, req.from, async (ctx) => {
      await progress.step('approve', 'pending')
      if (s.approval?.token && s.approval.spender) {
        const a = await approveIfNeeded(ctx, s.approval.token, s.approval.spender, BigInt(s.approval.amount ?? req.amountRaw))
        if (a) hashes.push(a)
      }
      await progress.step('approve', 'success', { txHash: hashes[0] })
      await progress.step('swap', 'pending')
      const hash = await ctx.wallet.sendTransaction({ account: ctx.wallet.account!, chain: ctx.wallet.chain, to: tx.to as `0x${string}`, data: tx.data as `0x${string}`, value: BigInt(tx.value ?? '0'), ...(tx.gas ? { gas: BigInt(tx.gas) } : {}) })
      hashes.push(hash)
      const receipt = await ctx.pub.waitForTransactionReceipt({ hash, timeout: 120_000 })
      const link = explorerLink(req.from, hash)
      const ok = receipt.status === 'success'
      await progress.step('swap', ok ? 'success' : 'error', { txHash: hash, explorerUrl: link, error: ok ? undefined : 'The swap failed onchain' })
      return { ok, amountOut: quote.amountOut, txHashes: hashes, explorerUrl: link, error: ok ? undefined : 'The swap failed onchain' }
    })
  },
}
