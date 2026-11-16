/**
 * Development launcher: starts the Next.js dev server on :5173 (which serves the API) and the background worker.
 * Next.js runs on the Bun runtime. Both stop together when this process stops.
 */
import { spawn, type ChildProcess } from 'node:child_process'

const webPort = Number(process.env.WEB_PORT ?? 5173)
const children: ChildProcess[] = []

children.push(spawn('bun', ['worker/index.ts'], { stdio: 'inherit' }))
children.push(spawn('bunx', ['--bun', 'next', 'dev', '-H', '0.0.0.0', '-p', String(webPort)], { stdio: 'inherit' }))

const stop = () => {
  for (const c of children) c.kill()
}
process.once('exit', stop)
process.once('SIGINT', () => (stop(), process.exit(0)))
process.once('SIGTERM', () => (stop(), process.exit(0)))
// If the web server exits, everything exits.
children[children.length - 1].once('exit', (code) => (stop(), process.exit(code ?? 0)))
