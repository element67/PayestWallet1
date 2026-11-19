/** Shapes the trade API returns. Every number the swap and bridge screens show comes from these endpoints. */
export interface TradeToken { symbol: string; label: string; name: string }
export interface TradeChainInfo { id: string; name: string; family: 'evm' | 'solana'; gasSymbol: string; swap: boolean; swapTokens: TradeToken[]; bridgeTokens: TradeToken[] }
export interface TradeConfig {
  mode: 'testnet' | 'mainnet'; testnet: boolean; slippage: { defaultBps: number; maxBps: number }
  providers: Record<'circle' | 'lifi' | 'achswap', { configured: boolean; keyed: boolean }>; chains: TradeChainInfo[]
}
export interface FeeLine { type: string; label: string; token: string; amount: string }
export interface ProviderQuote {
  provider: 'circle' | 'lifi' | 'achswap'; providerName: string; amountOut: string; minOut: string | null; fees: FeeLine[]; etaSeconds: number | null
  otherSpeed: { speed: 'fast' | 'slow'; amountOut: string; fees: FeeLine[]; etaSeconds: number | null } | null; priceImpactBps: number | null; route: string[]; confirmToken: string
}
export interface TradeQuote {
  mode: 'testnet' | 'mainnet'; expiresAt: number; kind: 'swap' | 'bridge'; from: string; to: string; fromName: string; toName: string
  tokenIn: string; tokenOut: string; labelIn: string; labelOut: string; amount: string; slippageBps: number; speed: 'fast' | 'slow'
  balance: string | null; recipient: string; recommended: ProviderQuote; alternatives: ProviderQuote[]; skipped: { provider: string; name: string; reason: string }[]
  serviceFeeBps: number; warnings: string[]
}
export interface Step { name: string; state: 'pending' | 'success' | 'error'; txHash?: string; explorerUrl?: string; error?: string }
export interface TradeOp {
  id: string; kind: 'swap' | 'bridge'; provider: string; providerName: string; mode: 'testnet' | 'mainnet'; from: string; to: string; fromName: string; toName: string
  tokenIn: string; tokenOut: string; amountIn: string; amountOut: string | null; status: 'running' | 'completed' | 'failed'; steps: Step[]; txHashes: string[]
  explorerUrl: string | null; error: string | null; canResume: boolean; createdAt: number; updatedAt: number
}
