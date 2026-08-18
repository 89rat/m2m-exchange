-- Monetization streams 2+3: seller tiers and promoted placement.
-- Stream 1 (take-rate) reads receipts; no schema change needed there.

ALTER TABLE sellers ADD COLUMN tier TEXT NOT NULL DEFAULT 'free'; -- free | pro
ALTER TABLE sellers ADD COLUMN promoted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE listings ADD COLUMN promoted INTEGER NOT NULL DEFAULT 0;
