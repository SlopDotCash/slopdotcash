import {
  OUTCOME_FIRST_POLICY_AT,
  PAYMENT_REVIEW_POLICY_AT,
} from "./leaderboard";
import type {
  GitHubActor,
  ReviewExclusion,
  ReviewExclusionReason,
  ScoreEvent,
} from "./leaderboard-types";
import {
  findRegisteredRepository,
  findRegisteredRepositoryById,
} from "./repositories.mjs";

const RECOVERY_DECISIONS = ["award", "exclude"] as const;
const RECOVERY_EXCLUSION_REASONS = [
  "already-awarded-reviewer",
  "evaluated-contribution-award",
  "external-prize-policy",
  "insufficient-substance",
  "non-decision",
  "post-merge",
  "pull-request-review-awarded",
  "reviewer-cycle-cap",
  "unchanged-outcome",
] as const;

export type PreCensusRecoveryDecision = (typeof RECOVERY_DECISIONS)[number];

export interface PreCensusReviewRecovery {
  id: string;
  decision: PreCensusRecoveryDecision;
  repository: string;
  pullRequestNumber: number;
  pullRequestTitle: string;
  pullRequestUrl: string;
  reviewedHeadOid: string;
  mergedHeadOid: string;
  mergeCommitOid: string;
  mergedAt: string;
  responseCommitOids: string[];
  actor: GitHubActor;
  review: {
    id: string;
    url: string;
    state: "CHANGES_REQUESTED";
    submittedAt: string;
    commitId: string;
    body: string;
    inlineCommentCount: number;
  };
  lifecycleReviewIds: string[];
  continuity: {
    sourceSnapshotSha256: string;
    decisionUrl: string;
  };
  exclusionReason?: ReviewExclusionReason;
}

export interface ParsedPreCensusReviewRecovery {
  recoveries: PreCensusReviewRecovery[];
  events: ScoreEvent[];
  /**
   * The same awards reconstructed against the production-release payment
   * cutoff: standard credit before it, triage credit at or after it.
   */
  paymentEvents: ScoreEvent[];
  exclusions: ReviewExclusion[];
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: string[],
  path: string,
) {
  if (
    JSON.stringify(Object.keys(value).sort()) !==
    JSON.stringify([...keys].sort())
  ) {
    throw new TypeError(`${path} has unexpected or missing fields`);
  }
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${path} must be a non-empty string`);
  }
  return value;
}

function textValue(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${path} must be a string`);
  }
  return value;
}

function shaValue(value: unknown, path: string): string {
  const result = stringValue(value, path);
  if (!/^[0-9a-f]{40}$/u.test(result)) {
    throw new TypeError(`${path} must be a lowercase SHA-1`);
  }
  return result;
}

function digestValue(value: unknown, path: string): string {
  const result = stringValue(value, path);
  if (!/^[0-9a-f]{64}$/u.test(result)) {
    throw new TypeError(`${path} must be a lowercase SHA-256 digest`);
  }
  return result;
}

function timestampValue(value: unknown, path: string): string {
  const result = stringValue(value, path);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(result)) {
    throw new TypeError(`${path} must be an ISO UTC timestamp`);
  }
  if (!Number.isFinite(Date.parse(result))) {
    throw new TypeError(`${path} must be a valid timestamp`);
  }
  return result;
}

function positiveInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${path} must be a positive integer`);
  }
  return value;
}

function actorValue(value: unknown, path: string): GitHubActor {
  const actor = record(value, path);
  exactKeys(actor, ["id", "login", "avatarUrl", "url", "kind"], path);
  const kind = stringValue(actor.kind, `${path}.kind`);
  if (kind !== "User") throw new TypeError(`${path}.kind must be User`);
  const login = stringValue(actor.login, `${path}.login`);
  if (/\[bot\]$|\b(bot|claude|codex|cursoragent)\b/iu.test(login)) {
    throw new TypeError(`${path}.login must not identify an automated actor`);
  }
  return {
    id: stringValue(actor.id, `${path}.id`),
    login,
    avatarUrl: stringValue(actor.avatarUrl, `${path}.avatarUrl`),
    url: stringValue(actor.url, `${path}.url`),
    kind: "User",
  };
}

function reviewValue(value: unknown, path: string) {
  const review = record(value, path);
  exactKeys(
    review,
    [
      "id",
      "url",
      "state",
      "submittedAt",
      "commitId",
      "body",
      "inlineCommentCount",
    ],
    path,
  );
  const body = textValue(review.body, `${path}.body`);
  const inlineCommentCount = review.inlineCommentCount;
  if (
    typeof inlineCommentCount !== "number" ||
    !Number.isSafeInteger(inlineCommentCount) ||
    inlineCommentCount < 0
  ) {
    throw new TypeError(
      `${path}.inlineCommentCount must be a non-negative integer`,
    );
  }
  if (
    body.replace(/<!--[\s\S]*?-->/g, "").trim().length < 20 &&
    inlineCommentCount === 0
  ) {
    throw new TypeError(`${path} must retain substantive review evidence`);
  }
  if (review.state !== "CHANGES_REQUESTED") {
    throw new TypeError(`${path}.state must be CHANGES_REQUESTED`);
  }
  return {
    id: stringValue(review.id, `${path}.id`),
    url: stringValue(review.url, `${path}.url`),
    state: "CHANGES_REQUESTED" as const,
    submittedAt: timestampValue(review.submittedAt, `${path}.submittedAt`),
    commitId: shaValue(review.commitId, `${path}.commitId`),
    body,
    inlineCommentCount,
  };
}

function urlValue(value: unknown, path: string, pattern: RegExp): string {
  const result = stringValue(value, path);
  let url: URL;
  try {
    url = new URL(result);
  } catch {
    throw new TypeError(`${path} must be an absolute URL`);
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    !pattern.test(result)
  ) {
    throw new TypeError(`${path} is not a permitted GitHub URL`);
  }
  return result;
}

function githubRepositoryId(url: string): string | null {
  const segments = new URL(url).pathname.split("/").filter(Boolean);
  const owner = segments[0] ?? "";
  const name = segments[1] ?? "";
  return findRegisteredRepository(owner, name)?.id ?? null;
}

function parseRecovery(value: unknown, index: number): PreCensusReviewRecovery {
  const path = `preCensusRecoveries[${index}]`;
  const input = record(value, path);
  const requiredKeys = [
    "id",
    "decision",
    "repository",
    "pullRequestNumber",
    "pullRequestTitle",
    "pullRequestUrl",
    "reviewedHeadOid",
    "mergedHeadOid",
    "mergeCommitOid",
    "mergedAt",
    "responseCommitOids",
    "actor",
    "review",
    "lifecycleReviewIds",
    "continuity",
  ];
  const actualKeys = Object.keys(input);
  if (
    requiredKeys.some((key) => !actualKeys.includes(key)) ||
    actualKeys.some(
      (key) => !requiredKeys.includes(key) && key !== "exclusionReason",
    )
  ) {
    throw new TypeError(`${path} has unexpected or missing fields`);
  }
  const rawRepository = stringValue(input.repository, `${path}.repository`);
  const registeredRepository = findRegisteredRepositoryById(rawRepository);
  if (!registeredRepository) {
    throw new TypeError(`${path}.repository is not registered`);
  }
  const repository = registeredRepository.id;
  const pullRequestNumber = positiveInteger(
    input.pullRequestNumber,
    `${path}.pullRequestNumber`,
  );
  const pullRequestUrl = urlValue(
    input.pullRequestUrl,
    `${path}.pullRequestUrl`,
    new RegExp(
      `^https://github\\.com/[^/]+/[^/]+/pull/${pullRequestNumber}$`,
      "u",
    ),
  );
  if (githubRepositoryId(pullRequestUrl) !== repository) {
    throw new TypeError(`${path}.pullRequestUrl must belong to ${repository}`);
  }
  const reviewedHeadOid = shaValue(
    input.reviewedHeadOid,
    `${path}.reviewedHeadOid`,
  );
  const mergedHeadOid = shaValue(input.mergedHeadOid, `${path}.mergedHeadOid`);
  const mergeCommitOid = shaValue(
    input.mergeCommitOid,
    `${path}.mergeCommitOid`,
  );
  if (reviewedHeadOid === mergedHeadOid) {
    throw new TypeError(`${path} must prove a changed accepted outcome`);
  }
  const responseCommitOids = input.responseCommitOids;
  if (
    !Array.isArray(responseCommitOids) ||
    responseCommitOids.length < 1 ||
    responseCommitOids.length > 16
  ) {
    throw new TypeError(
      `${path}.responseCommitOids must contain one to sixteen commits`,
    );
  }
  const responseCommits = responseCommitOids.map((value, responseIndex) =>
    shaValue(value, `${path}.responseCommitOids[${responseIndex}]`),
  );
  if (
    new Set(responseCommits).size !== responseCommits.length ||
    !responseCommits.includes(mergedHeadOid)
  ) {
    throw new TypeError(
      `${path}.responseCommitOids must include the merged head once`,
    );
  }
  const mergedAt = timestampValue(input.mergedAt, `${path}.mergedAt`);
  const actor = actorValue(input.actor, `${path}.actor`);
  const review = reviewValue(input.review, `${path}.review`);
  if (review.commitId !== reviewedHeadOid) {
    throw new TypeError(`${path}.review.commitId must bind reviewedHeadOid`);
  }
  if (Date.parse(review.submittedAt) >= Date.parse(mergedAt)) {
    throw new TypeError(`${path}.review must precede the merge`);
  }
  const reviewUrl = urlValue(
    review.url,
    `${path}.review.url`,
    new RegExp(
      `^https://github\\.com/[^/]+/[^/]+/pull/${pullRequestNumber}#(?:pullrequestreview-[0-9]+|discussion_r[0-9]+)$`,
      "u",
    ),
  );
  if (githubRepositoryId(reviewUrl) !== repository) {
    throw new TypeError(`${path}.review.url must belong to ${repository}`);
  }
  const lifecycleReviewIds = input.lifecycleReviewIds;
  if (
    !Array.isArray(lifecycleReviewIds) ||
    lifecycleReviewIds.length < 1 ||
    lifecycleReviewIds.length > 8 ||
    !lifecycleReviewIds.every(
      (value) => typeof value === "string" && value.length > 0,
    ) ||
    new Set(lifecycleReviewIds).size !== lifecycleReviewIds.length ||
    !lifecycleReviewIds.includes(review.id)
  ) {
    throw new TypeError(
      `${path}.lifecycleReviewIds must be a distinct bounded review lifecycle`,
    );
  }
  const continuity = record(input.continuity, `${path}.continuity`);
  exactKeys(
    continuity,
    ["sourceSnapshotSha256", "decisionUrl"],
    `${path}.continuity`,
  );
  const sourceSnapshotSha256 = digestValue(
    continuity.sourceSnapshotSha256,
    `${path}.continuity.sourceSnapshotSha256`,
  );
  const decisionUrl = urlValue(
    continuity.decisionUrl,
    `${path}.continuity.decisionUrl`,
    /^https:\/\/github\.com\/SlopDotCash\/slopdotcash\/issues\/[1-9][0-9]*$/u,
  );
  const decision = input.decision;
  if (!RECOVERY_DECISIONS.includes(decision as PreCensusRecoveryDecision)) {
    throw new TypeError(`${path}.decision is invalid`);
  }
  const exclusionReason = input.exclusionReason;
  if (decision === "award" && exclusionReason !== undefined) {
    throw new TypeError(`${path}.exclusionReason is only valid for exclusions`);
  }
  if (
    decision === "exclude" &&
    (typeof exclusionReason !== "string" ||
      !RECOVERY_EXCLUSION_REASONS.includes(
        exclusionReason as (typeof RECOVERY_EXCLUSION_REASONS)[number],
      ))
  ) {
    throw new TypeError(`${path}.exclusionReason is required for exclusions`);
  }
  return {
    id: stringValue(input.id, `${path}.id`),
    decision: decision as PreCensusRecoveryDecision,
    repository,
    pullRequestNumber,
    pullRequestTitle: stringValue(
      input.pullRequestTitle,
      `${path}.pullRequestTitle`,
    ),
    pullRequestUrl,
    reviewedHeadOid,
    mergedHeadOid,
    mergeCommitOid,
    mergedAt,
    responseCommitOids: responseCommits,
    actor,
    review: { ...review, url: reviewUrl },
    lifecycleReviewIds: [...lifecycleReviewIds],
    continuity: { sourceSnapshotSha256, decisionUrl },
    ...(decision === "exclude"
      ? { exclusionReason: exclusionReason as ReviewExclusionReason }
      : {}),
  };
}

function recoveryPullRequestId(recovery: PreCensusReviewRecovery): string {
  const slug = recovery.repository.replace(/[^a-z0-9]+/giu, "_");
  return `PR_PRE_CENSUS_${slug}_${recovery.pullRequestNumber}`;
}

/**
 * V2 score events only validate with a lowercase ``wu_`` work unit. Mirrors the
 * merge convention ``wu_<repository>_pr_<number>`` plus the reviewer suffix so a
 * recovered review stays one work unit per pull request and actor.
 */
function recoveryWorkUnitId(recovery: PreCensusReviewRecovery): string {
  const repository = recovery.repository
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "_");
  const actor = recovery.actor.id.toLowerCase().replace(/[^a-z0-9_-]+/gu, "_");
  return `wu_${repository}_pr_${recovery.pullRequestNumber}_review_${actor}`;
}

/**
 * Replays the ordinary review award for one cutoff: a review submitted before
 * it keeps standard credit, and a later one only ever earns triage credit.
 */
function eventForRecovery(
  recovery: PreCensusReviewRecovery,
  reviewCutoff: string,
): ScoreEvent {
  const pullRequestId = recoveryPullRequestId(recovery);
  const standardCredit =
    Date.parse(recovery.review.submittedAt) < Date.parse(reviewCutoff);
  return {
    id: `${pullRequestId}:reviewer:${recovery.actor.id}`,
    actor: recovery.actor,
    category: "substantive-review",
    ...(standardCredit ? { points: 3 } : { points: 1 / 3, scoreThirds: 1 }),
    occurredAt: recovery.review.submittedAt,
    repository: recovery.repository,
    source: {
      id: recovery.review.id,
      kind: "review",
      number: recovery.pullRequestNumber,
      title: recovery.pullRequestTitle,
      url: recovery.review.url,
    },
    reason:
      "Recovered pre-census CHANGES_REQUESTED review whose accepted change is bound to the merged head.",
    continuity: recovery.continuity,
    workUnitId: recoveryWorkUnitId(recovery),
  };
}

function exclusionForRecovery(
  recovery: PreCensusReviewRecovery,
): ReviewExclusion {
  const pullRequestId = recoveryPullRequestId(recovery);
  return {
    id: `${pullRequestId}:review-exclusion:${recovery.review.id}`,
    reviewId: recovery.review.id,
    pullRequestId,
    pullRequestNumber: recovery.pullRequestNumber,
    repository: recovery.repository,
    url: recovery.review.url,
    reason: recovery.exclusionReason as ReviewExclusionReason,
  };
}

export function parsePreCensusReviewRecoveries(
  value: unknown,
): ParsedPreCensusReviewRecovery {
  const input = record(value, "pre-census recovery manifest");
  exactKeys(
    input,
    ["schemaVersion", "recoveries"],
    "pre-census recovery manifest",
  );
  if (input.schemaVersion !== "1") {
    throw new TypeError("pre-census recovery manifest schemaVersion must be 1");
  }
  if (!Array.isArray(input.recoveries) || input.recoveries.length > 64) {
    throw new TypeError(
      "pre-census recovery manifest must contain at most 64 records",
    );
  }
  const recoveries = input.recoveries.map(parseRecovery);
  const keys = recoveries.map(
    (recovery) => `${recovery.repository}\0${recovery.pullRequestNumber}`,
  );
  if (new Set(keys).size !== keys.length) {
    throw new TypeError(
      "pre-census recovery manifest must have one decision per pull request",
    );
  }
  const awards = recoveries.filter((recovery) => recovery.decision === "award");
  const events = awards.map((recovery) =>
    eventForRecovery(recovery, OUTCOME_FIRST_POLICY_AT),
  );
  const paymentEvents = awards.map((recovery) =>
    eventForRecovery(recovery, PAYMENT_REVIEW_POLICY_AT),
  );
  const exclusions = recoveries
    .filter((recovery) => recovery.decision === "exclude")
    .map(exclusionForRecovery);
  return { recoveries, events, paymentEvents, exclusions };
}
