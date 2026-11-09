/** Each slot contains JSON.stringify([the original fact]), not a coerced ID. */
export interface PaymentEvidenceFacts {
  kind: string;
  transactionId: string;
  eventIndex: string;
  blockId: string;
  obligationId: string;
  projectId: string;
  network: string;
  chain: string;
  vault: string;
  githubUserId: string;
  grossMicro: string;
  netMicro: string;
  feeMicro: string;
  sourceDigest: string;
  destination: string;
}

/** Complete agreement of the original fifteen evidence facts. */
//@ verify
//@ pure
//@ ensures \result <==> a.kind == b.kind && a.transactionId == b.transactionId && a.eventIndex == b.eventIndex && a.blockId == b.blockId && a.obligationId == b.obligationId && a.projectId == b.projectId && a.network == b.network && a.chain == b.chain && a.vault == b.vault && a.githubUserId == b.githubUserId && a.grossMicro == b.grossMicro && a.netMicro == b.netMicro && a.feeMicro == b.feeMicro && a.sourceDigest == b.sourceDigest && a.destination == b.destination
export function paymentEvidenceMatches(
  a: PaymentEvidenceFacts,
  b: PaymentEvidenceFacts,
): boolean {
  return (
    a.kind === b.kind &&
    a.transactionId === b.transactionId &&
    a.eventIndex === b.eventIndex &&
    a.blockId === b.blockId &&
    a.obligationId === b.obligationId &&
    a.projectId === b.projectId &&
    a.network === b.network &&
    a.chain === b.chain &&
    a.vault === b.vault &&
    a.githubUserId === b.githubUserId &&
    a.grossMicro === b.grossMicro &&
    a.netMicro === b.netMicro &&
    a.feeMicro === b.feeMicro &&
    a.sourceDigest === b.sourceDigest &&
    a.destination === b.destination
  );
}

export interface PaymentAssetIdentity {
  asset_address: string;
  asset_decimals: number;
}

export type StoredPaymentAsset =
  | { kind: "legacy" }
  | { kind: "incompatible" }
  | { kind: "bound"; address: string; decimals: number };

//@ verify
//@ pure
//@ ensures \result <==> stored.kind == "legacy" || (stored.kind == "bound" && stored.address == expected.asset_address && stored.decimals == expected.asset_decimals)
export function paymentAssetMatches(
  stored: StoredPaymentAsset,
  expected: PaymentAssetIdentity,
): boolean {
  return (
    stored.kind === "legacy" ||
    (stored.kind === "bound" &&
      stored.address === expected.asset_address &&
      stored.decimals === expected.asset_decimals)
  );
}

export interface PaymentEventIdentity {
  kind: string;
  transactionId: string;
  projectId: string;
  network: string;
  vault: string;
  githubUserId: string;
  grossMicro: string;
  feeMicro: string;
  sourceDigest: string;
}

export interface PaymentObligationIdentity {
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
}

export type RecordedPaymentReference =
  | { kind: "missing" }
  | { kind: "recorded"; transactionId: string };

export type StoredPaymentObligation =
  | { kind: "missing" }
  | {
      kind: "stored";
      record: PaymentObligationIdentity;
      paid: RecordedPaymentReference;
    };

//@ verify
//@ pure
//@ ensures \result <==> record.project_id == event.projectId && record.network == event.network && record.vault == event.vault && record.asset_address == asset.asset_address && record.asset_decimals == asset.asset_decimals && record.github_user_id == event.githubUserId && record.gross_base == event.grossMicro && record.fee_base == event.feeMicro && record.source_digest == event.sourceDigest
function obligationIdentityMatches(
  record: PaymentObligationIdentity,
  event: PaymentEventIdentity,
  asset: PaymentAssetIdentity,
): boolean {
  return (
    record.project_id === event.projectId &&
    record.network === event.network &&
    record.vault === event.vault &&
    record.asset_address === asset.asset_address &&
    record.asset_decimals === asset.asset_decimals &&
    record.github_user_id === event.githubUserId &&
    record.gross_base === event.grossMicro &&
    record.fee_base === event.feeMicro &&
    record.source_digest === event.sourceDigest
  );
}

/** Identity conflicts precede a missing or differently paid obligation. */
//@ verify
//@ pure
//@ ensures \result == "immutable-mismatch" <==> prior.kind == "stored" && !obligationIdentityMatches(prior.record, event, asset)
//@ ensures \result == "payout-mismatch" <==> (prior.kind == "missing" || obligationIdentityMatches(prior.record, event, asset)) && event.kind == "paid" && (prior.kind == "missing" || (prior.record.state == "paid" && (prior.paid.kind == "missing" || prior.paid.transactionId != event.transactionId)))
//@ ensures \result == "ready" <==> (prior.kind == "missing" || obligationIdentityMatches(prior.record, event, asset)) && (event.kind != "paid" || (prior.kind == "stored" && (prior.record.state != "paid" || (prior.paid.kind == "recorded" && prior.paid.transactionId == event.transactionId))))
//@ ensures \result == "ready" ==> event.kind != "paid" || prior.kind == "stored"
export function paymentObligationDecision(
  prior: StoredPaymentObligation,
  event: PaymentEventIdentity,
  asset: PaymentAssetIdentity,
): "immutable-mismatch" | "payout-mismatch" | "ready" {
  if (
    prior.kind === "stored" &&
    !obligationIdentityMatches(prior.record, event, asset)
  )
    return "immutable-mismatch";
  if (
    event.kind === "paid" &&
    (prior.kind === "missing" ||
      (prior.record.state === "paid" &&
        (prior.paid.kind === "missing" ||
          prior.paid.transactionId !== event.transactionId)))
  )
    return "payout-mismatch";
  return "ready";
}

export interface VaultCounterHeader {
  block: bigint;
  asset: string;
  decimals: number;
}

/** An older block is ignored before any asset or cumulative-counter check. */
//@ verify
//@ pure
//@ ensures \result == "older" <==> incoming.block < prior.block
//@ ensures \result == "asset-changed" <==> incoming.block >= prior.block && (incoming.asset != prior.asset || incoming.decimals != prior.decimals)
//@ ensures \result == "compare" <==> incoming.block >= prior.block && incoming.asset == prior.asset && incoming.decimals == prior.decimals
export function vaultCounterHeader(
  incoming: VaultCounterHeader,
  prior: VaultCounterHeader,
): "older" | "asset-changed" | "compare" {
  if (incoming.block < prior.block) return "older";
  if (incoming.asset !== prior.asset || incoming.decimals !== prior.decimals)
    return "asset-changed";
  return "compare";
}

/** The first decreased counter, or -1 exactly when every counter is monotone. */
//@ verify
//@ requires incoming.length == prior.length
//@ ensures -1 <= \result && \result < incoming.length
//@ ensures \result == -1 <==> forall(i, 0 <= i && i < incoming.length ==> incoming[i] >= prior[i])
//@ ensures \result >= 0 ==> incoming[\result] < prior[\result] && forall(i, 0 <= i && i < \result ==> incoming[i] >= prior[i])
export function firstDecreasedCounter(
  incoming: bigint[],
  prior: bigint[],
): number {
  let i = 0;
  while (i < incoming.length) {
    //@ invariant 0 <= i && i <= incoming.length
    //@ invariant forall(k, 0 <= k && k < i ==> incoming[k] >= prior[k])
    if (incoming[i] < prior[i]) return i;
    i += 1;
  }
  return -1;
}
