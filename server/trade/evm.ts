/** Signing helpers for providers that return a ready-made transaction. The wallet key lives only inside withEvmAccount. */
import { createPublicClient, createWalletClient, defineChain, erc20Abi, http, type PublicClient, type WalletClient } from 'viem'
import { HttpError } from '../auth'
import { withEvmAccount } from '../wallet/keys'
import type { TradeChain } from './types'

export interface EvmCtx { pub: PublicClient; wallet: WalletClient; address: `0x${string}`; chain: TradeChain }

const chainDef = (c: TradeChain) =>
  defineChain({ id: c.chainId as number, name: c.name, nativeCurrency: { name: c.gasSymbol, symbol: c.gasSymbol, decimals: 18 }, rpcUrls: { default: { http: [c.rpc] } } })

export async function readOnly(c: TradeChain): Promise<PublicClient> {
  if (!c.chainId) throw new HttpError(400, `${c.name} is not an EVM network`)
  return createPublicClient({ chain: chainDef(c), transport: http(c.rpc, { timeout: 15_000, retryCount: 1 }) }) as PublicClient
}

export async function withEvm<T>(userId: string, c: TradeChain, fn: (ctx: EvmCtx) => Promise<T>): Promise<T> {
  if (!c.chainId) throw new HttpError(400, `${c.name} is not an EVM network`)
  return await withEvmAccount(userId, async (account) => {
    const chain = chainDef(c)
    const pub = createPublicClient({ chain, transport: http(c.rpc, { timeout: 15_000, retryCount: 1 }) }) as PublicClient
    const wallet = createWalletClient({ account, chain, transport: http(c.rpc, { timeout: 20_000 }) })
    return await fn({ pub, wallet, address: account.address, chain: c })
  })
}

export const NATIVE = new Set(['0x0000000000000000000000000000000000000000', '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'])
export const isNative = (a: string | null) => !a || NATIVE.has(a.toLowerCase())

export async function allowanceOf(pub: PublicClient, token: string, owner: string, spender: string): Promise<bigint> {
  return await pub.readContract({ address: token as `0x${string}`, abi: erc20Abi, functionName: 'allowance', args: [owner as `0x${string}`, spender as `0x${string}`] })
}

/** Approves exactly the amount needed (never unlimited) when the allowance is short, and waits for it to confirm. Returns the hash, or null when none was needed. */
export async function approveIfNeeded(ctx: EvmCtx, token: string, spender: string, amount: bigint): Promise<string | null> {
  if (isNative(token) || (await allowanceOf(ctx.pub, token, ctx.address, spender)) >= amount) return null
  const hash = await ctx.wallet.writeContract({ address: token as `0x${string}`, abi: erc20Abi, functionName: 'approve', args: [spender as `0x${string}`, amount], account: ctx.wallet.account!, chain: ctx.wallet.chain })
  const r = await ctx.pub.waitForTransactionReceipt({ hash, timeout: 120_000 })
  if (r.status !== 'success') throw new HttpError(502, 'The approval transaction failed onchain')
  return hash
}

export const explorerLink = (c: TradeChain, hash: string) => (c.explorer ? (c.explorer.includes('{hash}') ? c.explorer.replace('{hash}', hash) : `${c.explorer.replace(/\/$/, '')}/tx/${hash}`) : '')
