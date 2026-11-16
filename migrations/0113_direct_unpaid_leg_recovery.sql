-- Retire an unpaid fee or researcher nonce without reissuing a paid leg.
DROP TRIGGER security_direct_revision_order;
CREATE TRIGGER security_direct_revision_order BEFORE INSERT ON security_direct_payment_revisions
WHEN NEW.prior_generation != COALESCE((SELECT MAX(generation) FROM security_direct_payment_revisions WHERE case_id=NEW.case_id),0)
 OR EXISTS(SELECT 1 FROM security_direct_payment_receipts WHERE case_id=NEW.case_id)
 OR EXISTS(SELECT 1 FROM security_direct_transfer_receipts WHERE case_id=NEW.case_id AND leg_index=0 AND (
   json_extract(NEW.intent,'$.chain')='solana'
   OR json_extract(NEW.intent,'$.recipient') IS NOT (SELECT json_extract(intent,'$.recipient') FROM security_direct_current_payments WHERE case_id=NEW.case_id)
   OR json_extract(NEW.intent,'$.transactions[0]') IS NOT (SELECT json_extract(intent,'$.transactions[0]') FROM security_direct_current_payments WHERE case_id=NEW.case_id)
   OR json_extract(NEW.intent,'$.afterBlocks[0]') IS NOT (SELECT json_extract(intent,'$.afterBlocks[0]') FROM security_direct_current_payments WHERE case_id=NEW.case_id)
 ))
 OR EXISTS(SELECT 1 FROM security_direct_transfer_receipts WHERE case_id=NEW.case_id AND leg_index=1 AND (
   json_extract(NEW.intent,'$.transactions[1]') IS NOT (SELECT json_extract(intent,'$.transactions[1]') FROM security_direct_current_payments WHERE case_id=NEW.case_id)
   OR json_extract(NEW.intent,'$.afterBlocks[1]') IS NOT (SELECT json_extract(intent,'$.afterBlocks[1]') FROM security_direct_current_payments WHERE case_id=NEW.case_id)
 ))
BEGIN SELECT RAISE(ABORT,'direct payment successor is stale or changes a paid leg'); END;

DROP TRIGGER security_direct_successor_nonce;
CREATE TRIGGER security_direct_successor_nonce AFTER INSERT ON security_direct_payment_revisions
WHEN json_extract(NEW.intent,'$.protocolVersion')=2 AND json_extract(NEW.intent,'$.chain')<>'solana'
BEGIN
 INSERT INTO security_direct_nonce_reservations(network,payer,nonce,case_id,generation,leg_index,created_at)
 SELECT json_extract(NEW.intent,'$.network'),lower(json_extract(NEW.intent,'$.payer.address')),lower(json_extract(t.value,'$.nonce')),NEW.case_id,NEW.generation,CAST(t.key AS INTEGER),NEW.created_at
 FROM json_each(NEW.intent,'$.transactions') t
 WHERE json_extract(t.value,'$.nonce') IS NOT json_extract(
   COALESCE((SELECT intent FROM security_direct_payment_revisions WHERE case_id=NEW.case_id AND generation=NEW.prior_generation),(SELECT intent FROM security_direct_payments WHERE case_id=NEW.case_id)),
   '$.transactions['||t.key||'].nonce'
 );
END;
