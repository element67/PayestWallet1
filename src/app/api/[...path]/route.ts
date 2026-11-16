/**
 * The whole API runs here, inside Next.js, on the Bun runtime. Routes are registered by importing @server/app; background
 * work (queue, chain monitors, agent) runs in the separate worker process (`bun run worker`), never in a request.
 */
import type { NextRequest } from 'next/server'
import { CONFIG } from '@server/config'
import { clientIp, handle } from '@server/app'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_BODY = 128 * 1024

async function serve(req: NextRequest): Promise<Response> {
  const declared = Number(req.headers.get('content-length') ?? 0)
  if (declared > MAX_BODY) return Response.json({ error: 'Request body is too large' }, { status: 413 })
  // Next.js does not expose the socket address. When the operator says a proxy sits in front (TRUST_PROXY=true) the client
  // is read from X-Forwarded-For exactly as the standalone server does; otherwise every caller shares one bucket.
  const ip = clientIp(req.headers, CONFIG.trustProxy ? '127.0.0.1' : undefined)
  return await handle(req, ip)
}

export const GET = serve
export const POST = serve
export const PUT = serve
export const PATCH = serve
export const DELETE = serve
