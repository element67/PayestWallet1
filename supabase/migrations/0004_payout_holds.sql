-- First-time counterparty hold: payouts above a threshold to a destination the user has not paid before wait out a cooling period.

CREATE TABLE IF NOT EXISTS payout_holds (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,            -- withdrawal | naira_bank | bank_payout | buy_release
  ref_id TEXT NOT NULL,          -- withdrawal id, transaction id or order id
  cp_key TEXT NOT NULL,          -- hashed destination key
  cp_label TEXT NOT NULL,        -- masked label shown to people
  amount_kobo NUMERIC NOT NULL,
  status TEXT NOT NULL,          -- held | released | cancelled
  release_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  resolved_at BIGINT,
  resolved_by TEXT,
  note TEXT,
  UNIQUE (kind, ref_id)
);
CREATE INDEX IF NOT EXISTS payout_holds_due ON payout_holds (status, release_at);
CREATE INDEX IF NOT EXISTS payout_holds_user ON payout_holds (user_id, created_at DESC);

-- Every destination a user has tried. A destination is trusted only after a payout to it completed AND it has existed longer than the hold window.
CREATE TABLE IF NOT EXISTS counterparties (
  user_id TEXT NOT NULL,
  cp_key TEXT NOT NULL,
  kind TEXT NOT NULL,            -- crypto | bank
  label TEXT NOT NULL,
  first_seen_at BIGINT NOT NULL,
  last_paid_at BIGINT,
  paid_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, cp_key)
);

ALTER TABLE payout_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE counterparties ENABLE ROW LEVEL SECURITY;
