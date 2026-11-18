-- Circle swaps (App Kit) on Arc Testnet, signed by the user's app wallet after a transaction PIN. One row per swap.
CREATE TABLE IF NOT EXISTS swap_ops (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), chain TEXT NOT NULL, address TEXT NOT NULL,
  token_in TEXT NOT NULL, token_out TEXT NOT NULL, amount_in TEXT NOT NULL, amount_out TEXT, slippage_bps INTEGER NOT NULL,
  provider TEXT, status TEXT NOT NULL, tx_hash TEXT, explorer_url TEXT, fees TEXT NOT NULL DEFAULT '[]', error TEXT,
  idem_key TEXT NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_swap_ops_idem ON swap_ops(user_id, idem_key);
CREATE INDEX IF NOT EXISTS idx_swap_ops_user ON swap_ops(user_id, created_at DESC);
ALTER TABLE swap_ops ENABLE ROW LEVEL SECURITY;
