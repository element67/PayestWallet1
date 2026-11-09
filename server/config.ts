/**
 * Server configuration. Secrets come from the environment only (.env, loaded by Bun).
 * The server fails closed: it refuses to start without its encryption and webhook secrets.
 */
import { arcTestnet } from 'viem/chains'
import { getUsdc } from '../src/onchain-facts'

function required(name: string): string {
  const v = process.env[name]
  if (!v || v.length < 32) throw new Error(`Missing or too-short secret ${name}. Set it in .env.`)
  return v
}

const proxyChains = (process.env.RPC_PROXY_CHAINS ?? '').split(',')
const proxiedRpc =
  process.env.RPC_PROXY_BASE_URL && process.env.RPC_PROXY_TOKEN && proxyChains.includes('Arc_Testnet')
    ? `${process.env.RPC_PROXY_BASE_URL}/api/rpc/Arc_Testnet?_rpc_token=${process.env.RPC_PROXY_TOKEN}`
    : undefined

const usdc = getUsdc(arcTestnet.id)
if (!usdc) throw new Error('USDC fact for Arc Testnet is missing')

export const CONFIG = {
  port: Number(process.env.PORT ?? 3001),
  /** Development preview: sign in without credentials. Sandbox money only. */
  devPreview: process.env.DEV_PREVIEW === 'true',
  /**
   * Real-money rails are NOT implemented in this build. Even if REAL_MONEY_ENABLED=true is set,
   * this stays false until a licensed payment provider and a custody signer are integrated.
   */
  /**
   * Central payment mode. SANDBOX is the only mode this build supports: testnets, simulated bank and bill providers.
   * Any other PAYMENT_MODE value stops the server at startup instead of silently running.
   */
  paymentMode: (() => {
    const mode = (process.env.PAYMENT_MODE ?? 'SANDBOX').toUpperCase()
    if (mode !== 'SANDBOX') throw new Error(`PAYMENT_MODE=${mode} is not supported. This build only runs in SANDBOX mode.`)
    return 'SANDBOX' as const
  })(),
  realMoney: false as boolean,
  realMoneyRequested: process.env.REAL_MONEY_ENABLED === 'true',
  encryptionKey: Buffer.from(required('APP_ENCRYPTION_KEY').slice(0, 64), 'hex'),
  webhookSecret: required('WEBHOOK_SECRET'),
  /** Wraps every wallet seed phrase. Separate from APP_ENCRYPTION_KEY so the two can be rotated and scoped independently. */
  walletMasterKey: Buffer.from(required('WALLET_MASTER_KEY').slice(0, 64), 'hex'),
  sessionTtlMs: 12 * 60 * 60 * 1000,
  webhookToleranceMs: 5 * 60 * 1000,
  arc: {
    chainId: arcTestnet.id,
    rpcUrl: proxiedRpc ?? arcTestnet.rpcUrls.default.http[0],
    usingProxy: Boolean(proxiedRpc),
    usdcAddress: usdc.address.toLowerCase(),
    usdcDecimals: usdc.decimals,
  },
}

export const DEFAULT_SETTINGS: Record<string, string> = {
  fee_bps: '100', // 1.00%
  quote_ttl_sec: '60',
  instant_payout_limit_kobo: '50000000', // 500,000.00 NGN
  risk_block_score: '70',
  risk_review_score: '40',
  daily_limit_tier1_kobo: '50000000',
  daily_limit_tier2_kobo: '500000000',
  wallet_limits: JSON.stringify({ perTx: { USDC: '500', ETH: '0.5', SOL: '5', BTC: '0.01' }, daily: { USDC: '2000', ETH: '2', SOL: '20', BTC: '0.05' } }),
  bank_transfer_fee_kobo: '2500', // NGN 25.00 per bank transfer
  bill_fee_kobo: '1000', // NGN 10.00 service fee per bill payment
  daily_spend_limit_kobo: '500000000', // NGN 5,000,000 per user, rolling 24h, all Naira debits
  review_threshold_kobo: '300000000', // bank transfers at or above this wait for founder review
  large_flag_kobo: '100000000', // NGN 1,000,000: flagged for the fraud queue
  pin_lock_minutes: '30',
  velocity_block_count: '15', // payments in 10 minutes before new ones are refused
  velocity_flag_count: '8', // payments in 10 minutes before the account is flagged
  gas_fee_estimates: JSON.stringify({ USDC: '0.01', USDT: '1.00', BTC: '0.00005', SOL: '0.000005' }),
  // Founder-set gas fee in NGN per chain, added automatically to every exchange, buy, sell and swap on that chain. Placeholders: set your own.
  gas_fee_ngn: JSON.stringify({ 'arc-testnet': '5', 'ethereum-sepolia': '50', 'bitcoin-testnet': '100', 'solana-devnet': '10' }),
  daily_withdraw_limit_kobo: '200000000', // 2,000,000.00 NGN equivalent per user per day
  confirmations_required: '2',
  order_expiry_min: '30',
  vault_address_arc: '',
  instant_payouts_enabled: 'true',
  platform_paused: 'false',
}
