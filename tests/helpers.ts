/** Shared test helpers: a fresh user per test, seeded assets, direct order rows and an in-process API client. */
import '../server/routes'
import '../server/withdrawals'
import '../server/naira/routes'
import '../server/naira/bills'
import '../server/cryptoOps'
import '../server/settings'
import { seedAssets } from '../server/assets'
import { createSession, type User } from '../server/auth'
import { get, now, run, uid } from '../server/db'
import { handle } from '../server/http'
import { post } from '../server/ledger'
import { ensureNairaWallet, setPin } from '../server/naira/wallet'

await seedAssets()

export const PIN = '2468'

export async function makeUser(opts: { role?: 'user' | 'founder'; kyc?: number; password?: string; pin?: boolean } = {}): Promise<User> {
  const id = uid('usr')
  const email = `${id}@test.example`
  const hash = opts.password === undefined ? null : Bun.password.hashSync(opts.password, { algorithm: 'argon2id' })
  await run('INSERT INTO users(id,email,name,password_hash,role,kyc_tier,created_at) VALUES (?,?,?,?,?,?,?)', id, email, 'Test User', hash, opts.role ?? 'user', opts.kyc ?? 2, now())
  await ensureNairaWallet(id)
  if (opts.pin) await setPin(id, PIN)
  return await get<User>('SELECT * FROM users WHERE id=?', id) as User
}

export const fundNgn = async (userId: string, kobo: bigint) => await post({ owner: userId, asset: 'NGN', delta: kobo, reason: 'test funds', idem: `test:fund:${uid('f')}` })

export const tokenFor = async (u: User) => await createSession(u.id, '10.0.0.1', 'bun-test')

/** Calls the real router in-process. */
export async function api(method: string, path: string, opts: { token?: string; body?: unknown; headers?: Record<string, string>; ip?: string } = {}) {
  const req = new Request(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...(opts.headers ?? {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  const res = await handle(req, opts.ip ?? `9.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`)
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return { status: res.status, json }
}

export async function insertOrder(o: Partial<Record<string, string | number | null>> & { user_id: string }) {
  const id = String(o.id ?? uid('ord'))
  const t = now()
  const row = {
    id, quote_id: 'q_test', idem_key: uid('idem'), side: 'sell', asset: 'USDC', crypto_amount: '10000000', gross_kobo: '1480000', fee_kobo: '14800', net_kobo: '1465200',
    rate_kobo: '148000', status: 'awaiting_deposit', mode: 'sandbox', created_at: t, updated_at: t, expires_at: t + 3_600_000, ...o,
  }
  const cols = Object.keys(row)
  await run(`INSERT INTO orders(${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...cols.map((c) => (row as Record<string, string | number | null>)[c] ?? null))
  return id
}

export const count = async (sql: string, ...p: (string | number)[]) => (await get<{ c: number }>(sql, ...p))?.c ?? 0

/** The promise must reject (the async version of `expect(fn).toThrow()`). */
export async function mustReject(p: Promise<unknown>) {
  let threw = false
  try {
    await p
  } catch {
    threw = true
  }
  if (!threw) throw new Error('Expected the promise to reject, but it resolved')
}
