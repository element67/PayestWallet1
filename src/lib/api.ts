/** Typed client for the NairaBridge backend. The session token lives in sessionStorage and is sent as a Bearer header. */

const KEY = 'nb_session'
export const getToken = () => sessionStorage.getItem(KEY)
export const setToken = (t: string | null) => (t ? sessionStorage.setItem(KEY, t) : sessionStorage.removeItem(KEY))

export class ApiError extends Error {
  constructor(public status: number, message: string, public data: Record<string, unknown> = {}) {
    super(message)
  }
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = getToken()
  const res = await fetch(path, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'Request failed', data)
  return data
}

export interface PublicUser { id: string; email: string; name: string; role: 'user' | 'founder'; kycTier: number; devPreview: boolean; username?: string | null; phone?: string | null }
export interface AppConfig {
  devPreview: boolean; realMoney: boolean; realMoneyRequested: boolean; sandbox: boolean; chainId: number
  usdcAddress: string; vaultConfigured: boolean; feeBps: number; paused: boolean
}
export interface Asset {
  symbol: string; name: string; chain: string; decimals: number; enabled: boolean; monitoring: 'live' | 'simulated'
  contract: string | null; buyRate: string; sellRate: string; minNgn: string; maxNgn: string; rateVersion: number; rateSource: string; updatedAt: number
}
export interface Balances { ngn: string; simulated: boolean; assets: { symbol: string; amount: string; rate: string }[] }
export interface Quote {
  id: string; expiresAt: number; side: 'sell' | 'buy'; asset: string; cryptoAmount: string; grossNgn: string; feeNgn: string
  netNgn: string; rate: string; feeBps: number; rateVersion: number; rateSource: string; networkFeeNgn: string; platformFeeNgn: string
}
export interface OrderEvent { at: number; kind: string; detail: string }
export interface Order {
  id: string; side: 'sell' | 'buy'; asset: string; status: string; mode: 'live' | 'sandbox'; cryptoAmount: string; grossNgn: string
  feeNgn: string; netNgn: string; rate: string; payoutType: string | null; funding: string | null; destAddress: string | null
  fromAddress: string | null; depositAddress: string | null; instant: boolean; riskScore: number; riskFlags: string[]
  txHash: string | null; txUrl: string | null
  chainTx: { status: string; verdict: string; confirmations: number; simulated: boolean; detectLatencyMs: number | null } | null
  payment: { reference: string; status: string; direction: string; simulated: boolean } | null
  failureReason: string | null; createdAt: number; updatedAt: number; expiresAt: number | null; detectedAt: number | null
  payoutAt: number | null; completedAt: number | null; events?: OrderEvent[]; userEmail?: string
}
export interface BankAccount { id: string; bankName: string; accountName: string; masked: string }
export interface Notification { id: number; at: number; kind: string; title: string; body: string; read: number }
