-- PRD section 11: reserve the signed maximum before broadcast. Unknown sends
-- remain liabilities across midnight; only canonical receipts settle a cost.
CREATE TABLE referral_post_gas (
  post_id TEXT PRIMARY KEY REFERENCES referral_root_posts(id),
  network TEXT NOT NULL CHECK(network IN ('robinhood-testnet','robinhood-mainnet')),
  maximum_wei INTEGER NOT NULL CHECK(maximum_wei > 0 AND maximum_wei <= 9007199254740991),
  actual_wei INTEGER CHECK(actual_wei IS NULL OR (actual_wei >= 0 AND actual_wei <= maximum_wei)),
  settled_day TEXT,
  CHECK((actual_wei IS NULL) = (settled_day IS NULL)),
  CHECK(settled_day IS NULL OR (length(settled_day)=10 AND settled_day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'))
) STRICT;
CREATE INDEX referral_post_gas_network ON referral_post_gas(network);
CREATE TRIGGER referral_post_gas_immutable BEFORE UPDATE ON referral_post_gas
WHEN NEW.post_id IS NOT OLD.post_id OR NEW.network IS NOT OLD.network
  OR NEW.maximum_wei IS NOT OLD.maximum_wei
  OR (OLD.actual_wei IS NOT NULL AND (NEW.actual_wei IS NOT OLD.actual_wei OR NEW.settled_day IS NOT OLD.settled_day))
BEGIN SELECT RAISE(ABORT, 'referral native cost evidence is immutable'); END;
CREATE TRIGGER referral_post_gas_no_delete BEFORE DELETE ON referral_post_gas
BEGIN SELECT RAISE(ABORT, 'referral native cost evidence is permanent'); END;
