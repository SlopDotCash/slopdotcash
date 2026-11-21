-- The SLOP rate of the refundable submission fee (operator decision,
-- 18 November 2026; PRD section 6, "Submission fee deposits"). One platform
-- number: whole SLOP per 1.00 of stablecoin. A project's SLOP fee is half its
-- stablecoin fee at this rate, rounded to two significant digits. A rate is
-- in force from `effective_at` on, and the one before it still counts for 48
-- hours. Rows are permanent.
CREATE TABLE submission_fee_rates (
  effective_at TEXT PRIMARY KEY,
  slop_per_usd TEXT NOT NULL,       -- whole SLOP per 1.00 of stablecoin, decimal string
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TRIGGER submission_fee_rates_no_update BEFORE UPDATE ON submission_fee_rates
BEGIN SELECT RAISE(ABORT, 'submission fee rate immutable'); END;
CREATE TRIGGER submission_fee_rates_no_delete BEFORE DELETE ON submission_fee_rates
BEGIN SELECT RAISE(ABORT, 'submission fee rate permanent'); END;

-- Hourly readings of the official SLOP / USDG pool on Robinhood Chain, one
-- per UTC hour, that the rate is averaged from. `slop_per_usd` is the pool's
-- price at `block_number`, as whole SLOP per 1.00 USDG.
CREATE TABLE submission_fee_price_samples (
  sampled_hour TEXT PRIMARY KEY CHECK (length(sampled_hour) = 13),  -- YYYY-MM-DDTHH
  sampled_at TEXT NOT NULL,
  block_number INTEGER NOT NULL CHECK (block_number >= 0),
  slop_per_usd TEXT NOT NULL CHECK (length(slop_per_usd) BETWEEN 1 AND 32),
  source TEXT NOT NULL
) STRICT;

CREATE TRIGGER submission_fee_price_samples_no_update BEFORE UPDATE ON submission_fee_price_samples
BEGIN SELECT RAISE(ABORT, 'submission fee price sample immutable'); END;
CREATE TRIGGER submission_fee_price_samples_no_delete BEFORE DELETE ON submission_fee_price_samples
BEGIN SELECT RAISE(ABORT, 'submission fee price sample permanent'); END;
