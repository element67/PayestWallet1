-- Onchain exchange operations (swap, add or remove liquidity) signed from the in-app wallet.
CREATE TABLE IF NOT EXISTS dex_ops (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), network TEXT NOT NULL, kind TEXT NOT NULL,
  summary TEXT NOT NULL, hashes TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL, note TEXT,
  idem_key TEXT NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dex_ops_idem ON dex_ops(user_id, idem_key);
CREATE INDEX IF NOT EXISTS idx_dex_ops_user ON dex_ops(user_id, created_at DESC);
ALTER TABLE dex_ops ENABLE ROW LEVEL SECURITY;
