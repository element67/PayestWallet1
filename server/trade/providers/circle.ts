/**
 * Circle App Kit: bridge (CCTP v2, native USDC and EURC, burn and mint with no wrapped tokens) and same-chain swap.
 * The kit runs approval, burn, Circle's attestation and mint in one call and reports each step; this adapter turns those reports into
 * progress the screen can show. Signing happens with the user's app wallet key, which exists in memory only inside the callbacks below.
 * Circle takes no key for these calls; KIT_KEY is passed through only when it is set.
 */
import { AppKit } from '@circle-fin/app-kit'
import { createViemAdapterFromPrivateKey } from '@circle-fin/adapter-viem-v2'
import { createSolanaKitAdapterFromPrivateKey } from '@circle-fin/adapter-solana-kit'
import { bytesToHex } from 'viem'
import { HttpError } from '../../auth'
import { fromUnits } from '../../money'
import { scrub } from '../../rpc'
import { withWalletKeys } from '../../wallet/keys'
import { unitsOf } from '../../wallet/history'
import { providerKey } from '../config'
import type { ExecResult, FeeLine, Mode, Provider, ProviderQuote, Speed } from '../types'

/** Typical times Circle publishes for the two transfer speeds. These are typical, not promised. */
const ETA: Record<Speed, number> = { fast: 60, slow: 900 }
const SWAP_TOKENS = { testnet: ['USDC', 'EURC', 'CIRBTC'], mainnet: ['USDC', 'EURC', 'USDT', 'USDE', 'DAI', 'PYUSD'] } as const

const newKit = () => { const k = providerKey('circle'); return k ? new AppKit({ kitKey: k } as never) : new AppKit() }

interface Adapters { evm: unknown; solana: unknown | null; evmAddress: string }

/** Runs `fn` with adapters for the user's wallet. The keys live only inside this call. */
async function withAdapters<T>(userId: string, needSolana: boolean, fn: (a: Adapters) => Promise<T>): Promise<T> {
  return await withWalletKeys(userId, async ({ evm, solanaSecret }) => {
    const evmAdapter = createViemAdapterFromPrivateKey({ privateKey: bytesToHex(evm.getHdKey().privateKey as Uint8Array) })
    const solAdapter = needSolana ? createSolanaKitAdapterFromPrivateKey({ privateKey: solanaSecret }) : null
    return await fn({ evm: evmAdapter, solana: solAdapter, evmAddress: evm.address })
  })
}

interface Fee { type?: string; name?: string; token: string; amount: string }
interface BridgeEstimate { fees?: Fee[]; gasFees?: { name: string; token: string; fees?: { fee?: string } }[] }

/** A fee such as 0.0235855725 has more decimals than the token, so it is rounded UP to the smallest unit: a fee is never under-counted. */
export function ceilToUnits(input: string, decimals: number): bigint {
  const s = input.trim()
  if (!/^\d+(\.\d+)?$/.test(s)) throw new HttpError(502, 'The provider returned an unreadable fee')
  const [whole, frac = ''] = s.split('.')
  const base = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.slice(0, decimals).padEnd(decimals, '0') || '0')
  return /[1-9]/.test(frac.slice(decimals)) ? base + 1n : base
}

function bridgeFees(est: BridgeEstimate, token: string): { fees: FeeLine[]; takenFromAmountRaw: bigint } {
  const fees: FeeLine[] = []
  let taken = 0n
  for (const f of est.fees ?? []) {
    fees.push({ type: 'bridge', label: f.type === 'forwarder' ? 'Circle forwarding fee' : 'Bridge fee', token: f.token, amount: f.amount })
    if (f.token === token) taken += ceilToUnits(f.amount, 6)
  }
  const gas = (est.gasFees ?? []).reduce((s, g) => s + Number(g.fees?.fee ?? 0), 0)
  const gasToken = (est.gasFees ?? [])[0]?.token
  if (gas > 0 && gasToken) fees.push({ type: 'network', label: 'Network fee (approve and burn)', token: gasToken, amount: String(Number(gas.toFixed(8))) })
  return { fees, takenFromAmountRaw: taken }
}

export const circle: Provider = {
  id: 'circle',
  name: 'Circle App Kit',

  unsupported(req, mode: Mode) {
    const sym = req.tokenIn.symbol
    if (req.kind === 'bridge') {
      if (req.tokenOut.symbol !== sym) return 'A bridge moves the same token to another network'
      if (sym !== 'USDC' && sym !== 'EURC') return 'Circle bridges USDC and EURC'
      if (sym === 'EURC' && (!req.from.eurc || !req.to.eurc || req.from.family === 'solana' || req.to.family === 'solana')) return 'EURC is not available on one of these networks'
      return null
    }
    if (req.from.id !== req.to.id) return 'Circle swaps run on one network at a time'
    if (mode === 'testnet' && req.from.id !== 'arc-testnet') return 'On the test network, Circle swaps run on Arc Testnet only'
    const allowed: readonly string[] = SWAP_TOKENS[mode]
    if (!allowed.includes(sym) || !allowed.includes(req.tokenOut.symbol)) return `Circle swaps ${mode === 'testnet' ? 'USDC, EURC and cirBTC' : 'stablecoins'} on this network`
    return null
  },

  async getQuote(req, who, _mode): Promise<ProviderQuote> {
    if (req.kind === 'bridge') {
      const solana = req.from.family === 'solana' || req.to.family === 'solana'
      const recipient = req.to.family === 'solana' ? who.solana : who.evm
      const run = (a: Adapters, speed: Speed) => newKit().estimateBridge({
        from: { adapter: (req.from.family === 'solana' ? a.solana : a.evm) as never, chain: req.from.kit as never },
        to: { recipientAddress: recipient, chain: req.to.kit as never, useForwarder: true } as never,
        amount: req.amount, token: req.tokenIn.symbol as never, config: { transferSpeed: speed.toUpperCase() },
      } as never) as Promise<BridgeEstimate>
      const [fast, slow] = await withAdapters(who.userId, solana, async (a) => Promise.all([run(a, 'fast'), run(a, 'slow')]))
      const sym = req.tokenIn.symbol
      const calc = (e: BridgeEstimate, speed: Speed) => {
        const f = bridgeFees(e, sym)
        const outRaw = req.amountRaw > f.takenFromAmountRaw ? req.amountRaw - f.takenFromAmountRaw : 0n
        return { f, outRaw, speed }
      }
      const picked = req.speed === 'fast' ? calc(fast, 'fast') : calc(slow, 'slow')
      const other = req.speed === 'fast' ? calc(slow, 'slow') : calc(fast, 'fast')
      return {
        provider: 'circle', providerName: 'Circle App Kit (CCTP, native burn and mint)', amountOutRaw: picked.outRaw, amountOut: fromUnits(picked.outRaw, 6), minOut: fromUnits(picked.outRaw, 6),
        fees: picked.f.fees, etaSeconds: ETA[picked.speed], route: [req.from.name, 'Circle CCTP', req.to.name],
        otherSpeed: { speed: other.speed, amountOut: fromUnits(other.outRaw, 6), fees: other.f.fees, etaSeconds: ETA[other.speed] },
      }
    }
    const est = await withAdapters(who.userId, false, async (a) => await newKit().estimateSwap({
      from: { adapter: a.evm as never, chain: req.from.kit as never }, tokenIn: req.tokenIn.symbol as never, tokenOut: req.tokenOut.symbol as never,
      amountIn: req.amount, config: { slippageBps: req.slippageBps },
    } as never)) as unknown as { estimatedOutput?: { amount: string }; stopLimit?: { amount: string }; fees?: Fee[]; route?: { provider?: string } }
    const out = est.estimatedOutput?.amount
    if (!out || !(Number(out) > 0)) throw new HttpError(422, 'Circle has no swap route for these tokens right now. Try a different pair or amount.')
    const lines: FeeLine[] = (est.fees ?? []).map((f) => ({ type: f.type === 'gas' ? 'network' : f.type === 'custom' ? 'service' : 'provider', label: f.type === 'gas' ? 'Network fee' : f.type === 'custom' ? 'Service fee' : 'Provider fee', token: f.token === 'CIRBTC' ? 'cirBTC' : f.token, amount: f.amount }))
    return {
      provider: 'circle', providerName: 'Circle App Kit swap', amountOut: out, amountOutRaw: unitsOf(out, req.tokenOut.decimals), minOut: est.stopLimit?.amount ?? null,
      fees: lines, etaSeconds: 10, route: [req.tokenIn.label, est.route?.provider ? `via ${est.route.provider}` : 'Circle route', req.tokenOut.label],
    }
  },

  /** The kit approves what it needs as the first step of the call, so there is nothing for the user to approve separately. */
  async checkApproval() { return null },

  async execute(req, quote, who, _mode, progress, resume): Promise<ExecResult> {
    if (req.kind === 'swap') {
      const r = await withAdapters(who.userId, false, async (a) => await newKit().swap({
        from: { adapter: a.evm as never, chain: req.from.kit as never }, tokenIn: req.tokenIn.symbol as never, tokenOut: req.tokenOut.symbol as never,
        amountIn: req.amount, config: { slippageBps: req.slippageBps },
      } as never)) as unknown as { amountOut?: string; txHash?: string; explorerUrl?: string; progress?: { status?: string } }
      const ok = r.progress?.status === 'DONE' || (Boolean(r.txHash) && r.progress?.status !== 'FAILED')
      await progress.step('swap', ok ? 'success' : 'error', { txHash: r.txHash, explorerUrl: r.explorerUrl, error: ok ? undefined : 'The swap did not finish. Check your balance before trying again.' })
      return { ok, amountOut: r.amountOut, txHashes: r.txHash ? [r.txHash] : [], explorerUrl: r.explorerUrl, error: ok ? undefined : 'The swap did not finish. Check your balance before trying again.' }
    }
    const solana = req.from.family === 'solana' || req.to.family === 'solana'
    return await withAdapters(who.userId, solana, async (a) => {
      const kit = newKit()
      // Every step event is passed on as it happens: approve, burn, fetchAttestation, mint.
      kit.on('*', (payload: unknown) => {
        const p = payload as { method?: string; values?: Record<string, unknown> }
        if (!p.method?.startsWith('bridge.')) return
        const v = p.values ?? {}
        const txHash = typeof v.txHash === 'string' ? v.txHash : typeof v.transactionHash === 'string' ? v.transactionHash : undefined
        void progress.step(p.method.slice('bridge.'.length), v.state === 'error' ? 'error' : v.state === 'pending' ? 'pending' : 'success', { txHash, explorerUrl: typeof v.explorerUrl === 'string' ? v.explorerUrl : undefined })
      })
      const adapterFor = (family: 'evm' | 'solana') => (family === 'solana' ? a.solana : a.evm) as never
      const recipient = req.to.family === 'solana' ? who.solana : who.evm
      const result = resume
        ? await kit.retryBridge(resume as Parameters<typeof kit.retryBridge>[0], { from: adapterFor(req.from.family), to: adapterFor(req.to.family) })
        : await kit.bridge({
            from: { adapter: adapterFor(req.from.family), chain: req.from.kit as never },
            to: { recipientAddress: recipient, chain: req.to.kit as never, useForwarder: true } as never,
            amount: req.amount, token: req.tokenIn.symbol as never, config: { transferSpeed: req.speed.toUpperCase() },
          } as never)
      const steps = (Array.isArray(result.steps) ? result.steps : []) as { name?: string; state?: string; txHash?: string; explorerUrl?: string; error?: unknown }[]
      const ok = result.state === 'success'
      const failed = steps.find((s) => s.state === 'error')
      return {
        ok, amountOut: quote.amountOut, txHashes: steps.map((s) => s.txHash).filter((h): h is string => Boolean(h)),
        explorerUrl: [...steps].reverse().find((s) => s.explorerUrl)?.explorerUrl,
        error: ok ? undefined : (failed?.error ? scrub(failed.error) : 'The transfer did not finish'),
        resume: ok ? undefined : JSON.parse(JSON.stringify(result, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))),
      }
    })
  },
}
