import type { D1TransactionalDatabase as D1Database, D1Statement } from "../d1";
import {
  notifyPayoutException,
  notifyPayoutHeld,
} from "../notifications/events";

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
  heldNotices?: (obligationId: string, at: string) => Promise<D1Statement[]>,
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
      "SELECT o.id obligationId,o.network,o.vault,o.github_user_id githubUserId,w.id claimId,w.record_sha256 claimDigest,w.wallet_address destination FROM payment_obligations o JOIN effective_payment_wallet_claims w ON w.github_user_id=o.github_user_id AND w.chain=o.chain JOIN payment_wallet_authorizations a ON a.claim_id=w.id WHERE o.id=? AND o.state='reserved'",
    )
    .bind(obligationId)
    .first<DispatchPayment>();
  const previous = payment
    ? await db
        .prepare(
          "SELECT id,claim_id FROM payment_attempts WHERE obligation_id=? AND state IN ('prepared','unknown','submitted') ORDER BY created_at LIMIT 1",
        )
        .bind(obligationId)
        .first<{ id: string; claim_id: string }>()
    : null;
  // Missing wallet authorization and a changed destination share the held transition.
  // A changed destination never starts a competing transfer while the old attempt is uncertain.
  // Recovery may retire that attempt while this dispatcher holds the lease: it then writes
  // `failed` and leaves the live lease alone. Retirement and signing share the executor
  // journal, so a retired attempt is never signed and the submit below fails on its tombstone.
  // Freeing the row here keeps that pair dispatchable; holding it would leave `held` next to
  // a `failed` attempt, which neither recovery nor the dispatch guard picks up again.
  if (!payment || (previous && previous.claim_id !== payment.claimId)) {
    await db.batch([
      db
        .prepare(
          "UPDATE payment_outbox SET state=CASE WHEN EXISTS(SELECT 1 FROM payment_attempts WHERE id=? AND state='failed' AND transaction_id IS NULL) THEN 'ready' ELSE 'held' END,lease_token=NULL,lease_until=NULL,updated_at=? WHERE obligation_id=? AND lease_token=?",
        )
        .bind(previous?.id ?? "", timestamp, obligationId, lease),
      ...(heldNotices
        ? await heldNotices(obligationId, timestamp)
        : [
            notifyPayoutHeld(db, obligationId, timestamp),
            notifyPayoutException(db, obligationId, timestamp),
          ]),
    ]);
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
          // A retirement that raced this completion leaves the row `failed`
          // without a transaction; the signature that landed keeps its receipt.
          "UPDATE payment_attempts SET state='submitted',transaction_id=? WHERE id=? AND (state IN ('prepared','unknown','submitted') OR (state='failed' AND transaction_id IS NULL))",
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
