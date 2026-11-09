/**
 * SQLite persistence. One process owns this file (API, workers and agent run together).
 * Crash-safe pragmas; on an integrity failure the server stops and never rebuilds the file.
 */
import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { DEFAULT_SETTINGS } from './config'

mkdirSync('data', { recursive: true })
export const db = new Database('data/fintech.db', { create: true })
db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;')

const check = db.query('PRAGMA quick_check').get() as { quick_check: string } | null
if (check && check.quick_check !== 'ok') {
  throw new Error(`SQLite integrity check failed: ${check.quick_check}. Not touching the database file.`)
}

// Migration: the single-entry `ledger` table becomes the immutable double-entry `ledger_entries` table.
{
  const has = (name: string) => Boolean(db.query("SELECT 1 FROM sqlite_master WHERE name=?").get(name))
  if (has('ledger') && !has('ledger_entries')) db.exec('ALTER TABLE ledger RENAME TO ledger_entries')
}

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'user', kyc_tier INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'active',
  dev_preview INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, last_login_at INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL, ip TEXT
);
CREATE TABLE IF NOT EXISTS assets (
  symbol TEXT PRIMARY KEY, name TEXT NOT NULL, chain TEXT NOT NULL, kind TEXT NOT NULL, contract TEXT,
  decimals INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, monitoring TEXT NOT NULL,
  buy_rate_kobo TEXT NOT NULL, sell_rate_kobo TEXT NOT NULL, min_ngn_kobo TEXT NOT NULL, max_ngn_kobo TEXT NOT NULL,
  rate_version INTEGER NOT NULL DEFAULT 1, rate_source TEXT NOT NULL DEFAULT 'seed placeholder', updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS balances (
  owner TEXT NOT NULL, asset TEXT NOT NULL, amount TEXT NOT NULL DEFAULT '0', PRIMARY KEY (owner, asset)
);
CREATE TABLE IF NOT EXISTS ledger_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, asset TEXT NOT NULL, delta TEXT NOT NULL,
  balance_after TEXT NOT NULL, reason TEXT NOT NULL, order_id TEXT, idem_key TEXT UNIQUE NOT NULL, created_at INTEGER NOT NULL,
  txn_id TEXT, side TEXT
);
CREATE INDEX IF NOT EXISTS idx_ledger_owner ON ledger_entries(owner, asset, id);
CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, side TEXT NOT NULL, asset TEXT NOT NULL,
  crypto_amount TEXT NOT NULL, gross_kobo TEXT NOT NULL, fee_kobo TEXT NOT NULL, net_kobo TEXT NOT NULL,
  rate_kobo TEXT NOT NULL, rate_version INTEGER NOT NULL, fee_bps INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), quote_id TEXT NOT NULL, idem_key TEXT NOT NULL,
  side TEXT NOT NULL, asset TEXT NOT NULL, crypto_amount TEXT NOT NULL, gross_kobo TEXT NOT NULL, fee_kobo TEXT NOT NULL,
  net_kobo TEXT NOT NULL, rate_kobo TEXT NOT NULL, status TEXT NOT NULL, mode TEXT NOT NULL,
  payout_type TEXT, bank_account_id TEXT, dest_address TEXT, from_address TEXT, deposit_address TEXT,
  funding TEXT, instant INTEGER NOT NULL DEFAULT 0, risk_score INTEGER NOT NULL DEFAULT 0, risk_flags TEXT NOT NULL DEFAULT '[]',
  tx_hash TEXT, failure_reason TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  broadcast_at INTEGER, detected_at INTEGER, payout_at INTEGER, completed_at INTEGER, expires_at INTEGER,
  UNIQUE (user_id, idem_key)
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at);
CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_order_events ON order_events(order_id);
CREATE TABLE IF NOT EXISTS chain_txs (
  id TEXT PRIMARY KEY, chain TEXT NOT NULL, tx_hash TEXT NOT NULL, log_index INTEGER NOT NULL DEFAULT 0,
  token_address TEXT, asset TEXT, from_addr TEXT, to_addr TEXT, amount TEXT, block_number INTEGER,
  confirmations INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, verdict TEXT NOT NULL DEFAULT 'unchecked',
  order_id TEXT, simulated INTEGER NOT NULL DEFAULT 0, first_seen_at INTEGER NOT NULL, detect_latency_ms INTEGER,
  settled_at INTEGER, updated_at INTEGER NOT NULL, UNIQUE (chain, tx_hash, log_index)
);
CREATE TABLE IF NOT EXISTS bank_accounts (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, bank_name TEXT NOT NULL, account_name TEXT NOT NULL,
  account_last4 TEXT NOT NULL, account_enc TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL, direction TEXT NOT NULL, provider TEXT NOT NULL, reference TEXT UNIQUE NOT NULL,
  amount_kobo TEXT NOT NULL, status TEXT NOT NULL, simulated INTEGER NOT NULL DEFAULT 1, detail TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS withdrawals (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, asset TEXT NOT NULL, amount TEXT NOT NULL, value_kobo TEXT NOT NULL,
  dest TEXT, bank_account_id TEXT, status TEXT NOT NULL, idem_key TEXT NOT NULL, reference TEXT, tx_hash TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE (user_id, idem_key)
);
CREATE TABLE IF NOT EXISTS wallets (
  id TEXT PRIMARY KEY, user_id TEXT UNIQUE NOT NULL, mnemonic_enc TEXT NOT NULL, key_version INTEGER NOT NULL DEFAULT 1,
  environment TEXT NOT NULL DEFAULT 'testnet', created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS wallet_addresses (
  id TEXT PRIMARY KEY, wallet_id TEXT NOT NULL REFERENCES wallets(id), family TEXT NOT NULL, derivation_path TEXT NOT NULL,
  address TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE (wallet_id, family)
);
CREATE INDEX IF NOT EXISTS idx_wallet_addr ON wallet_addresses(address);
CREATE TABLE IF NOT EXISTS wallet_balances (
  user_id TEXT NOT NULL, asset_key TEXT NOT NULL, raw TEXT NOT NULL, verified_at INTEGER NOT NULL, block_ref TEXT,
  PRIMARY KEY (user_id, asset_key)
);
CREATE TABLE IF NOT EXISTS wallet_txs (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, network TEXT NOT NULL, asset_key TEXT, token_ref TEXT, symbol TEXT,
  type TEXT NOT NULL, amount TEXT NOT NULL, from_addr TEXT, to_addr TEXT, tx_hash TEXT NOT NULL, fee_raw TEXT, fee_symbol TEXT,
  status TEXT NOT NULL, verdict TEXT NOT NULL DEFAULT 'genuine', block_number INTEGER, confirmations INTEGER NOT NULL DEFAULT 0,
  risk_score INTEGER NOT NULL DEFAULT 0, risk_flags TEXT NOT NULL DEFAULT '[]', idem_key TEXT, note TEXT,
  detected_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, finalized_at INTEGER,
  UNIQUE (network, tx_hash, user_id, type)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_tx_idem ON wallet_txs(user_id, idem_key) WHERE idem_key IS NOT NULL;
CREATE TABLE IF NOT EXISTS wallet_cursors (key TEXT PRIMARY KEY, value TEXT NOT NULL);
DROP TABLE IF EXISTS wallet_assets; -- migration: per-asset display toggles were removed
CREATE TABLE IF NOT EXISTS webhook_events (event_id TEXT PRIMARY KEY, received_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, uniq TEXT UNIQUE NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL,
  run_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'queued', last_error TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs ON jobs(status, run_at);
CREATE TABLE IF NOT EXISTS agent_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, order_id TEXT, tx_id TEXT, kind TEXT NOT NULL,
  decision TEXT NOT NULL, score INTEGER NOT NULL DEFAULT 0, reasons TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, severity TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '', user_id TEXT, order_id TEXT, resolved INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL,
  body TEXT NOT NULL, read INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor_id TEXT, action TEXT NOT NULL, target TEXT,
  before TEXT, after TEXT
);
CREATE TABLE IF NOT EXISTS naira_wallets (
  user_id TEXT PRIMARY KEY REFERENCES users(id), account_number TEXT UNIQUE NOT NULL, status TEXT NOT NULL DEFAULT 'active', freeze_reason TEXT,
  pin_hash TEXT, pin_set_at INTEGER, pin_attempts INTEGER NOT NULL DEFAULT 0, pin_locked_until INTEGER,
  reset_otp_hash TEXT, reset_otp_expires INTEGER, reset_otp_attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY, reference TEXT UNIQUE NOT NULL, user_id TEXT NOT NULL, type TEXT NOT NULL, direction TEXT NOT NULL,
  amount_kobo TEXT NOT NULL, fee_kobo TEXT NOT NULL DEFAULT '0', status TEXT NOT NULL, title TEXT NOT NULL, counterparty TEXT, note TEXT,
  meta TEXT NOT NULL DEFAULT '{}', idem_key TEXT, ledger_txn_id TEXT, failure_reason TEXT, reversed INTEGER NOT NULL DEFAULT 0,
  review_required INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, completed_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_txn_idem ON transactions(user_id, idem_key) WHERE idem_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_txn_user ON transactions(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_txn_status ON transactions(status);
CREATE TABLE IF NOT EXISTS tokens (
  symbol TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  decimals INTEGER NOT NULL,
  logo TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  popular INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 100,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS token_networks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL REFERENCES tokens(symbol),
  network_id TEXT NOT NULL,
  chain_id INTEGER,
  is_testnet INTEGER NOT NULL,
  contract TEXT,
  decimals INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0,
  verified INTEGER NOT NULL DEFAULT 0,
  verified_at INTEGER,
  verify_note TEXT,
  source TEXT NOT NULL DEFAULT 'seed',
  UNIQUE(symbol, network_id)
);
CREATE INDEX IF NOT EXISTS idx_tn_network ON token_networks(network_id, is_active);
CREATE TABLE IF NOT EXISTS wallet_tokens (
  user_id TEXT NOT NULL REFERENCES users(id),
  asset_key TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, asset_key)
);
CREATE TABLE IF NOT EXISTS crypto_ops (
  id TEXT PRIMARY KEY,
  reference TEXT UNIQUE NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  asset TEXT NOT NULL,
  to_asset TEXT,
  amount TEXT NOT NULL,
  result_amount TEXT,
  value_kobo TEXT NOT NULL DEFAULT '0',
  fee_kobo TEXT NOT NULL DEFAULT '0',
  order_id TEXT,
  meta TEXT NOT NULL DEFAULT '{}',
  reason TEXT,
  idem_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, idem_key)
);
CREATE INDEX IF NOT EXISTS idx_ops_user ON crypto_ops(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS beneficiaries (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL, bank_code TEXT, bank_name TEXT,
  account_enc TEXT, account_last4 TEXT, account_name TEXT, target_user_id TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bills_orders (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, transaction_id TEXT NOT NULL, category TEXT NOT NULL, provider TEXT NOT NULL,
  product TEXT, customer_ref TEXT, customer_name TEXT, amount_kobo TEXT NOT NULL, fee_kobo TEXT NOT NULL DEFAULT '0',
  status TEXT NOT NULL, token TEXT, provider_ref TEXT, payload TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS p2p_orders (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, exchange_order_id TEXT UNIQUE NOT NULL, asset TEXT NOT NULL, crypto_amount TEXT NOT NULL,
  expected_kobo TEXT NOT NULL, status TEXT NOT NULL, transaction_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS provider_callbacks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT NOT NULL, event_id TEXT UNIQUE NOT NULL, kind TEXT NOT NULL,
  payload TEXT NOT NULL, received_at INTEGER NOT NULL, processed_at INTEGER, result TEXT
);
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, fingerprint TEXT NOT NULL, label TEXT, ip TEXT, first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL, UNIQUE (user_id, fingerprint)
);
CREATE TABLE IF NOT EXISTS shop_products (
  id TEXT PRIMARY KEY, category TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL, price_kobo TEXT NOT NULL,
  kind TEXT NOT NULL, stock INTEGER NOT NULL DEFAULT 100, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS monitor_state (
  chain TEXT PRIMARY KEY, status TEXT NOT NULL, last_block INTEGER, head_block INTEGER, last_poll_at INTEGER,
  poll_ms INTEGER, error TEXT, mode TEXT NOT NULL
);
`)

function addColumn(table: string, column: string, type: string) {
  const cols = db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
}
addColumn('users', 'username', 'TEXT')
addColumn('users', 'phone', 'TEXT')
if (!(db.query("PRAGMA table_info(ledger_entries)").all() as { name: string }[]).some((c) => c.name === 'status')) {
  db.exec("ALTER TABLE ledger_entries ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed'")
}
addColumn('users', 'display_currency', "TEXT NOT NULL DEFAULT 'USD'")
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username) WHERE username IS NOT NULL; CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users(phone) WHERE phone IS NOT NULL;')
addColumn('sessions', 'device_fp', 'TEXT')
addColumn('sessions', 'user_agent', 'TEXT')
addColumn('ledger_entries', 'txn_id', 'TEXT')
addColumn('ledger_entries', 'side', 'TEXT')
db.exec('CREATE INDEX IF NOT EXISTS idx_ledger_txn ON ledger_entries(txn_id)')

// Legacy single-entry rows get a mirror entry against the suspense account so every transaction nets to zero.
db.exec('DROP TRIGGER IF EXISTS ledger_no_update; DROP TRIGGER IF EXISTS ledger_no_delete;')
db.transaction(() => {
  const legacy = db.query('SELECT id, asset, delta, reason, created_at FROM ledger_entries WHERE txn_id IS NULL').all() as { id: number; asset: string; delta: string; reason: string; created_at: number }[]
  for (const r of legacy) {
    const d = BigInt(r.delta)
    db.query('UPDATE ledger_entries SET txn_id=?, side=? WHERE id=?').run(`legacy-${r.id}`, d >= 0n ? 'credit' : 'debit', r.id)
    const bal = db.query("SELECT amount FROM balances WHERE owner='sys:suspense' AND asset=?").get(r.asset) as { amount: string } | null
    const next = (bal ? BigInt(bal.amount) : 0n) - d
    db.query('INSERT INTO ledger_entries(owner,asset,delta,balance_after,reason,order_id,idem_key,created_at,txn_id,side) VALUES (?,?,?,?,?,?,?,?,?,?)').run(
      'sys:suspense', r.asset, (-d).toString(), next.toString(), `mirror: ${r.reason}`, null, `legacy-${r.id}#cp`, r.created_at, `legacy-${r.id}`, d >= 0n ? 'debit' : 'credit',
    )
    db.query("INSERT INTO balances(owner,asset,amount) VALUES ('sys:suspense',?,?) ON CONFLICT(owner,asset) DO UPDATE SET amount=excluded.amount").run(r.asset, next.toString())
  }
})()
db.exec(`
CREATE TRIGGER ledger_no_update BEFORE UPDATE ON ledger_entries BEGIN SELECT RAISE(ABORT, 'ledger entries are immutable'); END;
CREATE TRIGGER ledger_no_delete BEFORE DELETE ON ledger_entries BEGIN SELECT RAISE(ABORT, 'ledger entries are immutable'); END;
`)

for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
  db.query('INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)').run(k, v)
}

export const now = () => Date.now()
export const uid = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`

export function all<T = Record<string, unknown>>(sql: string, ...p: (string | number | bigint | null)[]): T[] {
  return db.query(sql).all(...p) as T[]
}
export function get<T = Record<string, unknown>>(sql: string, ...p: (string | number | bigint | null)[]): T | null {
  return (db.query(sql).get(...p) as T | null) ?? null
}
export function run(sql: string, ...p: (string | number | bigint | null)[]) {
  return db.query(sql).run(...p)
}

export function setting(key: string): string {
  return get<{ value: string }>('SELECT value FROM settings WHERE key=?', key)?.value ?? DEFAULT_SETTINGS[key] ?? ''
}
export const settingNum = (key: string) => Number(setting(key))
export const settingBig = (key: string) => BigInt(setting(key) || '0')

export function audit(actorId: string | null, action: string, target: string, before?: unknown, after?: unknown) {
  run(
    'INSERT INTO audit_logs(at, actor_id, action, target, before, after) VALUES (?,?,?,?,?,?)',
    now(), actorId, action, target, before === undefined ? null : JSON.stringify(before), after === undefined ? null : JSON.stringify(after),
  )
}

export function alert(severity: 'info' | 'warning' | 'critical', kind: string, title: string, detail = '', userId?: string, orderId?: string) {
  run('INSERT INTO alerts(at, severity, kind, title, detail, user_id, order_id) VALUES (?,?,?,?,?,?,?)', now(), severity, kind, title, detail, userId ?? null, orderId ?? null)
}

export function notify(userId: string, kind: string, title: string, body: string) {
  run('INSERT INTO notifications(user_id, at, kind, title, body) VALUES (?,?,?,?,?)', userId, now(), kind, title, body)
}

export function orderEvent(orderId: string, kind: string, detail = '') {
  run('INSERT INTO order_events(order_id, at, kind, detail) VALUES (?,?,?,?)', orderId, now(), kind, detail)
}
