/**
 * Payment provider boundary. Only a SANDBOX provider exists in this build: no real money moves.
 * Provider events always enter through signed webhooks (HMAC + timestamp window + event-id replay protection).
 */
import { CONFIG } from './config'
import { get, now, run, uid } from './db'
import { hmacHex, randomHex, safeEqual } from './security'

export interface PaymentEvent {
  id: string
  type: 'collection.succeeded' | 'payout.succeeded' | 'payout.failed'
  reference: string
  amountKobo: string
  ts: number
}

export interface PaymentProvider {
  name: string
  simulated: boolean
  createCollection(orderId: string, amountKobo: bigint): { reference: string; instructions: string }
  sendPayout(orderId: string, amountKobo: bigint, reference: string): void
}

export function signWebhook(body: string, ts: number): string {
  return `t=${ts},v1=${hmacHex(CONFIG.webhookSecret, `${ts}.${body}`)}`
}

export type WebhookVerdict = { ok: true; event: PaymentEvent } | { ok: false; reason: string }

export function verifyWebhook(rawBody: string, header: string | null): WebhookVerdict {
  if (!header) return { ok: false, reason: 'missing signature' }
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]))
  const ts = Number(parts.t)
  if (!ts || !parts.v1) return { ok: false, reason: 'malformed signature' }
  if (Math.abs(now() - ts) > CONFIG.webhookToleranceMs) return { ok: false, reason: 'timestamp outside tolerance' }
  if (!safeEqual(parts.v1, hmacHex(CONFIG.webhookSecret, `${ts}.${rawBody}`))) return { ok: false, reason: 'bad signature' }
  let event: PaymentEvent
  try {
    event = JSON.parse(rawBody) as PaymentEvent
  } catch {
    return { ok: false, reason: 'invalid json' }
  }
  if (!event.id || !event.reference || !event.type) return { ok: false, reason: 'invalid event' }
  if (get('SELECT 1 FROM webhook_events WHERE event_id=?', event.id)) return { ok: false, reason: 'replayed event' }
  run('INSERT INTO webhook_events(event_id, received_at) VALUES (?,?)', event.id, now())
  return { ok: true, event }
}

/** Sandbox provider posts its own signed webhook back to this server, like a real provider would. */
async function deliver(event: PaymentEvent) {
  const body = JSON.stringify(event)
  await fetch(`http://127.0.0.1:${CONFIG.port}/webhooks/payments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-signature': signWebhook(body, event.ts) },
    body,
  })
}

export const sandboxProvider: PaymentProvider = {
  name: 'sandbox-provider',
  simulated: true,
  createCollection(orderId, amountKobo) {
    const reference = `SBX-IN-${randomHex(5).toUpperCase()}`
    run(
      `INSERT INTO payments(id, order_id, direction, provider, reference, amount_kobo, status, simulated, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,1,?,?)`,
      uid('pay'), orderId, 'in', 'sandbox-provider', reference, amountKobo.toString(), 'awaiting', now(), now(),
    )
    return { reference, instructions: 'Sandbox virtual account. No real bank transfer is possible. Use "Simulate bank transfer".' }
  },
  sendPayout(orderId, amountKobo, reference) {
    run(
      `INSERT OR IGNORE INTO payments(id, order_id, direction, provider, reference, amount_kobo, status, simulated, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,1,?,?)`,
      uid('pay'), orderId, 'out', 'sandbox-provider', reference, amountKobo.toString(), 'processing', now(), now(),
    )
    setTimeout(
      () =>
        void deliver({ id: uid('evt'), type: 'payout.succeeded', reference, amountKobo: amountKobo.toString(), ts: now() }).catch(() => undefined),
      1500,
    )
  },
}

/** Used by the sandbox "simulate bank transfer" button. */
export function simulateIncomingTransfer(reference: string, amountKobo: string) {
  return deliver({ id: uid('evt'), type: 'collection.succeeded', reference, amountKobo, ts: now() })
}

export const provider: PaymentProvider = sandboxProvider
