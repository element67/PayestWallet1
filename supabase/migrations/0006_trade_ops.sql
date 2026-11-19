-- One record for every swap and bridge made through the trade module, whichever provider handled it.
CREATE TABLE IF NOT EXISTS trade_ops (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL, provider TEXT NOT NULL, mode TEXT NOT NULL,
  from_chain TEXT NOT NULL, to_chain TEXT NOT NULL, token_in TEXT NOT NULL, token_out TEXT NOT NULL, amount_in TEXT NOT NULL,
  amount_out TEXT, min_out TEXT, slippage_bps INTEGER NOT NULL, speed TEXT, fee_bps INTEGER NOT NULL DEFAULT 0, fee_amount TEXT,
  fees TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL, steps TEXT NOT NULL DEFAULT '[]', tx_hashes TEXT NOT NULL DEFAULT '[]',
  explorer_url TEXT, error TEXT, resume TEXT, address TEXT NOT NULL, recipient TEXT NOT NULL, idem_key TEXT NOT NULL,
  created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_trade_ops_idem ON trade_ops(user_id, idem_key);
CREATE INDEX IF NOT EXISTS idx_trade_ops_user ON trade_ops(user_id, created_at DESC);
ALTER TABLE trade_ops ENABLE ROW LEVEL SECURITY;
