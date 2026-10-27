import { chainFamily } from "../../src/lib/escrow-policy.mjs";
import {
  acceptsPayoutFee,
  isBaseUnits,
  type PaymentChain,
  type PayoutPolicy,
} from "../../src/lib/payments/contracts";
import type { D1TransactionalDatabase as D1Database, D1Statement } from "../d1";
import {
  notifyAwardReserved,
  notifyPaymentPaid,
} from "../notifications/events";

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
  /** Historical names; the values are base units of the vault asset. */
  grossMicro: string;
  netMicro: string;
  feeMicro: string;
  sourceDigest: string;
  destination?: string;
}
/** The facts of a stored finalized event, compared field by field. */
function evidenceFacts(value: Record<string, unknown>) {
  return JSON.stringify([
    value.kind,
    value.transactionId,
    value.eventIndex,
    value.blockId,
    value.obligationId,
    value.projectId,
    value.network,
    value.chain,
    value.vault,
    value.githubUserId,
    value.grossMicro,
    value.netMicro,
    value.feeMicro,
    value.sourceDigest,
    value.destination ?? null,
  ]);
}
/** Adapters must independently fetch canonical finalized chain evidence. */
export interface PaymentChainAdapter {
  /** The one reviewed deployment this adapter verifies. With it, evidence already stored for
   * that deployment is not verified again, so re-scans never depend on today's registry. */
  deployment?: { projectId: string; network: string; vault: string };
  verifyFinalized(input: {
    transactionId: string;
    eventIndex: number;
    kind: "reserved" | "paid";
    obligationId: string;
  }): Promise<FinalizedPaymentEvent>;
}
export interface PaymentLedgerPolicy {
  payoutPolicy: PayoutPolicy;
  authorize: (
    event: FinalizedPaymentEvent,
    asset: { asset_address: string; asset_decimals: number },
  ) => Promise<void>;
  notices: (
    event: FinalizedPaymentEvent,
    now: string,
  ) => Promise<D1Statement[]>;
}
/** Only an adapter result may enter the ledger. Public handlers cannot call this with a body. */
export async function indexPaymentEvent(
  db: D1Database,
  adapter: PaymentChainAdapter,
  input: Parameters<PaymentChainAdapter["verifyFinalized"]>[0],
  now: string,
  policy?: PaymentLedgerPolicy,
): Promise<void> {
  const scope = adapter.deployment;
  if (scope) {
    const stored = await db
      .prepare(
        "SELECT kind,obligation_id,evidence_json FROM payment_events WHERE network=? AND transaction_id=? AND event_index=?",
      )
      .bind(scope.network, input.transactionId, input.eventIndex)
      .first<{ kind: string; obligation_id: string; evidence_json: string }>();
    if (stored) {
      const evidence = JSON.parse(stored.evidence_json) as Record<
        string,
        unknown
      >;
      // This exact event was verified and recorded atomically when it was
      // first indexed. A changed field falls through and fails as a conflict.
      if (
        stored.kind === input.kind &&
        stored.obligation_id === input.obligationId &&
        evidence.kind === input.kind &&
        evidence.transactionId === input.transactionId &&
        evidence.eventIndex === input.eventIndex &&
        evidence.obligationId === input.obligationId &&
        evidence.projectId === scope.projectId &&
        evidence.network === scope.network &&
        evidence.vault === scope.vault
      )
        return;
    }
  }
  const event = await adapter.verifyFinalized(input);
  if (
    event.transactionId !== input.transactionId ||
    event.eventIndex !== input.eventIndex ||
    event.kind !== input.kind ||
    event.obligationId !== input.obligationId ||
    !/^[1-9]\d*$/.test(event.githubUserId) ||
    !isBaseUnits(event.grossMicro) ||
    event.grossMicro === "0" ||
    !/^(0|[1-9]\d*)$/.test(event.feeMicro) ||
    !acceptsPayoutFee(
      BigInt(event.grossMicro),
      BigInt(event.feeMicro),
      policy?.payoutPolicy,
    ) ||
    (BigInt(event.grossMicro) - BigInt(event.feeMicro)).toString() !==
      event.netMicro ||
    !/^[a-f0-9]{64}$/.test(event.sourceDigest)
  )
    throw new Error("Chain event mismatch");
  // The asset and its decimals come from the finalized vault read that the
  // payments worker caches (vault_snapshots), never from the event request.
  const asset = await db
    .prepare(
      "SELECT asset_address,asset_decimals FROM vault_snapshots WHERE project_id=? AND network=? AND vault=?",
    )
    .bind(event.projectId, event.network, event.vault)
    .first<{ asset_address: string; asset_decimals: number }>();
  if (!asset) throw new Error("Finalized vault asset snapshot required");
  await policy?.authorize(event, asset);
  const existing = await db
    .prepare("SELECT * FROM payment_obligations WHERE id=?")
    .bind(event.obligationId)
    .first<{
      project_id: string;
      network: string;
      vault: string;
      asset_address: string;
      asset_decimals: number;
      github_user_id: string;
      gross_base: string;
      fee_base: string;
      source_digest: string;
      state: string;
      paid_transaction: string | null;
    }>();
  if (
    existing &&
    (existing.project_id !== event.projectId ||
      existing.network !== event.network ||
      existing.vault !== event.vault ||
      existing.asset_address !== asset.asset_address ||
      existing.asset_decimals !== asset.asset_decimals ||
      existing.github_user_id !== event.githubUserId ||
      existing.gross_base !== event.grossMicro ||
      existing.fee_base !== event.feeMicro ||
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
        "SELECT 1 ok FROM wallet_claims w JOIN payment_wallet_authorizations a ON a.claim_id=w.id AND a.github_user_id=w.github_user_id WHERE w.github_user_id=? AND w.chain=? AND (CASE WHEN ?=1 THEN lower(w.wallet_address)=lower(?) ELSE w.wallet_address=? END)",
      )
      .bind(
        event.githubUserId,
        event.chain,
        chainFamily(event.chain) === "evm" ? 1 : 0,
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
  const evidence = JSON.stringify({
    ...event,
    assetAddress: asset.asset_address,
    assetDecimals: asset.asset_decimals,
  });
  if (prior) {
    const stored = JSON.parse(prior.evidence_json) as Record<string, unknown>;
    if (
      evidenceFacts(stored) !==
        evidenceFacts(event as unknown as Record<string, unknown>) ||
      (stored.assetAddress !== undefined &&
        (stored.assetAddress !== asset.asset_address ||
          stored.assetDecimals !== asset.asset_decimals))
    )
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
          "INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at,paid_transaction) VALUES(?,?,?,?,?,?,?,?,?,?,?,'reserved',?,NULL) ON CONFLICT(id) DO NOTHING",
        )
        .bind(
          event.obligationId,
          event.projectId,
          event.githubUserId,
          event.network,
          event.chain,
          event.vault,
          asset.asset_address,
          asset.asset_decimals,
          event.grossMicro,
          event.feeMicro,
          event.sourceDigest,
          now,
        ),
    );
    statements.push(
      db
        .prepare(
          "INSERT INTO payment_outbox(obligation_id,state,updated_at) SELECT o.id,'ready',? FROM payment_obligations o JOIN effective_payment_wallet_claims w ON w.github_user_id=o.github_user_id AND w.chain=o.chain JOIN payment_wallet_authorizations a ON a.claim_id=w.id WHERE o.id=? ON CONFLICT(obligation_id) DO NOTHING",
        )
        .bind(now, event.obligationId),
    );
    if (!policy)
      statements.push(notifyAwardReserved(db, event.obligationId, now));
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
    if (!policy)
      statements.push(
        notifyPaymentPaid(db, event.obligationId, event.transactionId, now),
      );
  }
  if (policy) statements.push(...(await policy.notices(event, now)));
  const result = await db.batch(statements);
  if (result.some((r) => !r.success))
    throw new Error("Payment event transaction failed");
}
