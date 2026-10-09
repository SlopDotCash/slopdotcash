import { type PaymentChain, payoutFee } from "../../src/lib/payments/contracts";
import type { D1Database } from "../trace/cloudflare-persistence";

export interface FinalizedPaymentEvent {
  kind: "reserved" | "paid";
  transactionId: string;
  eventIndex: number;
  blockId: string;
  obligationId: string;
  projectId: string;
  network: string;
  chain: PaymentChain;
  vault: string;
  githubUserId: string;
  grossMicro: string;
  netMicro: string;
  feeMicro: string;
  sourceDigest: string;
  destination?: string;
}
/** Adapters must independently fetch canonical finalized chain evidence. */
export interface PaymentChainAdapter {
  verifyFinalized(input: {
    transactionId: string;
    eventIndex: number;
    kind: "reserved" | "paid";
    obligationId: string;
  }): Promise<FinalizedPaymentEvent>;
}
/** Only an adapter result may enter the ledger. Public handlers cannot call this with a body. */
export async function indexPaymentEvent(
  db: D1Database,
  adapter: PaymentChainAdapter,
  input: Parameters<PaymentChainAdapter["verifyFinalized"]>[0],
  now: string,
): Promise<void> {
  const event = await adapter.verifyFinalized(input);
  if (
    event.transactionId !== input.transactionId ||
    event.eventIndex !== input.eventIndex ||
    event.kind !== input.kind ||
    event.obligationId !== input.obligationId ||
    !/^[1-9]\d*$/.test(event.githubUserId) ||
    !/^[1-9]\d*$/.test(event.grossMicro) ||
    payoutFee(BigInt(event.grossMicro)).toString() !== event.feeMicro ||
    (BigInt(event.grossMicro) - BigInt(event.feeMicro)).toString() !==
      event.netMicro ||
    !/^[a-f0-9]{64}$/.test(event.sourceDigest)
  )
    throw new Error("Chain event mismatch");
  const existing = await db
    .prepare("SELECT * FROM payment_obligations WHERE id=?")
    .bind(event.obligationId)
    .first<{
      project_id: string;
      network: string;
      vault: string;
      github_user_id: string;
      gross_micro: string;
      fee_micro: string;
      source_digest: string;
      state: string;
      paid_transaction: string | null;
    }>();
  if (
    existing &&
    (existing.project_id !== event.projectId ||
      existing.network !== event.network ||
      existing.vault !== event.vault ||
      existing.github_user_id !== event.githubUserId ||
      existing.gross_micro !== event.grossMicro ||
      existing.fee_micro !== event.feeMicro ||
      (BigInt(event.grossMicro) - BigInt(event.feeMicro)).toString() !==
        event.netMicro ||
      existing.source_digest !== event.sourceDigest)
  )
    throw new Error("Immutable obligation mismatch");
  if (
    event.kind === "paid" &&
    (!existing ||
      (existing.state === "paid" &&
        existing.paid_transaction !== event.transactionId))
  )
    throw new Error("Unknown or duplicate payout");
  // A payout to a wallet the contributor never authorized means the identity
  // authority was misused. Fail closed so it is investigated, not recorded.
  if (event.kind === "paid") {
    if (!event.destination) throw new Error("Payout destination missing");
    const authorized = await db
      .prepare(
        "SELECT 1 ok FROM wallet_claims w JOIN payment_wallet_authorizations a ON a.claim_id=w.id AND a.github_user_id=w.github_user_id WHERE w.github_user_id=? AND w.chain=? AND (CASE WHEN w.chain='base' THEN lower(w.wallet_address)=lower(?) ELSE w.wallet_address=? END)",
      )
      .bind(
        event.githubUserId,
        event.chain,
        event.destination,
        event.destination,
      )
      .first<{ ok: number }>();
    if (!authorized)
      throw new Error(
        "Payout destination is not an authorized contributor wallet",
      );
  }
  const prior = await db
    .prepare(
      "SELECT evidence_json FROM payment_events WHERE network=? AND transaction_id=? AND event_index=?",
    )
    .bind(event.network, event.transactionId, event.eventIndex)
    .first<{ evidence_json: string }>();
  const evidence = JSON.stringify(event);
  if (prior) {
    if (prior.evidence_json !== evidence)
      throw new Error("Conflicting finalized event");
    return;
  }
  const statements = [
    db
      .prepare("INSERT INTO payment_events VALUES(?,?,?,?,?,?,?,?)")
      .bind(
        event.network,
        event.transactionId,
        event.eventIndex,
        event.blockId,
        event.kind,
        event.obligationId,
        evidence,
        now,
      ),
  ];
  if (event.kind === "reserved") {
    statements.push(
      db
        .prepare(
          "INSERT INTO payment_obligations VALUES(?,?,?,?,?,?,?,?,?,'reserved',?,NULL) ON CONFLICT(id) DO NOTHING",
        )
        .bind(
          event.obligationId,
          event.projectId,
          event.githubUserId,
          event.network,
          event.chain,
          event.vault,
          event.grossMicro,
          event.feeMicro,
          event.sourceDigest,
          now,
        ),
    );
    statements.push(
      db
        .prepare(
          "INSERT INTO payment_outbox(obligation_id,state,updated_at) SELECT o.id,'ready',? FROM payment_obligations o JOIN wallet_claims w ON w.github_user_id=o.github_user_id AND w.chain=o.chain JOIN payment_wallet_authorizations a ON a.claim_id=w.id WHERE o.id=? AND NOT EXISTS(SELECT 1 FROM wallet_claims n WHERE n.supersedes_claim_id=w.id) ON CONFLICT(obligation_id) DO NOTHING",
        )
        .bind(now, event.obligationId),
    );
  } else {
    statements.push(
      db
        .prepare(
          "UPDATE payment_obligations SET state='paid',paid_transaction=? WHERE id=? AND state='reserved'",
        )
        .bind(event.transactionId, event.obligationId),
    );
    statements.push(
      db
        .prepare(
          "UPDATE payment_outbox SET state='paid',lease_token=NULL,lease_until=NULL,updated_at=? WHERE obligation_id=?",
        )
        .bind(now, event.obligationId),
    );
    statements.push(
      db
        .prepare(
          "UPDATE payment_attempts SET state='finalized' WHERE obligation_id=? AND transaction_id=?",
        )
        .bind(event.obligationId, event.transactionId),
    );
  }
  const result = await db.batch(statements);
  if (result.some((r) => !r.success))
    throw new Error("Payment event transaction failed");
}
