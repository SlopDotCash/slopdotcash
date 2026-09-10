/** Global immutable payment records, never a project inventory or approval.
 * V1 has no retirement or expiry: every accepted instrument and intent remains
 * reserved indefinitely. Policy changes and signer loss cannot erase it. */

import { assertFreshCyclePaymentPolicy } from "./funding-readiness";
import { fundingReviewProposalSha256 } from "./funding-review-submission";
import { assertRewardAllocationManifest } from "./rewards";
import { createSettlementExecutionPlan } from "./settlement-plan";

export const PAYMENT_RESERVATION_PATH = "funding/payment-reservations.json";
export const PAYMENT_RESERVATION_CHECK = "Trusted payment reservation gate";
export interface PaymentReservation {
  schemaVersion: "1";
  kind: "payment-reservation";
  projectId: string;
  cycleId: string;
  instrumentId: string;
  allocationSha256: string;
  policySha256: string;
  planSha256: string;
  reservedAt: string;
  principalMinor: string;
  feeMinor: string;
  intentIds: string[];
}
export const paymentRecordBytes = (value: unknown): Uint8Array =>
  new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
const HASH = /^[a-f0-9]{64}$/u;
const KEYS =
  "allocationSha256,cycleId,feeMinor,instrumentId,intentIds,kind,planSha256,policySha256,principalMinor,projectId,reservedAt,schemaVersion";
function assertReservation(value: unknown): PaymentReservation {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Invalid reservation");
  const r = value as PaymentReservation;
  if (
    Object.keys(r).sort().join() !== KEYS ||
    r.schemaVersion !== "1" ||
    r.kind !== "payment-reservation" ||
    typeof r.projectId !== "string" ||
    !/^[a-z0-9][a-z0-9-]{0,47}$/u.test(r.projectId) ||
    typeof r.cycleId !== "string" ||
    !/^\d{4}-(0[1-9]|1[0-2])$/u.test(r.cycleId) ||
    typeof r.instrumentId !== "string" ||
    !/^squads-v4-vault:solana:[1-9A-HJ-NP-Za-km-z]{32,44}:(0|[1-9][0-9]{0,2}):[1-9A-HJ-NP-Za-km-z]{32,44}$/u.test(
      r.instrumentId,
    ) ||
    Number(r.instrumentId.split(":")[3]) > 255 ||
    ![r.allocationSha256, r.policySha256, r.planSha256].every(
      (h) => typeof h === "string" && HASH.test(h),
    ) ||
    typeof r.reservedAt !== "string" ||
    !Number.isFinite(Date.parse(r.reservedAt)) ||
    new Date(r.reservedAt).toISOString() !== r.reservedAt ||
    typeof r.principalMinor !== "string" ||
    !/^[1-9]\d{0,19}$/u.test(r.principalMinor) ||
    typeof r.feeMinor !== "string" ||
    !/^(0|[1-9]\d{0,19})$/u.test(r.feeMinor) ||
    !Array.isArray(r.intentIds) ||
    r.intentIds.length < 1 ||
    r.intentIds.length > 199 ||
    r.intentIds.some(
      (id) => typeof id !== "string" || !/^[A-Za-z0-9_-]{1,160}$/u.test(id),
    )
  )
    throw new TypeError("Invalid reservation fields");
  return {
    schemaVersion: r.schemaVersion,
    kind: r.kind,
    projectId: r.projectId,
    cycleId: r.cycleId,
    instrumentId: r.instrumentId,
    allocationSha256: r.allocationSha256,
    policySha256: r.policySha256,
    planSha256: r.planSha256,
    reservedAt: r.reservedAt,
    principalMinor: r.principalMinor,
    feeMinor: r.feeMinor,
    intentIds: [...r.intentIds],
  };
}
export function assertPaymentReservationLedger(
  value: unknown,
): PaymentReservation[] {
  if (!Array.isArray(value) || value.length > 24000)
    throw new TypeError("Invalid global reservation ledger");
  const rows = value.map(assertReservation);
  const used = new Set<string>();
  for (const r of rows) {
    for (const key of [
      `plan:${r.planSha256}`,
      `allocation:${r.allocationSha256}`,
      `instrument:${r.instrumentId}`,
      `cycle:${r.projectId}:${r.cycleId}`,
      ...r.intentIds.map((id) => `intent:${id}`),
    ]) {
      if (used.has(key))
        throw new TypeError(
          "Reservation conflict or replay; accepted money remains reserved",
        );
      used.add(key);
    }
  }
  return rows;
}
export function parsePaymentReservationLedger(
  bytes: Uint8Array,
): PaymentReservation[] {
  if (bytes.byteLength > 16 * 1024 * 1024)
    throw new TypeError("Reservation ledger exceeds byte bound");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const rows = assertPaymentReservationLedger(JSON.parse(text));
  if (text !== new TextDecoder().decode(paymentRecordBytes(rows)))
    throw new TypeError(
      "Noncanonical reservation bytes or duplicate JSON keys",
    );
  return rows;
}
export function assertPaymentReservationTransition(
  base: unknown,
  head: unknown,
): PaymentReservation[] {
  const prior = assertPaymentReservationLedger(base);
  const next = assertPaymentReservationLedger(head);
  if (
    next.length < prior.length ||
    next.length > prior.length + 1 ||
    prior.some((r, i) => JSON.stringify(r) !== JSON.stringify(next[i]))
  )
    throw new TypeError(
      "Reservation ledger requires an exact append-only prefix and at most one new plan",
    );
  return next;
}
/** Pure drafting helper. Output is a reservation proposal, NOT released plan bytes.
 * Trusted transition validates policy and allocation from immutable base blobs. */
export async function draftPaymentReservation(
  allocationBytes: Uint8Array,
  policyValue: unknown,
  reservedAt: string,
): Promise<PaymentReservation> {
  const source = new Uint8Array(allocationBytes);
  const policy = assertFreshCyclePaymentPolicy(policyValue);
  const allocation = assertRewardAllocationManifest(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(source)),
  );
  if (
    allocation.projectId !== policy.projectId ||
    allocation.cycleId !== policy.cycleId ||
    !allocation.fundingBasis?.instrumentId?.startsWith(
      "squads-v4-vault:solana:",
    ) ||
    allocation.fundingBasis.fundingState !== "committed" ||
    allocation.status !== "approved" ||
    !allocation.approvedAt ||
    reservedAt < allocation.approvedAt ||
    reservedAt < policy.effectiveAt ||
    reservedAt >= policy.planningExpiresAt ||
    policy.effectiveAt >= allocation.generatedAt ||
    (allocation.carriedMinor !== undefined &&
      allocation.carriedMinor !== "0") ||
    allocation.rewardLines ||
    allocation.allocations.some((r) => r.lines)
  )
    throw new TypeError(
      "Reservation requires exact approved fresh-cycle allocation and pre-freeze policy without carry or review budget",
    );
  const allocationSha256 = await fundingReviewProposalSha256(source);
  const plan = createSettlementExecutionPlan({
    allocation,
    allocationSha256,
    createdAt: reservedAt,
    feeRecipient: policy.feeRecipient,
    sourceOwner: allocation.fundingBasis.instrumentId.split(":")[4],
  });
  return assertReservation({
    schemaVersion: "1",
    kind: "payment-reservation",
    projectId: allocation.projectId,
    cycleId: allocation.cycleId,
    instrumentId: allocation.fundingBasis.instrumentId,
    allocationSha256,
    policySha256: await fundingReviewProposalSha256(paymentRecordBytes(policy)),
    planSha256: await fundingReviewProposalSha256(paymentRecordBytes(plan)),
    reservedAt,
    principalMinor: plan.totals.contributorMinor,
    feeMinor: plan.totals.platformFeeMinor,
    intentIds: plan.transfers.flatMap((t) => t.intentIds),
  });
}
/** Exact deterministic reconstruction, never a new timestamp, wallet, or intent. */
export async function reservedPlanBytes(
  reservation: PaymentReservation,
  allocationBytes: Uint8Array,
  policy: unknown,
): Promise<Uint8Array> {
  const expected = await draftPaymentReservation(
    allocationBytes,
    policy,
    reservation.reservedAt,
  );
  if (
    JSON.stringify(expected) !== JSON.stringify(assertReservation(reservation))
  )
    throw new TypeError(
      "Reservation no longer matches exact frozen plan inputs",
    );
  const allocation = assertRewardAllocationManifest(
    JSON.parse(new TextDecoder().decode(allocationBytes)),
  );
  return paymentRecordBytes(
    createSettlementExecutionPlan({
      allocation,
      allocationSha256: expected.allocationSha256,
      createdAt: expected.reservedAt,
      feeRecipient: assertFreshCyclePaymentPolicy(policy).feeRecipient,
      sourceOwner: expected.instrumentId.split(":")[4],
    }),
  );
}
