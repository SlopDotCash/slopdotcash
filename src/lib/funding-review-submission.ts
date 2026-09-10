/** GitHub handoff only: candidates convey proposed changes, never approval. */
import {
  assertRewardAllocationManifest,
  MINIMUM_TRANSFER_MINOR,
  REVIEW_WINDOW_DAYS,
  type RewardAllocationManifest,
} from "./rewards";

export interface FundingReviewSubmission {
  schemaVersion: "1";
  kind: "funding-review-submission";
  projectId: string;
  cycleId: string;
  /** Lowercase SHA-256 of the exact source file bytes, not reserialized JSON. */
  sourceProposalSha256: string;
  adjustments: FundingReviewAdjustment[];
}

export interface FundingReviewAdjustment {
  actorId: string;
  decision: "include" | "exclude";
  /** Total proposed USDC micro-units, including any retained review line. */
  amountMinor: string;
  reason: string;
}

function object(value: unknown, keys: string[], label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(`${label} must be an object`);
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(row, key))
  )
    throw new TypeError(
      `${label} has missing or forbidden fields (wallets and approval cannot be submitted)`,
    );
  return row;
}

export function assertFundingReviewSubmission(
  value: unknown,
): FundingReviewSubmission {
  const row = object(
    value,
    [
      "schemaVersion",
      "kind",
      "projectId",
      "cycleId",
      "sourceProposalSha256",
      "adjustments",
    ],
    "submission",
  );
  if (
    row.schemaVersion !== "1" ||
    row.kind !== "funding-review-submission" ||
    typeof row.projectId !== "string" ||
    !row.projectId ||
    typeof row.cycleId !== "string" ||
    !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(row.cycleId) ||
    typeof row.sourceProposalSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(row.sourceProposalSha256) ||
    !Array.isArray(row.adjustments)
  )
    throw new TypeError("Invalid funding review submission header");
  const actors = new Set<string>();
  const adjustments = row.adjustments.map((value): FundingReviewAdjustment => {
    const adjustment = object(
      value,
      ["actorId", "decision", "amountMinor", "reason"],
      "adjustment",
    );
    if (
      typeof adjustment.actorId !== "string" ||
      !adjustment.actorId ||
      (adjustment.decision !== "include" &&
        adjustment.decision !== "exclude") ||
      typeof adjustment.amountMinor !== "string" ||
      !/^(0|[1-9]\d{0,19})$/u.test(adjustment.amountMinor) ||
      typeof adjustment.reason !== "string"
    )
      throw new TypeError("Invalid review adjustment or integer amount");
    if (actors.has(adjustment.actorId))
      throw new TypeError("Duplicate actor in review submission");
    actors.add(adjustment.actorId);
    const reason = adjustment.reason.trim();
    if (reason && (reason.length < 12 || reason.length > 1000))
      throw new TypeError("Public reason must contain 12 to 1000 characters");
    if (
      adjustment.decision === "exclude" &&
      (adjustment.amountMinor !== "0" || !reason)
    )
      throw new TypeError("Exclusions require zero amount and a public reason");
    return {
      actorId: adjustment.actorId,
      decision: adjustment.decision,
      amountMinor: adjustment.amountMinor,
      reason,
    };
  });
  return {
    schemaVersion: "1",
    kind: "funding-review-submission",
    projectId: row.projectId,
    cycleId: row.cycleId,
    sourceProposalSha256: row.sourceProposalSha256,
    adjustments,
  };
}

/** Browser-compatible digest helper; callers must supply original fetched bytes. */
export async function fundingReviewProposalSha256(
  source: Uint8Array,
): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(source));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** The clock is execution context, deliberately not a user-controlled JSON field. */
export async function applyFundingReviewSubmission(
  source: Uint8Array,
  untrustedSubmission: unknown,
  now = Date.now(),
): Promise<RewardAllocationManifest> {
  // Freeze caller-owned bytes before the asynchronous digest, so validation
  // and parsing always consume the same source even if the caller reuses it.
  source = new Uint8Array(source);
  const submission = assertFundingReviewSubmission(untrustedSubmission);
  if (
    (await fundingReviewProposalSha256(source)) !==
    submission.sourceProposalSha256
  )
    throw new TypeError(
      "Stale source proposal SHA-256; export against the current exact proposal bytes",
    );
  const proposal = assertRewardAllocationManifest(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(source)),
  );
  if (
    proposal.projectId !== submission.projectId ||
    proposal.cycleId !== submission.cycleId
  )
    throw new TypeError(
      "Submission project/cycle does not match source proposal",
    );
  if (proposal.status !== "proposed")
    throw new TypeError("Only proposed manifests can be reviewed");
  if (
    !Number.isFinite(now) ||
    now < Date.parse(proposal.review.lastMaterialChangeAt) ||
    now >= Date.parse(proposal.review.endsAt)
  )
    throw new RangeError("Proposal review is expired or has not started");
  if (
    proposal.totals.approvedMinor !== "0" ||
    proposal.totals.feeMinor !== "0" ||
    proposal.allocations.some(
      (row) =>
        row.approvedMinor !== "0" ||
        row.state === "approved" ||
        row.platformApproval !== null,
    )
  )
    throw new TypeError(
      "Review submission requires zero approved amounts and no approval authority",
    );
  const byActor = new Map(
    submission.adjustments.map((row) => [row.actorId, row]),
  );
  const known = new Set(proposal.allocations.map((row) => row.actor.id));
  if (submission.adjustments.some((row) => !known.has(row.actorId)))
    throw new TypeError("Unknown actor in review submission");
  let material = false;
  const allocations = proposal.allocations.map((row) => {
    const adjustment = byActor.get(row.actor.id);
    if (!adjustment) return row;
    const excluded = adjustment.decision === "exclude";
    const changed =
      adjustment.amountMinor !== row.suggestedMinor ||
      excluded !== (row.state === "excluded");
    if (changed && !adjustment.reason)
      throw new TypeError("Material changes require a public reason");
    if (!changed)
      return adjustment.reason
        ? { ...row, adjustmentReason: adjustment.reason }
        : row;
    if (row.state === "held" || row.hold)
      throw new TypeError(
        "Held allocations require their separate resolution contract",
      );
    material = true;
    const amount = BigInt(adjustment.amountMinor);
    const reviewMinor = excluded
      ? 0n
      : BigInt(row.lines?.reviewBudget.suggestedMinor ?? "0");
    if (amount < reviewMinor)
      throw new RangeError(
        "Included amount cannot reduce the separate review-budget line",
      );
    return {
      ...row,
      suggestedMinor: adjustment.amountMinor,
      ...(row.accruedMinor === undefined
        ? {}
        : { accruedMinor: adjustment.amountMinor }),
      adjustmentReason: adjustment.reason,
      state: excluded
        ? ("excluded" as const)
        : !row.wallet
          ? ("unclaimed" as const)
          : row.accruedMinor !== undefined &&
              amount < BigInt(MINIMUM_TRANSFER_MINOR)
            ? ("held-below-minimum" as const)
            : ("proposed" as const),
      ...(row.lines
        ? {
            lines: {
              sharedPool: {
                ...row.lines.sharedPool,
                suggestedMinor: (amount - reviewMinor).toString(),
              },
              reviewBudget: {
                ...row.lines.reviewBudget,
                suggestedMinor: reviewMinor.toString(),
              },
            },
          }
        : {}),
    };
  });
  const sharedTotal = allocations.reduce(
    (sum, row) =>
      sum + BigInt(row.lines?.sharedPool.suggestedMinor ?? row.suggestedMinor),
    0n,
  );
  // Carry is already-earned principal, not an increase to the current monthly cap.
  if (
    sharedTotal >
    BigInt(proposal.capMinor) + BigInt(proposal.carriedMinor ?? "0")
  )
    throw new RangeError(
      "Proposed amounts exceed the monthly cap plus existing carry",
    );
  const suggestedMinor = allocations
    .reduce((sum, row) => sum + BigInt(row.suggestedMinor), 0n)
    .toString();
  return assertRewardAllocationManifest({
    ...proposal,
    allocations,
    review: material
      ? {
          days: REVIEW_WINDOW_DAYS,
          lastMaterialChangeAt: new Date(now).toISOString(),
          endsAt: new Date(now + REVIEW_WINDOW_DAYS * 86_400_000).toISOString(),
        }
      : proposal.review,
    ...(proposal.rewardLines
      ? {
          rewardLines: {
            sharedPool: {
              ...proposal.rewardLines.sharedPool,
              suggestedMinor: sharedTotal.toString(),
            },
            reviewBudget: {
              ...proposal.rewardLines.reviewBudget,
              suggestedMinor: allocations
                .reduce(
                  (sum, row) =>
                    sum + BigInt(row.lines?.reviewBudget.suggestedMinor ?? "0"),
                  0n,
                )
                .toString(),
            },
          },
        }
      : {}),
    totals: { ...proposal.totals, suggestedMinor },
  });
}

/** Export a validated app handoff using exact fetched proposal bytes. */
export async function createFundingReviewSubmission(
  source: Uint8Array,
  adjustments: readonly FundingReviewAdjustment[],
  now = Date.now(),
): Promise<FundingReviewSubmission> {
  source = new Uint8Array(source);
  const proposal = assertRewardAllocationManifest(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(source)),
  );
  const submission = assertFundingReviewSubmission({
    schemaVersion: "1",
    kind: "funding-review-submission",
    projectId: proposal.projectId,
    cycleId: proposal.cycleId,
    sourceProposalSha256: await fundingReviewProposalSha256(source),
    adjustments: [...adjustments],
  });
  await applyFundingReviewSubmission(source, submission, now);
  return submission;
}
