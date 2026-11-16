/**
 * Vault boundary. The agent never touches keys. This build has only a SANDBOX vault signer:
 * releases update ledgers and record clearly-simulated outbound transfers. A real custody signer
 * (for example Circle developer-controlled wallets) plugs in here behind the same interface.
 */
import { isAddress } from 'viem'
import { all, get, now, run, setting, uid } from './db'
import { regNetwork } from './tokens/networks'
import { post } from './ledger'
import { randomHex } from './security'
import type { OrderRow } from './orders'

export const vaultAddressArc = async () => {
  const v = (await setting('vault_address_arc')).trim()
  return isAddress(v) ? v.toLowerCase() : null
}

type Family = 'evm' | 'solana' | 'bitcoin'

/** Address formats per chain family. */
export const ADDRESS_CHECK: Record<Family, (addr: string) => boolean> = {
  evm: (a) => isAddress(a),
  solana: (a) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a),
  bitcoin: (a) => /^(bc1|tb1)[a-z0-9]{25,62}$|^[13mn2][a-km-zA-HJ-NP-Z1-9]{25,40}$/.test(a),
}

/** The chain families a token can be sent on, read from the exchange assets and the active token registry (never a hardcoded symbol list). */
async function familiesFor(symbol: string): Promise<Set<Family>> {
  const out = new Set<Family>()
  const nets = [
    ...await all<{ n: string }>('SELECT chain AS n FROM assets WHERE symbol=?', symbol),
    ...await all<{ n: string }>('SELECT network_id AS n FROM token_networks WHERE symbol=? AND is_active=1', symbol),
  ]
  for (const r of nets) {
    const net = regNetwork(r.n)
    if (net) out.add(net.family)
  }
  return out
}

export async function validDestination(symbol: string, addr: string): Promise<boolean> {
  if (typeof addr !== 'string' || !addr) return false
  for (const f of await familiesFor(symbol)) if (ADDRESS_CHECK[f](addr)) return true
  return false
}

export const vaultSigner = { name: 'sandbox-vault-signer', simulated: true } as const

/** Releases crypto for a buy order. Idempotent per order. Returns the simulated tx hash for external sends. */
export async function releaseCrypto(order: OrderRow): Promise<string | null> {
  const amount = BigInt(order.crypto_amount)
  await post({ owner: 'house', asset: order.asset, delta: -amount, reason: 'vault release', idem: `release:${order.id}:house`, orderId: order.id })
  if (!order.dest_address) {
    await post({ owner: order.user_id, asset: order.asset, delta: amount, reason: 'purchase credited to platform wallet', idem: `release:${order.id}:user`, orderId: order.id })
    return null
  }
  const existing = await get<{ tx_hash: string }>("SELECT tx_hash FROM chain_txs WHERE order_id=? AND status='finalized' AND simulated=1 AND from_addr='vault'", order.id)
  if (existing) return existing.tx_hash
  const hash = `sim:0x${randomHex(32)}`
  await run(
    `INSERT INTO chain_txs(id, chain, tx_hash, log_index, token_address, asset, from_addr, to_addr, amount, confirmations, status, verdict, order_id, simulated, first_seen_at, updated_at, settled_at)
     VALUES (?,?,?,0,NULL,?,?,?,?,1,'finalized','genuine',?,1,?,?,?)`,
    uid('ctx'), 'sandbox', hash, order.asset, 'vault', order.dest_address, amount.toString(), order.id, now(), now(), now(),
  )
  return hash
}
