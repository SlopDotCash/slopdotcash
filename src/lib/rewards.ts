/**
 * Validates public reward-allocation, external-share, and settlement manifests.
 * All monetary values remain canonical integer minor units and every approved
 * amount is tied to one immutable payout intent.
 */

import { isSolanaTransactionId } from "./funding-address.mjs";
import { assertExactModelIdentity } from "./model-identity";
import { findProject, type ProjectId } from "./projects.mjs";
import { isSolanaAddress, WALLET_CLAIM_REPOSITORY } from "./wallets";

export const REWARD_PROTOCOL_VERSION = "1" as const;
export const REVIEW_WINDOW_DAYS = 14;
export const SHARE_PARTS_TOTAL = 1_000_000;
export const PLATFORM_FEE_BASIS_POINTS = 100 as const;
export const MINIMUM_TRANSFER_MINOR = "2000000" as const;

export type AllocationState =
  | "approved"
  | "excluded"
  | "held"
  | "held-below-minimum"
  | "proposed"
  | "unclaimed";

export interface ProfileReadmeWalletProof {
  address: string;
  chain: "solana";
  observedAt: string;
  sourceCommit: string;
  sourceUrl: string;
}

export interface GithubIssueWalletProof {
  address: string;
  chain: "solana";
  observedAt: string;
  sourceActorId: string;
  sourceBodySha256: string;
  sourceIssueId: string;
  sourceIssueNumber: number;
  sourceUpdatedAt: string;
  sourceUrl: string;
}

export interface SlopDatabaseWalletProof {
  address: string;
  chain: "solana";
  observedAt: string;
  sourceActorId: string;
  sourceClaimId: string;
  sourceRecordSha256: string;
  sourceUrl: string;
}

export type WalletProof =
  | ProfileReadmeWalletProof
  | GithubIssueWalletProof
  | SlopDatabaseWalletProof;

export interface RewardAllocation {
  intentId: string;
  actor: { id: string; login: string };
  score: number;
  suggestedMinor: string;
  accruedMinor?: string;
  approvedMinor: string;
  state: AllocationState;
  wallet: WalletProof | null;
  evidenceEventIds: string[];
  adjustmentReason: string | null;
  relatedParty: boolean;
  platformApproval: {
    reviewer: string;
    approvedAt: string;
  } | null;
  lines?: {
    sharedPool: { suggestedMinor: string; approvedMinor: string };
    reviewBudget: {
      suggestedMinor: string;
      approvedMinor: string;
      evidenceEventIds: string[];
    };
  };
}

export interface RewardAllocationManifest {
  schemaVersion: typeof REWARD_PROTOCOL_VERSION;
  kind: "reward-allocation";
  projectId: string;
  cycleId: string;
  status: "approved" | "proposed";
  generatedAt: string;
  approvedAt: string | null;
  contributionWindow: { from: string; to: string };
  review: {
    days: typeof REVIEW_WINDOW_DAYS;
    lastMaterialChangeAt: string;
    endsAt: string;
  };
  currency: "USDC";
  chain: "solana";
  capMinor: string;
  carriedMinor?: string;
  minimumTransferMinor?: typeof MINIMUM_TRANSFER_MINOR;
  feeBasisPoints: typeof PLATFORM_FEE_BASIS_POINTS;
  scoringRuleVersion: string;
  sourceSnapshotSha256: string;
  allocations: RewardAllocation[];
  rewardLines?: {
    sharedPool: {
      capMinor: string;
      suggestedMinor: string;
      approvedMinor: string;
    };
    reviewBudget: {
      capMinor: string;
      committedMinor: string;
      suggestedMinor: string;
      approvedMinor: string;
    };
  };
  totals: {
    suggestedMinor: string;
    approvedMinor: string;
    feeMinor: string;
  };
}

export interface ExternalContributionShareManifest {
  schemaVersion: typeof REWARD_PROTOCOL_VERSION;
  kind: "external-contribution-share";
  projectId: string;
  cycleId: string;
  status: "provisional";
  generatedAt: string;
  contributionWindow: { from: string; to: string };
  scoringRuleVersion: string;
  sourceSnapshotSha256: string;
  platformSharePartsPerMillion: number;
  entries: Array<{
    actor: { id: string; login: string };
    score: number;
    sharePartsPerMillion: number;
    evidenceEventIds: string[];
  }>;
}

export interface RewardSettlementManifest {
  schemaVersion: typeof REWARD_PROTOCOL_VERSION;
  kind: "reward-settlement";
  projectId: string;
  cycleId: string;
  allocationSha256: string;
  settledAt: string;
  currency: "USDC";
  chain: "solana";
  status: "failed" | "paid" | "partially-paid";
  recipients: Array<{
    intentId: string;
    approvedMinor: string;
    paidMinor: string;
    state: "failed" | "paid" | "pending";
    rewardLines?: {
      sharedPool: { approvedMinor: string; paidMinor: string };
      reviewBudget: { approvedMinor: string; paidMinor: string };
    };
  }>;
  attempts: Array<{
    attemptId: string;
    intentIds: string[];
    signature: string | null;
    state: "broadcast" | "failed" | "finalized";
  }>;
  platformFee: {
    recipient: string | null;
    dueMinor: string;
    paidMinor: string;
    signature: string | null;
    state: "failed" | "not-applicable" | "paid" | "pending" | "reported";
  };
  totals: {
    approvedMinor: string;
    paidMinor: string;
    feeMinor: string;
  };
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  path: string,
): void {
  if (Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) {
    throw new TypeError(`${path} has unexpected or missing fields`);
  }
}

function text(
  value: unknown,
  path: string,
  options: { max?: number; min?: number; pattern?: RegExp } = {},
): string {
  const min = options.min ?? 1;
  const max = options.max ?? 512;
  if (
    typeof value !== "string" ||
    value.length < min ||
    value.length > max ||
    (options.pattern && !options.pattern.test(value))
  ) {
    throw new TypeError(`${path} is invalid`);
  }
  return value;
}

function iso(value: unknown, path: string): string {
  const result = text(value, path, {
    pattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u,
  });
  if (
    !Number.isFinite(Date.parse(result)) ||
    new Date(result).toISOString() !== result
  ) {
    throw new TypeError(`${path} is not a timestamp`);
  }
  return result;
}

function minor(value: unknown, path: string): string {
  const result = text(value, path, { pattern: /^(?:0|[1-9]\d*)$/u });
  BigInt(result);
  return result;
}

function safeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${path} must be a non-negative safe integer`);
  }
  return Number(value);
}

function sha256(value: unknown, path: string): string {
  return text(value, path, { pattern: /^[0-9a-f]{64}$/u });
}

function solanaSignature(value: unknown, path: string): string {
  if (!isSolanaTransactionId(value)) {
    throw new TypeError(`${path} is invalid`);
  }
  return value;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
  return value;
}

function unique(values: readonly string[], path: string): void {
  if (new Set(values).size !== values.length) {
    throw new TypeError(`${path} contains duplicates`);
  }
}

function sumMinor(values: readonly string[]): string {
  return values.reduce((total, value) => total + BigInt(value), 0n).toString();
}

export function feeForPrincipal(
  principalMinor: string,
  basisPoints: number,
): string {
  if (!/^(?:0|[1-9]\d*)$/u.test(principalMinor)) {
    throw new TypeError("principal must be canonical integer minor units");
  }
  if (
    !Number.isSafeInteger(basisPoints) ||
    basisPoints < 0 ||
    basisPoints > 10_000
  ) {
    throw new TypeError(
      "basis points must be an integer from 0 through 10,000",
    );
  }
  return ((BigInt(principalMinor) * BigInt(basisPoints)) / 10_000n).toString();
}

/**
 * Computes only the newly due fee so splitting a settlement cannot change
 * integer rounding or reduce the project's cumulative obligation.
 */
export function incrementalFeeForPrincipal(
  settledBeforeMinor: string,
  batchMinor: string,
  basisPoints: number = PLATFORM_FEE_BASIS_POINTS,
): string {
  const settledBefore = BigInt(settledBeforeMinor);
  const batch = BigInt(batchMinor);
  if (settledBefore < 0n || batch < 0n) {
    throw new RangeError("settled principal cannot be negative");
  }
  if (
    !Number.isSafeInteger(basisPoints) ||
    basisPoints < 0 ||
    basisPoints > 10_000
  ) {
    throw new TypeError(
      "basis points must be an integer from 0 through 10,000",
    );
  }
  return (
    ((settledBefore + batch) * BigInt(basisPoints)) / 10_000n -
    (settledBefore * BigInt(basisPoints)) / 10_000n
  ).toString();
}

function assertActor(
  value: unknown,
  path: string,
): { id: string; login: string } {
  const actor = record(value, path);
  exactKeys(actor, ["id", "login"], path);
  return {
    id: text(actor.id, `${path}.id`, { max: 128 }),
    login: text(actor.login, `${path}.login`, {
      max: 39,
      pattern: /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u,
    }),
  };
}

function assertEvidenceIds(value: unknown, path: string): string[] {
  const result = array(value, path).map((entry, index) =>
    text(entry, `${path}[${index}]`, { max: 256 }),
  );
  unique(result, path);
  return result;
}

function assertWallet(
  value: unknown,
  path: string,
  actor: { id: string; login: string },
): WalletProof | null {
  if (value === null) return null;
  const wallet = record(value, path);
  if (wallet.chain !== "solana") {
    throw new TypeError(`${path}.chain must be solana`);
  }
  if (!isSolanaAddress(wallet.address)) {
    throw new TypeError(`${path}.address is not a Solana public key`);
  }
  const sourceUrl = text(wallet.sourceUrl, `${path}.sourceUrl`, { max: 512 });
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(sourceUrl);
  } catch (error) {
    throw new TypeError(`${path}.sourceUrl is not a URL`, { cause: error });
  }
  const commonUrlInvalid =
    parsedUrl.protocol !== "https:" ||
    parsedUrl.hostname !== "github.com" ||
    parsedUrl.search ||
    parsedUrl.hash ||
    parsedUrl.username ||
    parsedUrl.password ||
    parsedUrl.port;
  if ("sourceCommit" in wallet) {
    exactKeys(
      wallet,
      ["address", "chain", "observedAt", "sourceCommit", "sourceUrl"],
      path,
    );
    const sourceCommit = text(wallet.sourceCommit, `${path}.sourceCommit`, {
      pattern: /^[0-9a-f]{40}$/u,
    });
    const expectedPath = `/${actor.login}/${actor.login}/blob/${sourceCommit}/README.md`;
    if (
      commonUrlInvalid ||
      parsedUrl.pathname.toLowerCase() !== expectedPath.toLowerCase()
    ) {
      throw new TypeError(
        `${path}.sourceUrl must be the actor's immutable GitHub profile README`,
      );
    }
    return {
      address: wallet.address,
      chain: "solana",
      observedAt: iso(wallet.observedAt, `${path}.observedAt`),
      sourceCommit,
      sourceUrl,
    };
  }
  if ("sourceClaimId" in wallet) {
    exactKeys(
      wallet,
      [
        "address",
        "chain",
        "observedAt",
        "sourceActorId",
        "sourceClaimId",
        "sourceRecordSha256",
        "sourceUrl",
      ],
      path,
    );
    const sourceActorId = text(wallet.sourceActorId, `${path}.sourceActorId`, {
      max: 128,
    });
    if (sourceActorId !== actor.id) {
      throw new TypeError(
        `${path}.sourceActorId does not match the contributor`,
      );
    }
    const sourceClaimId = text(wallet.sourceClaimId, `${path}.sourceClaimId`, {
      max: 128,
      pattern: /^[A-Za-z0-9_-]+$/u,
    });
    const sourceRecordSha256 = text(
      wallet.sourceRecordSha256,
      `${path}.sourceRecordSha256`,
      { pattern: /^[0-9a-f]{64}$/u },
    );
    if (
      parsedUrl.protocol !== "https:" ||
      parsedUrl.hostname !== "api.slop.cash" ||
      parsedUrl.pathname !== `/api/v1/wallet-claims/${sourceClaimId}` ||
      parsedUrl.search ||
      parsedUrl.hash ||
      parsedUrl.username ||
      parsedUrl.password ||
      parsedUrl.port
    ) {
      throw new TypeError(
        `${path}.sourceUrl is not a canonical Slop wallet claim`,
      );
    }
    return {
      address: wallet.address,
      chain: "solana",
      observedAt: iso(wallet.observedAt, `${path}.observedAt`),
      sourceActorId,
      sourceClaimId,
      sourceRecordSha256,
      sourceUrl,
    };
  }
  exactKeys(
    wallet,
    [
      "address",
      "chain",
      "observedAt",
      "sourceActorId",
      "sourceBodySha256",
      "sourceIssueId",
      "sourceIssueNumber",
      "sourceUpdatedAt",
      "sourceUrl",
    ],
    path,
  );
  const sourceActorId = text(wallet.sourceActorId, `${path}.sourceActorId`, {
    max: 128,
  });
  if (sourceActorId !== actor.id) {
    throw new TypeError(`${path}.sourceActorId does not match the contributor`);
  }
  const sourceBodySha256 = text(
    wallet.sourceBodySha256,
    `${path}.sourceBodySha256`,
    { pattern: /^[0-9a-f]{64}$/u },
  );
  const sourceIssueId = text(wallet.sourceIssueId, `${path}.sourceIssueId`, {
    max: 128,
    pattern: /^[A-Za-z0-9_=-]+$/u,
  });
  if (
    !Number.isSafeInteger(wallet.sourceIssueNumber) ||
    (wallet.sourceIssueNumber as number) < 1
  ) {
    throw new TypeError(`${path}.sourceIssueNumber is invalid`);
  }
  const sourceIssueNumber = wallet.sourceIssueNumber as number;
  const expectedIssuePath = `/${WALLET_CLAIM_REPOSITORY}/issues/${sourceIssueNumber}`;
  if (
    commonUrlInvalid ||
    parsedUrl.pathname.toLowerCase() !== expectedIssuePath.toLowerCase()
  ) {
    throw new TypeError(
      `${path}.sourceUrl is not the canonical wallet claim issue`,
    );
  }
  return {
    address: wallet.address,
    chain: "solana",
    observedAt: iso(wallet.observedAt, `${path}.observedAt`),
    sourceActorId,
    sourceBodySha256,
    sourceIssueId,
    sourceIssueNumber,
    sourceUpdatedAt: iso(wallet.sourceUpdatedAt, `${path}.sourceUpdatedAt`),
    sourceUrl,
  };
}

function assertAllocation(value: unknown, index: number): RewardAllocation {
  const path = `allocations[${index}]`;
  const allocation = record(value, path);
  const hasAccrual = "accruedMinor" in allocation;
  const hasLines = "lines" in allocation;
  exactKeys(
    allocation,
    [
      "actor",
      "adjustmentReason",
      "approvedMinor",
      "evidenceEventIds",
      "intentId",
      "platformApproval",
      "relatedParty",
      "score",
      "state",
      "suggestedMinor",
      "wallet",
      ...(hasAccrual ? ["accruedMinor"] : []),
      ...(hasLines ? ["lines"] : []),
    ],
    path,
  );
  const state = allocation.state;
  if (
    state !== "approved" &&
    state !== "excluded" &&
    state !== "held" &&
    state !== "held-below-minimum" &&
    state !== "proposed" &&
    state !== "unclaimed"
  ) {
    throw new TypeError(`${path}.state is invalid`);
  }
  const suggestedMinor = minor(
    allocation.suggestedMinor,
    `${path}.suggestedMinor`,
  );
  const accruedMinor = hasAccrual
    ? minor(allocation.accruedMinor, `${path}.accruedMinor`)
    : undefined;
  if (
    state === "held-below-minimum" &&
    (accruedMinor === undefined ||
      BigInt(accruedMinor) >= BigInt(MINIMUM_TRANSFER_MINOR))
  ) {
    throw new TypeError(`${path} below-minimum hold must remain below $2`);
  }
  const approvedMinor = minor(
    allocation.approvedMinor,
    `${path}.approvedMinor`,
  );
  let lines: RewardAllocation["lines"];
  if (hasLines) {
    const rawLines = record(allocation.lines, `${path}.lines`);
    exactKeys(rawLines, ["reviewBudget", "sharedPool"], `${path}.lines`);
    const sharedPool = record(rawLines.sharedPool, `${path}.lines.sharedPool`);
    exactKeys(
      sharedPool,
      ["approvedMinor", "suggestedMinor"],
      `${path}.lines.sharedPool`,
    );
    const reviewBudget = record(
      rawLines.reviewBudget,
      `${path}.lines.reviewBudget`,
    );
    exactKeys(
      reviewBudget,
      ["approvedMinor", "evidenceEventIds", "suggestedMinor"],
      `${path}.lines.reviewBudget`,
    );
    lines = {
      sharedPool: {
        suggestedMinor: minor(
          sharedPool.suggestedMinor,
          `${path}.lines.sharedPool.suggestedMinor`,
        ),
        approvedMinor: minor(
          sharedPool.approvedMinor,
          `${path}.lines.sharedPool.approvedMinor`,
        ),
      },
      reviewBudget: {
        suggestedMinor: minor(
          reviewBudget.suggestedMinor,
          `${path}.lines.reviewBudget.suggestedMinor`,
        ),
        approvedMinor: minor(
          reviewBudget.approvedMinor,
          `${path}.lines.reviewBudget.approvedMinor`,
        ),
        evidenceEventIds: assertEvidenceIds(
          reviewBudget.evidenceEventIds,
          `${path}.lines.reviewBudget.evidenceEventIds`,
        ),
      },
    };
    if (
      BigInt(lines.sharedPool.suggestedMinor) +
        BigInt(lines.reviewBudget.suggestedMinor) !==
        BigInt(suggestedMinor) ||
      BigInt(lines.sharedPool.approvedMinor) +
        BigInt(lines.reviewBudget.approvedMinor) !==
        BigInt(approvedMinor)
    ) {
      throw new TypeError(`${path} reward lines do not reconcile`);
    }
    if (
      (BigInt(lines.reviewBudget.suggestedMinor) > 0n &&
        lines.reviewBudget.evidenceEventIds.length === 0) ||
      lines.reviewBudget.evidenceEventIds.some(
        (eventId) =>
          !(allocation.evidenceEventIds as unknown[]).includes(eventId),
      )
    ) {
      throw new TypeError(`${path} review line lacks accepted review evidence`);
    }
  }
  const adjustmentReason =
    allocation.adjustmentReason === null
      ? null
      : text(allocation.adjustmentReason, `${path}.adjustmentReason`, {
          max: 1000,
          min: 12,
        });
  if (
    state !== "proposed" &&
    state !== "unclaimed" &&
    state !== "held-below-minimum" &&
    approvedMinor !== suggestedMinor &&
    !adjustmentReason
  ) {
    throw new TypeError(`${path} adjustment requires an adjustment reason`);
  }
  if (typeof allocation.relatedParty !== "boolean") {
    throw new TypeError(`${path}.relatedParty must be boolean`);
  }
  let platformApproval: RewardAllocation["platformApproval"] = null;
  if (allocation.platformApproval !== null) {
    const approval = record(
      allocation.platformApproval,
      `${path}.platformApproval`,
    );
    exactKeys(approval, ["approvedAt", "reviewer"], `${path}.platformApproval`);
    platformApproval = {
      reviewer: text(approval.reviewer, `${path}.platformApproval.reviewer`, {
        max: 128,
      }),
      approvedAt: iso(
        approval.approvedAt,
        `${path}.platformApproval.approvedAt`,
      ),
    };
  }
  if (
    allocation.relatedParty &&
    BigInt(approvedMinor) > 0n &&
    platformApproval === null
  ) {
    throw new TypeError(
      `${path} related-party payment needs platform approval`,
    );
  }
  const actor = assertActor(allocation.actor, `${path}.actor`);
  const wallet = assertWallet(allocation.wallet, `${path}.wallet`, actor);
  if (state === "proposed" && wallet === null) {
    throw new TypeError(`${path} proposed payment needs a wallet observation`);
  }
  if (state === "unclaimed" && wallet !== null) {
    throw new TypeError(`${path} unclaimed payment cannot retain a wallet`);
  }
  if (
    state === "approved" &&
    (BigInt(approvedMinor) === 0n || wallet === null)
  ) {
    throw new TypeError(`${path} approved payment needs money and a wallet`);
  }
  if (
    hasAccrual &&
    state === "approved" &&
    BigInt(approvedMinor) < BigInt(MINIMUM_TRANSFER_MINOR)
  ) {
    throw new TypeError(`${path} approved payment is below the $2 minimum`);
  }
  if (
    hasLines &&
    state === "approved" &&
    BigInt(approvedMinor) < BigInt(MINIMUM_TRANSFER_MINOR)
  ) {
    throw new TypeError(
      `${path} combined approved payment is below the $2 minimum`,
    );
  }
  if (state !== "approved" && BigInt(approvedMinor) !== 0n) {
    throw new TypeError(
      `${path} non-approved state must have zero approved amount`,
    );
  }
  return {
    intentId: text(allocation.intentId, `${path}.intentId`, {
      max: 160,
      pattern: /^pay_[a-z0-9][a-z0-9_-]+$/u,
    }),
    actor,
    score: safeInteger(allocation.score, `${path}.score`),
    suggestedMinor,
    ...(accruedMinor === undefined ? {} : { accruedMinor }),
    approvedMinor,
    state,
    wallet,
    evidenceEventIds: assertEvidenceIds(
      allocation.evidenceEventIds,
      `${path}.evidenceEventIds`,
    ),
    adjustmentReason,
    relatedParty: allocation.relatedParty,
    platformApproval,
    ...(lines ? { lines } : {}),
  };
}

/** Validates a public Eliza cycle allocation and its financial invariants. */
export function assertRewardAllocationManifest(
  value: unknown,
): RewardAllocationManifest {
  const manifest = record(value, "allocation manifest");
  const hasAccrual =
    "carriedMinor" in manifest || "minimumTransferMinor" in manifest;
  const hasRewardLines = "rewardLines" in manifest;
  exactKeys(
    manifest,
    [
      "allocations",
      "approvedAt",
      "capMinor",
      "chain",
      "contributionWindow",
      "currency",
      "cycleId",
      "feeBasisPoints",
      "generatedAt",
      "kind",
      "projectId",
      "review",
      "schemaVersion",
      "scoringRuleVersion",
      "sourceSnapshotSha256",
      "status",
      "totals",
      ...(hasAccrual ? ["carriedMinor", "minimumTransferMinor"] : []),
      ...(hasRewardLines ? ["rewardLines"] : []),
    ],
    "allocation manifest",
  );
  if (
    manifest.schemaVersion !== REWARD_PROTOCOL_VERSION ||
    manifest.kind !== "reward-allocation" ||
    typeof manifest.projectId !== "string" ||
    (manifest.status !== "proposed" && manifest.status !== "approved") ||
    manifest.currency !== "USDC" ||
    manifest.chain !== "solana"
  ) {
    throw new TypeError("allocation manifest protocol header is invalid");
  }
  const project = findProject(manifest.projectId);
  if (project?.reward.kind !== "monthly-pool") {
    throw new TypeError("allocation manifest project has no monthly pool");
  }
  const cycleId = text(manifest.cycleId, "allocation manifest.cycleId", {
    pattern: /^\d{4}-(?:0[1-9]|1[0-2])$/u,
  });
  const generatedAt = iso(
    manifest.generatedAt,
    "allocation manifest.generatedAt",
  );
  const approvedAt =
    manifest.approvedAt === null
      ? null
      : iso(manifest.approvedAt, "allocation manifest.approvedAt");
  if (manifest.status === "approved" && approvedAt === null) {
    throw new TypeError("approved allocation manifest needs approvedAt");
  }
  if (manifest.status === "proposed" && approvedAt !== null) {
    throw new TypeError("proposed allocation manifest cannot have approvedAt");
  }
  const contributionWindow = record(
    manifest.contributionWindow,
    "allocation manifest.contributionWindow",
  );
  exactKeys(
    contributionWindow,
    ["from", "to"],
    "allocation manifest.contributionWindow",
  );
  const windowFrom = iso(
    contributionWindow.from,
    "allocation manifest.contributionWindow.from",
  );
  const windowTo = iso(
    contributionWindow.to,
    "allocation manifest.contributionWindow.to",
  );
  const [cycleYear, cycleMonth] = cycleId.split("-").map(Number);
  const calendarFrom = Date.UTC(cycleYear, cycleMonth - 1, 1);
  const expectedFrom = Math.max(
    calendarFrom,
    Date.parse(project.reward.rewardStartAt),
  );
  const expectedTo = Date.UTC(cycleYear, cycleMonth, 1);
  if (
    Date.parse(windowFrom) !== expectedFrom ||
    Date.parse(windowTo) !== expectedTo ||
    Date.parse(generatedAt) < expectedTo
  ) {
    throw new TypeError(
      "allocation contribution window or generation time is outside the closed cycle",
    );
  }
  const review = record(manifest.review, "allocation manifest.review");
  exactKeys(
    review,
    ["days", "endsAt", "lastMaterialChangeAt"],
    "allocation manifest.review",
  );
  if (review.days !== REVIEW_WINDOW_DAYS) {
    throw new TypeError("allocation review window must be 14 days");
  }
  const lastMaterialChangeAt = iso(
    review.lastMaterialChangeAt,
    "allocation manifest.review.lastMaterialChangeAt",
  );
  const endsAt = iso(review.endsAt, "allocation manifest.review.endsAt");
  if (Date.parse(lastMaterialChangeAt) < Date.parse(generatedAt)) {
    throw new TypeError("allocation material-change time predates generation");
  }
  if (
    Date.parse(endsAt) !==
    Date.parse(lastMaterialChangeAt) + REVIEW_WINDOW_DAYS * 86_400_000
  ) {
    throw new TypeError("allocation review end must be 14 days after change");
  }
  if (approvedAt && Date.parse(approvedAt) < Date.parse(endsAt)) {
    throw new TypeError("allocation was approved before review ended");
  }
  if (manifest.feeBasisPoints !== project.reward.feeBasisPoints) {
    throw new TypeError("allocation fee differs from project policy");
  }
  const capMinor = minor(manifest.capMinor, "allocation manifest.capMinor");
  if (capMinor !== project.reward.monthlyCapMinor) {
    throw new TypeError("allocation cap differs from project policy");
  }
  const carriedMinor = hasAccrual
    ? minor(manifest.carriedMinor, "allocation manifest.carriedMinor")
    : "0";
  if (hasAccrual && manifest.minimumTransferMinor !== MINIMUM_TRANSFER_MINOR) {
    throw new TypeError("allocation minimum transfer must be 2 USDC");
  }
  const allocations = array(
    manifest.allocations,
    "allocation manifest.allocations",
  ).map(assertAllocation);
  unique(
    allocations.map((allocation) => allocation.intentId),
    "allocation intent ids",
  );
  unique(
    allocations.map((allocation) => allocation.actor.id),
    "allocation actor ids",
  );
  for (const allocation of allocations) {
    if (
      allocation.wallet &&
      Date.parse(allocation.wallet.observedAt) >
        Date.parse(lastMaterialChangeAt)
    ) {
      throw new TypeError(
        "wallet observation is newer than the declared material change",
      );
    }
    if (
      allocation.platformApproval &&
      Date.parse(allocation.platformApproval.approvedAt) < Date.parse(endsAt)
    ) {
      throw new TypeError(
        "related-party approval predates the review deadline",
      );
    }
  }
  if (
    manifest.status === "approved" &&
    allocations.some((allocation) => allocation.state === "proposed")
  ) {
    throw new TypeError(
      "approved allocation manifest has unresolved proposals",
    );
  }
  const suggestedMinor = sumMinor(
    allocations.map((allocation) => allocation.suggestedMinor),
  );
  const approvedMinor = sumMinor(
    allocations.map((allocation) => allocation.approvedMinor),
  );
  let rewardLines: RewardAllocationManifest["rewardLines"];
  if (hasRewardLines) {
    const policy = project.reward.reviewBudget;
    if (
      policy?.fundingState !== "committed" ||
      policy.paymentMode !== "enabled"
    ) {
      throw new TypeError("allocation review line is not funded and enabled");
    }
    const rawLines = record(manifest.rewardLines, "allocation rewardLines");
    exactKeys(
      rawLines,
      ["reviewBudget", "sharedPool"],
      "allocation rewardLines",
    );
    const sharedPool = record(
      rawLines.sharedPool,
      "allocation rewardLines.sharedPool",
    );
    exactKeys(
      sharedPool,
      ["approvedMinor", "capMinor", "suggestedMinor"],
      "allocation rewardLines.sharedPool",
    );
    const reviewBudget = record(
      rawLines.reviewBudget,
      "allocation rewardLines.reviewBudget",
    );
    exactKeys(
      reviewBudget,
      ["approvedMinor", "capMinor", "committedMinor", "suggestedMinor"],
      "allocation rewardLines.reviewBudget",
    );
    rewardLines = {
      sharedPool: {
        capMinor: minor(sharedPool.capMinor, "shared-pool line capMinor"),
        suggestedMinor: minor(
          sharedPool.suggestedMinor,
          "shared-pool line suggestedMinor",
        ),
        approvedMinor: minor(
          sharedPool.approvedMinor,
          "shared-pool line approvedMinor",
        ),
      },
      reviewBudget: {
        capMinor: minor(reviewBudget.capMinor, "review line capMinor"),
        committedMinor: minor(
          reviewBudget.committedMinor,
          "review line committedMinor",
        ),
        suggestedMinor: minor(
          reviewBudget.suggestedMinor,
          "review line suggestedMinor",
        ),
        approvedMinor: minor(
          reviewBudget.approvedMinor,
          "review line approvedMinor",
        ),
      },
    };
    const allocationSharedSuggested = sumMinor(
      allocations.map((entry) => entry.lines?.sharedPool.suggestedMinor ?? "0"),
    );
    const allocationSharedApproved = sumMinor(
      allocations.map((entry) => entry.lines?.sharedPool.approvedMinor ?? "0"),
    );
    const allocationReviewSuggested = sumMinor(
      allocations.map(
        (entry) => entry.lines?.reviewBudget.suggestedMinor ?? "0",
      ),
    );
    const allocationReviewApproved = sumMinor(
      allocations.map(
        (entry) => entry.lines?.reviewBudget.approvedMinor ?? "0",
      ),
    );
    if (
      allocations.some((entry) => !entry.lines) ||
      rewardLines.sharedPool.capMinor !== capMinor ||
      rewardLines.reviewBudget.capMinor !== policy.monthlyCapMinor ||
      rewardLines.reviewBudget.committedMinor !== policy.committedMinor ||
      rewardLines.sharedPool.suggestedMinor !== allocationSharedSuggested ||
      rewardLines.sharedPool.approvedMinor !== allocationSharedApproved ||
      rewardLines.reviewBudget.suggestedMinor !== allocationReviewSuggested ||
      rewardLines.reviewBudget.approvedMinor !== allocationReviewApproved ||
      BigInt(allocationSharedApproved) >
        BigInt(capMinor) + BigInt(carriedMinor) ||
      BigInt(allocationReviewApproved) > BigInt(policy.committedMinor) ||
      BigInt(allocationReviewApproved) > BigInt(policy.monthlyCapMinor) ||
      BigInt(allocationReviewSuggested) > BigInt(policy.committedMinor) ||
      BigInt(allocationReviewSuggested) > BigInt(policy.monthlyCapMinor)
    ) {
      throw new TypeError(
        "allocation reward lines do not reconcile with policy",
      );
    }
  } else if (allocations.some((entry) => entry.lines)) {
    throw new TypeError(
      "allocation rows have reward lines without line totals",
    );
  } else if (BigInt(approvedMinor) > BigInt(capMinor) + BigInt(carriedMinor)) {
    throw new TypeError("allocation total exceeds the monthly cap");
  }
  const totals = record(manifest.totals, "allocation manifest.totals");
  exactKeys(
    totals,
    ["approvedMinor", "feeMinor", "suggestedMinor"],
    "allocation manifest.totals",
  );
  const feeMinor = feeForPrincipal(
    approvedMinor,
    project.reward.feeBasisPoints,
  );
  if (
    minor(totals.suggestedMinor, "allocation totals.suggestedMinor") !==
      suggestedMinor ||
    minor(totals.approvedMinor, "allocation totals.approvedMinor") !==
      approvedMinor ||
    minor(totals.feeMinor, "allocation totals.feeMinor") !== feeMinor
  ) {
    throw new TypeError("allocation totals do not reconcile");
  }

  return {
    schemaVersion: REWARD_PROTOCOL_VERSION,
    kind: "reward-allocation",
    projectId: project.id,
    cycleId,
    status: manifest.status,
    generatedAt,
    approvedAt,
    contributionWindow: { from: windowFrom, to: windowTo },
    review: {
      days: REVIEW_WINDOW_DAYS,
      lastMaterialChangeAt,
      endsAt,
    },
    currency: "USDC",
    chain: "solana",
    capMinor,
    ...(hasAccrual
      ? {
          carriedMinor,
          minimumTransferMinor: MINIMUM_TRANSFER_MINOR,
        }
      : {}),
    feeBasisPoints: PLATFORM_FEE_BASIS_POINTS,
    scoringRuleVersion: text(
      manifest.scoringRuleVersion,
      "allocation manifest.scoringRuleVersion",
      { max: 128 },
    ),
    sourceSnapshotSha256: sha256(
      manifest.sourceSnapshotSha256,
      "allocation manifest.sourceSnapshotSha256",
    ),
    allocations,
    ...(rewardLines ? { rewardLines } : {}),
    totals: { suggestedMinor, approvedMinor, feeMinor },
  };
}

/** Validates Delta Star percentages without representing them as owed dollars. */
export function assertExternalContributionShareManifest(
  value: unknown,
): ExternalContributionShareManifest {
  const manifest = record(value, "share manifest");
  exactKeys(
    manifest,
    [
      "cycleId",
      "contributionWindow",
      "entries",
      "generatedAt",
      "kind",
      "platformSharePartsPerMillion",
      "projectId",
      "schemaVersion",
      "scoringRuleVersion",
      "sourceSnapshotSha256",
      "status",
    ],
    "share manifest",
  );
  if (
    manifest.schemaVersion !== REWARD_PROTOCOL_VERSION ||
    manifest.kind !== "external-contribution-share" ||
    typeof manifest.projectId !== "string" ||
    manifest.status !== "provisional"
  ) {
    throw new TypeError("share manifest protocol header is invalid");
  }
  const project = findProject(manifest.projectId);
  if (project?.reward.kind !== "external-prize-share") {
    throw new TypeError("share manifest project has no external opportunity");
  }
  const platformSharePartsPerMillion = safeInteger(
    manifest.platformSharePartsPerMillion,
    "share manifest.platformSharePartsPerMillion",
  );
  const expectedPlatformShare =
    (SHARE_PARTS_TOTAL * project.reward.feeBasisPoints) / 10_000;
  if (platformSharePartsPerMillion !== expectedPlatformShare) {
    throw new TypeError(
      "share manifest platform share differs from project policy",
    );
  }
  const entries = array(manifest.entries, "share manifest.entries").map(
    (value, index) => {
      const path = `share manifest.entries[${index}]`;
      const entry = record(value, path);
      exactKeys(
        entry,
        ["actor", "evidenceEventIds", "score", "sharePartsPerMillion"],
        path,
      );
      return {
        actor: assertActor(entry.actor, `${path}.actor`),
        score: safeInteger(entry.score, `${path}.score`),
        sharePartsPerMillion: safeInteger(
          entry.sharePartsPerMillion,
          `${path}.sharePartsPerMillion`,
        ),
        evidenceEventIds: assertEvidenceIds(
          entry.evidenceEventIds,
          `${path}.evidenceEventIds`,
        ),
      };
    },
  );
  unique(
    entries.map((entry) => entry.actor.id),
    "share actor ids",
  );
  if (
    entries.reduce((total, entry) => total + entry.sharePartsPerMillion, 0) +
      (entries.length === 0 ? 0 : platformSharePartsPerMillion) !==
    (entries.length === 0 ? 0 : SHARE_PARTS_TOTAL)
  ) {
    throw new TypeError(
      "share parts must total one million when a cycle has contributors",
    );
  }
  const cycleId = text(manifest.cycleId, "share manifest.cycleId", {
    pattern: /^\d{4}-(?:0[1-9]|1[0-2])$/u,
  });
  const contributionWindow = record(
    manifest.contributionWindow,
    "share manifest.contributionWindow",
  );
  exactKeys(
    contributionWindow,
    ["from", "to"],
    "share manifest.contributionWindow",
  );
  const windowFrom = iso(
    contributionWindow.from,
    "share manifest.contributionWindow.from",
  );
  const windowTo = iso(
    contributionWindow.to,
    "share manifest.contributionWindow.to",
  );
  const generatedAt = iso(manifest.generatedAt, "share manifest.generatedAt");
  const [cycleYear, cycleMonth] = cycleId.split("-").map(Number);
  const expectedFrom = Math.max(
    Date.UTC(cycleYear, cycleMonth - 1, 1),
    Date.parse(project.reward.rewardStartAt),
  );
  const expectedTo = Date.UTC(cycleYear, cycleMonth, 1);
  if (
    Date.parse(windowFrom) !== expectedFrom ||
    Date.parse(windowTo) !== expectedTo ||
    Date.parse(generatedAt) < expectedTo
  ) {
    throw new TypeError(
      "share contribution window or generation time is outside the closed cycle",
    );
  }
  return {
    schemaVersion: REWARD_PROTOCOL_VERSION,
    kind: "external-contribution-share",
    projectId: project.id,
    cycleId,
    status: "provisional",
    generatedAt,
    contributionWindow: { from: windowFrom, to: windowTo },
    scoringRuleVersion: text(
      manifest.scoringRuleVersion,
      "share manifest.scoringRuleVersion",
      { max: 128 },
    ),
    sourceSnapshotSha256: sha256(
      manifest.sourceSnapshotSha256,
      "share manifest.sourceSnapshotSha256",
    ),
    platformSharePartsPerMillion,
    entries,
  };
}

/** Validates a receipt ledger against its approved allocation manifest. */
export function assertRewardSettlementManifest(
  value: unknown,
  allocation: RewardAllocationManifest,
): RewardSettlementManifest {
  if (allocation.status !== "approved" || allocation.approvedAt === null) {
    throw new TypeError("settlement requires an approved allocation");
  }
  const manifest = record(value, "settlement manifest");
  exactKeys(
    manifest,
    [
      "allocationSha256",
      "attempts",
      "chain",
      "currency",
      "cycleId",
      "kind",
      "platformFee",
      "projectId",
      "recipients",
      "schemaVersion",
      "settledAt",
      "status",
      "totals",
    ],
    "settlement manifest",
  );
  if (
    manifest.schemaVersion !== REWARD_PROTOCOL_VERSION ||
    manifest.kind !== "reward-settlement" ||
    manifest.projectId !== allocation.projectId ||
    manifest.cycleId !== allocation.cycleId ||
    manifest.currency !== allocation.currency ||
    manifest.chain !== allocation.chain ||
    (manifest.status !== "failed" &&
      manifest.status !== "paid" &&
      manifest.status !== "partially-paid")
  ) {
    throw new TypeError("settlement manifest protocol header is invalid");
  }
  const approvedByIntent = new Map(
    allocation.allocations
      .filter((entry) => entry.state === "approved")
      .map((entry) => [entry.intentId, entry]),
  );
  const recipients = array(manifest.recipients, "settlement recipients").map(
    (value, index) => {
      const path = `settlement recipients[${index}]`;
      const recipient = record(value, path);
      const expectedAllocation =
        typeof recipient.intentId === "string"
          ? approvedByIntent.get(recipient.intentId)
          : undefined;
      const hasRewardLines = "rewardLines" in recipient;
      exactKeys(
        recipient,
        [
          "approvedMinor",
          "intentId",
          "paidMinor",
          "state",
          ...(hasRewardLines ? ["rewardLines"] : []),
        ],
        path,
      );
      const intentId = text(recipient.intentId, `${path}.intentId`, {
        max: 160,
      });
      const approvedMinor = minor(
        recipient.approvedMinor,
        `${path}.approvedMinor`,
      );
      if (expectedAllocation?.approvedMinor !== approvedMinor) {
        throw new TypeError(`${path} does not match an approved payout intent`);
      }
      const paidMinor = minor(recipient.paidMinor, `${path}.paidMinor`);
      if (BigInt(paidMinor) > BigInt(approvedMinor)) {
        throw new TypeError(`${path} paid more than approved`);
      }
      const state: RewardSettlementManifest["recipients"][number]["state"] =
        recipient.state as RewardSettlementManifest["recipients"][number]["state"];
      if (state !== "failed" && state !== "paid" && state !== "pending") {
        throw new TypeError(`${path}.state is invalid`);
      }
      if (state === "paid" && paidMinor !== approvedMinor) {
        throw new TypeError(`${path} paid state must be fully paid`);
      }
      if (state !== "paid" && BigInt(paidMinor) !== 0n) {
        throw new TypeError(
          `${path} non-paid state must have zero paid amount`,
        );
      }
      let rewardLines: RewardSettlementManifest["recipients"][number]["rewardLines"];
      if (expectedAllocation.lines) {
        if (!hasRewardLines) {
          throw new TypeError(`${path} must preserve reward line items`);
        }
        const rawLines = record(recipient.rewardLines, `${path}.rewardLines`);
        exactKeys(
          rawLines,
          ["reviewBudget", "sharedPool"],
          `${path}.rewardLines`,
        );
        const parseLine = (
          value: unknown,
          linePath: string,
          expectedApprovedMinor: string,
        ): { approvedMinor: string; paidMinor: string } => {
          const line = record(value, linePath);
          exactKeys(line, ["approvedMinor", "paidMinor"], linePath);
          const lineApproved = minor(
            line.approvedMinor,
            `${linePath}.approvedMinor`,
          );
          const linePaid = minor(line.paidMinor, `${linePath}.paidMinor`);
          if (
            lineApproved !== expectedApprovedMinor ||
            linePaid !== (state === "paid" ? lineApproved : "0")
          ) {
            throw new TypeError(`${linePath} does not reconcile`);
          }
          return { approvedMinor: lineApproved, paidMinor: linePaid };
        };
        rewardLines = {
          sharedPool: parseLine(
            rawLines.sharedPool,
            `${path}.rewardLines.sharedPool`,
            expectedAllocation.lines.sharedPool.approvedMinor,
          ),
          reviewBudget: parseLine(
            rawLines.reviewBudget,
            `${path}.rewardLines.reviewBudget`,
            expectedAllocation.lines.reviewBudget.approvedMinor,
          ),
        };
      } else if (hasRewardLines) {
        throw new TypeError(`${path} has reward lines absent from allocation`);
      }
      return {
        intentId,
        approvedMinor,
        paidMinor,
        state,
        ...(rewardLines ? { rewardLines } : {}),
      };
    },
  );
  unique(
    recipients.map((recipient) => recipient.intentId),
    "settlement recipient intents",
  );
  if (recipients.length !== approvedByIntent.size) {
    throw new TypeError(
      "settlement does not account for every approved intent",
    );
  }

  const finalizedIntents = new Set<string>();
  const attempts = array(manifest.attempts, "settlement attempts").map(
    (value, index) => {
      const path = `settlement attempts[${index}]`;
      const attempt = record(value, path);
      exactKeys(
        attempt,
        ["attemptId", "intentIds", "signature", "state"],
        path,
      );
      const state: RewardSettlementManifest["attempts"][number]["state"] =
        attempt.state as RewardSettlementManifest["attempts"][number]["state"];
      if (
        state !== "broadcast" &&
        state !== "failed" &&
        state !== "finalized"
      ) {
        throw new TypeError(`${path}.state is invalid`);
      }
      const intentIds = array(attempt.intentIds, `${path}.intentIds`).map(
        (entry, intentIndex) =>
          text(entry, `${path}.intentIds[${intentIndex}]`, { max: 160 }),
      );
      if (intentIds.length === 0) throw new TypeError(`${path} has no intents`);
      unique(intentIds, `${path}.intentIds`);
      for (const intentId of intentIds) {
        if (!approvedByIntent.has(intentId)) {
          throw new TypeError(`${path} references an unknown payout intent`);
        }
        if (state === "finalized" && finalizedIntents.has(intentId)) {
          throw new TypeError("a payout intent finalized more than once");
        }
        if (state === "finalized") finalizedIntents.add(intentId);
      }
      const signature =
        attempt.signature === null
          ? null
          : solanaSignature(attempt.signature, `${path}.signature`);
      if (state === "finalized" && signature === null) {
        throw new TypeError(`${path} finalized attempt needs a signature`);
      }
      return {
        attemptId: text(attempt.attemptId, `${path}.attemptId`, {
          max: 160,
          pattern: /^attempt_[a-z0-9][a-z0-9_-]+$/u,
        }),
        intentIds,
        signature,
        state,
      };
    },
  );
  unique(
    attempts.map((attempt) => attempt.attemptId),
    "settlement attempt ids",
  );
  unique(
    attempts.flatMap((attempt) =>
      attempt.signature === null ? [] : [attempt.signature],
    ),
    "settlement transaction signatures",
  );
  const paidIntents = new Set(
    recipients
      .filter((recipient) => recipient.state === "paid")
      .map((recipient) => recipient.intentId),
  );
  if (
    paidIntents.size !== finalizedIntents.size ||
    [...paidIntents].some((intentId) => !finalizedIntents.has(intentId))
  ) {
    throw new TypeError("paid recipients and finalized attempts disagree");
  }
  const approvedMinor = sumMinor(
    recipients.map((recipient) => recipient.approvedMinor),
  );
  const paidMinor = sumMinor(
    recipients.map((recipient) => recipient.paidMinor),
  );
  const feeMinor = feeForPrincipal(paidMinor, allocation.feeBasisPoints);
  const platformFeeRecord = record(
    manifest.platformFee,
    "settlement platformFee",
  );
  exactKeys(
    platformFeeRecord,
    ["dueMinor", "paidMinor", "recipient", "signature", "state"],
    "settlement platformFee",
  );
  const feeDueMinor = minor(
    platformFeeRecord.dueMinor,
    "settlement platformFee.dueMinor",
  );
  const feePaidMinor = minor(
    platformFeeRecord.paidMinor,
    "settlement platformFee.paidMinor",
  );
  if (feeDueMinor !== feeMinor || BigInt(feePaidMinor) > BigInt(feeDueMinor)) {
    throw new TypeError("settlement platform fee does not reconcile");
  }
  const feeState = platformFeeRecord.state;
  if (
    feeState !== "failed" &&
    feeState !== "not-applicable" &&
    feeState !== "paid" &&
    feeState !== "pending" &&
    feeState !== "reported"
  ) {
    throw new TypeError("settlement platform fee state is invalid");
  }
  const feeRecipient =
    platformFeeRecord.recipient === null
      ? null
      : text(platformFeeRecord.recipient, "settlement platformFee.recipient", {
          max: 44,
          min: 32,
        });
  if (feeRecipient !== null && !isSolanaAddress(feeRecipient)) {
    throw new TypeError("settlement platform fee recipient is invalid");
  }
  const feeSignature =
    platformFeeRecord.signature === null
      ? null
      : solanaSignature(
          platformFeeRecord.signature,
          "settlement platformFee.signature",
        );
  if (BigInt(feeDueMinor) === 0n) {
    if (
      feeState !== "not-applicable" ||
      feeRecipient !== null ||
      feeSignature !== null ||
      BigInt(feePaidMinor) !== 0n
    ) {
      throw new TypeError("zero platform fee must be not-applicable");
    }
  } else if (feeRecipient === null) {
    throw new TypeError("non-zero platform fee needs a recipient");
  }
  if (
    feeState === "paid" &&
    (feePaidMinor !== feeDueMinor || feeSignature === null)
  ) {
    throw new TypeError("paid platform fee must be exact and signed");
  }
  if (feeState === "reported") {
    if (BigInt(feePaidMinor) !== 0n || feeSignature === null) {
      throw new TypeError(
        "reported platform fee needs a signature but cannot claim verified payment",
      );
    }
  } else if (
    feeState !== "paid" &&
    (BigInt(feePaidMinor) !== 0n || feeSignature !== null)
  ) {
    throw new TypeError(
      "outstanding platform fee cannot claim transaction evidence",
    );
  }
  if (
    feeSignature &&
    attempts.some((attempt) => attempt.signature === feeSignature)
  ) {
    throw new TypeError(
      "platform fee and contributor payout reuse a signature",
    );
  }
  const expectedStatus =
    paidIntents.size === recipients.length &&
    (feeState === "paid" || feeState === "not-applicable")
      ? "paid"
      : paidIntents.size === 0
        ? "failed"
        : "partially-paid";
  if (manifest.status !== expectedStatus) {
    throw new TypeError("settlement status does not match recipient states");
  }
  const totals = record(manifest.totals, "settlement totals");
  exactKeys(
    totals,
    ["approvedMinor", "feeMinor", "paidMinor"],
    "settlement totals",
  );
  if (
    minor(totals.approvedMinor, "settlement totals.approvedMinor") !==
      approvedMinor ||
    minor(totals.paidMinor, "settlement totals.paidMinor") !== paidMinor ||
    minor(totals.feeMinor, "settlement totals.feeMinor") !== feeMinor
  ) {
    throw new TypeError("settlement totals do not reconcile");
  }
  const settledAt = iso(manifest.settledAt, "settlement settledAt");
  if (Date.parse(settledAt) < Date.parse(allocation.approvedAt)) {
    throw new TypeError("settlement predates allocation approval");
  }
  return {
    schemaVersion: REWARD_PROTOCOL_VERSION,
    kind: "reward-settlement",
    projectId: allocation.projectId,
    cycleId: allocation.cycleId,
    allocationSha256: sha256(
      manifest.allocationSha256,
      "settlement allocationSha256",
    ),
    settledAt,
    currency: "USDC",
    chain: "solana",
    status: expectedStatus,
    recipients,
    attempts,
    platformFee: {
      recipient: feeRecipient,
      dueMinor: feeDueMinor,
      paidMinor: feePaidMinor,
      signature: feeSignature,
      state: feeState,
    },
    totals: { approvedMinor, paidMinor, feeMinor },
  };
}

/** Confirms that an open project received exact, non-placeholder disclosure. */
export function hasDeclaredProjectModelIdentity(
  projectId: ProjectId,
  input: { client: string; model: string; provider: string },
): boolean {
  const project = findProject(projectId);
  if (
    project?.modelPolicy.mode !== "open-declared" ||
    !project.modelPolicy.disclosureRequired
  ) {
    return false;
  }
  try {
    assertExactModelIdentity(input);
    return true;
  } catch {
    return false;
  }
}
