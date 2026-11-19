/**
 * The one interface every swap and bridge provider implements. A provider adapter turns a request into a quote, says what
 * approval it needs, and runs the trade; the router in router.ts compares quotes and the service stores the record.
 */
export type ProviderId = 'circle' | 'lifi' | 'achswap'
export type Kind = 'swap' | 'bridge'
export type Speed = 'fast' | 'slow'
export type Mode = 'testnet' | 'mainnet'

export interface TradeChain {
  /** Our id, such as arc-testnet or base. */
  id: string
  /** The name Circle's App Kit uses for this chain. */
  kit: string
  name: string
  family: 'evm' | 'solana'
  chainId?: number
  testnet: boolean
  gasSymbol: string
  usdc: string
  eurc: string | null
  rpc: string
  /** Transaction link with {hash} in place of the hash. */
  explorer: string
}

export interface TradeToken { symbol: string; label: string; name: string; address: string | null; decimals: number }

/** A request that has already passed validation: chains and tokens exist, the amount is well formed and slippage is in range. */
export interface TradeRequest {
  kind: Kind
  from: TradeChain
  to: TradeChain
  tokenIn: TradeToken
  tokenOut: TradeToken
  /** Human amount of the token being sent, such as "1.5". */
  amount: string
  amountRaw: bigint
  slippageBps: number
  speed: Speed
}

export interface Who {
  userId: string
  /** The EVM address that signs, and the Solana address for Solana routes. The output always goes to the user's own address. */
  evm: string
  solana: string
}

export interface FeeLine { type: 'provider' | 'network' | 'service' | 'bridge'; label: string; token: string; amount: string }

export interface ProviderQuote {
  provider: ProviderId
  providerName: string
  /** What the user receives after every fee, as a human amount and in the token's smallest unit. */
  amountOut: string
  amountOutRaw: bigint
  /** The least the user will accept after slippage. */
  minOut: string | null
  fees: FeeLine[]
  etaSeconds: number | null
  /** For bridges: the quote for the other speed, so the screen can show the difference. */
  otherSpeed?: { speed: Speed; amountOut: string; fees: FeeLine[]; etaSeconds: number | null }
  priceImpactBps?: number
  route: string[]
  /** Anything the provider needs again at execution time. Never sent to the browser. */
  internal?: unknown
}

export interface Approval { token: string; spender: string; amountRaw: bigint; symbol: string }

export interface Progress {
  step(name: string, state: 'pending' | 'success' | 'error', extra?: { txHash?: string; explorerUrl?: string; error?: string }): Promise<void>
}

export interface ExecResult {
  ok: boolean
  amountOut?: string
  txHashes: string[]
  explorerUrl?: string
  error?: string
  /** For a bridge that stopped part-way: what is needed to resume it. */
  resume?: unknown
}

export interface Provider {
  id: ProviderId
  name: string
  /** Null when the provider can handle the route, otherwise the plain-words reason it cannot. */
  unsupported(req: TradeRequest, mode: Mode): string | null
  getQuote(req: TradeRequest, who: Who, mode: Mode): Promise<ProviderQuote>
  checkApproval(req: TradeRequest, quote: ProviderQuote, who: Who, mode: Mode): Promise<Approval | null>
  execute(req: TradeRequest, quote: ProviderQuote, who: Who, mode: Mode, progress: Progress, resume: unknown | null): Promise<ExecResult>
}
