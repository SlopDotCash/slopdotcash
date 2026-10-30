-- Direct awards are obligations, not vault funds. No signer or broadcaster is added.
CREATE TABLE security_direct_awards (
 case_id TEXT PRIMARY KEY REFERENCES security_cases(id),
 project_id TEXT NOT NULL REFERENCES projects(id),
 root_cause_key TEXT NOT NULL,
 terms TEXT NOT NULL CHECK(json_valid(terms)),
 gross_base TEXT NOT NULL,
 approved_at TEXT NOT NULL,
 UNIQUE(project_id,root_cause_key)
) STRICT;
CREATE TRIGGER security_direct_awards_no_update BEFORE UPDATE ON security_direct_awards BEGIN SELECT RAISE(ABORT,'direct award is immutable'); END;
CREATE TRIGGER security_direct_awards_no_delete BEFORE DELETE ON security_direct_awards BEGIN SELECT RAISE(ABORT,'direct award is permanent'); END;
CREATE TRIGGER security_direct_awards_no_vault BEFORE INSERT ON security_direct_awards
WHEN EXISTS(SELECT 1 FROM security_award_reservations WHERE project_id=NEW.project_id AND root_cause_key=NEW.root_cause_key)
BEGIN SELECT RAISE(ABORT,'root cause already reserved'); END;
CREATE TRIGGER security_vault_awards_no_direct BEFORE INSERT ON security_award_reservations
WHEN EXISTS(SELECT 1 FROM security_direct_awards WHERE project_id=NEW.project_id AND root_cause_key=NEW.root_cause_key)
BEGIN SELECT RAISE(ABORT,'root cause already awarded'); END;
CREATE TABLE security_direct_payments (
 case_id TEXT PRIMARY KEY REFERENCES security_direct_awards(case_id),
 network TEXT NOT NULL,
 intent TEXT NOT NULL CHECK(json_valid(intent)),
 prepared_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER security_direct_payments_no_update BEFORE UPDATE ON security_direct_payments BEGIN SELECT RAISE(ABORT,'direct payment intent is immutable'); END;
CREATE TRIGGER security_direct_payments_no_delete BEFORE DELETE ON security_direct_payments BEGIN SELECT RAISE(ABORT,'direct payment intent is permanent'); END;
CREATE TRIGGER security_direct_payments_no_vault BEFORE INSERT ON security_direct_payments
WHEN EXISTS(SELECT 1 FROM security_settlements WHERE case_id=NEW.case_id)
BEGIN SELECT RAISE(ABORT,'case already has a vault payment'); END;
CREATE TRIGGER security_vault_payment_no_direct BEFORE INSERT ON security_settlements
WHEN EXISTS(SELECT 1 FROM security_direct_payments WHERE case_id=NEW.case_id)
BEGIN SELECT RAISE(ABORT,'case already has a direct payment'); END;
CREATE TABLE security_direct_payment_receipts (
 case_id TEXT PRIMARY KEY REFERENCES security_direct_payments(case_id),
 evidence TEXT NOT NULL CHECK(json_valid(evidence)),
 verified_at TEXT NOT NULL
) STRICT;
CREATE TABLE security_direct_transaction_uses (
 network TEXT NOT NULL,
 transaction_id TEXT NOT NULL,
 case_id TEXT NOT NULL REFERENCES security_direct_payment_receipts(case_id),
 PRIMARY KEY(network,transaction_id)
) STRICT;
CREATE TRIGGER security_direct_receipts_no_update BEFORE UPDATE ON security_direct_payment_receipts BEGIN SELECT RAISE(ABORT,'direct receipt is immutable'); END;
CREATE TRIGGER security_direct_receipts_no_delete BEFORE DELETE ON security_direct_payment_receipts BEGIN SELECT RAISE(ABORT,'direct receipt is permanent'); END;
CREATE TRIGGER security_direct_transactions_no_update BEFORE UPDATE ON security_direct_transaction_uses BEGIN SELECT RAISE(ABORT,'direct transaction use is immutable'); END;
CREATE TRIGGER security_direct_transactions_no_delete BEFORE DELETE ON security_direct_transaction_uses BEGIN SELECT RAISE(ABORT,'direct transaction use is permanent'); END;

-- Refresh only unsigned bytes; the approved payer, asset and transfers stay immutable.
CREATE TABLE security_direct_payment_plans (
 case_id TEXT NOT NULL REFERENCES security_direct_payments(case_id),
 case_revision INTEGER NOT NULL,
 plan TEXT NOT NULL CHECK(json_valid(plan)),
 created_at TEXT NOT NULL,
 PRIMARY KEY(case_id,case_revision)
) STRICT;
CREATE TRIGGER security_direct_plans_no_update BEFORE UPDATE ON security_direct_payment_plans BEGIN SELECT RAISE(ABORT,'direct payment plan is immutable'); END;
CREATE TRIGGER security_direct_plans_no_delete BEFORE DELETE ON security_direct_payment_plans BEGIN SELECT RAISE(ABORT,'direct payment plan is permanent'); END;

-- Native/custom awards can use the full uint128 base-unit range. Keep the legacy column untouched.
ALTER TABLE security_cases ADD COLUMN award_gross_base TEXT CHECK(award_gross_base IS NULL OR (length(award_gross_base) BETWEEN 1 AND 39 AND award_gross_base GLOB '[1-9]*' AND award_gross_base NOT GLOB '*[^0-9]*'));
CREATE TRIGGER security_cases_direct_amount_fixed BEFORE UPDATE ON security_cases
WHEN COALESCE(OLD.award_gross_base, OLD.award_gross_minor) IS NOT NULL AND COALESCE(NEW.award_gross_base, NEW.award_gross_minor) IS NOT COALESCE(OLD.award_gross_base, OLD.award_gross_minor)
AND (EXISTS(SELECT 1 FROM security_direct_awards WHERE case_id=OLD.id) OR EXISTS(SELECT 1 FROM security_award_reservations WHERE case_id=OLD.id))
BEGIN SELECT RAISE(ABORT,'an approved award amount is immutable'); END;
