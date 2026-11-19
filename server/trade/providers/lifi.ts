/**
 * LI.FI: bridges and swaps for assets and routes Circle's own protocol does not cover. Mainnet only (LI.FI no longer supports test
 * networks). The key is optional and only raises LI.FI's rate limit. LI.FI returns a ready transaction; before it is signed the target
 * contract must be on the server's allow-list (LIFI_ALLOWED_TARGETS), otherwise the trade is refused.
 */
import { HttpError } from '../../auth'
import { fromUnits } from '../../money'
import { providerKey, lifiAllowedTargets, lifiIntegrator, tradeFee } from '../config'
import { allowanceOf, explorerLink, isNative, withEvm, approveIfNeeded } from '../evm'
import { providerJson } from '../http'
import type { Approval, ExecResult, FeeLine, Provider, ProviderQuote, TradeRequest, Who } from '../types'

const BASE = 'https://li.quest/v1'

interface Cost { name?: string; amount?: string; token?: { symbol?: string; decimals?: number } }
interface LifiQuote {
  tool?: string; toolDetails?: { name?: string }
  estimate?: { toAmount?: string; toAmountMin?: string; approvalAddress?: string; executionDuration?: number; feeCosts?: Cost[]; gasCosts?: Cost[] }
  transactionRequest?: { to?: string; data?: string; value?: string; gasLimit?: string; chainId?: number }
}

const headers = () => ({ accept: 'application/json', ...(providerKey('lifi') ? { 'x-lifi-api-key': providerKey('lifi') as string } : {}) })

async function fetchQuote(req: TradeRequest, who: Who): Promise<LifiQuote> {
  const fee = await tradeFee()
  const q = new URLSearchParams({
    fromChain: String(req.from.chainId), toChain: String(req.to.chainId), fromToken: req.tokenIn.address as string, toToken: req.tokenOut.address as string,
    fromAmount: req.amountRaw.toString(), fromAddress: who.evm, toAddress: who.evm, slippage: String(req.slippageBps / 10_000),
    integrator: lifiIntegrator(), order: 'CHEAPEST', ...(fee.bps > 0 ? { fee: String(fee.bps / 10_000) } : {}),
  })
  return await providerJson<LifiQuote>('LI.FI', `${BASE}/quote?${q}`, { headers: headers() })
}

const toLines = (e: NonNullable<LifiQuote['estimate']>, serviceBps: number, req: TradeRequest): FeeLine[] => {
  const out: FeeLine[] = []
  for (const f of e.feeCosts ?? []) if (f.amount && f.token?.symbol) out.push({ type: 'provider', label: f.name ?? 'Provider fee', token: f.token.symbol, amount: fromUnits(BigInt(f.amount), f.token.decimals ?? 18) })
  for (const g of e.gasCosts ?? []) if (g.amount && g.token?.symbol) out.push({ type: 'network', label: 'Network fee', token: g.token.symbol, amount: fromUnits(BigInt(g.amount), g.token.decimals ?? 18) })
  if (serviceBps > 0) out.push({ type: 'service', label: `Service fee (${serviceBps / 100}%)`, token: req.tokenIn.label, amount: fromUnits((req.amountRaw * BigInt(serviceBps)) / 10_000n, req.tokenIn.decimals) })
  return out
}

export const lifi: Provider = {
  id: 'lifi',
  name: 'LI.FI',

  unsupported(req, mode) {
    if (mode !== 'mainnet') return 'LI.FI works on mainnet networks only'
    if (req.from.family !== 'evm' || req.to.family !== 'evm' || !req.from.chainId || !req.to.chainId) return 'LI.FI routes here cover EVM networks only'
    if (!req.tokenIn.address || !req.tokenOut.address) return 'This token has no known contract address on the network'
    if (req.kind === 'swap' && req.from.id !== req.to.id) return 'Swaps run on one network at a time'
    return null
  },

  async getQuote(req, who): Promise<ProviderQuote> {
    const [r, fee] = [await fetchQuote(req, who), await tradeFee()]
    const e = r.estimate
    if (!e?.toAmount || !r.transactionRequest) throw new HttpError(422, 'LI.FI has no route for this trade right now')
    const outRaw = BigInt(e.toAmount)
    return {
      provider: 'lifi', providerName: `LI.FI${r.toolDetails?.name ? ` via ${r.toolDetails.name}` : ''}`, amountOutRaw: outRaw, amountOut: fromUnits(outRaw, req.tokenOut.decimals),
      minOut: e.toAmountMin ? fromUnits(BigInt(e.toAmountMin), req.tokenOut.decimals) : null, fees: toLines(e, fee.bps, req),
      etaSeconds: e.executionDuration ?? null, route: [req.from.name, r.toolDetails?.name ?? r.tool ?? 'LI.FI route', req.to.name],
    }
  },

  async checkApproval(req, _quote, who): Promise<Approval | null> {
    if (isNative(req.tokenIn.address)) return null
    const r = await fetchQuote(req, who)
    const spender = r.estimate?.approvalAddress
    if (!spender) return null
    const { readOnly } = await import('../evm')
    const have = await allowanceOf(await readOnly(req.from), req.tokenIn.address as string, who.evm, spender)
    return have >= req.amountRaw ? null : { token: req.tokenIn.address as string, spender, amountRaw: req.amountRaw, symbol: req.tokenIn.label }
  },

  async execute(req, quote, who, _mode, progress): Promise<ExecResult> {
    const allowed = lifiAllowedTargets()
    if (allowed.length === 0) throw new HttpError(503, 'LI.FI trades are switched off until the allowed LI.FI contracts are set in LIFI_ALLOWED_TARGETS')
    // A fresh route right before signing, so the transaction is as current as possible.
    const r = await fetchQuote(req, who)
    const tx = r.transactionRequest
    if (!tx?.to || !tx.data) throw new HttpError(422, 'LI.FI did not return a transaction')
    if (!allowed.includes(tx.to.toLowerCase())) throw new HttpError(403, 'LI.FI returned a contract that is not on the allow-list, so nothing was sent')
    if (tx.chainId !== req.from.chainId) throw new HttpError(403, 'LI.FI returned a transaction for a different network, so nothing was sent')
    const spender = r.estimate?.approvalAddress
    if (spender && !allowed.includes(spender.toLowerCase())) throw new HttpError(403, 'LI.FI asked to approve a contract that is not on the allow-list, so nothing was sent')
    const hashes: string[] = []
    return await withEvm(who.userId, req.from, async (ctx) => {
      await progress.step('approve', 'pending')
      if (spender && !isNative(req.tokenIn.address)) {
        const a = await approveIfNeeded(ctx, req.tokenIn.address as string, spender, req.amountRaw)
        if (a) hashes.push(a)
      }
      await progress.step('approve', 'success', { txHash: hashes[0] })
      await progress.step('send', 'pending')
      const hash = await ctx.wallet.sendTransaction({ account: ctx.wallet.account!, chain: ctx.wallet.chain, to: tx.to as `0x${string}`, data: tx.data as `0x${string}`, value: BigInt(tx.value ?? '0'), ...(tx.gasLimit ? { gas: BigInt(tx.gasLimit) } : {}) })
      hashes.push(hash)
      const receipt = await ctx.pub.waitForTransactionReceipt({ hash, timeout: 180_000 })
      const link = explorerLink(req.from, hash)
      if (receipt.status !== 'success') { await progress.step('send', 'error', { txHash: hash, explorerUrl: link, error: 'The transaction failed onchain' }); return { ok: false, txHashes: hashes, explorerUrl: link, error: 'The transaction failed onchain' } }
      await progress.step('send', 'success', { txHash: hash, explorerUrl: link })
      if (req.kind === 'bridge') {
        await progress.step('bridging', 'pending')
        const deadline = Date.now() + 25 * 60_000
        let status = 'PENDING'
        while (Date.now() < deadline) {
          const s = await providerJson<{ status?: string; substatus?: string }>('LI.FI', `${BASE}/status?${new URLSearchParams({ txHash: hash, fromChain: String(req.from.chainId), toChain: String(req.to.chainId) })}`, { headers: headers() }).catch(() => ({ status: 'PENDING' }))
          status = s.status ?? 'PENDING'
          if (status === 'DONE' || status === 'FAILED' || status === 'INVALID') break
          await new Promise((res) => setTimeout(res, 8_000))
        }
        if (status !== 'DONE') {
          const why = status === 'PENDING' ? 'The bridge is still in progress. Check the transaction link; funds are not lost.' : 'The bridge did not complete. Check the transaction link.'
          await progress.step('bridging', 'error', { error: why })
          return { ok: false, txHashes: hashes, explorerUrl: link, error: why }
        }
        await progress.step('bridging', 'success')
        await progress.step('receive', 'success')
      }
      return { ok: true, amountOut: quote.amountOut, txHashes: hashes, explorerUrl: link }
    })
  },
}
