-- Cross-chain USDC transfers (Circle CCTP) started from the app wallet. Browser-wallet transfers are tracked in the browser.
CREATE TABLE IF NOT EXISTS bridge_ops (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), from_chain TEXT NOT NULL, to_chain TEXT NOT NULL,
  amount TEXT NOT NULL, recipient TEXT NOT NULL, status TEXT NOT NULL, steps TEXT NOT NULL DEFAULT '[]', error TEXT,
  result TEXT, idem_key TEXT NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bridge_ops_idem ON bridge_ops(user_id, idem_key);
CREATE INDEX IF NOT EXISTS idx_bridge_ops_user ON bridge_ops(user_id, created_at DESC);
ALTER TABLE bridge_ops ENABLE ROW LEVEL SECURITY;
