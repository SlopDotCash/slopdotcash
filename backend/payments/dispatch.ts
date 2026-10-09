import type { D1Database } from "../trace/cloudflare-persistence";

export interface DispatchPayment {
  obligationId: string;
  network: string;
  vault: string;
  githubUserId: string;
  claimId: string;
  claimDigest: string;
  destination: string;
}
/** The signer service must confirm the current on-chain destination binding and submit
 * a version-bound permissionless payment. Its key cannot approve awards or withdraw. */
export interface PaymentExecutor {
  submit(
    input: DispatchPayment & { idempotencyKey: string },
  ): Promise<{ transactionId: string }>;
}
/** A prepared attempt survives a crashed/ambiguous submit. Retry uses the same attempt
 * ID and executor idempotency key; it must reconcile before creating another transaction. */
export async function dispatchPayment(
  db: D1Database,
  executor: PaymentExecutor,
  obligationId: string,
  now: Date,
): Promise<"submitted" | "unavailable"> {
  const timestamp = now.toISOString();
  const lease = crypto.randomUUID();
  const locked = await db
    .prepare(
      "UPDATE payment_outbox SET state='processing',lease_token=?,lease_until=?,updated_at=? WHERE obligation_id=? AND (state='ready' OR (state='processing' AND lease_until<?))",
    )
    .bind(
      lease,
      new Date(now.getTime() + 60000).toISOString(),
      timestamp,
      obligationId,
      timestamp,
    )
    .run();
  if (locked.meta?.changes !== 1) return "unavailable";
  const payment = await db
    .prepare(
      "SELECT o.id obligationId,o.network,o.vault,o.github_user_id githubUserId,w.id claimId,w.record_sha256 claimDigest,w.wallet_address destination FROM payment_obligations o JOIN wallet_claims w ON w.github_user_id=o.github_user_id AND w.chain=o.chain JOIN payment_wallet_authorizations a ON a.claim_id=w.id WHERE o.id=? AND o.state='reserved' AND NOT EXISTS(SELECT 1 FROM wallet_claims n WHERE n.supersedes_claim_id=w.id)",
    )
    .bind(obligationId)
    .first<DispatchPayment>();
  if (!payment) {
    await db
      .prepare(
        "UPDATE payment_outbox SET state='held',lease_token=NULL,lease_until=NULL,updated_at=? WHERE obligation_id=? AND lease_token=?",
      )
      .bind(timestamp, obligationId, lease)
      .run();
    return "unavailable";
  }
  const previous = await db
    .prepare(
      "SELECT id,claim_id FROM payment_attempts WHERE obligation_id=? AND state IN ('prepared','unknown','submitted') ORDER BY created_at LIMIT 1",
    )
    .bind(obligationId)
    .first<{ id: string; claim_id: string }>();
  // A changed destination never starts a competing transfer while the old attempt is uncertain.
  if (previous && previous.claim_id !== payment.claimId) {
    await db
      .prepare(
        "UPDATE payment_outbox SET state='held',lease_token=NULL,lease_until=NULL,updated_at=? WHERE obligation_id=? AND lease_token=?",
      )
      .bind(timestamp, obligationId, lease)
      .run();
    return "unavailable";
  }
  const id = previous?.id ?? crypto.randomUUID();
  if (!previous)
    await db
      .prepare(
        "INSERT INTO payment_attempts(id,obligation_id,claim_id,created_at,state) VALUES(?,?,?,?,'prepared')",
      )
      .bind(id, obligationId, payment.claimId, timestamp)
      .run();
  try {
    const result = await executor.submit({ ...payment, idempotencyKey: id });
    if (!result.transactionId) throw new Error("Missing submitted transaction");
    await db.batch([
      db
        .prepare(
          "UPDATE payment_attempts SET state='submitted',transaction_id=? WHERE id=? AND state IN ('prepared','unknown','submitted')",
        )
        .bind(result.transactionId, id),
      db
        .prepare(
          "UPDATE payment_outbox SET state='submitted',lease_token=NULL,lease_until=NULL,updated_at=? WHERE obligation_id=? AND lease_token=?",
        )
        .bind(timestamp, obligationId, lease),
    ]);
    return "submitted";
  } catch (error) {
    await db.batch([
      db
        .prepare(
          "UPDATE payment_attempts SET state='unknown' WHERE id=? AND state IN ('prepared','unknown')",
        )
        .bind(id),
      db
        .prepare(
          "UPDATE payment_outbox SET state='ready',lease_token=NULL,lease_until=NULL,updated_at=? WHERE obligation_id=? AND lease_token=?",
        )
        .bind(timestamp, obligationId, lease),
    ]);
    throw error;
  }
}
