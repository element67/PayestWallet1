/**
 * Standalone server: the API (served by Bun directly) plus the background worker in one process. The app itself serves
 * the API through Next.js and runs the worker separately (`bun run dev` or `bun run worker`); this entry exists for the
 * test scripts in scripts/*-test.ts and for running the backend without the web app.
 */
import { CONFIG } from './config'
import { clientIp, handle } from './app'
import { startWorker } from '../worker/start'

// Bind the port first: if another instance already owns it, exit before any worker touches the database.
Bun.serve({
  port: CONFIG.port,
  hostname: '127.0.0.1',
  maxRequestBodySize: 128 * 1024,
  idleTimeout: 60,
  async fetch(req, server) {
    return await handle(req, clientIp(req.headers, server.requestIP(req)?.address))
  },
  error(err) {
    console.error('[server]', err)
    return new Response(JSON.stringify({ error: 'Something went wrong on our side' }), { status: 500, headers: { 'content-type': 'application/json' } })
  },
})

await startWorker()

console.log(
  `[fintech] API on :${CONFIG.port} | dev preview: ${CONFIG.devPreview} | real money: ${CONFIG.realMoney} | arc rpc: ${CONFIG.arc.usingProxy ? 'proxy' : 'public'}`,
)
