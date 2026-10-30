-- Successors change only an unpaid destination after proof retires the old request.
CREATE TABLE security_direct_payment_revisions (
 case_id TEXT NOT NULL REFERENCES security_direct_payments(case_id),
 generation INTEGER NOT NULL CHECK(generation>0),
 prior_generation INTEGER NOT NULL CHECK(prior_generation=generation-1),
 intent TEXT NOT NULL CHECK(json_valid(intent)),
 retirement TEXT NOT NULL CHECK(json_valid(retirement)),
 actor_github_id TEXT NOT NULL,
 created_at TEXT NOT NULL,
 PRIMARY KEY(case_id,generation)
) STRICT;
CREATE TRIGGER security_direct_revision_no_update BEFORE UPDATE ON security_direct_payment_revisions
BEGIN SELECT RAISE(ABORT,'direct payment successor is immutable'); END;
CREATE TRIGGER security_direct_revision_no_delete BEFORE DELETE ON security_direct_payment_revisions
BEGIN SELECT RAISE(ABORT,'direct payment successor is permanent'); END;
CREATE TRIGGER security_direct_revision_order BEFORE INSERT ON security_direct_payment_revisions
WHEN NEW.prior_generation != COALESCE((SELECT MAX(generation) FROM security_direct_payment_revisions WHERE case_id=NEW.case_id),0)
 OR EXISTS(SELECT 1 FROM security_direct_transfer_receipts WHERE case_id=NEW.case_id AND leg_index=0)
BEGIN SELECT RAISE(ABORT,'direct payment successor is stale or already paid'); END;

CREATE TRIGGER security_direct_revision_terms BEFORE INSERT ON security_direct_payment_revisions
WHEN json_extract(NEW.intent,'$.network') IS NOT (SELECT json_extract(intent,'$.network') FROM security_direct_current_payments WHERE case_id=NEW.case_id)
 OR json_extract(NEW.intent,'$.chain') IS NOT (SELECT json_extract(intent,'$.chain') FROM security_direct_current_payments WHERE case_id=NEW.case_id)
 OR json_extract(NEW.intent,'$.payer') IS NOT (SELECT json_extract(intent,'$.payer') FROM security_direct_current_payments WHERE case_id=NEW.case_id)
 OR json_extract(NEW.intent,'$.asset') IS NOT (SELECT json_extract(intent,'$.asset') FROM security_direct_current_payments WHERE case_id=NEW.case_id)
 OR json_extract(NEW.intent,'$.grossBase') IS NOT (SELECT json_extract(intent,'$.grossBase') FROM security_direct_current_payments WHERE case_id=NEW.case_id)
 OR json_extract(NEW.intent,'$.netBase') IS NOT (SELECT json_extract(intent,'$.netBase') FROM security_direct_current_payments WHERE case_id=NEW.case_id)
 OR json_extract(NEW.intent,'$.feeBase') IS NOT (SELECT json_extract(intent,'$.feeBase') FROM security_direct_current_payments WHERE case_id=NEW.case_id)
 OR json_extract(NEW.intent,'$.transfers[0].amountBase') IS NOT (SELECT json_extract(intent,'$.transfers[0].amountBase') FROM security_direct_current_payments WHERE case_id=NEW.case_id)
 OR json_extract(NEW.intent,'$.transfers[1]') IS NOT (SELECT json_extract(intent,'$.transfers[1]') FROM security_direct_current_payments WHERE case_id=NEW.case_id)
BEGIN SELECT RAISE(ABORT,'recovery cannot change payer, asset, amounts or fee'); END;

CREATE VIEW security_direct_current_payments AS
SELECT p.case_id,p.network,p.prepared_at,
 COALESCE((SELECT r.intent FROM security_direct_payment_revisions r WHERE r.case_id=p.case_id ORDER BY generation DESC LIMIT 1),p.intent) intent,
 COALESCE((SELECT MAX(generation) FROM security_direct_payment_revisions r WHERE r.case_id=p.case_id),0) generation
FROM security_direct_payments p;

CREATE TABLE security_direct_nonce_reservations (
 network TEXT NOT NULL, payer TEXT NOT NULL, nonce TEXT NOT NULL,
 case_id TEXT NOT NULL REFERENCES security_direct_payments(case_id),
 generation INTEGER NOT NULL, leg_index INTEGER NOT NULL CHECK(leg_index IN (0,1)),
 created_at TEXT NOT NULL,
 PRIMARY KEY(network,payer,nonce), UNIQUE(case_id,generation,leg_index)
) STRICT;
CREATE TRIGGER security_direct_nonce_no_update BEFORE UPDATE ON security_direct_nonce_reservations
BEGIN SELECT RAISE(ABORT,'direct payment nonce is immutable'); END;
CREATE TRIGGER security_direct_nonce_no_delete BEFORE DELETE ON security_direct_nonce_reservations
BEGIN SELECT RAISE(ABORT,'direct payment nonce is permanent'); END;
CREATE TRIGGER security_direct_initial_nonces AFTER INSERT ON security_direct_payments
WHEN json_extract(NEW.intent,'$.protocolVersion')=2 AND json_extract(NEW.intent,'$.chain')<>'solana'
BEGIN
 INSERT INTO security_direct_nonce_reservations(network,payer,nonce,case_id,generation,leg_index,created_at)
 SELECT NEW.network,lower(json_extract(NEW.intent,'$.payer.address')),lower(json_extract(t.value,'$.nonce')),NEW.case_id,0,CAST(t.key AS INTEGER),NEW.prepared_at
 FROM json_each(NEW.intent,'$.transactions') t;
END;
CREATE TRIGGER security_direct_successor_nonce AFTER INSERT ON security_direct_payment_revisions
WHEN json_extract(NEW.intent,'$.protocolVersion')=2 AND json_extract(NEW.intent,'$.chain')<>'solana'
 AND json_extract(NEW.retirement,'$.kind')<>'consent-renewal'
BEGIN
 INSERT INTO security_direct_nonce_reservations(network,payer,nonce,case_id,generation,leg_index,created_at)
 VALUES(json_extract(NEW.intent,'$.network'),lower(json_extract(NEW.intent,'$.payer.address')),lower(json_extract(NEW.intent,'$.transactions[0].nonce')),NEW.case_id,NEW.generation,0,NEW.created_at);
END;

ALTER TABLE security_direct_payment_plans ADD COLUMN generation INTEGER NOT NULL DEFAULT 0;
CREATE TABLE security_direct_recovery_scans (
 case_id TEXT NOT NULL REFERENCES security_direct_payments(case_id), generation INTEGER NOT NULL,
 transaction_id TEXT NOT NULL, operator TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0),
 scan_json TEXT NOT NULL CHECK(json_valid(scan_json)),
 page_json TEXT NOT NULL CHECK(json_valid(page_json)), created_at TEXT NOT NULL,
 PRIMARY KEY(case_id,generation,transaction_id,operator,revision)
) STRICT;
CREATE TRIGGER security_direct_scan_no_update BEFORE UPDATE ON security_direct_recovery_scans
BEGIN SELECT RAISE(ABORT,'recovery scan evidence is immutable'); END;
CREATE TRIGGER security_direct_scan_no_delete BEFORE DELETE ON security_direct_recovery_scans
BEGIN SELECT RAISE(ABORT,'recovery scan evidence is permanent'); END;
