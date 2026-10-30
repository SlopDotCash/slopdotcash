-- Retain each finalized external transfer before all legs of an award finish.
-- A refresh must never offer a transfer that has already paid its recipient.
CREATE TABLE security_direct_transfer_receipts (
 case_id TEXT NOT NULL REFERENCES security_direct_payments(case_id),
 leg_index INTEGER NOT NULL CHECK(leg_index IN (0,1)),
 network TEXT NOT NULL,
 transaction_id TEXT NOT NULL,
 evidence TEXT NOT NULL CHECK(json_valid(evidence)),
 verified_at TEXT NOT NULL,
 PRIMARY KEY(case_id,leg_index),
 UNIQUE(network,transaction_id)
) STRICT;

-- One public transaction cannot also be credited as an ordinary manual payment.
CREATE TRIGGER security_direct_transfer_no_public_replay BEFORE INSERT ON security_direct_transfer_receipts
WHEN EXISTS(SELECT 1 FROM payment_direct_transfers p WHERE p.network=NEW.network AND
  CASE WHEN NEW.network LIKE 'solana%' THEN p.transaction_id=NEW.transaction_id ELSE lower(p.transaction_id)=lower(NEW.transaction_id) END)
BEGIN SELECT RAISE(ABORT,'payment transfer already credited'); END;
CREATE TRIGGER payment_direct_no_security_replay BEFORE INSERT ON payment_direct_transfers
WHEN EXISTS(SELECT 1 FROM security_direct_transfer_receipts p WHERE p.network=NEW.network AND
  CASE WHEN NEW.network LIKE 'solana%' THEN p.transaction_id=NEW.transaction_id ELSE lower(p.transaction_id)=lower(NEW.transaction_id) END)
BEGIN SELECT RAISE(ABORT,'payment transfer already credited'); END;

-- Existing completed payments were recorded in the immutable transfer order.
INSERT INTO security_direct_transfer_receipts(case_id,leg_index,network,transaction_id,evidence,verified_at)
SELECT p.case_id,CAST(e.key AS INTEGER),p.network,json_extract(e.value,'$.transactionId'),e.value,r.verified_at
FROM security_direct_payments p JOIN security_direct_payment_receipts r ON r.case_id=p.case_id,
     json_each(r.evidence) e;

CREATE TRIGGER security_direct_transfer_receipts_no_update BEFORE UPDATE ON security_direct_transfer_receipts
BEGIN SELECT RAISE(ABORT,'direct transfer receipt is immutable'); END;
CREATE TRIGGER security_direct_transfer_receipts_no_delete BEFORE DELETE ON security_direct_transfer_receipts
BEGIN SELECT RAISE(ABORT,'direct transfer receipt is permanent'); END;
