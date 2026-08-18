-- Multi-tenant registry: sellers, listings, receipts.
-- Receipts are the invoice basis (2% take-rate) and the reputation-graph seed.

CREATE TABLE IF NOT EXISTS sellers (
  id TEXT PRIMARY KEY,                -- [a-z0-9-]{2,63}
  wallet TEXT NOT NULL UNIQUE,        -- payTo: buyer USDC goes DIRECTLY here (non-custodial)
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id TEXT NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL,           -- slug used in /s/{sellerId}/{serviceId}
  method TEXT NOT NULL DEFAULT 'GET',
  upstream_url TEXT NOT NULL,         -- the seller's real API endpoint we proxy to
  price_usd TEXT NOT NULL,            -- e.g. "$0.05"
  description TEXT DEFAULT '',
  live INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  UNIQUE(seller_id, service_id)
);

CREATE TABLE IF NOT EXISTS receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  seller_id TEXT NOT NULL REFERENCES sellers(id),
  service_id TEXT NOT NULL,
  amount_usd TEXT NOT NULL,
  payer TEXT,                          -- from X-PAYMENT-RESPONSE when available
  tx_hash TEXT,
  raw_response TEXT
);
CREATE INDEX IF NOT EXISTS idx_receipts_seller ON receipts(seller_id, ts DESC);
