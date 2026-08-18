import { findProject, type ProjectId } from "./projects.mjs";

const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const NODE_ID_PATTERN = /^[A-Za-z0-9_=-]{4,256}$/u;
const WORK_UNIT_PATTERN = /^wu_[a-z0-9][a-z0-9_-]{2,127}$/u;

export const SCORE_TIERS = {
  micro: 1,
  small: 3,
  medium: 9,
  large: 24,
  xl: 45,
  exceptional: 75,
} as const;

export type ScoreTier = keyof typeof SCORE_TIERS;

export interface ScoreRatificationRecord {
  schemaVersion: "1";
  ruleVersion: "slop-score-v2";
  projectId: ProjectId;
  pullRequestNodeId: string;
  headSha: string;
  workUnitId: string;
  tier: ScoreTier;
  scoreThirds: 1 | 3 | 9 | 24 | 45 | 75;
  proposalReviewNodeIds: string[];
  coRatifierNodeIds: string[];
  reason: string;
  supersedes: string | null;
}

export interface ScoreRatificationContext {
  projectId: ProjectId;
  pullRequestNodeId: string;
  headSha: string;
  sourceNodeId: string;
  authorAssociation: string | null | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface ScoreApprovalRecord {
  schemaVersion: "1";
  ruleVersion: "slop-score-v2";
  projectId: ProjectId;
  pullRequestNodeId: string;
  headSha: string;
  workUnitId: string;
  tier: ScoreTier;
  decision: "approve";
  reason: string;
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("score record must be an object");
  }
  return value as Record<string, unknown>;
}

export function assertScoreRatificationRecord(
  value: unknown,
): ScoreRatificationRecord {
  const record = object(value);
  const expected = [
    "coRatifierNodeIds",
    "headSha",
    "projectId",
    "proposalReviewNodeIds",
    "pullRequestNodeId",
    "reason",
    "ruleVersion",
    "schemaVersion",
    "scoreThirds",
    "supersedes",
    "tier",
    "workUnitId",
  ].sort();
  if (Object.keys(record).sort().join("\0") !== expected.join("\0")) {
    throw new TypeError("score record has unexpected or missing fields");
  }
  if (record.schemaVersion !== "1" || record.ruleVersion !== "slop-score-v2") {
    throw new TypeError("score record version is unsupported");
  }
  const project =
    typeof record.projectId === "string" ? findProject(record.projectId) : null;
  if (!project) throw new TypeError("score record project is not registered");
  if (
    typeof record.pullRequestNodeId !== "string" ||
    !NODE_ID_PATTERN.test(record.pullRequestNodeId)
  )
    throw new TypeError("score record pullRequestNodeId is invalid");
  if (
    typeof record.headSha !== "string" ||
    !GIT_SHA_PATTERN.test(record.headSha)
  )
    throw new TypeError("score record headSha is invalid");
  if (
    typeof record.workUnitId !== "string" ||
    !WORK_UNIT_PATTERN.test(record.workUnitId)
  )
    throw new TypeError("score record workUnitId is invalid");
  const tier = record.tier as ScoreTier;
  if (!(tier in SCORE_TIERS) || record.scoreThirds !== SCORE_TIERS[tier])
    throw new TypeError("score record tier and scoreThirds do not match");
  if (
    !Array.isArray(record.proposalReviewNodeIds) ||
    record.proposalReviewNodeIds.length > 16 ||
    record.proposalReviewNodeIds.some(
      (id) => typeof id !== "string" || !NODE_ID_PATTERN.test(id),
    ) ||
    new Set(record.proposalReviewNodeIds).size !==
      record.proposalReviewNodeIds.length
  )
    throw new TypeError("score record proposalReviewNodeIds is invalid");
  if (tier !== "micro" && record.proposalReviewNodeIds.length === 0) {
    throw new TypeError("non-micro scores require a Claude review proposal");
  }
  if (
    !Array.isArray(record.coRatifierNodeIds) ||
    record.coRatifierNodeIds.length > 8 ||
    record.coRatifierNodeIds.some(
      (id) => typeof id !== "string" || !NODE_ID_PATTERN.test(id),
    ) ||
    new Set(record.coRatifierNodeIds).size !== record.coRatifierNodeIds.length
  )
    throw new TypeError("score record coRatifierNodeIds is invalid");
  if (
    (tier === "xl" || tier === "exceptional") &&
    record.coRatifierNodeIds.length < 1
  )
    throw new TypeError("XL and exceptional scores require a co-ratifier");
  if (
    typeof record.reason !== "string" ||
    record.reason.length < 12 ||
    record.reason.length > 4096
  )
    throw new TypeError("score record reason is invalid");
  if (
    record.supersedes !== null &&
    (typeof record.supersedes !== "string" ||
      !NODE_ID_PATTERN.test(record.supersedes))
  )
    throw new TypeError("score record supersedes is invalid");
  return record as unknown as ScoreRatificationRecord;
}

export function parseScoreRatificationBlock(body: string): unknown | null {
  const matches = [
    ...body.matchAll(
      /^ {0,3}```slop-score[\t ]*\r?\n([^\r\n]{1,32768})\r?\n {0,3}```[\t ]*$/gmu,
    ),
  ];
  if (matches.length > 1)
    throw new TypeError("source must contain at most one slop-score record");
  if (matches.length === 0) return null;
  try {
    return JSON.parse(matches[0][1]);
  } catch {
    throw new TypeError("slop-score record JSON is malformed");
  }
}

export function parseScoreApprovalBlock(body: string): unknown | null {
  const matches = [
    ...body.matchAll(
      /^ {0,3}```slop-score-approval[\t ]*\r?\n([^\r\n]{1,32768})\r?\n {0,3}```[\t ]*$/gmu,
    ),
  ];
  if (matches.length > 1)
    throw new TypeError(
      "source must contain at most one slop-score-approval record",
    );
  if (matches.length === 0) return null;
  try {
    return JSON.parse(matches[0][1]);
  } catch {
    throw new TypeError("slop-score-approval JSON is malformed");
  }
}

export function assertScoreApprovalRecord(
  value: unknown,
  expected: ScoreRatificationRecord,
): ScoreApprovalRecord {
  const approval = object(value);
  const keys = [
    "decision",
    "headSha",
    "projectId",
    "pullRequestNodeId",
    "reason",
    "ruleVersion",
    "schemaVersion",
    "tier",
    "workUnitId",
  ].sort();
  if (Object.keys(approval).sort().join("\0") !== keys.join("\0"))
    throw new TypeError("score approval has unexpected or missing fields");
  if (
    approval.schemaVersion !== "1" ||
    approval.ruleVersion !== "slop-score-v2" ||
    approval.decision !== "approve"
  )
    throw new TypeError("score approval header is invalid");
  if (
    approval.projectId !== expected.projectId ||
    approval.pullRequestNodeId !== expected.pullRequestNodeId ||
    approval.headSha !== expected.headSha ||
    approval.workUnitId !== expected.workUnitId ||
    approval.tier !== expected.tier
  )
    throw new TypeError("score approval does not match the ratified decision");
  if (
    typeof approval.reason !== "string" ||
    approval.reason.length < 12 ||
    approval.reason.length > 4096
  )
    throw new TypeError("score approval reason is invalid");
  return approval as unknown as ScoreApprovalRecord;
}

export function assertScoreRatificationContext(
  value: unknown,
  context: ScoreRatificationContext,
): ScoreRatificationRecord {
  const record = assertScoreRatificationRecord(value);
  if (
    !["OWNER", "MEMBER", "COLLABORATOR"].includes(
      context.authorAssociation ?? "",
    )
  )
    throw new TypeError("slop-score author is not a maintainer");
  if (context.createdAt !== context.updatedAt)
    throw new TypeError(
      "slop-score source was edited; append a successor instead",
    );
  if (
    record.projectId !== context.projectId ||
    record.pullRequestNodeId !== context.pullRequestNodeId ||
    record.headSha !== context.headSha.toLowerCase()
  )
    throw new TypeError(
      "slop-score record does not match the exact pull request head",
    );
  if (record.supersedes === context.sourceNodeId)
    throw new TypeError("slop-score record cannot supersede itself");
  return record;
}
