/**
 * Validators for historical escrow-v2 cycle documents. Monthly awards now use
 * private allocations and a frozen execution snapshot
 * (backend/payments/monthly.ts); published decisions, public adjustment
 * reasons and the 14-day review period no longer gate a commitment. These
 * checks keep old cycle records verifiable under the rules they were made
 * under.
 */

import { MAX_BASE_UNITS } from "../escrow-policy.mjs";
import type { assertProjectDefinition } from "../project-schema.mjs";
import { CANONICAL_UINT } from "../record-validation.mjs";

interface EscrowReviewProposal {
  projectId: string;
  cycleId: string;
  grossCapMicro: string;
  awards: { githubUserId: string; grossMicro: string; sourceDigest: string }[];
}
interface EscrowDecision {
  githubUserId: string;
  state: "approved" | "held" | "excluded";
  approvedGrossMicro: string;
  adjustmentReason: string | null;
  relatedParty: boolean;
}
interface EscrowDecisions {
  schemaVersion: "1";
  proposalSha256: string;
  rows: EscrowDecision[];
}
function exact(value: unknown, fields: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join() !== fields.sort().join()
  )
    throw new Error("Invalid reviewed decision fields");
  return value as Record<string, unknown>;
}
/** A historical decision file under its original public-reason and related-party rules. */
export function assertEscrowDecisions(
  value: unknown,
  proposal: EscrowReviewProposal,
  proposalSha256: string,
  stewardActorId: string | readonly string[],
): EscrowDecisions {
  const stewards = new Set(
    typeof stewardActorId === "string" ? [stewardActorId] : stewardActorId,
  );
  const record = exact(value, ["schemaVersion", "proposalSha256", "rows"]);
  if (
    record.schemaVersion !== "1" ||
    record.proposalSha256 !== proposalSha256 ||
    !Array.isArray(record.rows) ||
    record.rows.length !== proposal.awards.length
  )
    throw new Error("Decisions must cover the exact proposal");
  const awards = new Map(proposal.awards.map((a) => [a.githubUserId, a]));
  const seen = new Set<string>();
  let approved = 0n;
  for (const item of record.rows) {
    const row = exact(item, [
      "githubUserId",
      "state",
      "approvedGrossMicro",
      "adjustmentReason",
      "relatedParty",
    ]);
    if (
      typeof row.githubUserId !== "string" ||
      seen.has(row.githubUserId) ||
      !awards.has(row.githubUserId) ||
      !["approved", "held", "excluded"].includes(String(row.state)) ||
      typeof row.approvedGrossMicro !== "string" ||
      !CANONICAL_UINT.test(row.approvedGrossMicro) ||
      typeof row.relatedParty !== "boolean"
    )
      throw new Error("Invalid actor or decision");
    seen.add(row.githubUserId);
    const amount = BigInt(row.approvedGrossMicro),
      award = awards.get(row.githubUserId);
    if (
      !award ||
      amount > MAX_BASE_UNITS ||
      (row.state !== "approved" && amount !== 0n)
    )
      throw new Error("Invalid approved gross amount");
    if (
      row.adjustmentReason !== null &&
      (typeof row.adjustmentReason !== "string" || !row.adjustmentReason.trim())
    )
      throw new Error("Invalid adjustment reason");
    if (row.approvedGrossMicro !== award.grossMicro && !row.adjustmentReason)
      throw new Error("Award changes require a public reason");
    if (stewards.has(row.githubUserId) && row.relatedParty !== true)
      throw new Error("Project steward is a related party");
    approved += amount;
  }
  if (approved > BigInt(proposal.grossCapMicro))
    throw new Error("Reviewed awards exceed the gross cap");
  return record as unknown as EscrowDecisions;
}
/** The vault's financial terms still match those that sized an earlier proposal. */
export function assertEscrowFinancialPolicy(
  current: ReturnType<typeof assertProjectDefinition>,
  archived: ReturnType<typeof assertProjectDefinition>,
) {
  if (
    !current.escrow ||
    !archived.escrow ||
    [
      "chain",
      "effectiveCycle",
      "feeMode",
      "feeBasisPoints",
      "withdrawalFeeBasisPoints",
    ].some(
      (key) =>
        current.escrow?.[key as keyof typeof current.escrow] !==
        archived.escrow?.[key as keyof typeof archived.escrow],
    )
  )
    throw new Error(
      "Current escrow financial policy differs from the reviewed archive",
    );
}
