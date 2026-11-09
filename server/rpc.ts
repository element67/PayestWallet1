/**
 * Arc Testnet RPC client. The proxy token in .env is refreshed by the platform while this process runs,
 * so the endpoint is re-resolved from the environment file (at most every 5s) instead of frozen at startup.
 * Error text is scrubbed so a URL carrying a token is never stored or shown.
 */
import { readFileSync } from 'node:fs'
import { createPublicClient, http } from 'viem'
import { arcTestnet } from 'viem/chains'
import { CONFIG } from './config'

let cache: { at: number; url: string; proxy: boolean } | null = null
let client: ReturnType<typeof createArcClient> | null = null
let clientUrl = ''

function createArcClient(url: string) {
  return createPublicClient({ chain: arcTestnet, transport: http(url, { timeout: 8000 }) })
}

function readEnvFile(): Record<string, string> {
  try {
    const out: Record<string, string> = {}
    for (const line of readFileSync('.env', 'utf8').split('\n')) {
      const m = /^(RPC_PROXY_[A-Z_]+)=(.*)$/.exec(line.trim())
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
    return out
  } catch {
    return {}
  }
}

function resolve(): { url: string; proxy: boolean } {
  if (cache && Date.now() - cache.at < 5000) return cache
  const fresh = readEnvFile()
  const pick = (k: string) => fresh[k] ?? process.env[k]
  const base = pick('RPC_PROXY_BASE_URL')
  const token = pick('RPC_PROXY_TOKEN')
  const chains = (pick('RPC_PROXY_CHAINS') ?? '').split(',')
  const proxy = Boolean(base && token && chains.includes('Arc_Testnet'))
  cache = { at: Date.now(), proxy, url: proxy ? `${base}/api/rpc/Arc_Testnet?_rpc_token=${token}` : (arcTestnet.rpcUrls.default.http[0] ?? CONFIG.arc.rpcUrl) }
  return cache
}

export function arcClient() {
  const { url } = resolve()
  if (!client || url !== clientUrl) {
    client = createArcClient(url)
    clientUrl = url
  }
  return client
}

export const rpcViaProxy = () => resolve().proxy

export function scrub(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (msg.includes('Status: 401')) return 'RPC proxy token expired (401). Retrying every second; it recovers once the platform refreshes the token.'
  return msg.replace(/https?:\/\/\S+/g, '[rpc url]').replace(/\s+/g, ' ').slice(0, 160)
}

/** Endpoint for signing clients. Internal use only: when proxied the URL carries a token, so never log it. */
export const arcRpcUrl = () => resolve().url
