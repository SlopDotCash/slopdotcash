/**
 * Defines the public contribution snapshot and the deterministic scoring policy
 * for slop.cash. GitHub ingestion stays outside this module so fixtures can
 * prove every award, exclusion, cap, and provenance rule without network access.
 */

import {
  isExactClientIdentifier,
  isExactModelIdentifier,
  isExactProviderIdentifier,
  isExactProviderModelIdentifier,
} from "./model-identity";
import { findProject } from "./projects.mjs";
import {
  findTargetRepository,
  findTargetRepositoryById,
  PRIMARY_REPOSITORY,
  type RepositoryId,
  TARGET_REPOSITORIES,
  type TargetRepository,
} from "./repositories.mjs";
import {
  assertReviewRecord,
  assertReviewRecordReceiptJoin,
  parseReviewRecordBlock,
  type ReviewRecord,
} from "./review-records";
import {
  assertProjectRunReceipt,
  assertRunReceiptMarker,
  assertRunReceiptPolicyJoin,
  type ProjectRunReceipt,
} from "./run-receipts";
import {
  assertScoreApprovalRecord,
  assertScoreRatificationContext,
  parseScoreApprovalBlock,
  parseScoreRatificationBlock,
  type ScoreRatificationRecord,
} from "./score-records";

export {
  PRIMARY_REPOSITORY,
  type RepositoryId,
  TARGET_REPOSITORIES,
  type TargetRepository,
} from "./repositories.mjs";

/** Backward-compatible alias for the primary registry repository. */
export const LEADERBOARD_REPOSITORY = PRIMARY_REPOSITORY.id;
export const LEADERBOARD_SCHEMA_VERSION = "6" as const;
export const PROFILE_OPPORTUNITY_LIMIT = 5 as const;
export const SCORE_RULE_VERSION = "slop-score-v2" as const;
export const SCORE_V2_EFFECTIVE_AT = "2026-08-01T00:00:00.000Z" as const;
const USAGE_NEUTRAL_EVIDENCE_POLICY_AT = "2026-08-19T00:00:00.000Z" as const;
// A 35-day collection window guarantees a complete prior UTC calendar month;
// project reward views still exclude everything before their reward start.
export const SCORE_WINDOW_DAYS = 35;
export const VERIFICATION_WINDOW_DAYS = 35;
export const MATERIAL_TEST_ADDITIONS = 10;
export const MATERIAL_TEST_CHURN = 20;
export const CLAIM_MAX_AGE_DAYS = 7;
export const SCORE_CAPS = {
  mergedPullRequests: null,
  resolvedIssues: 5,
  materialTestChanges: 5,
  evidencePoints: 30,
  substantiveReviews: 10,
  evaluatedContributions: 3,
} as const;
export const DETAILED_MERGED_PULL_REQUESTS_PER_MONTH = 5;

/**
 * Gives every accepted merge positive credit while reducing the marginal
 * reward for repeated outcomes in the same project and UTC month.
 */
export function mergedPullRequestPoints(ordinal: number): number {
  if (!Number.isSafeInteger(ordinal) || ordinal < 1) {
    throw new TypeError(
      "merged pull request ordinal must be a positive integer",
    );
  }
  return Math.max(1, Math.ceil(10 / Math.sqrt(ordinal)));
}

export type GitHubActorKind =
  | "Bot"
  | "Mannequin"
  | "Organization"
  | "User"
  | "Unknown";

export interface GitHubActor {
  id: string;
  login: string;
  avatarUrl: string;
  url: string;
  kind: GitHubActorKind;
}

export interface GitHubLabel {
  id: string;
  name: string;
  color: string;
}

export interface GitHubTextSource {
  id: string;
  artifactId: string;
  kind: "body" | "comment" | "review";
  body: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  author: GitHubActor | null;
  authorAssociation?: string | null;
  artifactUrl?: string;
  artifactHeadSha?: string;
}

export interface PullRequestFile {
  path: string;
  additions: number;
  deletions: number;
}

export interface PullRequestReview {
  id: string;
  body: string;
  state:
    | "APPROVED"
    | "CHANGES_REQUESTED"
    | "COMMENTED"
    | "DISMISSED"
    | "PENDING"
    | string;
  submittedAt: string | null;
  url: string;
  author: GitHubActor | null;
  inlineCommentCount: number;
}

export interface PullRequestRecord {
  id: string;
  number: number;
  title: string;
  url: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  lastEditedAt: string | null;
  /**
   * GitHub's last body editor. Used only to distinguish author post-merge
   * evidence farming from third-party (usually maintainer) body touches that
   * must not void a head-pinned pre-merge evidence package.
   */
  editor: GitHubActor | null;
  mergedAt: string | null;
  headRefOid: string;
  isDraft: boolean;
  reviewDecision: string | null;
  activeReviewRequestCount: number;
  author: GitHubActor | null;
  assignees: GitHubActor[];
  labels: GitHubLabel[];
  files: PullRequestFile[];
  comments: GitHubTextSource[];
  reviews: PullRequestReview[];
  closingIssueIds: string[];
  additions: number;
  deletions: number;
  changedFiles: number;
  commitCount: number;
}

export interface MergedPullRequestOutcome {
  id: string;
  number: number;
  title: string;
  url: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  mergedAt: string;
  author: GitHubActor | null;
  additions: number;
  deletions: number;
}

export interface IssueRecord {
  id: string;
  number: number;
  title: string;
  url: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  stateReason: "COMPLETED" | "NOT_PLANNED" | "REOPENED" | null | string;
  author: GitHubActor | null;
  assignees: GitHubActor[];
  labels: GitHubLabel[];
  comments: GitHubTextSource[];
  closedByPullRequests: Array<{
    id: string;
    number: number;
    url: string;
    mergedAt: string | null;
    body: string;
    createdAt: string;
    updatedAt: string;
    author: GitHubActor | null;
  }>;
}

export type EvidenceCategory =
  | "screenshot"
  | "video"
  | "logs"
  | "trajectory"
  | "domain-artifact";

export interface EvidenceFinding {
  category: EvidenceCategory;
  points: number;
  sourceIds: string[];
}

export interface EvidenceAssessment {
  points: number;
  maxPoints: 6;
  categories: EvidenceCategory[];
  findings: EvidenceFinding[];
}

/**
 * Records one artifact that the live generator fetched and structurally
 * verified. The source body is retained only in the in-memory generation input
 * so a verdict cannot be replayed after a PR body or comment is edited.
 */
export interface VerifiedEvidenceArtifact {
  pullRequestId: string;
  pullRequestMergedAt: string | null;
  pullRequestHeadOid: string;
  pullRequestUpdatedAt: string;
  sourceId: string;
  sourceBody: string;
  sourceUpdatedAt: string;
  category: EvidenceCategory;
  artifactIdentity: string;
  contentSha256: string;
}

export interface InvalidAttributionMarker {
  sourceId: string;
  sourceUrl: string;
  reason: string;
}

export interface ModelAttribution {
  id: string;
  sourceId: string;
  sourceUrl: string;
  artifactId: string;
  actor: GitHubActor | null;
  provider: string;
  model: string;
  identifier: string;
  client: string | null;
  skillRevision: string | null;
  run: ProjectRunReceipt | null;
  format: "machine-marker" | "visible-declaration";
  status: "self-reported";
}

export interface AttributionAssessment {
  declarations: ModelAttribution[];
  invalidMarkers: InvalidAttributionMarker[];
  coverage: AttributionCoverage;
}

export interface AttributionAssessmentOptions {
  requireEverySource?: boolean;
  verifyRunReceipt?: (value: unknown) => ProjectRunReceipt;
}

export interface AttributionCoverage {
  status: "complete" | "partial" | "missing" | "invalid";
  eligibleSourceCount: number;
  validSourceCount: number;
  missingSourceCount: number;
  invalidSourceCount: number;
  humanOnlySourceCount: number;
}

export type ScoreCategory =
  | "merged-pull-request"
  | "resolved-issue"
  | "material-test-change"
  | "evidence"
  | "substantive-review"
  | "evaluated-contribution";

export interface ScoreEvent {
  id: string;
  actor: GitHubActor;
  category: ScoreCategory;
  points: number;
  scoreThirds?: number;
  evidenceBonusBasisPoints?: 0 | 1_000 | 1_500 | 2_500;
  workUnitId?: string;
  scoreDecisionSourceId?: string;
  occurredAt: string;
  repository: RepositoryId;
  source: {
    id: string;
    kind: "comment" | "issue" | "pull-request" | "review";
    number: number;
    title: string;
    url: string;
  };
  reason: string;
  evaluation?: {
    decisionUrl: string;
    reviewedAt: string;
    reviewer: string;
    manifestPath: string;
    manifestSha256: string;
  };
}

export type ScoreOpportunityKind =
  | "near-material-test"
  | "expand-review"
  | "missing-evidence"
  | "partial-evidence";

/** Still-actionable scoring opportunities for public profile guidance. */
export interface ScoreOpportunity {
  id: string;
  actor: GitHubActor;
  kind: ScoreOpportunityKind;
  category: ScoreCategory;
  potentialPoints: number;
  occurredAt: string;
  repository: RepositoryId;
  source: ScoreEvent["source"];
  reason: string;
  hint: string;
}

export interface CapUsageBucket {
  used: number;
  cap: number | null;
}

/** Per-contributor monthly cap fill for compact profile status lines. */
export interface CapUsageStatus {
  month: string;
  mergedPullRequests: CapUsageBucket;
  resolvedIssues: CapUsageBucket;
  materialTestChanges: CapUsageBucket;
  evidencePoints: CapUsageBucket;
  substantiveReviews: CapUsageBucket;
  evaluatedContributions: CapUsageBucket;
}

export interface LeaderboardEntry {
  rank: number;
  actor: GitHubActor;
  score: number;
  scoreThirds: number;
  points: {
    mergedPullRequests: number;
    resolvedIssues: number;
    materialTestChanges: number;
    evidence: number;
    substantiveReviews: number;
    evaluatedContributions: number;
  };
  pointThirds: {
    mergedPullRequests: number;
    resolvedIssues: number;
    materialTestChanges: number;
    evidence: number;
    substantiveReviews: number;
    evaluatedContributions: number;
  };
  acceptedOutcomes: {
    mergedPullRequests: number;
    resolvedIssues: number;
    materialTestChanges: number;
    evidenceCategories: number;
    substantiveReviews: number;
    evaluatedContributions: number;
  };
  rawActivity: {
    comments: number;
    reviews: number;
    commits: number;
    additions: number;
    deletions: number;
  };
  reportedModels: string[];
}

export interface WorkItemClaimStatus {
  status: "claimed" | "unclaimed";
  source: "assignee" | "label" | "claim-comment" | "none";
  kind: "implementation" | "review" | null;
  actors: GitHubActor[];
  claimedAt: string | null;
}

export interface WorkItemEvidenceStatus {
  status: "complete" | "partial" | "missing";
  points: number;
  maxPoints: 6;
  categories: EvidenceCategory[];
}

export interface WorkItemModelStatus {
  status: AttributionCoverage["status"];
  identifiers: string[];
  machineMarkerCount: number;
  invalidMarkerCount: number;
  eligibleSourceCount: number;
  validSourceCount: number;
  missingSourceCount: number;
  invalidSourceCount: number;
  humanOnlySourceCount: number;
  provenance: "self-reported" | "none";
}

export type WorkItemCandidateExclusion =
  | "active-review-request"
  | "already-approved"
  | "blocked"
  | "bot-authored"
  | "changes-requested"
  | "claimed"
  | "draft"
  | "security-sensitive"
  | "untriaged"
  | "unknown-author";

export interface WorkItemSelection {
  status: "candidate" | "excluded";
  reasons: WorkItemCandidateExclusion[];
}

export interface WorkItem {
  id: string;
  kind: "issue" | "pull-request";
  number: number;
  title: string;
  url: string;
  repository: RepositoryId;
  author: GitHubActor | null;
  createdAt: string;
  updatedAt: string;
  labels: string[];
  priority: "urgent" | "high" | "normal" | "low";
  actionability: "actionable" | "blocked" | "draft";
  isDraft: boolean | null;
  reviewDecision: string | null;
  activeReviewRequestCount: number | null;
  commentCount: number;
  claim: WorkItemClaimStatus;
  selection: WorkItemSelection;
  evidence: WorkItemEvidenceStatus;
  model: WorkItemModelStatus;
}

export interface LeaderboardMethodology {
  summary: string;
  scoringRules: Array<{
    id: ScoreCategory;
    points: string;
    cap: string;
    qualification: string;
  }>;
  evidenceWeights: Record<EvidenceCategory, number>;
  materialTestThreshold: {
    minimumAdditions: number;
    minimumTotalChurn: number;
    cap: string;
  };
  exclusions: string[];
  nonScoringActivity: string[];
  provenancePolicy: string;
  collectionPolicy: string;
}

export interface LeaderboardSourceMetadata {
  provider: "github-graphql";
  fetchedAt: string;
  cutoffAt: string;
  repositoryId: string;
  repositories: Array<{ id: RepositoryId; repositoryId: string }>;
  requestCount: number;
  searchSliceCount: number;
  rateLimit: {
    cost: number;
    consumedDuringRun?: number;
    limit: number;
    remaining: number;
    resetAt: string;
  };
  counts: {
    mergedPullRequests: number;
    detailedMergedPullRequests: number;
    closedIssues: number;
    detailedClosedIssues: number;
    resolvedIssues: number;
    openIssues: number;
    openPullRequests: number;
  };
  verificationWindow: {
    days: number;
    from: string;
    to: string;
  };
  evidenceVerification: {
    status: "complete" | "suppressed-limit";
    sourceCount: number;
    artifactCount: number;
    maxSources: number;
    maxArtifacts: number;
  };
}

export interface LeaderboardSnapshot {
  schemaVersion: typeof LEADERBOARD_SCHEMA_VERSION;
  repository: typeof LEADERBOARD_REPOSITORY;
  repositories: Omit<TargetRepository, "aliases" | "expectedNodeId">[];
  ruleVersion: typeof SCORE_RULE_VERSION;
  generatedAt: string;
  sourceUpdatedAt: string;
  stale: false;
  window: {
    days: number;
    from: string;
    to: string;
  };
  methodology: LeaderboardMethodology;
  source: LeaderboardSourceMetadata;
  leaders: LeaderboardEntry[];
  ledger: ScoreEvent[];
  opportunities: ScoreOpportunity[];
  attributions: ModelAttribution[];
  invalidAttributionMarkers: InvalidAttributionMarker[];
  attributionCoverage: AttributionCoverage;
  workQueue: {
    issues: WorkItem[];
    pullRequests: WorkItem[];
  };
}

export interface LeaderboardInput {
  generatedAt: string;
  windowFrom: string;
  windowTo: string;
  sourceUpdatedAt: string;
  source: LeaderboardSourceMetadata;
  mergedPullRequestOutcomes: MergedPullRequestOutcome[];
  mergedPullRequests: PullRequestRecord[];
  closedIssueCount: number;
  resolvedIssues: IssueRecord[];
  openIssues: IssueRecord[];
  openPullRequests: PullRequestRecord[];
  verificationWindowFrom: string;
  verifiedEvidence: VerifiedEvidenceArtifact[];
  evaluatedContributions?: ScoreEvent[];
  verifyRunReceipt?: (value: unknown) => ProjectRunReceipt;
}

const EVIDENCE_WEIGHTS: Record<EvidenceCategory, number> = {
  screenshot: 1,
  video: 2,
  logs: 1,
  trajectory: 1,
  "domain-artifact": 1,
};

const CONFIRMATION_LABELS = new Set([
  "confirmed",
  "status: confirmed",
  "status: triaged",
  "triaged",
  "validated",
]);

const CONTRIBUTOR_READY_LABELS = new Set([
  "bug-confirmed",
  "demo-blocker",
  "good first issue",
  "help wanted",
  "launch-qa",
  "needs-review",
  "needs testing",
  "p0",
  "p1",
  "p2",
  "priority: high",
  "triage-reviewed",
]);

const TRUSTED_CLAIM_ASSOCIATIONS = new Set(["COLLABORATOR", "MEMBER", "OWNER"]);

const ISSUE_CLAIM_LABEL_PATTERN =
  /^(?:(?:claimed|in[- ]progress|working)(?:\s*:\s*[a-z0-9][a-z0-9._/-]*)?|status:\s*(?:claimed|in[- ]progress))$/i;

const REVIEW_CLAIM_LABEL_PATTERN =
  /^(?:(?:review[- ]claimed|review[- ]in[- ]progress)(?:\s*:\s*[a-z0-9][a-z0-9._/-]*)?|review:\s*claimed)$/i;

const BLOCKED_LABEL_PATTERN =
  /^(?:blocked|do[- ]not[- ]merge|human[- ]only|needs[- ]human(?:[- ](?:input|review|verify|verification))?|needs[- ]shaw|status\s*[:/]\s*(?:blocked|proposal|human[- ]only|needs[- ]human(?:[- ](?:input|review|verify|verification))?|needs[- ]shaw))$/i;

const EPIC_TITLE_PATTERN = /^\s*(?:\[[^\]]*\bepic\b[^\]]*\]|epic\s*:)/i;
const EPIC_LABEL_PATTERN = /^epic(?:\s+\d+)?$/i;

function isEpicIssue(title: string, labels: string[]): boolean {
  return (
    EPIC_TITLE_PATTERN.test(title) ||
    labels.some((label) => EPIC_LABEL_PATTERN.test(label.trim()))
  );
}

const SECURITY_SENSITIVE_LABEL_PATTERN =
  /(?:^|[-_ ])(?:security|vulnerability|credential[-_ ]?leak|secret[-_ ]?leak|cve)(?:$|[-_ ])/i;

const URGENT_LABELS = new Set([
  "blocker",
  "critical",
  "p0",
  "priority: critical",
  "priority: urgent",
  "urgent",
]);

const HIGH_PRIORITY_LABELS = new Set(["high priority", "p1", "priority: high"]);

const LOW_PRIORITY_LABELS = new Set([
  "low priority",
  "p3",
  "p4",
  "priority: low",
]);

const EXACT_MODEL_IDENTIFIER_PATTERN =
  /\b([a-z0-9][a-z0-9._+~-]{0,63})\/([a-z0-9][a-z0-9._:/+~-]{0,127})\b/gi;
const FULL_SKILL_REVISION_PATTERN =
  /^[a-z0-9_.-]+\/[a-z0-9_.-]+@[0-9a-f]{40}:[^\s`]+$/i;
const HUMAN_ONLY_PATTERN =
  /^\s*(?:[-*]\s*)?(?:(?:AI assistance|Attribution)\s*:\s*)?`?(?:no\s*[-—:]\s*)?human[- ]only\s+(?:comment|contribution|epic|issue|report|request|review|work)`?\s*$/im;
const ISSUE_CLAIM_PATTERN = /^CLAIMING:\s*\S/i;
const REVIEW_CLAIM_PATTERN = /^CLAIMING\s+REVIEW:\s*\S/i;
const ATTRIBUTION_DECLARATION_PATTERN =
  /^(?:AI provider\/model\s*:|AI assistance\s*:\s*yes\b|Models?(?:\s+used)?\s*:|Model\(s\)\s+used\s*:|Client\s*\/\s*agent tooling\s*:|Contribution skill revision\s*:)/i;
const ATTRIBUTION_MARKER_LINE_PATTERN =
  /^<!--\s*(?:(?:elizaos-contribution|eliza-computer)-attribution:v[12]|slop-contribution-attribution:v1)\b[^\r\n]*-->\s*$/i;

interface MutableLeaderboardEntry {
  actor: GitHubActor;
  score: number;
  scoreThirds: number;
  points: LeaderboardEntry["points"];
  pointThirds: LeaderboardEntry["pointThirds"];
  acceptedOutcomes: LeaderboardEntry["acceptedOutcomes"];
  rawActivity: LeaderboardEntry["rawActivity"];
  models: Set<string>;
  projectCapUsage: Map<
    string,
    {
      acceptedOutcomes: LeaderboardEntry["acceptedOutcomes"];
      evidencePoints: number;
    }
  >;
  creditedWorkUnits: Set<string>;
}

interface AttributionDeclarationLine {
  end: number;
  normalized: string;
  raw: string;
  start: number;
}

interface AttributionMarkerRecord {
  end: number;
  payload: string;
  start: number;
  version: "v1" | "v2";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase();
}

function attributionDeclarationLineRecords(
  body: string,
): AttributionDeclarationLine[] {
  const records: AttributionDeclarationLine[] = [];
  let fence: { character: "`" | "~"; length: number } | null = null;
  let offset = 0;
  while (offset <= body.length) {
    const newline = body.indexOf("\n", offset);
    const physicalEnd = newline === -1 ? body.length : newline;
    const raw = body.slice(offset, physicalEnd);
    const sourceLine = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const fenceMatch = sourceLine.match(
      /^\s{0,3}(?:(?:[-*+]|\d+[.)])\s+)?(`{3,}|~{3,})(.*)$/,
    );
    if (fenceMatch) {
      const marker = fenceMatch[1];
      const character = marker[0] as "`" | "~";
      if (fence === null) {
        fence = { character, length: marker.length };
      } else if (
        character === fence.character &&
        marker.length >= fence.length &&
        fenceMatch[2].trim().length === 0
      ) {
        fence = null;
      }
      if (newline === -1) break;
      offset = newline + 1;
      continue;
    }
    if (
      fence !== null ||
      /^\s{0,3}>/.test(sourceLine) ||
      /^(?:\t| {4})/.test(sourceLine)
    ) {
      if (newline === -1) break;
      offset = newline + 1;
      continue;
    }
    const line = sourceLine
      .trim()
      .replace(/^(?:[-*+]|\d+[.)])\s+/, "")
      .replaceAll("**", "")
      .replaceAll("__", "");
    if (!line.startsWith("`")) {
      records.push({
        end: offset + sourceLine.length,
        normalized: line,
        raw: sourceLine,
        start: offset,
      });
    }
    if (newline === -1) break;
    offset = newline + 1;
  }
  return records;
}

function attributionDeclarationLines(body: string): string[] {
  return attributionDeclarationLineRecords(body).map(
    (record) => record.normalized,
  );
}

function attributionMarkerRecords(body: string): AttributionMarkerRecord[] {
  return attributionDeclarationLineRecords(body)
    .map((record) => {
      const raw = record.raw.trim();
      const marker = raw.match(
        /^<!--\s*(?:(?:elizaos-contribution|eliza-computer)-attribution:(v[12])|(slop-contribution-attribution:v1))\b([\s\S]*?)-->\s*$/i,
      );
      if (!marker) return null;
      const leadingWhitespace =
        record.raw.length - record.raw.trimStart().length;
      return {
        end: record.start + leadingWhitespace + raw.length,
        payload: marker[3].trim(),
        start: record.start + leadingWhitespace,
        version: marker[2] ? "v2" : (marker[1].toLowerCase() as "v1" | "v2"),
      };
    })
    .filter((record): record is AttributionMarkerRecord => record !== null);
}

function hasAttributionEligibilitySignal(body: string): boolean {
  return (
    /^ {0,3}```slop-review[\t ]*$/mu.test(body) ||
    attributionDeclarationLines(body).some(
      (line) =>
        ATTRIBUTION_DECLARATION_PATTERN.test(line) ||
        ATTRIBUTION_MARKER_LINE_PATTERN.test(line),
    )
  );
}

function hasMarkdownLine(body: string, pattern: RegExp): boolean {
  return attributionDeclarationLines(body).some((line) => pattern.test(line));
}

/**
 * Resolves a GitHub artifact URL to its registry repository id. GitHub treats
 * owner and name case-insensitively, so the canonical registry id is returned
 * regardless of URL casing; a URL outside the registry fails closed.
 */
export function repositoryIdFromUrl(url: string): RepositoryId {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // error-policy:J3 a malformed artifact URL cannot receive attribution.
    throw new Error(`Cannot derive a target repository from URL: ${url}`);
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  const repository =
    parsed.origin === "https://github.com" &&
    !parsed.username &&
    !parsed.password &&
    !parsed.search &&
    (!parsed.hash ||
      /^#(?:issuecomment-|pullrequestreview-|discussion_r)[0-9]+$/iu.test(
        parsed.hash,
      )) &&
    segments.length >= 2
      ? findTargetRepository(segments[0], segments[1])
      : null;
  if (!repository) {
    throw new Error(`URL is outside the target repository registry: ${url}`);
  }
  return repository.id;
}

function parseIsoTime(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ISO timestamp: ${value}`);
  }
  return parsed;
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareRankedEntries(
  left: Pick<MutableLeaderboardEntry, "actor" | "scoreThirds">,
  right: Pick<MutableLeaderboardEntry, "actor" | "scoreThirds">,
): number {
  return (
    right.scoreThirds - left.scoreThirds ||
    compareCodeUnits(
      left.actor.login.toLowerCase(),
      right.actor.login.toLowerCase(),
    ) ||
    compareCodeUnits(left.actor.login, right.actor.login) ||
    compareCodeUnits(left.actor.id, right.actor.id)
  );
}

export function dedupeByNodeId<T extends { id: string }>(records: T[]): T[] {
  const byId = new Map<string, T>();
  for (const record of records) {
    if (!record.id) {
      throw new Error("GitHub record is missing its immutable node ID");
    }
    if (!byId.has(record.id)) {
      byId.set(record.id, record);
    }
  }
  return [...byId.values()];
}

export function isBotActor(actor: GitHubActor | null): boolean {
  if (!actor) {
    return false;
  }
  if (actor.kind === "Bot") {
    return true;
  }
  return (
    /\[bot\]$/i.test(actor.login) ||
    /(?:^|[-_])bot$/i.test(actor.login) ||
    /^(?:dependabot|github-actions|renovate)$/i.test(actor.login)
  );
}

export function isRecognizedTestFile(path: string): boolean {
  const normalized = path.toLowerCase();
  if (
    normalized.includes("/__snapshots__/") ||
    normalized.includes("/fixtures/") ||
    normalized.includes("/testdata/")
  ) {
    return false;
  }
  return (
    /(^|\/)(?:__tests__|tests?|specs?|e2e)\//.test(normalized) ||
    /(?:^|[._-])(?:test|spec)\.[a-z0-9]+$/.test(normalized) ||
    /_test\.[a-z0-9]+$/.test(normalized) ||
    /\.feature$/.test(normalized)
  );
}

export function materialTestStats(files: PullRequestFile[]): {
  additions: number;
  churn: number;
} {
  const testFiles = files.filter((file) => isRecognizedTestFile(file.path));
  const additions = testFiles.reduce(
    (total, file) => total + file.additions,
    0,
  );
  const churn = testFiles.reduce(
    (total, file) => total + file.additions + file.deletions,
    0,
  );
  return { additions, churn };
}

export function hasMaterialTestChange(files: PullRequestFile[]): boolean {
  const { additions, churn } = materialTestStats(files);
  return additions >= MATERIAL_TEST_ADDITIONS && churn >= MATERIAL_TEST_CHURN;
}

/** Open PRs with non-trivial test progress that still miss the published bar. */
export function isNearMaterialTestChange(files: PullRequestFile[]): boolean {
  if (hasMaterialTestChange(files)) {
    return false;
  }
  const { additions, churn } = materialTestStats(files);
  return (
    additions >= Math.ceil(MATERIAL_TEST_ADDITIONS / 2) ||
    churn >= Math.ceil(MATERIAL_TEST_CHURN / 2)
  );
}

const EVIDENCE_CATEGORIES: readonly EvidenceCategory[] = [
  "screenshot",
  "video",
  "logs",
  "trajectory",
  "domain-artifact",
];

interface EvidenceClaim {
  category: EvidenceCategory;
  sourceId: string;
}

function addEvidenceClaim(
  claims: Map<string, EvidenceClaim[]>,
  identity: string,
  claim: EvidenceClaim,
): void {
  const current = claims.get(identity) ?? [];
  current.push(claim);
  claims.set(identity, current);
}

export function assessEvidence(
  sources: GitHubTextSource[],
  verifiedEvidence: VerifiedEvidenceArtifact[] = [],
): EvidenceAssessment {
  const claims = new Map<string, EvidenceClaim[]>();
  const sourceIds = new Map<EvidenceCategory, Set<string>>();
  const sourcesById = new Map(
    dedupeByNodeId(sources)
      .filter(
        (source) =>
          source.kind === "body" &&
          (!source.author || !isBotActor(source.author)),
      )
      .map((source) => [source.id, source]),
  );

  // URL parsing and normalization belong to the remote verifier; scoring only
  // rebinds its identity to the exact source revision that was verified.
  for (const artifact of verifiedEvidence) {
    const source = sourcesById.get(artifact.sourceId);
    if (
      !source ||
      source.artifactId !== artifact.pullRequestId ||
      source.updatedAt !== artifact.sourceUpdatedAt ||
      source.body !== artifact.sourceBody ||
      artifact.artifactIdentity.length === 0
    ) {
      continue;
    }
    addEvidenceClaim(claims, artifact.artifactIdentity, {
      category: artifact.category,
      sourceId: source.id,
    });
  }

  for (const artifactClaims of claims.values()) {
    const categories = new Set(artifactClaims.map((claim) => claim.category));
    if (categories.size !== 1) {
      continue;
    }
    const category = categories.values().next().value;
    if (!category) {
      continue;
    }
    const ids = sourceIds.get(category) ?? new Set<string>();
    for (const claim of artifactClaims) {
      ids.add(claim.sourceId);
    }
    sourceIds.set(category, ids);
  }

  const findings = [...sourceIds.entries()]
    .map(([category, ids]) => ({
      category,
      points: EVIDENCE_WEIGHTS[category],
      sourceIds: [...ids].sort(),
    }))
    .sort((left, right) => left.category.localeCompare(right.category));
  const points = Math.min(
    6,
    findings.reduce((total, finding) => total + finding.points, 0),
  );

  return {
    points,
    maxPoints: 6,
    categories: findings.map((finding) => finding.category),
    findings,
  };
}

/** Keeps one deterministic owner for a canonical URL or identical content. */
export function selectUniqueVerifiedEvidence(
  artifacts: VerifiedEvidenceArtifact[],
  pullRequests: PullRequestRecord[],
): VerifiedEvidenceArtifact[] {
  const categoryOrder = new Map<EvidenceCategory, number>(
    EVIDENCE_CATEGORIES.map((category, index) => [category, index]),
  );
  const pullRequestOrder = new Map(
    [...pullRequests]
      .sort(
        (left, right) =>
          Number(left.mergedAt === null) - Number(right.mergedAt === null) ||
          (left.mergedAt ?? left.updatedAt).localeCompare(
            right.mergedAt ?? right.updatedAt,
          ) ||
          left.number - right.number ||
          left.id.localeCompare(right.id),
      )
      .map((pullRequest, index) => [pullRequest.id, index]),
  );
  const claimedIdentities = new Set<string>();
  const claimedDigests = new Set<string>();
  return [...artifacts]
    .sort(
      (left, right) =>
        (pullRequestOrder.get(left.pullRequestId) ?? Number.MAX_SAFE_INTEGER) -
          (pullRequestOrder.get(right.pullRequestId) ??
            Number.MAX_SAFE_INTEGER) ||
        (categoryOrder.get(left.category) ?? Number.MAX_SAFE_INTEGER) -
          (categoryOrder.get(right.category) ?? Number.MAX_SAFE_INTEGER) ||
        left.artifactIdentity.localeCompare(right.artifactIdentity),
    )
    .filter((artifact) => {
      if (
        claimedIdentities.has(artifact.artifactIdentity) ||
        claimedDigests.has(artifact.contentSha256)
      ) {
        return false;
      }
      claimedIdentities.add(artifact.artifactIdentity);
      claimedDigests.add(artifact.contentSha256);
      return true;
    });
}

function parseMarker(
  value: string,
  version: "v1" | "v2",
):
  | {
      provider: string;
      model: string;
      client: string | null;
      skillRevision: string | null;
      run: ProjectRunReceipt | null;
    }
  | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    // error-policy:J3 an attribution marker with malformed JSON is explicitly invalid.
    return { error: "marker JSON is malformed" };
  }
  if (!isRecord(parsed)) {
    return { error: "marker payload must be an object" };
  }
  if (version === "v2") {
    try {
      const run = assertRunReceiptMarker(parsed);
      const project = findProject(run.projectId);
      if (!project)
        throw new TypeError("run receipt project is not registered");
      assertRunReceiptPolicyJoin(run, project);
      return {
        provider: run.provider,
        model: run.model,
        client: run.client,
        skillRevision: run.skillRevision,
        run,
      };
    } catch (error: unknown) {
      return {
        error: error instanceof Error ? error.message : "run marker is invalid",
      };
    }
  }
  const expectedKeys = ["client", "model", "provider", "skill_revision"];
  if (Object.keys(parsed).sort().join(",") !== expectedKeys.sort().join(",")) {
    return {
      error:
        "marker must contain only provider, model, client, and skill_revision",
    };
  }
  const provider = parsed.provider;
  const model = parsed.model;
  if (!isExactProviderIdentifier(provider)) {
    return { error: "provider must be an exact provider identifier" };
  }
  if (!isExactModelIdentifier(model)) {
    return { error: "model must be an exact model identifier" };
  }
  const client = parsed.client;
  if (!isExactClientIdentifier(client)) {
    return { error: "client must name the exact client used" };
  }
  const skillRevision = parsed.skill_revision;
  if (
    typeof skillRevision !== "string" ||
    skillRevision.length > 256 ||
    (!FULL_SKILL_REVISION_PATTERN.test(skillRevision) &&
      !/^n\/?a\s*[-:–—]\s*(?!<[^>]+>)(?!\[[^\]]+\])\S.{2,}$/i.test(
        skillRevision,
      ))
  ) {
    return {
      error:
        "skill_revision must be owner/repo@full-sha:path or N/A with a reason",
    };
  }
  return {
    provider,
    model,
    client: client.trim(),
    skillRevision: skillRevision.trim(),
    run: null,
  };
}

function exactIdentifier(provider: string, model: string): string {
  return model.toLowerCase().startsWith(`${provider.toLowerCase()}/`)
    ? model
    : `${provider}/${model}`;
}

function attributionLineValues(body: string, label: string): string[] {
  const expression = new RegExp(`^${label}\\s*:\\s*(.+?)\\s*$`, "i");
  return attributionDeclarationLines(body)
    .map((line) => line.match(expression)?.[1]?.trim())
    .filter((value): value is string => value !== undefined);
}

const ATTRIBUTION_LABEL_PATTERN =
  /^(?:AI provider\/model|Client \/ agent tooling|Contribution skill revision|Skill revision|Attribution status)\s*:/i;

/**
 * The contiguous run of attribution label lines that terminates at the lane
 * signature, returned as the slice of `body` they occupy. Walking backwards
 * from the lane and stopping at the first non-label line bounds the footer to
 * the block a contributor actually appended, so unrelated rows elsewhere in
 * the body (notably the PR template's attribution checklist) cannot be
 * mistaken for a second footer.
 */
function terminalAttributionBlock(
  body: string,
  beforeMarker: AttributionDeclarationLine[],
  markerRecord: AttributionMarkerRecord,
): string {
  // beforeMarker ends with the validated lane signature; anchor there and
  // collect the label lines above it, requiring only blank space between
  // adjacent members (the lane itself sits between the last label and the
  // marker, so anchoring at the marker would break the walk immediately).
  const terminalLane = beforeMarker.at(-1);
  if (terminalLane === undefined) return "";
  let start = terminalLane.start;
  for (let index = beforeMarker.length - 2; index >= 0; index -= 1) {
    const record = beforeMarker[index];
    if (!ATTRIBUTION_LABEL_PATTERN.test(record.normalized)) break;
    if (body.slice(record.end, start).trim().length !== 0) break;
    start = record.start;
  }
  return body.slice(start, markerRecord.start);
}

function markerFooterError(
  body: string,
  markerRecord: AttributionMarkerRecord,
  marker: {
    provider: string;
    model: string;
    client: string | null;
    skillRevision: string | null;
  },
): string | null {
  const lanePattern = /^(?:—|-)\s*\[([a-z0-9][a-z0-9-]{1,48})\]\s*$/i;
  const beforeMarker = attributionDeclarationLineRecords(
    body.slice(0, markerRecord.start),
  ).filter((record) => record.normalized.length > 0);
  const laneSignatures = beforeMarker.filter((record) =>
    lanePattern.test(record.normalized),
  );
  const terminalLane = beforeMarker.at(-1);
  if (
    laneSignatures.length !== 1 ||
    terminalLane === undefined ||
    !lanePattern.test(terminalLane.normalized) ||
    body.slice(terminalLane.end, markerRecord.start).trim().length !== 0
  ) {
    return "marker requires exactly one terminal lane signature";
  }
  if (body.slice(markerRecord.end).trim()) {
    return "marker must be the final source content";
  }
  // Count rows in the TERMINAL attribution block only — the run of label lines
  // immediately preceding the validated lane signature — not across the whole
  // body. The rule means "exactly one footer", and the repository PR template
  // ships `Client / agent tooling`, `Skill revision`, and `Attribution status`
  // as checklist rows far above it; a checklist row is not a competing footer.
  // Scanning the whole body made the template and SKILL.md ("append this
  // footer after the template") mutually exclusive and invalidated 64 of 67
  // eligible sources (#17610). Adjacent duplicate rows within this single
  // terminal block still collide here (the count checks below). Two
  // COMPLETE footers, each carrying its own lane signature, are already
  // rejected earlier by the one-terminal-lane-signature check above this
  // call, not by this block's row counts.
  const footerBlock = terminalAttributionBlock(
    body,
    beforeMarker,
    markerRecord,
  );
  const providerModelLines = attributionLineValues(
    footerBlock,
    "AI provider/model",
  );
  const clientLines = attributionLineValues(
    footerBlock,
    "Client / agent tooling",
  );
  const skillRevisionLines = attributionLineValues(
    footerBlock,
    "(?:Contribution skill revision|Skill revision)",
  );
  const statusLines = attributionLineValues(footerBlock, "Attribution status");
  if (
    providerModelLines.length !== 1 ||
    clientLines.length !== 1 ||
    skillRevisionLines.length !== 1 ||
    statusLines.length !== 1
  ) {
    return "marker requires exactly one complete visible attribution footer";
  }
  const providerModel = providerModelLines[0].match(/^(.+?)\s+\/\s+(.+)$/);
  if (!providerModel) {
    return "visible provider/model row is not canonical";
  }
  const visibleProvider = providerModel[1].trim();
  const visibleModel = providerModel[2].trim();
  if (
    marker.provider.toLowerCase() !== visibleProvider.toLowerCase() ||
    marker.model !== visibleModel ||
    marker.client !== clientLines[0] ||
    marker.skillRevision !== skillRevisionLines[0] ||
    statusLines[0].toLowerCase() !== "self-reported"
  ) {
    return "marker fields do not match the visible attribution footer";
  }
  return null;
}

export function assessModelAttribution(
  sources: GitHubTextSource[],
  options: AttributionAssessmentOptions = {},
): AttributionAssessment {
  const declarations: ModelAttribution[] = [];
  const invalidMarkers: InvalidAttributionMarker[] = [];
  const eligibleSources = dedupeByNodeId(sources).filter(
    (source) =>
      source.author &&
      !isBotActor(source.author) &&
      (options.requireEverySource === true ||
        hasAttributionEligibilitySignal(source.body) ||
        hasMarkdownLine(source.body, HUMAN_ONLY_PATTERN) ||
        hasMarkdownLine(source.body, ISSUE_CLAIM_PATTERN) ||
        hasMarkdownLine(source.body, REVIEW_CLAIM_PATTERN)),
  );
  const validSourceIds = new Set<string>();
  const invalidSourceIds = new Set<string>();
  const humanOnlySourceIds = new Set<string>();
  const receiptArtifactMismatchSourceIds = new Set<string>();

  for (const source of eligibleSources) {
    if (hasMarkdownLine(source.body, HUMAN_ONLY_PATTERN)) {
      humanOnlySourceIds.add(source.id);
      validSourceIds.add(source.id);
    }
    let markerIndex = 0;
    const markerIdentifiers = new Set<string>();
    let reviewRecord: unknown | null;
    try {
      reviewRecord = parseReviewRecordBlock(source.body);
    } catch (error: unknown) {
      invalidSourceIds.add(source.id);
      invalidMarkers.push({
        sourceId: source.id,
        sourceUrl: source.url,
        reason:
          error instanceof Error
            ? error.message
            : "slop-review record is invalid",
      });
      continue;
    }
    const markerMatches = attributionMarkerRecords(source.body);
    if (reviewRecord !== null && markerMatches.length !== 1) {
      invalidSourceIds.add(source.id);
      invalidMarkers.push({
        sourceId: source.id,
        sourceUrl: source.url,
        reason: "slop-review requires exactly one terminal signed run receipt",
      });
      continue;
    }
    if (markerMatches.length > 1) {
      invalidSourceIds.add(source.id);
      invalidMarkers.push({
        sourceId: source.id,
        sourceUrl: source.url,
        reason: "source must contain at most one attribution marker",
      });
    }
    const markerMatchesToParse =
      markerMatches.length === 1 ? markerMatches : [];
    for (const match of markerMatchesToParse) {
      const marker = parseMarker(match.payload, match.version);
      if ("error" in marker) {
        invalidSourceIds.add(source.id);
        invalidMarkers.push({
          sourceId: source.id,
          sourceUrl: source.url,
          reason: marker.error,
        });
        markerIndex += 1;
        continue;
      }
      const footerError = markerFooterError(source.body, match, marker);
      if (footerError) {
        invalidSourceIds.add(source.id);
        invalidMarkers.push({
          sourceId: source.id,
          sourceUrl: source.url,
          reason: footerError,
        });
        markerIndex += 1;
        continue;
      }
      if (reviewRecord !== null) {
        try {
          assertReviewRecordReceiptJoin(
            reviewRecord,
            marker.run,
            source.artifactUrl && source.artifactHeadSha
              ? {
                  artifactUrl: source.artifactUrl,
                  headSha: source.artifactHeadSha,
                }
              : null,
          );
        } catch (error: unknown) {
          invalidSourceIds.add(source.id);
          invalidMarkers.push({
            sourceId: source.id,
            sourceUrl: source.url,
            reason:
              error instanceof Error
                ? error.message
                : "slop-review receipt join is invalid",
          });
          markerIndex += 1;
          continue;
        }
      }
      let verifiedRun = marker.run;
      if (options.verifyRunReceipt) {
        try {
          verifiedRun = options.verifyRunReceipt(marker.run);
        } catch (error: unknown) {
          invalidSourceIds.add(source.id);
          invalidMarkers.push({
            sourceId: source.id,
            sourceUrl: source.url,
            reason: `run receipt excluded: ${error instanceof Error ? error.message : "signature verification failed"}`,
          });
          markerIndex += 1;
          continue;
        }
      }
      if (
        verifiedRun !== null &&
        source.artifactUrl !== undefined &&
        verifiedRun.repositoryId !== repositoryIdFromUrl(source.artifactUrl)
      ) {
        invalidSourceIds.add(source.id);
        receiptArtifactMismatchSourceIds.add(source.id);
        invalidMarkers.push({
          sourceId: source.id,
          sourceUrl: source.url,
          reason: "run receipt repository does not match its GitHub artifact",
        });
        markerIndex += 1;
        continue;
      }
      const identifier = exactIdentifier(marker.provider, marker.model);
      validSourceIds.add(source.id);
      markerIdentifiers.add(identifier.toLowerCase());
      declarations.push({
        id: `${source.id}:machine-marker:${markerIndex}`,
        sourceId: source.id,
        sourceUrl: source.url,
        artifactId: source.artifactId,
        actor: source.author,
        provider: marker.provider,
        model: marker.model,
        identifier,
        client: marker.client,
        skillRevision: marker.skillRevision,
        run: verifiedRun,
        format: "machine-marker",
        status: "self-reported",
      });
      markerIndex += 1;
    }

    if (
      (reviewRecord !== null ||
        receiptArtifactMismatchSourceIds.has(source.id)) &&
      invalidSourceIds.has(source.id)
    ) {
      continue;
    }

    let visibleIndex = 0;
    for (const line of attributionDeclarationLines(source.body)) {
      const declarationLine = line.match(
        /^\s*(?:[-*]\s*)?(?:AI\s+)?Model(?:s|\(s\))?(?:\s+used)?\s*:\s*(.+?)\s*$/i,
      );
      const canonicalLine = line.match(
        /^\s*(?:[-*]\s*)?AI\s+provider\s*\/\s*model\s*:\s*`?([^`\s]+)`?\s+\/\s+`?([^`\s]+)`?\s*$/i,
      );
      const visibleIdentifiers: Array<{ provider: string; model: string }> = [];
      if (declarationLine) {
        for (const match of declarationLine[1].matchAll(
          EXACT_MODEL_IDENTIFIER_PATTERN,
        )) {
          visibleIdentifiers.push({ provider: match[1], model: match[2] });
        }
      }
      if (canonicalLine) {
        visibleIdentifiers.push({
          provider: canonicalLine[1],
          model: canonicalLine[2],
        });
      }
      for (const declaration of visibleIdentifiers) {
        if (
          !isExactProviderIdentifier(declaration.provider) ||
          !isExactModelIdentifier(declaration.model)
        ) {
          continue;
        }
        const identifier = exactIdentifier(
          declaration.provider,
          declaration.model,
        );
        validSourceIds.add(source.id);
        if (markerIdentifiers.has(identifier.toLowerCase())) {
          continue;
        }
        declarations.push({
          id: `${source.id}:visible-declaration:${visibleIndex}`,
          sourceId: source.id,
          sourceUrl: source.url,
          artifactId: source.artifactId,
          actor: source.author,
          provider: declaration.provider,
          model: declaration.model,
          identifier,
          client: null,
          skillRevision: null,
          run: null,
          format: "visible-declaration",
          status: "self-reported",
        });
        visibleIndex += 1;
      }
    }
  }

  const eligibleSourceCount = eligibleSources.length;
  const validSourceCount = validSourceIds.size;
  const invalidSourceCount = invalidSourceIds.size;
  let status: AttributionCoverage["status"];
  if (
    eligibleSourceCount > 0 &&
    validSourceCount === eligibleSourceCount &&
    invalidSourceCount === 0
  ) {
    status = "complete";
  } else if (validSourceCount > 0) {
    status = "partial";
  } else if (invalidSourceCount > 0) {
    status = "invalid";
  } else {
    status = "missing";
  }

  return {
    declarations: dedupeByNodeId(declarations),
    invalidMarkers,
    coverage: {
      status,
      eligibleSourceCount,
      validSourceCount,
      missingSourceCount: eligibleSourceCount - validSourceCount,
      invalidSourceCount,
      humanOnlySourceCount: humanOnlySourceIds.size,
    },
  };
}

export function pullRequestTextSources(
  pullRequest: PullRequestRecord,
): GitHubTextSource[] {
  const body = pullRequestBodySource(pullRequest);
  const reviewSources: GitHubTextSource[] = pullRequest.reviews.map(
    (review) => ({
      id: review.id,
      artifactId: pullRequest.id,
      kind: "review",
      body: review.body,
      url: review.url,
      createdAt: review.submittedAt ?? pullRequest.updatedAt,
      updatedAt: review.submittedAt ?? pullRequest.updatedAt,
      author: review.author,
    }),
  );
  return dedupeByNodeId([body, ...pullRequest.comments, ...reviewSources]).map(
    (source) => ({
      ...source,
      artifactUrl: pullRequest.url,
      artifactHeadSha: pullRequest.headRefOid.toLowerCase(),
    }),
  );
}

export function issueTextSources(issue: IssueRecord): GitHubTextSource[] {
  return dedupeByNodeId([
    {
      id: `${issue.id}:body`,
      artifactId: issue.id,
      kind: "body" as const,
      body: issue.body,
      url: issue.url,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      author: issue.author,
    },
    ...issue.comments,
  ]).map((source) => ({ ...source, artifactUrl: issue.url }));
}

export function qualifiesResolvedIssue(issue: IssueRecord): boolean {
  if (!issue.closedAt) {
    return false;
  }
  if (issue.closedByPullRequests.some((pullRequest) => pullRequest.mergedAt)) {
    return true;
  }
  if (issue.stateReason === "NOT_PLANNED") {
    return false;
  }
  return issue.labels.some((label) =>
    CONFIRMATION_LABELS.has(normalizeLabel(label.name)),
  );
}

export function isSubstantiveReview(
  review: PullRequestReview,
  pullRequest: PullRequestRecord,
): boolean {
  if (
    !review.author ||
    isBotActor(review.author) ||
    !pullRequest.author ||
    isBotActor(pullRequest.author)
  ) {
    return false;
  }
  if (
    review.author.id === pullRequest.author.id ||
    review.author.login.toLowerCase() === pullRequest.author.login.toLowerCase()
  ) {
    return false;
  }
  if (!review.submittedAt || !pullRequest.mergedAt) {
    return false;
  }
  if (parseIsoTime(review.submittedAt) > parseIsoTime(pullRequest.mergedAt)) {
    return false;
  }
  if (!["APPROVED", "CHANGES_REQUESTED"].includes(review.state)) {
    return false;
  }
  return hasSubstantiveReviewBody(review);
}

/**
 * Open-PR review that already chose APPROVED/CHANGES_REQUESTED but still needs
 * substantive rationale or an inline comment to qualify after merge.
 */
export function isExpandableReviewOpportunity(
  review: PullRequestReview,
  pullRequest: PullRequestRecord,
): boolean {
  if (pullRequest.mergedAt !== null) {
    return false;
  }
  if (
    !review.author ||
    isBotActor(review.author) ||
    !pullRequest.author ||
    isBotActor(pullRequest.author)
  ) {
    return false;
  }
  if (
    review.author.id === pullRequest.author.id ||
    review.author.login.toLowerCase() === pullRequest.author.login.toLowerCase()
  ) {
    return false;
  }
  if (!review.submittedAt) {
    return false;
  }
  if (!["APPROVED", "CHANGES_REQUESTED"].includes(review.state)) {
    return false;
  }
  return !hasSubstantiveReviewBody(review);
}

function hasSubstantiveReviewBody(review: PullRequestReview): boolean {
  const substantiveBody = review.body
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/[#*_>`~[\]()!-]/g, "")
    .trim();
  return substantiveBody.length >= 20 || review.inlineCommentCount > 0;
}

export function leaderboardMethodology(): LeaderboardMethodology {
  return {
    summary:
      "Slop Score v2 groups accepted work into logical work units and stores credit in integer thirds. Claude review agents propose effort, complexity, impact, and review load; maintainers ratify the score on GitHub. Tiny accepted work starts at one third, and only the actor's aggregate is rounded down at cycle close.",
    scoringRules: [
      {
        id: "merged-pull-request",
        points: "micro 1/3; small 1; medium 3; large 8; XL 15; exceptional 25",
        cap: "uncapped; related or split pull requests share one workUnitId",
        qualification:
          "Authored pull request merged during the rolling window. Unratified August work receives provisional micro credit; higher tiers require an immutable exact-head maintainer slop-score record.",
      },
      {
        id: "resolved-issue",
        points: "included in the ratified outcome tier",
        cap: "no separate award",
        qualification:
          "Resolution value is evidence for the work-unit tier, not a second score.",
      },
      {
        id: "material-test-change",
        points: "included in the ratified outcome tier",
        cap: "no separate award",
        qualification:
          "Test depth informs complexity and value but is not farmable additive credit.",
      },
      {
        id: "evidence",
        points: "included in the ratified outcome tier",
        cap: "no separate award",
        qualification: `For the author's newest ${DETAILED_MERGED_PULL_REQUESTS_PER_MONTH} deep-inspected merged pull requests per project and UTC month, contributor-authored proof is bound to the merged head via a single evidence-head marker, appears in a stable evidence row in the canonical PR body, uses an immutable GitHub attachment URL, and passes bounded remote byte and structure verification. Author post-merge body edits still void the package; a non-author post-merge body edit keeps the package only while the evidence-head still matches the merged OID. Mutable release assets, comment copies, inline text, N/A rows, unreachable artifacts, and third-party claims do not qualify.`,
      },
      {
        id: "substantive-review",
        points:
          "triage 1/3; standard 1; deep reproduction 3; specialist 8; ratification 1/3",
        cap: "uncapped; no self-review and no duplicate reviewer credit on one artifact",
        qualification:
          "Within the published deep-inspection set of human-authored pull requests, a pre-merge APPROVED or CHANGES_REQUESTED review has substantive text or inline discussion.",
      },
      {
        id: "evaluated-contribution",
        points: "integer-thirds maintainer decision",
        cap: "uncapped; cannot duplicate an ordinary source or work unit",
        qualification:
          "A public, strictly validated award manifest was reviewed and merged into elizaOS/slopdotcash for useful implementation, tests, review, diagnosis, or evidence that is not already rewarded as a merged outcome.",
      },
    ],
    evidenceWeights: { ...EVIDENCE_WEIGHTS },
    materialTestThreshold: {
      minimumAdditions: MATERIAL_TEST_ADDITIONS,
      minimumTotalChurn: MATERIAL_TEST_CHURN,
      cap: `4 points for each of the newest ${SCORE_CAPS.materialTestChanges} qualifying merged pull requests per contributor`,
    },
    exclusions: [
      "GitHub Bot actors and bot-pattern logins",
      "reviews of bot-authored or unattributed pull requests",
      "self-reviews",
      "reviews submitted after merge",
      "pull-request comments created or edited after merge; bodies created after merge; author post-merge body edits; and non-author post-merge body edits that no longer pin the merged head via a single evidence-head marker",
      "duplicate immutable GitHub node IDs",
      "repeated reviews by the same reviewer on the same pull request",
      "arbitrary external media links, bare checksums, and unstructured evidence claims",
      "unreachable, empty, malformed, wrong-kind, or conflicting evidence artifacts",
      "closed issues that only carry GitHub's COMPLETED state reason",
      "issue reports whose author did not also author the linked merged fix",
      "score-bearing evidence supplied only by a third party",
      "unreviewed evaluator output or evaluator output that duplicates an already-scored source",
    ],
    nonScoringActivity: [
      "raw comments",
      "commit count within the 35-day verification window",
      "lines added or deleted",
      "model disclosure",
    ],
    provenancePolicy:
      "Leaderboard model identifiers come only from text sources causally attached to a scored contribution by the same actor. Exact provider/model declarations, human-only declarations, and contribution-attribution markers remain self-reported provenance; complete, partial, missing, and invalid states add no points.",
    collectionPolicy: `The same complete collection pipeline runs for every repository in the published project registry; records merge by immutable GitHub node ID and every artifact keeps its repository attribution. Score v2 applies to work from 2026-08-01 UTC. Every accepted merge receives at least provisional micro credit. Higher scores require an unedited maintainer-authored slop-score record bound to the PR node ID and exact head SHA; corrections append a successor. Proposal review records disclose exact provider, model, client, run, trace, effort, complexity, impact, review load, split risk, and confidence. XL and exceptional decisions require a second maintainer. Project reward views exclude work before the published reward start.`,
  };
}

function newMutableEntry(actor: GitHubActor): MutableLeaderboardEntry {
  return {
    actor,
    score: 0,
    scoreThirds: 0,
    points: {
      mergedPullRequests: 0,
      resolvedIssues: 0,
      materialTestChanges: 0,
      evidence: 0,
      substantiveReviews: 0,
      evaluatedContributions: 0,
    },
    pointThirds: {
      mergedPullRequests: 0,
      resolvedIssues: 0,
      materialTestChanges: 0,
      evidence: 0,
      substantiveReviews: 0,
      evaluatedContributions: 0,
    },
    acceptedOutcomes: {
      mergedPullRequests: 0,
      resolvedIssues: 0,
      materialTestChanges: 0,
      evidenceCategories: 0,
      substantiveReviews: 0,
      evaluatedContributions: 0,
    },
    rawActivity: {
      comments: 0,
      reviews: 0,
      commits: 0,
      additions: 0,
      deletions: 0,
    },
    models: new Set<string>(),
    projectCapUsage: new Map(),
    creditedWorkUnits: new Set(),
  };
}

function actorEntry(
  entries: Map<string, MutableLeaderboardEntry>,
  actor: GitHubActor,
): MutableLeaderboardEntry {
  const key = actor.id;
  const current = entries.get(key);
  if (current) {
    return current;
  }
  const created = newMutableEntry(actor);
  entries.set(key, created);
  return created;
}

function addScore(
  entries: Map<string, MutableLeaderboardEntry>,
  ledger: ScoreEvent[],
  event: ScoreEvent,
): boolean {
  if (isBotActor(event.actor)) {
    return false;
  }
  const entry = actorEntry(entries, event.actor);
  const projectId = TARGET_REPOSITORIES.find(
    (repository) => repository.id === event.repository,
  )?.projectId;
  if (!projectId) {
    throw new Error(
      `Score event repository is not registered: ${event.repository}`,
    );
  }
  const capKey = `${projectId}\0${event.occurredAt.slice(0, 7)}`;
  const capUsage = entry.projectCapUsage.get(capKey) ?? {
    acceptedOutcomes: {
      mergedPullRequests: 0,
      resolvedIssues: 0,
      materialTestChanges: 0,
      evidenceCategories: 0,
      substantiveReviews: 0,
      evaluatedContributions: 0,
    },
    evidencePoints: 0,
  };
  const v2 =
    parseIsoTime(event.occurredAt) >= parseIsoTime(SCORE_V2_EFFECTIVE_AT);
  if (v2) {
    if (
      event.category === "resolved-issue" ||
      event.category === "material-test-change" ||
      event.category === "evidence"
    ) {
      return false;
    }
    const scoreThirds =
      event.scoreThirds ??
      (event.category === "merged-pull-request"
        ? 1
        : event.category === "substantive-review"
          ? 3
          : Math.max(1, Math.round(event.points * 3)));
    if (!Number.isSafeInteger(scoreThirds) || scoreThirds < 1) {
      throw new TypeError("v2 scoreThirds must be a positive safe integer");
    }
    const workUnitId =
      event.workUnitId ??
      `wu_${projectId}_${event.source.id.toLowerCase().replace(/[^a-z0-9_-]+/gu, "_")}`;
    const globalWorkUnitKey = `${projectId}\0${event.occurredAt.slice(0, 7)}\0${workUnitId}`;
    if (entry.creditedWorkUnits.has(globalWorkUnitKey)) return false;
    if (
      event.category === "merged-pull-request" &&
      ledger.some(
        (existing) =>
          existing.category === "merged-pull-request" &&
          `${projectId}\0${existing.occurredAt.slice(0, 7)}\0${existing.workUnitId}` ===
            globalWorkUnitKey,
      )
    ) {
      return false;
    }
    const scoredEvent = {
      ...event,
      points: scoreThirds / 3,
      scoreThirds,
      workUnitId,
      reason:
        event.reason ||
        "Accepted outcome scored in integer thirds under the ratified work-unit policy.",
    };
    entry.score += scoredEvent.points;
    entry.scoreThirds += scoreThirds;
    if (scoredEvent.category === "merged-pull-request") {
      entry.points.mergedPullRequests += scoredEvent.points;
      entry.pointThirds.mergedPullRequests += scoreThirds;
      entry.acceptedOutcomes.mergedPullRequests += 1;
      capUsage.acceptedOutcomes.mergedPullRequests += 1;
    } else if (scoredEvent.category === "substantive-review") {
      entry.points.substantiveReviews += scoredEvent.points;
      entry.pointThirds.substantiveReviews += scoreThirds;
      entry.acceptedOutcomes.substantiveReviews += 1;
      capUsage.acceptedOutcomes.substantiveReviews += 1;
    } else {
      entry.points.evaluatedContributions += scoredEvent.points;
      entry.pointThirds.evaluatedContributions += scoreThirds;
      entry.acceptedOutcomes.evaluatedContributions += 1;
      capUsage.acceptedOutcomes.evaluatedContributions += 1;
    }
    entry.creditedWorkUnits.add(globalWorkUnitKey);
    entry.projectCapUsage.set(capKey, capUsage);
    ledger.push(scoredEvent);
    return true;
  }
  const atCap =
    (event.category === "resolved-issue" &&
      capUsage.acceptedOutcomes.resolvedIssues >= SCORE_CAPS.resolvedIssues) ||
    (event.category === "material-test-change" &&
      capUsage.acceptedOutcomes.materialTestChanges >=
        SCORE_CAPS.materialTestChanges) ||
    (event.category === "evidence" &&
      capUsage.evidencePoints + event.points > SCORE_CAPS.evidencePoints) ||
    (event.category === "substantive-review" &&
      capUsage.acceptedOutcomes.substantiveReviews >=
        SCORE_CAPS.substantiveReviews) ||
    (event.category === "evaluated-contribution" &&
      capUsage.acceptedOutcomes.evaluatedContributions >=
        SCORE_CAPS.evaluatedContributions);
  if (atCap) {
    return false;
  }
  const scoredEvent =
    event.category === "merged-pull-request"
      ? {
          ...event,
          points: mergedPullRequestPoints(
            capUsage.acceptedOutcomes.mergedPullRequests + 1,
          ),
          reason:
            "Pull request merged during the rolling window; uncapped diminishing credit applies within its project and UTC month.",
        }
      : event;
  entry.score += scoredEvent.points;
  entry.scoreThirds += scoredEvent.points * 3;
  if (scoredEvent.category === "merged-pull-request") {
    entry.points.mergedPullRequests += scoredEvent.points;
    entry.pointThirds.mergedPullRequests += scoredEvent.points * 3;
    entry.acceptedOutcomes.mergedPullRequests += 1;
    capUsage.acceptedOutcomes.mergedPullRequests += 1;
  } else if (scoredEvent.category === "resolved-issue") {
    entry.points.resolvedIssues += scoredEvent.points;
    entry.pointThirds.resolvedIssues += scoredEvent.points * 3;
    entry.acceptedOutcomes.resolvedIssues += 1;
    capUsage.acceptedOutcomes.resolvedIssues += 1;
  } else if (scoredEvent.category === "material-test-change") {
    entry.points.materialTestChanges += scoredEvent.points;
    entry.pointThirds.materialTestChanges += scoredEvent.points * 3;
    entry.acceptedOutcomes.materialTestChanges += 1;
    capUsage.acceptedOutcomes.materialTestChanges += 1;
  } else if (scoredEvent.category === "evidence") {
    entry.points.evidence += scoredEvent.points;
    entry.pointThirds.evidence += scoredEvent.points * 3;
    entry.acceptedOutcomes.evidenceCategories += 1;
    capUsage.evidencePoints += scoredEvent.points;
    capUsage.acceptedOutcomes.evidenceCategories += 1;
  } else if (scoredEvent.category === "substantive-review") {
    entry.points.substantiveReviews += scoredEvent.points;
    entry.pointThirds.substantiveReviews += scoredEvent.points * 3;
    entry.acceptedOutcomes.substantiveReviews += 1;
    capUsage.acceptedOutcomes.substantiveReviews += 1;
  } else {
    entry.points.evaluatedContributions += scoredEvent.points;
    entry.pointThirds.evaluatedContributions += scoredEvent.points * 3;
    entry.acceptedOutcomes.evaluatedContributions += 1;
    capUsage.acceptedOutcomes.evaluatedContributions += 1;
  }
  entry.projectCapUsage.set(capKey, capUsage);
  ledger.push(scoredEvent);
  return true;
}

function recordTextActivity(
  entries: Map<string, MutableLeaderboardEntry>,
  sources: GitHubTextSource[],
): void {
  for (const source of dedupeByNodeId(sources)) {
    if (
      source.kind === "comment" &&
      source.author &&
      !isBotActor(source.author)
    ) {
      actorEntry(entries, source.author).rawActivity.comments += 1;
    }
  }
}

function sameActor(
  left: GitHubActor | null,
  right: GitHubActor | null,
): boolean {
  return (
    left !== null &&
    right !== null &&
    (left.id === right.id ||
      left.login.toLowerCase() === right.login.toLowerCase())
  );
}

/**
 * Parses the single `<!-- evidence-head:<40 hex> -->` marker used to bind a
 * PR body evidence package to an exact head. Zero or multiple markers → null.
 */
export function parseEvidenceHeadOid(body: string): string | null {
  const matches = [
    ...String(body ?? "").matchAll(
      /<!--\s*evidence-head:([a-f0-9]{40})\s*-->/gi,
    ),
  ];
  return matches.length === 1 ? matches[0][1].toLowerCase() : null;
}

/**
 * Whether a merged PR's current body may still be used as the evidence source.
 *
 * Intent of the merge-time freeze: stop authors from adding score-bearing
 * proof after merge. A non-author post-merge body edit (common: maintainer
 * typo/scope note) must not void a package that remains head-pinned to the
 * merged OID — see elizaOS/eliza#17606 (editor lalalune after merge).
 *
 * Fail closed when the editor is missing or is the PR author.
 */
export function isMergedPullRequestBodyEligibleForEvidence(
  pullRequest: Pick<
    PullRequestRecord,
    | "mergedAt"
    | "createdAt"
    | "lastEditedAt"
    | "headRefOid"
    | "body"
    | "author"
    | "editor"
  >,
  bodySource: Pick<GitHubTextSource, "createdAt" | "updatedAt" | "body">,
): boolean {
  if (!pullRequest.mergedAt) {
    return false;
  }
  const mergedAt = parseIsoTime(pullRequest.mergedAt);
  if (parseIsoTime(bodySource.createdAt) > mergedAt) {
    return false;
  }
  if (parseIsoTime(bodySource.updatedAt) <= mergedAt) {
    return true;
  }
  // Body touched after merge.
  const evidenceHead = parseEvidenceHeadOid(bodySource.body);
  if (
    evidenceHead === null ||
    evidenceHead !== pullRequest.headRefOid.toLowerCase()
  ) {
    return false;
  }
  if (!pullRequest.editor || !pullRequest.author) {
    return false;
  }
  if (sameActor(pullRequest.editor, pullRequest.author)) {
    return false;
  }
  return true;
}

function evidenceSourcesAtMerge(
  pullRequest: PullRequestRecord,
  sources: GitHubTextSource[],
): GitHubTextSource[] {
  if (!pullRequest.mergedAt) {
    return [];
  }
  const mergedAt = parseIsoTime(pullRequest.mergedAt);
  return sources.filter((source) => {
    if (source.kind === "review") {
      return false;
    }
    if (parseIsoTime(source.createdAt) > mergedAt) {
      return false;
    }
    if (parseIsoTime(source.updatedAt) <= mergedAt) {
      return true;
    }
    // Post-merge source mutation: only the PR body can survive, and only when
    // the last editor is not the author and the package is still head-pinned.
    if (source.kind === "body" && source.id === `${pullRequest.id}:body`) {
      return isMergedPullRequestBodyEligibleForEvidence(pullRequest, source);
    }
    return false;
  });
}

function pullRequestBodySource(
  pullRequest: PullRequestRecord | MergedPullRequestOutcome,
): GitHubTextSource {
  return {
    id: `${pullRequest.id}:body`,
    artifactId: pullRequest.id,
    kind: "body",
    body: pullRequest.body,
    url: pullRequest.url,
    createdAt: pullRequest.createdAt,
    updatedAt:
      "lastEditedAt" in pullRequest
        ? (pullRequest.lastEditedAt ?? pullRequest.createdAt)
        : pullRequest.updatedAt,
    author: pullRequest.author,
    artifactUrl: pullRequest.url,
  };
}

function resolvedIssueContributor(
  issue: IssueRecord,
): IssueRecord["closedByPullRequests"][number] | null {
  if (!issue.closedAt) {
    return null;
  }
  const closedAt = parseIsoTime(issue.closedAt);
  return (
    [...issue.closedByPullRequests]
      .filter(
        (pullRequest) =>
          pullRequest.mergedAt !== null &&
          parseIsoTime(pullRequest.mergedAt) <= closedAt &&
          pullRequest.author !== null &&
          !isBotActor(pullRequest.author),
      )
      .sort(
        (left, right) =>
          parseIsoTime(right.mergedAt ?? "") -
            parseIsoTime(left.mergedAt ?? "") ||
          left.id.localeCompare(right.id),
      )[0] ?? null
  );
}

function modelStatus(assessment: AttributionAssessment): WorkItemModelStatus {
  const identifiers = uniqueSorted(
    assessment.declarations.map((declaration) => declaration.identifier),
  );
  const machineMarkerCount = assessment.declarations.filter(
    (declaration) => declaration.format === "machine-marker",
  ).length;
  return {
    status: assessment.coverage.status,
    identifiers,
    machineMarkerCount,
    invalidMarkerCount: assessment.invalidMarkers.length,
    eligibleSourceCount: assessment.coverage.eligibleSourceCount,
    validSourceCount: assessment.coverage.validSourceCount,
    missingSourceCount: assessment.coverage.missingSourceCount,
    invalidSourceCount: assessment.coverage.invalidSourceCount,
    humanOnlySourceCount: assessment.coverage.humanOnlySourceCount,
    provenance:
      assessment.coverage.validSourceCount > 0 ? "self-reported" : "none",
  };
}

function evidenceStatus(
  assessment: EvidenceAssessment,
): WorkItemEvidenceStatus {
  return {
    status:
      assessment.points === 6
        ? "complete"
        : assessment.points > 0
          ? "partial"
          : "missing",
    points: assessment.points,
    maxPoints: assessment.maxPoints,
    categories: assessment.categories,
  };
}

function latestClaimComment(
  comments: GitHubTextSource[],
  pattern: RegExp,
  referenceTime: string,
  excludedActor?: GitHubActor | null,
): GitHubTextSource | null {
  const now = parseIsoTime(referenceTime);
  const cutoff = now - CLAIM_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const matches = dedupeByNodeId(comments)
    .filter((comment) => {
      if (!comment.author || isBotActor(comment.author)) {
        return false;
      }
      if (
        !comment.authorAssociation ||
        !TRUSTED_CLAIM_ASSOCIATIONS.has(comment.authorAssociation)
      ) {
        return false;
      }
      if (
        excludedActor &&
        (comment.author.id === excludedActor.id ||
          comment.author.login.toLowerCase() ===
            excludedActor.login.toLowerCase())
      ) {
        return false;
      }
      const createdAt = parseIsoTime(comment.createdAt);
      return (
        createdAt >= cutoff &&
        createdAt <= now &&
        hasMarkdownLine(comment.body, pattern)
      );
    })
    .sort(
      (left, right) =>
        parseIsoTime(right.createdAt) - parseIsoTime(left.createdAt) ||
        left.id.localeCompare(right.id),
    );
  return matches[0] ?? null;
}

function isClaimLabel(
  label: GitHubLabel,
  kind: WorkItemClaimStatus["kind"],
): boolean {
  const normalized = normalizeLabel(label.name);
  return kind === "implementation"
    ? ISSUE_CLAIM_LABEL_PATTERN.test(normalized)
    : REVIEW_CLAIM_LABEL_PATTERN.test(normalized);
}

function issueClaim(
  issue: IssueRecord,
  referenceTime: string,
): WorkItemClaimStatus {
  const assignees = issue.assignees.filter((actor) => !isBotActor(actor));
  if (assignees.length > 0) {
    return {
      status: "claimed",
      source: "assignee",
      kind: "implementation",
      actors: assignees,
      claimedAt: null,
    };
  }
  const comment = latestClaimComment(
    issue.comments,
    ISSUE_CLAIM_PATTERN,
    referenceTime,
  );
  if (comment?.author) {
    return {
      status: "claimed",
      source: "claim-comment",
      kind: "implementation",
      actors: [comment.author],
      claimedAt: comment.createdAt,
    };
  }
  if (issue.labels.some((label) => isClaimLabel(label, "implementation"))) {
    return {
      status: "claimed",
      source: "label",
      kind: "implementation",
      actors: [],
      claimedAt: null,
    };
  }
  return {
    status: "unclaimed",
    source: "none",
    kind: null,
    actors: [],
    claimedAt: null,
  };
}

function pullRequestClaim(
  pullRequest: PullRequestRecord,
  referenceTime: string,
): WorkItemClaimStatus {
  const assignees = pullRequest.assignees.filter(
    (actor) =>
      !isBotActor(actor) &&
      (!pullRequest.author ||
        (actor.id !== pullRequest.author.id &&
          actor.login.toLowerCase() !==
            pullRequest.author.login.toLowerCase())),
  );
  if (assignees.length > 0) {
    return {
      status: "claimed",
      source: "assignee",
      kind: "review",
      actors: assignees,
      claimedAt: null,
    };
  }
  const comment = latestClaimComment(
    pullRequest.comments,
    REVIEW_CLAIM_PATTERN,
    referenceTime,
    pullRequest.author,
  );
  if (comment?.author) {
    return {
      status: "claimed",
      source: "claim-comment",
      kind: "review",
      actors: [comment.author],
      claimedAt: comment.createdAt,
    };
  }
  if (pullRequest.labels.some((label) => isClaimLabel(label, "review"))) {
    return {
      status: "claimed",
      source: "label",
      kind: "review",
      actors: [],
      claimedAt: null,
    };
  }
  return {
    status: "unclaimed",
    source: "none",
    kind: null,
    actors: [],
    claimedAt: null,
  };
}

function workItemPriority(labels: GitHubLabel[]): WorkItem["priority"] {
  const names = labels.map((label) => normalizeLabel(label.name));
  if (names.some((name) => URGENT_LABELS.has(name))) {
    return "urgent";
  }
  if (names.some((name) => HIGH_PRIORITY_LABELS.has(name))) {
    return "high";
  }
  if (names.some((name) => LOW_PRIORITY_LABELS.has(name))) {
    return "low";
  }
  return "normal";
}

function workItemActionability(
  labels: GitHubLabel[],
  isDraft: boolean,
): WorkItem["actionability"] {
  if (isDraft) {
    return "draft";
  }
  return labels.some((label) =>
    BLOCKED_LABEL_PATTERN.test(normalizeLabel(label.name)),
  )
    ? "blocked"
    : "actionable";
}

interface CandidateSelectionInput {
  kind: WorkItem["kind"];
  author: GitHubActor | null;
  labels: string[];
  contributorReady: boolean;
  actionability: WorkItem["actionability"];
  reviewDecision: string | null;
  activeReviewRequestCount: number | null;
  claimStatus: WorkItemClaimStatus["status"];
}

function candidateExclusionReasons(
  input: CandidateSelectionInput,
): WorkItemCandidateExclusion[] {
  const reasons: WorkItemCandidateExclusion[] = [];
  if (!input.author) {
    reasons.push("unknown-author");
  } else if (input.author.kind === "Unknown") {
    reasons.push("unknown-author");
  } else if (isBotActor(input.author)) {
    reasons.push("bot-authored");
  }
  if (
    input.labels.some((label) => SECURITY_SENSITIVE_LABEL_PATTERN.test(label))
  ) {
    reasons.push("security-sensitive");
  }
  if (input.kind === "issue" && !input.contributorReady) {
    reasons.push("untriaged");
  }
  if (input.claimStatus === "claimed") {
    reasons.push("claimed");
  }
  if (input.actionability === "blocked") {
    reasons.push("blocked");
  }
  if (input.actionability === "draft") {
    reasons.push("draft");
  }
  if (
    input.kind === "pull-request" &&
    input.activeReviewRequestCount !== null &&
    input.activeReviewRequestCount > 0
  ) {
    reasons.push("active-review-request");
  }
  if (input.reviewDecision === "APPROVED") {
    reasons.push("already-approved");
  }
  if (input.reviewDecision === "CHANGES_REQUESTED") {
    reasons.push("changes-requested");
  }
  return reasons;
}

function workItemSelection(input: CandidateSelectionInput): WorkItemSelection {
  const reasons = candidateExclusionReasons(input);
  return {
    status: reasons.length === 0 ? "candidate" : "excluded",
    reasons,
  };
}

function issueWorkItem(
  issue: IssueRecord,
  referenceTime: string,
): {
  item: WorkItem;
  attribution: AttributionAssessment;
} {
  const sources = issueTextSources(issue);
  const evidence = assessEvidence(sources);
  const attribution = assessModelAttribution(sources);
  const claim = issueClaim(issue, referenceTime);
  const labels = uniqueSorted(issue.labels.map((label) => label.name));
  const actionability = workItemActionability(issue.labels, false);
  return {
    item: {
      id: issue.id,
      kind: "issue",
      number: issue.number,
      title: issue.title,
      url: issue.url,
      repository: repositoryIdFromUrl(issue.url),
      author: issue.author,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      labels,
      priority: workItemPriority(issue.labels),
      actionability,
      isDraft: null,
      reviewDecision: null,
      activeReviewRequestCount: null,
      commentCount: dedupeByNodeId(issue.comments).length,
      claim,
      selection: workItemSelection({
        kind: "issue",
        author: issue.author,
        labels,
        contributorReady:
          !isEpicIssue(issue.title, labels) &&
          issue.labels.some((label) =>
            CONTRIBUTOR_READY_LABELS.has(normalizeLabel(label.name)),
          ),
        actionability,
        reviewDecision: null,
        activeReviewRequestCount: null,
        claimStatus: claim.status,
      }),
      evidence: evidenceStatus(evidence),
      model: modelStatus(attribution),
    },
    attribution,
  };
}

function pullRequestWorkItem(
  pullRequest: PullRequestRecord,
  referenceTime: string,
  verifiedEvidence: VerifiedEvidenceArtifact[],
): {
  item: WorkItem;
  attribution: AttributionAssessment;
} {
  const sources = pullRequestTextSources(pullRequest);
  const evidence = assessEvidence(sources, verifiedEvidence);
  const attribution = assessModelAttribution(sources);
  const claim = pullRequestClaim(pullRequest, referenceTime);
  const labels = uniqueSorted(pullRequest.labels.map((label) => label.name));
  const actionability = workItemActionability(
    pullRequest.labels,
    pullRequest.isDraft,
  );
  return {
    item: {
      id: pullRequest.id,
      kind: "pull-request",
      number: pullRequest.number,
      title: pullRequest.title,
      url: pullRequest.url,
      repository: repositoryIdFromUrl(pullRequest.url),
      author: pullRequest.author,
      createdAt: pullRequest.createdAt,
      updatedAt: pullRequest.updatedAt,
      labels,
      priority: workItemPriority(pullRequest.labels),
      actionability,
      isDraft: pullRequest.isDraft,
      reviewDecision: pullRequest.reviewDecision,
      activeReviewRequestCount: pullRequest.activeReviewRequestCount,
      commentCount: dedupeByNodeId(pullRequest.comments).length,
      claim,
      selection: workItemSelection({
        kind: "pull-request",
        author: pullRequest.author,
        labels,
        contributorReady: true,
        actionability,
        reviewDecision: pullRequest.reviewDecision,
        activeReviewRequestCount: pullRequest.activeReviewRequestCount,
        claimStatus: claim.status,
      }),
      evidence: evidenceStatus(evidence),
      model: modelStatus(attribution),
    },
    attribution,
  };
}

function compareWorkItems(left: WorkItem, right: WorkItem): number {
  const actionabilityRank = {
    actionable: 0,
    blocked: 1,
    draft: 2,
  } as const;
  const priorityRank = { urgent: 0, high: 1, normal: 2, low: 3 } as const;
  return (
    Number(left.selection.status === "excluded") -
      Number(right.selection.status === "excluded") ||
    actionabilityRank[left.actionability] -
      actionabilityRank[right.actionability] ||
    Number(left.claim.status === "claimed") -
      Number(right.claim.status === "claimed") ||
    priorityRank[left.priority] - priorityRank[right.priority] ||
    parseIsoTime(right.updatedAt) - parseIsoTime(left.updatedAt) ||
    right.number - left.number
  );
}

function compareOpportunities(
  left: ScoreOpportunity,
  right: ScoreOpportunity,
): number {
  return (
    parseIsoTime(right.occurredAt) - parseIsoTime(left.occurredAt) ||
    left.source.number - right.source.number ||
    left.id.localeCompare(right.id)
  );
}

function hasOpenPullRequestOpportunitySignal(
  pullRequest: PullRequestRecord,
): boolean {
  if (isNearMaterialTestChange(pullRequest.files)) {
    return true;
  }
  if (materialTestStats(pullRequest.files).additions > 0) {
    return true;
  }
  if (
    pullRequest.reviews.some(
      (review) =>
        review.author &&
        !isBotActor(review.author) &&
        pullRequest.author &&
        !sameActor(review.author, pullRequest.author),
    )
  ) {
    return true;
  }
  return (
    pullRequest.commitCount >= 1 &&
    pullRequest.changedFiles >= 1 &&
    pullRequest.additions + pullRequest.deletions >= 20
  );
}

/**
 * Bounds a live GitHub title to the published 256-character opportunity limit
 * without splitting a surrogate pair, so one long upstream title cannot fail
 * the whole snapshot.
 */
function boundedSourceTitle(title: string): string {
  if (title.length <= 256) return title;
  return `${title.slice(0, 255).replace(/[\uD800-\uDBFF]$/u, "")}…`;
}

function collectOpenPullRequestOpportunities(
  openPullRequests: PullRequestRecord[],
  verifiedEvidence: VerifiedEvidenceArtifact[],
): ScoreOpportunity[] {
  const opportunities: ScoreOpportunity[] = [];

  for (const pullRequest of openPullRequests) {
    if (pullRequest.mergedAt !== null) {
      continue;
    }
    const repository = repositoryIdFromUrl(pullRequest.url);
    const pullRequestSource = {
      id: pullRequest.id,
      kind: "pull-request" as const,
      number: pullRequest.number,
      title: boundedSourceTitle(pullRequest.title),
      url: pullRequest.url,
    };

    if (pullRequest.author && !isBotActor(pullRequest.author)) {
      // Drafts are still open, but they are not ready for score-facing guidance.
      if (!pullRequest.isDraft) {
        if (isNearMaterialTestChange(pullRequest.files)) {
          const { additions, churn } = materialTestStats(pullRequest.files);
          opportunities.push({
            id: `${pullRequest.id}:opportunity:near-material-test`,
            actor: pullRequest.author,
            kind: "near-material-test",
            category: "material-test-change",
            potentialPoints: 4,
            occurredAt: pullRequest.updatedAt,
            repository,
            source: pullRequestSource,
            reason: `Recognized test files currently add ${additions} lines and change ${churn} total lines; thresholds are ${MATERIAL_TEST_ADDITIONS} additions and ${MATERIAL_TEST_CHURN} churn.`,
            hint: `Add recognized test coverage to reach ${MATERIAL_TEST_ADDITIONS} additions and ${MATERIAL_TEST_CHURN} total churn before merge.`,
          });
        }

        const sources = pullRequestTextSources(pullRequest);
        const evidence = assessEvidence(
          sources,
          verifiedEvidence.filter(
            (artifact) =>
              artifact.pullRequestId === pullRequest.id &&
              artifact.pullRequestMergedAt === pullRequest.mergedAt &&
              artifact.pullRequestHeadOid === pullRequest.headRefOid &&
              artifact.pullRequestUpdatedAt === pullRequest.updatedAt,
          ),
        );
        const status = evidenceStatus(evidence);
        const publishEvidenceGap =
          status.status === "partial" ||
          (status.status === "missing" &&
            hasOpenPullRequestOpportunitySignal(pullRequest));
        if (publishEvidenceGap) {
          const remaining = status.maxPoints - status.points;
          opportunities.push({
            id: `${pullRequest.id}:opportunity:${status.status}-evidence`,
            actor: pullRequest.author,
            kind:
              status.status === "missing"
                ? "missing-evidence"
                : "partial-evidence",
            category: "evidence",
            potentialPoints: remaining,
            occurredAt: pullRequest.updatedAt,
            repository,
            source: pullRequestSource,
            reason: `Open pull request evidence is ${status.status} with ${status.points} of ${status.maxPoints} points verified.`,
            hint:
              status.status === "missing"
                ? "Add verified screenshot, video, or log evidence before merge."
                : "Finish verified evidence categories before merge.",
          });
        }
      }
    }

    if (pullRequest.isDraft) {
      continue;
    }

    // A reviewer who already left a qualifying review on this pull request
    // scores once it merges, so telling them to expand a thinner review would
    // be false guidance.
    const qualifiedReviewers = new Set(
      dedupeByNodeId(pullRequest.reviews).flatMap((review) =>
        review.author &&
        ["APPROVED", "CHANGES_REQUESTED"].includes(review.state) &&
        hasSubstantiveReviewBody(review)
          ? [review.author.id]
          : [],
      ),
    );
    const seenReviewers = new Set<string>();
    for (const review of dedupeByNodeId(pullRequest.reviews).sort(
      (left, right) => {
        if (left.submittedAt === right.submittedAt) {
          return left.id.localeCompare(right.id);
        }
        if (left.submittedAt === null) {
          return -1;
        }
        if (right.submittedAt === null) {
          return 1;
        }
        return left.submittedAt.localeCompare(right.submittedAt);
      },
    )) {
      if (
        !review.author ||
        seenReviewers.has(review.author.id) ||
        qualifiedReviewers.has(review.author.id) ||
        !isExpandableReviewOpportunity(review, pullRequest)
      ) {
        continue;
      }
      seenReviewers.add(review.author.id);
      const submittedAt = review.submittedAt;
      if (submittedAt === null) {
        throw new TypeError("expandable review lost its submission timestamp");
      }
      opportunities.push({
        id: `${pullRequest.id}:opportunity:expand-review:${review.author.id}`,
        actor: review.author,
        kind: "expand-review",
        category: "substantive-review",
        potentialPoints: 3,
        occurredAt: submittedAt,
        repository,
        source: {
          id: review.id,
          kind: "review",
          number: pullRequest.number,
          title: boundedSourceTitle(pullRequest.title),
          url: review.url,
        },
        reason:
          "Review is APPROVED or CHANGES_REQUESTED but still needs at least 20 characters of rationale or an inline comment.",
        hint: "Add at least 20 characters of review rationale or an inline comment before merge.",
      });
    }
  }

  return opportunities.sort(compareOpportunities);
}

function latestSourceUpdate(input: LeaderboardInput): string {
  const timestamps = [
    input.sourceUpdatedAt,
    ...input.mergedPullRequestOutcomes.map((record) => record.updatedAt),
    ...input.mergedPullRequests.map((record) => record.updatedAt),
    ...input.resolvedIssues.map((record) => record.updatedAt),
    ...input.openIssues.map((record) => record.updatedAt),
    ...input.openPullRequests.map((record) => record.updatedAt),
  ];
  return timestamps.reduce((latest, current) =>
    parseIsoTime(current) > parseIsoTime(latest) ? current : latest,
  );
}

export function createLeaderboardSnapshot(
  input: LeaderboardInput,
): LeaderboardSnapshot {
  const mergedPullRequestOutcomes = dedupeByNodeId(
    input.mergedPullRequestOutcomes,
  ).sort(
    (left, right) =>
      parseIsoTime(right.mergedAt) - parseIsoTime(left.mergedAt) ||
      right.number - left.number ||
      left.id.localeCompare(right.id),
  );
  const mergedPullRequests = dedupeByNodeId(input.mergedPullRequests).sort(
    (left, right) =>
      parseIsoTime(right.mergedAt ?? right.updatedAt) -
        parseIsoTime(left.mergedAt ?? left.updatedAt) ||
      right.number - left.number ||
      left.id.localeCompare(right.id),
  );
  const resolvedIssues = dedupeByNodeId(input.resolvedIssues)
    .filter(qualifiesResolvedIssue)
    .sort(
      (left, right) =>
        parseIsoTime(right.closedAt ?? right.updatedAt) -
          parseIsoTime(left.closedAt ?? left.updatedAt) ||
        right.number - left.number ||
        left.id.localeCompare(right.id),
    );
  const openIssues = dedupeByNodeId(input.openIssues);
  const openPullRequests = dedupeByNodeId(input.openPullRequests);
  const verifiedEvidence = selectUniqueVerifiedEvidence(
    input.verifiedEvidence,
    [...mergedPullRequests, ...openPullRequests],
  );
  const entries = new Map<string, MutableLeaderboardEntry>();
  const ledger: ScoreEvent[] = [];
  const scoredAttributionSources = new Map<string, GitHubTextSource>();
  const recordScoredSources = (sources: GitHubTextSource[]): void => {
    for (const source of sources) {
      if (!scoredAttributionSources.has(source.id)) {
        scoredAttributionSources.set(source.id, source);
      }
    }
  };
  const outcomeIds = new Set(
    mergedPullRequestOutcomes.map((pullRequest) => pullRequest.id),
  );
  const verificationWindowFrom = parseIsoTime(input.verificationWindowFrom);
  const windowTo = parseIsoTime(input.windowTo);
  const generatedAt = parseIsoTime(input.generatedAt);

  if (verificationWindowFrom >= windowTo) {
    throw new Error("verificationWindowFrom must precede windowTo");
  }
  if (generatedAt < windowTo) {
    throw new Error("generatedAt cannot precede windowTo");
  }
  for (const pullRequest of mergedPullRequests) {
    if (!outcomeIds.has(pullRequest.id)) {
      throw new Error(
        `Detailed pull request ${pullRequest.id} is missing from the complete outcome window`,
      );
    }
    if (
      !pullRequest.mergedAt ||
      parseIsoTime(pullRequest.mergedAt) < verificationWindowFrom ||
      parseIsoTime(pullRequest.mergedAt) >= windowTo
    ) {
      throw new Error(
        `Detailed pull request ${pullRequest.id} falls outside the verification window`,
      );
    }
  }
  for (const issue of input.resolvedIssues) {
    if (
      !issue.closedAt ||
      parseIsoTime(issue.closedAt) < verificationWindowFrom ||
      parseIsoTime(issue.closedAt) >= windowTo
    ) {
      throw new Error(
        `Detailed issue ${issue.id} falls outside the verification window`,
      );
    }
  }

  const scoreRatifications = new Map<
    string,
    { record: ScoreRatificationRecord; source: GitHubTextSource }
  >();
  for (const pullRequest of mergedPullRequests) {
    const repository = findTargetRepositoryById(
      repositoryIdFromUrl(pullRequest.url),
    );
    if (!repository)
      throw new TypeError("score record repository is not registered");
    const sources = pullRequestTextSources(pullRequest);
    const sourceById = new Map(sources.map((source) => [source.id, source]));
    let current: {
      record: ScoreRatificationRecord;
      source: GitHubTextSource;
    } | null = null;
    for (const source of sources
      .filter((candidate) => candidate.kind === "comment")
      .sort(
        (left, right) =>
          parseIsoTime(left.createdAt) - parseIsoTime(right.createdAt) ||
          left.id.localeCompare(right.id),
      )) {
      const raw = parseScoreRatificationBlock(source.body);
      if (raw === null) continue;
      const record = assertScoreRatificationContext(raw, {
        projectId: repository.projectId,
        pullRequestNodeId: pullRequest.id,
        headSha: pullRequest.headRefOid,
        sourceNodeId: source.id,
        authorAssociation: source.authorAssociation,
        createdAt: source.createdAt,
        updatedAt: source.updatedAt,
      });
      if (current === null && record.supersedes !== null) {
        throw new TypeError(
          "first slop-score record cannot supersede another record",
        );
      }
      if (current !== null && record.supersedes !== current.source.id) {
        throw new TypeError(
          "slop-score correction must supersede the current record",
        );
      }
      // Related-party scoring requires a second maintainer regardless of tier:
      // a ratifier must never be the sole authority over their own outcome.
      if (
        sameActor(source.author, pullRequest.author) &&
        record.coRatifierNodeIds.length === 0
      ) {
        throw new TypeError(
          "self slop-score requires a second maintainer co-ratifier",
        );
      }
      for (const reviewNodeId of record.proposalReviewNodeIds) {
        const reviewSource = sourceById.get(reviewNodeId);
        const proposal = reviewSource
          ? parseReviewRecordBlock(reviewSource.body)
          : null;
        if (!reviewSource || proposal === null) {
          throw new TypeError(
            "slop-score proposal does not reference a review record on this pull request",
          );
        }
        if (
          typeof proposal !== "object" ||
          proposal === null ||
          (proposal as { schemaVersion?: unknown }).schemaVersion !== "2"
        ) {
          throw new TypeError(
            "non-micro slop-score requires a v2 Claude review proposal",
          );
        }
        const proposedReview = assertReviewRecord(proposal);
        const proposalAssessment = assessModelAttribution([reviewSource], {
          requireEverySource: true,
          verifyRunReceipt: input.verifyRunReceipt,
        });
        const proposalReceipt = input.verifyRunReceipt
          ? (proposalAssessment.declarations[0]?.run ?? null)
          : null;
        assertReviewRecordReceiptJoin(proposedReview, proposalReceipt, {
          artifactUrl: pullRequest.url,
          headSha: pullRequest.headRefOid,
        });
        if (
          proposedReview.securityRisk !== "none" &&
          record.coRatifierNodeIds.length === 0
        ) {
          throw new TypeError(
            "security-sensitive slop-score requires a co-ratifier",
          );
        }
      }
      for (const ratifierNodeId of record.coRatifierNodeIds) {
        const ratifier = sourceById.get(ratifierNodeId);
        if (
          !ratifier ||
          !["OWNER", "MEMBER", "COLLABORATOR"].includes(
            ratifier.authorAssociation ?? "",
          ) ||
          ratifier.createdAt !== ratifier.updatedAt
        ) {
          throw new TypeError(
            "slop-score co-ratifier is not an immutable maintainer comment",
          );
        }
        if (sameActor(ratifier.author, source.author)) {
          throw new TypeError(
            "slop-score co-ratifier must be a second maintainer",
          );
        }
        const approval = parseScoreApprovalBlock(ratifier.body);
        if (approval === null) {
          throw new TypeError(
            "slop-score co-ratifier lacks a score approval record",
          );
        }
        assertScoreApprovalRecord(approval, record);
      }
      current = { record, source };
    }
    if (current) scoreRatifications.set(pullRequest.id, current);
  }

  for (const pullRequest of mergedPullRequestOutcomes) {
    if (pullRequest.author && !isBotActor(pullRequest.author)) {
      const authorEntry = actorEntry(entries, pullRequest.author);
      authorEntry.rawActivity.additions += pullRequest.additions;
      authorEntry.rawActivity.deletions += pullRequest.deletions;
      const ratification = scoreRatifications.get(pullRequest.id);
      const contributionAssessment = assessModelAttribution(
        [pullRequestBodySource(pullRequest)],
        {
          requireEverySource: true,
          verifyRunReceipt: input.verifyRunReceipt,
        },
      );
      const contributionRun = input.verifyRunReceipt
        ? contributionAssessment.declarations.find(
            (declaration) =>
              declaration.actor?.id === pullRequest.author?.id &&
              declaration.artifactId === pullRequest.id,
          )?.run
        : null;
      const contributionBonus = contributionRun?.traceUpload ? 1_500 : 0;
      const scored = addScore(entries, ledger, {
        id: `${pullRequest.id}:merged`,
        actor: pullRequest.author,
        category: "merged-pull-request",
        points: ratification ? ratification.record.scoreThirds / 3 : 1 / 3,
        ...(parseIsoTime(pullRequest.mergedAt) >=
        parseIsoTime(SCORE_V2_EFFECTIVE_AT)
          ? {
              scoreThirds: ratification?.record.scoreThirds ?? 1,
              evidenceBonusBasisPoints: contributionBonus as
                | 0
                | 1_000
                | 1_500
                | 2_500,
              workUnitId:
                ratification?.record.workUnitId ??
                `wu_${repositoryIdFromUrl(pullRequest.url)
                  .toLowerCase()
                  .replace(/[^a-z0-9_-]+/gu, "_")}_pr_${pullRequest.number}`,
              scoreDecisionSourceId: ratification?.source.id,
            }
          : {}),
        occurredAt: pullRequest.mergedAt,
        repository: repositoryIdFromUrl(pullRequest.url),
        source: {
          id: pullRequest.id,
          kind: "pull-request",
          number: pullRequest.number,
          title: pullRequest.title,
          url: pullRequest.url,
        },
        reason: ratification
          ? `Maintainer-ratified ${ratification.record.tier} accepted outcome: ${ratification.record.reason}`
          : "Accepted outcome has provisional micro credit pending immutable maintainer ratification.",
      });
      if (scored) {
        recordScoredSources([pullRequestBodySource(pullRequest)]);
      }
    }
  }

  for (const pullRequest of mergedPullRequests) {
    if (!pullRequest.mergedAt) {
      throw new Error(
        `Detailed merged pull request ${pullRequest.id} is missing its merge timestamp`,
      );
    }
    const sources = pullRequestTextSources(pullRequest);
    recordTextActivity(entries, sources);

    if (pullRequest.author && !isBotActor(pullRequest.author)) {
      const authorEntry = actorEntry(entries, pullRequest.author);
      authorEntry.rawActivity.commits += pullRequest.commitCount;
      if (hasMaterialTestChange(pullRequest.files)) {
        const scored = addScore(entries, ledger, {
          id: `${pullRequest.id}:tests`,
          actor: pullRequest.author,
          category: "material-test-change",
          points: 4,
          occurredAt: pullRequest.mergedAt,
          repository: repositoryIdFromUrl(pullRequest.url),
          source: {
            id: pullRequest.id,
            kind: "pull-request",
            number: pullRequest.number,
            title: pullRequest.title,
            url: pullRequest.url,
          },
          reason: `Recognized test files met the ${MATERIAL_TEST_ADDITIONS}-addition and ${MATERIAL_TEST_CHURN}-churn threshold.`,
        });
        if (scored) {
          recordScoredSources([pullRequestBodySource(pullRequest)]);
        }
      }

      const attributableEvidenceSources = evidenceSourcesAtMerge(
        pullRequest,
        sources,
      ).filter((source) => sameActor(source.author, pullRequest.author));
      const evidence = assessEvidence(
        attributableEvidenceSources,
        verifiedEvidence.filter(
          (artifact) =>
            artifact.pullRequestId === pullRequest.id &&
            artifact.pullRequestMergedAt === pullRequest.mergedAt &&
            artifact.pullRequestHeadOid === pullRequest.headRefOid &&
            artifact.pullRequestUpdatedAt === pullRequest.updatedAt,
        ),
      );
      const evidenceSourceById = new Map(
        attributableEvidenceSources.map((source) => [source.id, source]),
      );
      for (const finding of evidence.findings) {
        const scored = addScore(entries, ledger, {
          id: `${pullRequest.id}:evidence:${finding.category}`,
          actor: pullRequest.author,
          category: "evidence",
          points: finding.points,
          occurredAt: pullRequest.mergedAt,
          repository: repositoryIdFromUrl(pullRequest.url),
          source: {
            id: pullRequest.id,
            kind: "pull-request",
            number: pullRequest.number,
            title: pullRequest.title,
            url: pullRequest.url,
          },
          reason: `Remote ${finding.category} evidence passed byte and structure verification.`,
        });
        if (scored) {
          recordScoredSources(
            finding.sourceIds.flatMap((sourceId) => {
              const source = evidenceSourceById.get(sourceId);
              return source ? [source] : [];
            }),
          );
        }
      }
    }

    const ratification = scoreRatifications.get(pullRequest.id);
    const awardedReviewers = new Set<string>();
    for (const source of sources) {
      let rawReview: unknown | null;
      try {
        rawReview = parseReviewRecordBlock(source.body);
      } catch {
        continue;
      }
      if (
        rawReview === null ||
        !source.author ||
        sameActor(source.author, pullRequest.author)
      )
        continue;
      const assessment = assessModelAttribution([source], {
        requireEverySource: true,
        verifyRunReceipt: input.verifyRunReceipt,
      });
      const receipt = input.verifyRunReceipt
        ? (assessment.declarations[0]?.run ?? null)
        : null;
      if (receipt === null) continue;
      let record: ReviewRecord;
      try {
        record = assertReviewRecordReceiptJoin(rawReview, receipt, {
          artifactUrl: pullRequest.url,
          headSha: pullRequest.headRefOid,
        });
      } catch {
        continue;
      }
      if (record.workUnitId.includes("_legacy_")) continue;
      if (!ratification?.record.proposalReviewNodeIds.includes(source.id)) {
        continue;
      }
      // Post-merge review is excluded, never fatal: an unprivileged comment on
      // a merged pull request must not fail snapshot generation.
      if (parseIsoTime(source.createdAt) > parseIsoTime(pullRequest.mergedAt)) {
        continue;
      }
      const reviewThirds = {
        triage: 1,
        standard: 3,
        deep: 9,
        specialist: 24,
      }[record.reviewLoad];
      awardedReviewers.add(source.author.id);
      if (
        addScore(entries, ledger, {
          id: `${pullRequest.id}:automated-review:${source.id}`,
          actor: source.author,
          category: "substantive-review",
          points: reviewThirds / 3,
          scoreThirds: reviewThirds,
          evidenceBonusBasisPoints: receipt.traceUpload ? 1_500 : 0,
          workUnitId: `${record.workUnitId}_review_${source.author.id.toLowerCase().replace(/[^a-z0-9_-]+/gu, "_")}`,
          occurredAt: source.createdAt,
          repository: repositoryIdFromUrl(pullRequest.url),
          source: {
            id: source.id,
            kind: source.kind === "review" ? "review" : "comment",
            number: pullRequest.number,
            title: pullRequest.title,
            url: source.url,
          },
          reason: `Automated ${record.reviewLoad} review with finalized private trace; maintainer scoring remains authoritative.`,
        })
      ) {
        recordScoredSources([source]);
      }
    }

    if (
      ratification?.source.author &&
      !sameActor(ratification.source.author, pullRequest.author) &&
      !awardedReviewers.has(ratification.source.author.id)
    ) {
      addScore(entries, ledger, {
        id: `${pullRequest.id}:ratifier:${ratification.source.id}`,
        actor: ratification.source.author,
        category: "substantive-review",
        points: 1 / 3,
        scoreThirds: 1,
        workUnitId: `${ratification.record.workUnitId}_ratification`,
        occurredAt: ratification.source.createdAt,
        repository: repositoryIdFromUrl(pullRequest.url),
        source: {
          id: ratification.source.id,
          kind: "comment",
          number: pullRequest.number,
          title: pullRequest.title,
          url: ratification.source.url,
        },
        reason:
          "Immutable maintainer score ratification for an accepted outcome.",
      });
    }
    for (const review of dedupeByNodeId(pullRequest.reviews).sort(
      (left, right) => {
        if (left.submittedAt === right.submittedAt) {
          return left.id.localeCompare(right.id);
        }
        if (left.submittedAt === null) {
          return -1;
        }
        if (right.submittedAt === null) {
          return 1;
        }
        return left.submittedAt.localeCompare(right.submittedAt);
      },
    )) {
      if (review.author && !isBotActor(review.author)) {
        actorEntry(entries, review.author).rawActivity.reviews += 1;
      }
      if (
        !review.author ||
        awardedReviewers.has(review.author.id) ||
        !isSubstantiveReview(review, pullRequest)
      ) {
        continue;
      }
      if (!review.submittedAt) {
        throw new Error(
          `Qualifying review ${review.id} is missing its submitted timestamp`,
        );
      }
      awardedReviewers.add(review.author.id);
      const scored = addScore(entries, ledger, {
        id: `${pullRequest.id}:reviewer:${review.author.id}`,
        actor: review.author,
        category: "substantive-review",
        points: 3,
        occurredAt: review.submittedAt,
        repository: repositoryIdFromUrl(review.url),
        source: {
          id: review.id,
          kind: "review",
          number: pullRequest.number,
          title: pullRequest.title,
          url: review.url,
        },
        reason:
          "First qualifying substantive, non-self review submitted before merge.",
      });
      if (scored) {
        const source = sources.find((candidate) => candidate.id === review.id);
        if (source) {
          recordScoredSources([source]);
        }
      }
    }
  }

  for (const issue of resolvedIssues) {
    const sources = issueTextSources(issue);
    recordTextActivity(entries, sources);
    const contributor = resolvedIssueContributor(issue);
    if (contributor?.author) {
      if (!issue.closedAt) {
        throw new Error(
          `Qualifying resolved issue ${issue.id} is missing its closed timestamp`,
        );
      }
      const scored = addScore(entries, ledger, {
        id: `${issue.id}:resolved-by:${contributor.id}`,
        actor: contributor.author,
        category: "resolved-issue",
        points: 4,
        occurredAt: issue.closedAt,
        repository: repositoryIdFromUrl(issue.url),
        source: {
          id: issue.id,
          kind: "issue",
          number: issue.number,
          title: issue.title,
          url: issue.url,
        },
        reason:
          "Contributor authored the merged pull request that resolved this issue.",
      });
      if (scored) {
        recordScoredSources([
          {
            id: `${contributor.id}:body`,
            artifactId: contributor.id,
            kind: "body",
            body: contributor.body,
            url: contributor.url,
            createdAt: contributor.createdAt,
            updatedAt: contributor.updatedAt,
            author: contributor.author,
          },
        ]);
      }
    }
  }

  const evaluatedSourceKeys = new Set<string>();
  const evaluatedTextSources = new Map<string, GitHubTextSource>();
  for (const source of [
    ...mergedPullRequests.flatMap(pullRequestTextSources),
    ...openPullRequests.flatMap(pullRequestTextSources),
    ...resolvedIssues.flatMap(issueTextSources),
    ...openIssues.flatMap(issueTextSources),
  ]) {
    const existing = evaluatedTextSources.get(source.id);
    if (
      existing &&
      (existing.url !== source.url ||
        existing.body !== source.body ||
        existing.author?.id !== source.author?.id)
    ) {
      throw new TypeError(
        `Evaluated source ${source.id} has conflicting GitHub records`,
      );
    }
    evaluatedTextSources.set(source.id, source);
  }
  const evaluatedContributions = [...(input.evaluatedContributions ?? [])].sort(
    (left, right) =>
      parseIsoTime(right.occurredAt) - parseIsoTime(left.occurredAt) ||
      left.id.localeCompare(right.id),
  );
  for (const [index, event] of evaluatedContributions.entries()) {
    assertLedgerValue(event, `evaluatedContributions[${index}]`);
    if (event.category !== "evaluated-contribution") {
      throw new TypeError(
        `evaluatedContributions[${index}] must use the evaluated-contribution category`,
      );
    }
    const occurredAt = parseIsoTime(event.occurredAt);
    if (occurredAt < parseIsoTime(input.windowFrom) || occurredAt >= windowTo) {
      throw new RangeError(
        `Evaluated contribution ${event.id} falls outside the rolling window`,
      );
    }
    const sourceKey = `${event.repository}\0${event.source.id}`;
    if (
      evaluatedSourceKeys.has(sourceKey) ||
      ledger.some(
        (existing) =>
          existing.repository === event.repository &&
          (existing.source.id === event.source.id ||
            existing.source.url === event.source.url),
      )
    ) {
      throw new TypeError(
        `Evaluated contribution ${event.id} duplicates a score-bearing source`,
      );
    }
    evaluatedSourceKeys.add(sourceKey);
    addScore(entries, ledger, event);
    if (event.source.kind === "comment") {
      const source = evaluatedTextSources.get(event.source.id);
      if (
        source?.kind !== "comment" ||
        source.url !== event.source.url ||
        source.author?.id !== event.actor.id ||
        parseIsoTime(source.createdAt) !== occurredAt
      ) {
        throw new TypeError(
          `Evaluated contribution ${event.id} does not match its exact GitHub comment`,
        );
      }
      recordScoredSources([source]);
    }
  }

  const issueQueue = openIssues.map((record) =>
    issueWorkItem(record, input.generatedAt),
  );
  const pullRequestQueue = openPullRequests.map((record) =>
    pullRequestWorkItem(
      record,
      input.generatedAt,
      verifiedEvidence.filter(
        (artifact) =>
          artifact.pullRequestId === record.id &&
          artifact.pullRequestMergedAt === record.mergedAt &&
          artifact.pullRequestHeadOid === record.headRefOid &&
          artifact.pullRequestUpdatedAt === record.updatedAt,
      ),
    ),
  );
  const opportunities = collectOpenPullRequestOpportunities(
    openPullRequests,
    verifiedEvidence,
  );
  const overallAttribution = assessModelAttribution(
    [...scoredAttributionSources.values()],
    {
      requireEverySource: true,
      verifyRunReceipt: input.verifyRunReceipt,
    },
  );
  const attributions = overallAttribution.declarations;
  for (const attribution of attributions) {
    if (attribution.actor && !isBotActor(attribution.actor)) {
      actorEntry(entries, attribution.actor).models.add(attribution.identifier);
    }
  }

  const leaders = [...entries.values()]
    .filter((entry) => entry.score > 0)
    .sort(compareRankedEntries)
    .map<LeaderboardEntry>((entry, index) => ({
      rank: index + 1,
      actor: entry.actor,
      score: Math.floor(entry.scoreThirds / 3),
      scoreThirds: entry.scoreThirds,
      points: {
        mergedPullRequests: entry.pointThirds.mergedPullRequests / 3,
        resolvedIssues: entry.pointThirds.resolvedIssues / 3,
        materialTestChanges: entry.pointThirds.materialTestChanges / 3,
        evidence: entry.pointThirds.evidence / 3,
        substantiveReviews: entry.pointThirds.substantiveReviews / 3,
        evaluatedContributions: entry.pointThirds.evaluatedContributions / 3,
      },
      pointThirds: { ...entry.pointThirds },
      acceptedOutcomes: { ...entry.acceptedOutcomes },
      rawActivity: { ...entry.rawActivity },
      reportedModels: uniqueSorted(entry.models),
    }));

  const snapshot: LeaderboardSnapshot = {
    schemaVersion: LEADERBOARD_SCHEMA_VERSION,
    repository: LEADERBOARD_REPOSITORY,
    repositories: TARGET_REPOSITORIES.map(
      ({ aliases: _aliases, expectedNodeId: _expectedNodeId, ...repository }) =>
        repository,
    ),
    ruleVersion: SCORE_RULE_VERSION,
    generatedAt: input.generatedAt,
    sourceUpdatedAt: latestSourceUpdate(input),
    stale: false,
    window: {
      days: SCORE_WINDOW_DAYS,
      from: input.windowFrom,
      to: input.windowTo,
    },
    methodology: leaderboardMethodology(),
    source: {
      ...input.source,
      counts: {
        mergedPullRequests: mergedPullRequestOutcomes.length,
        detailedMergedPullRequests: mergedPullRequests.length,
        closedIssues: input.closedIssueCount,
        detailedClosedIssues: input.resolvedIssues.length,
        resolvedIssues: resolvedIssues.length,
        openIssues: openIssues.length,
        openPullRequests: openPullRequests.length,
      },
      verificationWindow: {
        days: VERIFICATION_WINDOW_DAYS,
        from: input.verificationWindowFrom,
        to: input.windowTo,
      },
    },
    leaders,
    ledger: dedupeByNodeId(ledger).sort(
      (left, right) =>
        right.points - left.points ||
        left.source.number - right.source.number ||
        left.id.localeCompare(right.id),
    ),
    opportunities,
    attributions,
    invalidAttributionMarkers: overallAttribution.invalidMarkers.sort(
      (left, right) =>
        left.sourceId.localeCompare(right.sourceId) ||
        left.reason.localeCompare(right.reason),
    ),
    attributionCoverage: overallAttribution.coverage,
    workQueue: {
      issues: issueQueue.map((result) => result.item).sort(compareWorkItems),
      pullRequests: pullRequestQueue
        .map((result) => result.item)
        .sort(compareWorkItems),
    },
  };
  assertPublishableLeaderboardSnapshot(snapshot);
  return snapshot;
}

function assertObject(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value;
}

function assertString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
}

function assertFiniteNumber(
  value: unknown,
  path: string,
): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number`);
  }
}

function assertNonNegativeInteger(
  value: unknown,
  path: string,
): asserts value is number {
  assertFiniteNumber(value, path);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${path} must be a non-negative integer`);
  }
}

function assertPositiveInteger(
  value: unknown,
  path: string,
): asserts value is number {
  assertFiniteNumber(value, path);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${path} must be a positive integer`);
  }
}

function assertIsoTimestamp(
  value: unknown,
  path: string,
): asserts value is string {
  assertString(value, path);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 19) !== value.slice(0, 19)
  ) {
    throw new Error(`${path} must be a UTC ISO-8601 timestamp`);
  }
}

function secureUrl(value: unknown, path: string): URL {
  assertString(value, path);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    // error-policy:J3 a malformed public snapshot URL is explicitly rejected.
    throw new Error(`${path} must be a valid web URL`);
  }
  if (
    parsed.protocol !== "https:" ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.port
  ) {
    throw new Error(`${path} must be a credential-free HTTPS URL`);
  }
  return parsed;
}

function assertRepositoryUrl(
  value: unknown,
  path: string,
  expectedKind?: "comment" | "issue" | "pull-request" | "review",
  expectedNumber?: number,
  expectedRepository?: RepositoryId,
): RepositoryId {
  const parsed = secureUrl(value, path);
  if (parsed.hostname.toLowerCase() !== "github.com" || parsed.search) {
    throw new Error(`${path} must use the canonical GitHub repository origin`);
  }
  const match = parsed.pathname.match(
    /^\/([^/]+)\/([^/]+)\/(issues|pull)\/([1-9][0-9]*)\/?$/,
  );
  const repository = match ? findTargetRepository(match[1], match[2]) : null;
  if (!match || !repository) {
    throw new Error(
      `${path} must identify an issue or pull request in a registry repository`,
    );
  }
  if (
    expectedRepository !== undefined &&
    repository.id !== expectedRepository
  ) {
    throw new Error(`${path} does not match its declared repository`);
  }
  const actualKind =
    match[3].toLowerCase() === "issues" ? "issue" : "pull-request";
  if (
    expectedKind &&
    expectedKind !== "comment" &&
    (expectedKind === "issue"
      ? actualKind !== "issue"
      : actualKind !== "pull-request")
  ) {
    throw new Error(`${path} kind does not match its repository URL`);
  }
  if (expectedNumber !== undefined && Number(match[4]) !== expectedNumber) {
    throw new Error(`${path} number does not match its repository URL`);
  }
  if (expectedKind === "comment") {
    if (!/^#issuecomment-\d+$/i.test(parsed.hash)) {
      throw new Error(
        `${path} comment URL must identify an exact GitHub issue or pull-request comment`,
      );
    }
  } else if (expectedKind === "review") {
    if (!/^#(?:pullrequestreview-|discussion_r)\d+$/i.test(parsed.hash)) {
      throw new Error(
        `${path} review URL must identify a GitHub review or inline discussion`,
      );
    }
  } else if (
    parsed.hash &&
    !/^#(?:issuecomment-|pullrequestreview-|discussion_r)\d+$/i.test(
      parsed.hash,
    )
  ) {
    throw new Error(`${path} has an unsupported GitHub fragment`);
  }
  return repository.id;
}

function assertEnum<const Values extends readonly string[]>(
  value: unknown,
  allowed: Values,
  path: string,
): asserts value is Values[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`${path} must be one of: ${allowed.join(", ")}`);
  }
}

function assertStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array`);
  }
  const strings = value.map((item, index) => {
    assertString(item, `${path}[${index}]`);
    return item;
  });
  if (new Set(strings).size !== strings.length) {
    throw new Error(`${path} must not contain duplicates`);
  }
  return strings;
}

function assertActorValue(value: unknown, path: string): void {
  const actor = assertObject(value, path);
  assertString(actor.id, `${path}.id`);
  assertString(actor.login, `${path}.login`);
  if (/\s/.test(actor.login)) {
    throw new Error(`${path}.login must be a GitHub login`);
  }
  const avatarUrl = secureUrl(actor.avatarUrl, `${path}.avatarUrl`);
  if (avatarUrl.hostname.toLowerCase() !== "avatars.githubusercontent.com") {
    throw new Error(`${path}.avatarUrl must use GitHub's avatar origin`);
  }
  const profileUrl = secureUrl(actor.url, `${path}.url`);
  const normalizedProfilePath = profileUrl.pathname.replace(/\/$/u, "");
  const directProfilePath = `/${actor.login}`;
  const appProfileAllowed =
    actor.kind === "Bot" &&
    /^\/apps\/[a-z0-9][a-z0-9-]*$/i.test(normalizedProfilePath);
  if (
    profileUrl.hostname.toLowerCase() !== "github.com" ||
    profileUrl.search ||
    profileUrl.hash ||
    (!appProfileAllowed &&
      normalizedProfilePath.toLowerCase() !== directProfilePath.toLowerCase())
  ) {
    throw new Error(
      `${path}.url must match the actor's canonical GitHub profile`,
    );
  }
  assertEnum(
    actor.kind,
    ["Bot", "Mannequin", "Organization", "User", "Unknown"],
    `${path}.kind`,
  );
}

function assertNullableActor(
  value: unknown,
  path: string,
): asserts value is GitHubActor | null {
  if (value !== null) {
    assertActorValue(value, path);
  }
}

function actorAvatarIdentity(avatarUrl: string): string {
  const identity = new URL(avatarUrl);
  identity.search = "";
  identity.hash = "";
  return identity.href;
}

function assertActorCoherence(actors: GitHubActor[]): void {
  const byId = new Map<string, GitHubActor>();
  const idByLogin = new Map<string, string>();
  for (const actor of actors) {
    const previous = byId.get(actor.id);
    if (
      previous &&
      (previous.login !== actor.login ||
        actorAvatarIdentity(previous.avatarUrl) !==
          actorAvatarIdentity(actor.avatarUrl) ||
        previous.url !== actor.url ||
        previous.kind !== actor.kind)
    ) {
      throw new Error(
        `GitHub actor ${actor.id} changes identity inside the snapshot`,
      );
    }
    const loginKey = actor.login.toLowerCase();
    const previousId = idByLogin.get(loginKey);
    if (previousId && previousId !== actor.id) {
      throw new Error(`GitHub login ${actor.login} maps to multiple actor IDs`);
    }
    byId.set(actor.id, actor);
    idByLogin.set(loginKey, actor.id);
  }
}

function assertMethodologyValue(value: unknown, path: string): void {
  const methodology = assertObject(value, path);
  assertString(methodology.summary, `${path}.summary`);
  if (
    !Array.isArray(methodology.scoringRules) ||
    methodology.scoringRules.length !== 6
  ) {
    throw new Error(`${path}.scoringRules must contain all six scoring rules`);
  }
  const expectedRuleIds: ScoreCategory[] = [
    "merged-pull-request",
    "resolved-issue",
    "material-test-change",
    "evidence",
    "substantive-review",
    "evaluated-contribution",
  ];
  const seenRuleIds = new Set<string>();
  methodology.scoringRules.forEach((ruleValue, index) => {
    const rulePath = `${path}.scoringRules[${index}]`;
    const rule = assertObject(ruleValue, rulePath);
    assertEnum(rule.id, expectedRuleIds, `${rulePath}.id`);
    if (seenRuleIds.has(rule.id)) {
      throw new Error(`${path}.scoringRules must not repeat rule IDs`);
    }
    seenRuleIds.add(rule.id);
    assertString(rule.points, `${rulePath}.points`);
    assertString(rule.cap, `${rulePath}.cap`);
    assertString(rule.qualification, `${rulePath}.qualification`);
  });
  if (seenRuleIds.size !== expectedRuleIds.length) {
    throw new Error(`${path}.scoringRules must publish every scoring rule`);
  }

  const evidenceWeights = assertObject(
    methodology.evidenceWeights,
    `${path}.evidenceWeights`,
  );
  const expectedEvidenceWeights: Record<EvidenceCategory, number> = {
    screenshot: 1,
    video: 2,
    logs: 1,
    trajectory: 1,
    "domain-artifact": 1,
  };
  for (const [category, expected] of Object.entries(expectedEvidenceWeights)) {
    assertFiniteNumber(
      evidenceWeights[category],
      `${path}.evidenceWeights.${category}`,
    );
    if (evidenceWeights[category] !== expected) {
      throw new Error(
        `${path}.evidenceWeights.${category} must be ${expected}`,
      );
    }
  }

  const testThreshold = assertObject(
    methodology.materialTestThreshold,
    `${path}.materialTestThreshold`,
  );
  assertNonNegativeInteger(
    testThreshold.minimumAdditions,
    `${path}.materialTestThreshold.minimumAdditions`,
  );
  assertNonNegativeInteger(
    testThreshold.minimumTotalChurn,
    `${path}.materialTestThreshold.minimumTotalChurn`,
  );
  if (testThreshold.minimumAdditions !== MATERIAL_TEST_ADDITIONS) {
    throw new Error(
      `${path}.materialTestThreshold.minimumAdditions must be ${MATERIAL_TEST_ADDITIONS}`,
    );
  }
  if (testThreshold.minimumTotalChurn !== MATERIAL_TEST_CHURN) {
    throw new Error(
      `${path}.materialTestThreshold.minimumTotalChurn must be ${MATERIAL_TEST_CHURN}`,
    );
  }
  assertString(testThreshold.cap, `${path}.materialTestThreshold.cap`);
  assertStringArray(methodology.exclusions, `${path}.exclusions`);
  assertStringArray(
    methodology.nonScoringActivity,
    `${path}.nonScoringActivity`,
  );
  assertString(methodology.provenancePolicy, `${path}.provenancePolicy`);
  assertString(methodology.collectionPolicy, `${path}.collectionPolicy`);
}

function assertSourceValue(value: unknown, path: string): void {
  const source = assertObject(value, path);
  if (source.provider !== "github-graphql") {
    throw new Error(`${path}.provider must be github-graphql`);
  }
  assertIsoTimestamp(source.fetchedAt, `${path}.fetchedAt`);
  assertIsoTimestamp(source.cutoffAt, `${path}.cutoffAt`);
  assertString(source.repositoryId, `${path}.repositoryId`);
  if (
    !Array.isArray(source.repositories) ||
    source.repositories.length !== TARGET_REPOSITORIES.length
  ) {
    throw new Error(
      `${path}.repositories must record a GraphQL node ID for every registry repository`,
    );
  }
  const sourceRepositoryNodeIds = new Set<string>();
  source.repositories.forEach((value, index) => {
    const entryPath = `${path}.repositories[${index}]`;
    const entry = assertObject(value, entryPath);
    if (entry.id !== TARGET_REPOSITORIES[index].id) {
      throw new Error(
        `${entryPath}.id must follow the target repository registry order`,
      );
    }
    assertString(entry.repositoryId, `${entryPath}.repositoryId`);
    if (sourceRepositoryNodeIds.has(entry.repositoryId)) {
      throw new Error(
        `${entryPath}.repositoryId must be unique per repository`,
      );
    }
    sourceRepositoryNodeIds.add(entry.repositoryId);
    if (
      TARGET_REPOSITORIES[index].role === "primary" &&
      entry.repositoryId !== source.repositoryId
    ) {
      throw new Error(
        `${path}.repositoryId must match the primary registry repository`,
      );
    }
  });
  assertPositiveInteger(source.requestCount, `${path}.requestCount`);
  assertPositiveInteger(source.searchSliceCount, `${path}.searchSliceCount`);

  const rateLimit = assertObject(source.rateLimit, `${path}.rateLimit`);
  assertNonNegativeInteger(rateLimit.cost, `${path}.rateLimit.cost`);
  if (rateLimit.consumedDuringRun !== undefined) {
    assertNonNegativeInteger(
      rateLimit.consumedDuringRun,
      `${path}.rateLimit.consumedDuringRun`,
    );
  }
  assertPositiveInteger(rateLimit.limit, `${path}.rateLimit.limit`);
  assertNonNegativeInteger(rateLimit.remaining, `${path}.rateLimit.remaining`);
  if (
    typeof rateLimit.remaining === "number" &&
    typeof rateLimit.limit === "number" &&
    rateLimit.remaining > rateLimit.limit
  ) {
    throw new Error(`${path}.rateLimit.remaining cannot exceed its limit`);
  }
  assertIsoTimestamp(rateLimit.resetAt, `${path}.rateLimit.resetAt`);

  const counts = assertObject(source.counts, `${path}.counts`);
  assertNonNegativeInteger(
    counts.mergedPullRequests,
    `${path}.counts.mergedPullRequests`,
  );
  assertNonNegativeInteger(
    counts.detailedMergedPullRequests,
    `${path}.counts.detailedMergedPullRequests`,
  );
  assertNonNegativeInteger(counts.closedIssues, `${path}.counts.closedIssues`);
  assertNonNegativeInteger(
    counts.detailedClosedIssues,
    `${path}.counts.detailedClosedIssues`,
  );
  assertNonNegativeInteger(
    counts.resolvedIssues,
    `${path}.counts.resolvedIssues`,
  );
  assertNonNegativeInteger(counts.openIssues, `${path}.counts.openIssues`);
  assertNonNegativeInteger(
    counts.openPullRequests,
    `${path}.counts.openPullRequests`,
  );
  if (
    counts.detailedMergedPullRequests > counts.mergedPullRequests ||
    counts.detailedClosedIssues > counts.closedIssues ||
    counts.resolvedIssues > counts.detailedClosedIssues
  ) {
    throw new Error(`${path}.counts detail coverage exceeds its source count`);
  }

  const verificationWindow = assertObject(
    source.verificationWindow,
    `${path}.verificationWindow`,
  );
  assertFiniteNumber(
    verificationWindow.days,
    `${path}.verificationWindow.days`,
  );
  if (verificationWindow.days !== VERIFICATION_WINDOW_DAYS) {
    throw new Error(
      `${path}.verificationWindow.days must be ${VERIFICATION_WINDOW_DAYS}`,
    );
  }
  assertIsoTimestamp(
    verificationWindow.from,
    `${path}.verificationWindow.from`,
  );
  assertIsoTimestamp(verificationWindow.to, `${path}.verificationWindow.to`);
  const evidenceVerification = assertObject(
    source.evidenceVerification,
    `${path}.evidenceVerification`,
  );
  assertEnum(
    evidenceVerification.status,
    ["complete", "suppressed-limit"],
    `${path}.evidenceVerification.status`,
  );
  const sourceCount = evidenceVerification.sourceCount;
  const artifactCount = evidenceVerification.artifactCount;
  const maxSources = evidenceVerification.maxSources;
  const maxArtifacts = evidenceVerification.maxArtifacts;
  assertNonNegativeInteger(
    sourceCount,
    `${path}.evidenceVerification.sourceCount`,
  );
  assertNonNegativeInteger(
    artifactCount,
    `${path}.evidenceVerification.artifactCount`,
  );
  assertNonNegativeInteger(
    maxSources,
    `${path}.evidenceVerification.maxSources`,
  );
  assertNonNegativeInteger(
    maxArtifacts,
    `${path}.evidenceVerification.maxArtifacts`,
  );
  if (
    evidenceVerification.status === "complete" &&
    (sourceCount > maxSources || artifactCount > maxArtifacts)
  ) {
    throw new Error(
      `${path}.evidenceVerification complete status exceeds a verification limit`,
    );
  }
  if (
    evidenceVerification.status === "suppressed-limit" &&
    sourceCount <= maxSources &&
    artifactCount <= maxArtifacts
  ) {
    throw new Error(
      `${path}.evidenceVerification suppressed status must exceed a verification limit`,
    );
  }
}

function assertNonNegativeNumber(value: unknown, path: string): void {
  assertFiniteNumber(value, path);
  if (value < 0) {
    throw new Error(`${path} must not be negative`);
  }
}

function assertLeaderValue(
  value: unknown,
  path: string,
  rank: number,
): asserts value is LeaderboardEntry {
  const entry = assertObject(value, path);
  assertPositiveInteger(entry.rank, `${path}.rank`);
  if (entry.rank !== rank) {
    throw new Error(`${path}.rank is not contiguous`);
  }
  assertActorValue(entry.actor, `${path}.actor`);
  assertNonNegativeInteger(entry.score, `${path}.score`);
  assertNonNegativeInteger(entry.scoreThirds, `${path}.scoreThirds`);
  if (Math.floor(Number(entry.scoreThirds) / 3) !== entry.score) {
    throw new Error(`${path}.score does not equal rounded-down scoreThirds`);
  }

  const points = assertObject(entry.points, `${path}.points`);
  const pointThirds = assertObject(entry.pointThirds, `${path}.pointThirds`);
  const pointKeys = [
    "mergedPullRequests",
    "resolvedIssues",
    "materialTestChanges",
    "evidence",
    "substantiveReviews",
    "evaluatedContributions",
  ] as const;
  let scoreThirdsTotal = 0;
  for (const key of pointKeys) {
    assertNonNegativeNumber(points[key], `${path}.points.${key}`);
    assertNonNegativeInteger(pointThirds[key], `${path}.pointThirds.${key}`);
    if (Math.abs(Number(points[key]) - Number(pointThirds[key]) / 3) > 1e-12) {
      throw new Error(`${path}.points.${key} does not match integer thirds`);
    }
    scoreThirdsTotal += Number(pointThirds[key]);
  }
  if (scoreThirdsTotal !== entry.scoreThirds) {
    throw new Error(`${path}.scoreThirds does not equal its point breakdown`);
  }

  const acceptedOutcomes = assertObject(
    entry.acceptedOutcomes,
    `${path}.acceptedOutcomes`,
  );
  for (const key of [
    "mergedPullRequests",
    "resolvedIssues",
    "materialTestChanges",
    "evidenceCategories",
    "substantiveReviews",
    "evaluatedContributions",
  ]) {
    assertNonNegativeInteger(
      acceptedOutcomes[key],
      `${path}.acceptedOutcomes.${key}`,
    );
  }
  const acceptedMergedPullRequests = acceptedOutcomes.mergedPullRequests;
  const acceptedResolvedIssues = acceptedOutcomes.resolvedIssues;
  const acceptedMaterialTestChanges = acceptedOutcomes.materialTestChanges;
  const acceptedSubstantiveReviews = acceptedOutcomes.substantiveReviews;
  const acceptedEvaluatedContributions =
    acceptedOutcomes.evaluatedContributions;
  const evidencePoints = points.evidence;
  assertNonNegativeInteger(
    acceptedMergedPullRequests,
    `${path}.acceptedOutcomes.mergedPullRequests`,
  );
  assertNonNegativeInteger(
    acceptedResolvedIssues,
    `${path}.acceptedOutcomes.resolvedIssues`,
  );
  assertNonNegativeInteger(
    acceptedMaterialTestChanges,
    `${path}.acceptedOutcomes.materialTestChanges`,
  );
  assertNonNegativeInteger(
    acceptedSubstantiveReviews,
    `${path}.acceptedOutcomes.substantiveReviews`,
  );
  assertNonNegativeInteger(
    acceptedEvaluatedContributions,
    `${path}.acceptedOutcomes.evaluatedContributions`,
  );
  assertNonNegativeNumber(evidencePoints, `${path}.points.evidence`);
  const rawActivity = assertObject(entry.rawActivity, `${path}.rawActivity`);
  for (const key of [
    "comments",
    "reviews",
    "commits",
    "additions",
    "deletions",
  ]) {
    assertNonNegativeInteger(rawActivity[key], `${path}.rawActivity.${key}`);
  }
  const models = assertStringArray(
    entry.reportedModels,
    `${path}.reportedModels`,
  );
  models.forEach((identifier, index) => {
    if (!isExactProviderModelIdentifier(identifier)) {
      throw new Error(
        `${path}.reportedModels[${index}] must be an exact provider/model identifier`,
      );
    }
  });
}

function assertCoverageCounts(
  value: Record<string, unknown>,
  path: string,
): { invalidSourceCount: number; validSourceCount: number } {
  const eligibleSourceCount = value.eligibleSourceCount;
  const validSourceCount = value.validSourceCount;
  const missingSourceCount = value.missingSourceCount;
  const invalidSourceCount = value.invalidSourceCount;
  const humanOnlySourceCount = value.humanOnlySourceCount;
  assertNonNegativeInteger(eligibleSourceCount, `${path}.eligibleSourceCount`);
  assertNonNegativeInteger(validSourceCount, `${path}.validSourceCount`);
  assertNonNegativeInteger(missingSourceCount, `${path}.missingSourceCount`);
  assertNonNegativeInteger(invalidSourceCount, `${path}.invalidSourceCount`);
  assertNonNegativeInteger(
    humanOnlySourceCount,
    `${path}.humanOnlySourceCount`,
  );
  assertEnum(
    value.status,
    ["complete", "partial", "missing", "invalid"],
    `${path}.status`,
  );
  if (
    validSourceCount > eligibleSourceCount ||
    invalidSourceCount > eligibleSourceCount ||
    humanOnlySourceCount > validSourceCount ||
    missingSourceCount !== eligibleSourceCount - validSourceCount
  ) {
    throw new Error(`${path} source counts are internally inconsistent`);
  }
  const expectedStatus: AttributionCoverage["status"] =
    eligibleSourceCount > 0 &&
    validSourceCount === eligibleSourceCount &&
    invalidSourceCount === 0
      ? "complete"
      : validSourceCount > 0
        ? "partial"
        : invalidSourceCount > 0
          ? "invalid"
          : "missing";
  if (value.status !== expectedStatus) {
    throw new Error(`${path}.status does not match its source coverage`);
  }
  return { invalidSourceCount, validSourceCount };
}

function assertWorkItemValue(
  value: unknown,
  path: string,
  expectedKind: WorkItem["kind"],
): asserts value is WorkItem {
  const item = assertObject(value, path);
  assertString(item.id, `${path}.id`);
  assertEnum(item.kind, ["issue", "pull-request"], `${path}.kind`);
  if (item.kind !== expectedKind) {
    throw new Error(`${path}.kind must be ${expectedKind}`);
  }
  assertPositiveInteger(item.number, `${path}.number`);
  assertString(item.title, `${path}.title`);
  assertEnum(
    item.repository,
    TARGET_REPOSITORIES.map((repository) => repository.id),
    `${path}.repository`,
  );
  assertRepositoryUrl(
    item.url,
    `${path}.url`,
    expectedKind,
    item.number,
    item.repository as RepositoryId,
  );
  assertNullableActor(item.author, `${path}.author`);
  assertIsoTimestamp(item.createdAt, `${path}.createdAt`);
  assertIsoTimestamp(item.updatedAt, `${path}.updatedAt`);
  const labels = assertStringArray(item.labels, `${path}.labels`);
  assertEnum(
    item.priority,
    ["urgent", "high", "normal", "low"],
    `${path}.priority`,
  );
  assertEnum(
    item.actionability,
    ["actionable", "blocked", "draft"],
    `${path}.actionability`,
  );
  const labelRecords = labels.map((name) => ({ id: name, name, color: "" }));
  const expectedPriority = workItemPriority(labelRecords);
  const expectedActionability = workItemActionability(
    labelRecords,
    expectedKind === "pull-request" && item.isDraft === true,
  );
  if (item.priority !== expectedPriority) {
    throw new Error(`${path}.priority does not match its labels`);
  }
  if (item.actionability !== expectedActionability) {
    throw new Error(
      `${path}.actionability does not match its labels and draft state`,
    );
  }
  if (expectedKind === "issue") {
    if (
      item.isDraft !== null ||
      item.reviewDecision !== null ||
      item.activeReviewRequestCount !== null
    ) {
      throw new Error(
        `${path} issue draft, review-decision, and review-request fields must be null`,
      );
    }
    if (item.actionability === "draft") {
      throw new Error(`${path} issue cannot have draft actionability`);
    }
  } else {
    if (typeof item.isDraft !== "boolean") {
      throw new Error(`${path}.isDraft must be a boolean for pull requests`);
    }
    if (item.reviewDecision !== null) {
      assertEnum(
        item.reviewDecision,
        ["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"],
        `${path}.reviewDecision`,
      );
    }
    assertNonNegativeInteger(
      item.activeReviewRequestCount,
      `${path}.activeReviewRequestCount`,
    );
    if (
      (item.isDraft === true && item.actionability !== "draft") ||
      (item.isDraft === false && item.actionability === "draft")
    ) {
      throw new Error(`${path}.actionability must match its draft state`);
    }
  }
  assertNonNegativeInteger(item.commentCount, `${path}.commentCount`);

  const claim = assertObject(item.claim, `${path}.claim`);
  assertEnum(claim.status, ["claimed", "unclaimed"], `${path}.claim.status`);
  assertEnum(
    claim.source,
    ["assignee", "label", "claim-comment", "none"],
    `${path}.claim.source`,
  );
  if (claim.kind !== null) {
    assertEnum(claim.kind, ["implementation", "review"], `${path}.claim.kind`);
  }
  if (!Array.isArray(claim.actors)) {
    throw new Error(`${path}.claim.actors must be an array`);
  }
  claim.actors.forEach((actor, index) => {
    assertActorValue(actor, `${path}.claim.actors[${index}]`);
  });
  if (claim.claimedAt !== null) {
    assertIsoTimestamp(claim.claimedAt, `${path}.claim.claimedAt`);
  }
  const expectedClaimKind =
    expectedKind === "issue" ? "implementation" : "review";
  const hasClaimLabel = labelRecords.some((label) =>
    isClaimLabel(label, expectedClaimKind),
  );
  if (
    (claim.status === "unclaimed" &&
      (claim.source !== "none" ||
        claim.kind !== null ||
        claim.actors.length !== 0 ||
        claim.claimedAt !== null)) ||
    (claim.status === "claimed" &&
      (claim.source === "none" || claim.kind !== expectedClaimKind)) ||
    (claim.source === "assignee" && claim.actors.length === 0) ||
    (claim.source === "claim-comment" &&
      (claim.actors.length !== 1 || claim.claimedAt === null)) ||
    (claim.source !== "claim-comment" && claim.claimedAt !== null) ||
    (hasClaimLabel && claim.status !== "claimed") ||
    (claim.source === "label" && !hasClaimLabel)
  ) {
    throw new Error(`${path}.claim fields do not describe one valid claim`);
  }

  const selection = assertObject(item.selection, `${path}.selection`);
  assertEnum(
    selection.status,
    ["candidate", "excluded"],
    `${path}.selection.status`,
  );
  const selectionReasons = assertStringArray(
    selection.reasons,
    `${path}.selection.reasons`,
  );
  selectionReasons.forEach((reason, index) => {
    assertEnum(
      reason,
      [
        "active-review-request",
        "already-approved",
        "blocked",
        "bot-authored",
        "changes-requested",
        "claimed",
        "draft",
        "security-sensitive",
        "untriaged",
        "unknown-author",
      ],
      `${path}.selection.reasons[${index}]`,
    );
  });
  const expectedSelectionReasons = candidateExclusionReasons({
    kind: expectedKind,
    author: item.author,
    labels,
    contributorReady:
      expectedKind === "pull-request" ||
      (!isEpicIssue(item.title, labels) &&
        labels.some((label) =>
          CONTRIBUTOR_READY_LABELS.has(normalizeLabel(label)),
        )),
    actionability: item.actionability,
    reviewDecision: item.reviewDecision,
    activeReviewRequestCount: item.activeReviewRequestCount,
    claimStatus: claim.status,
  });
  if (
    selection.status !==
      (expectedSelectionReasons.length === 0 ? "candidate" : "excluded") ||
    selectionReasons.length !== expectedSelectionReasons.length ||
    selectionReasons.some(
      (reason, index) => reason !== expectedSelectionReasons[index],
    )
  ) {
    throw new Error(
      `${path}.selection does not match the shared work-candidate safety contract`,
    );
  }

  const evidence = assertObject(item.evidence, `${path}.evidence`);
  assertEnum(
    evidence.status,
    ["complete", "partial", "missing"],
    `${path}.evidence.status`,
  );
  assertNonNegativeInteger(evidence.points, `${path}.evidence.points`);
  if (evidence.maxPoints !== 6) {
    throw new Error(`${path}.evidence.maxPoints must be 6`);
  }
  if (typeof evidence.points === "number" && evidence.points > 6) {
    throw new Error(`${path}.evidence.points cannot exceed 6`);
  }
  const categories = assertStringArray(
    evidence.categories,
    `${path}.evidence.categories`,
  );
  categories.forEach((category, index) => {
    assertEnum(
      category,
      ["screenshot", "video", "logs", "trajectory", "domain-artifact"],
      `${path}.evidence.categories[${index}]`,
    );
  });
  if (
    (evidence.status === "missing" &&
      (evidence.points !== 0 || categories.length !== 0)) ||
    (evidence.status === "partial" &&
      (typeof evidence.points !== "number" ||
        evidence.points <= 0 ||
        evidence.points >= 6)) ||
    (evidence.status === "complete" && evidence.points !== 6)
  ) {
    throw new Error(
      `${path}.evidence status does not match its evidence points`,
    );
  }

  const model = assertObject(item.model, `${path}.model`);
  assertEnum(
    model.status,
    ["complete", "partial", "missing", "invalid"],
    `${path}.model.status`,
  );
  const identifiers = assertStringArray(
    model.identifiers,
    `${path}.model.identifiers`,
  );
  identifiers.forEach((identifier, index) => {
    if (!isExactProviderModelIdentifier(identifier)) {
      throw new Error(
        `${path}.model.identifiers[${index}] must be an exact provider/model identifier`,
      );
    }
  });
  assertNonNegativeInteger(
    model.machineMarkerCount,
    `${path}.model.machineMarkerCount`,
  );
  assertNonNegativeInteger(
    model.invalidMarkerCount,
    `${path}.model.invalidMarkerCount`,
  );
  assertEnum(
    model.provenance,
    ["self-reported", "none"],
    `${path}.model.provenance`,
  );
  const coverageCounts = assertCoverageCounts(model, `${path}.model`);
  if (
    (model.machineMarkerCount > 0 && identifiers.length === 0) ||
    (identifiers.length > 0 && coverageCounts.validSourceCount === 0) ||
    model.invalidMarkerCount < coverageCounts.invalidSourceCount
  ) {
    throw new Error(`${path}.model declarations do not match source coverage`);
  }
  if (
    (coverageCounts.validSourceCount > 0 &&
      model.provenance !== "self-reported") ||
    (coverageCounts.validSourceCount === 0 && model.provenance !== "none")
  ) {
    throw new Error(
      `${path}.model provenance does not match its model identifiers`,
    );
  }
}

function assertLedgerValue(
  value: unknown,
  path: string,
): asserts value is ScoreEvent {
  const event = assertObject(value, path);
  assertString(event.id, `${path}.id`);
  assertActorValue(event.actor, `${path}.actor`);
  assertEnum(
    event.category,
    [
      "merged-pull-request",
      "resolved-issue",
      "material-test-change",
      "evidence",
      "substantive-review",
      "evaluated-contribution",
    ],
    `${path}.category`,
  );
  assertNonNegativeNumber(event.points, `${path}.points`);
  const eventPoints = Number(event.points);
  const isV2 =
    typeof event.occurredAt === "string" &&
    Date.parse(event.occurredAt) >= Date.parse(SCORE_V2_EFFECTIVE_AT);
  const scoreThirds = event.scoreThirds;
  const validV2 =
    isV2 &&
    Number.isSafeInteger(scoreThirds) &&
    Number(scoreThirds) >= 1 &&
    eventPoints === Number(scoreThirds) / 3 &&
    typeof event.workUnitId === "string" &&
    /^wu_[a-z0-9][a-z0-9_-]{2,255}$/u.test(event.workUnitId);
  if (
    "evidenceBonusBasisPoints" in event &&
    (!isV2 ||
      ![0, 1_000, 1_500, 2_500].includes(
        Number(event.evidenceBonusBasisPoints),
      ))
  ) {
    throw new Error(
      `${path}.evidenceBonusBasisPoints must be an allowed v2 outcome bonus`,
    );
  }
  const validLegacy =
    (!isV2 &&
      event.category === "merged-pull-request" &&
      Number.isInteger(eventPoints) &&
      eventPoints >= 1 &&
      eventPoints <= 10) ||
    (event.category === "resolved-issue" && eventPoints === 4) ||
    (event.category === "material-test-change" && eventPoints === 4) ||
    (event.category === "substantive-review" && eventPoints === 3) ||
    (event.category === "evaluated-contribution" &&
      Number.isInteger(eventPoints) &&
      eventPoints >= 1 &&
      eventPoints <= 8) ||
    (event.category === "evidence" && (eventPoints === 1 || eventPoints === 2));
  if (!validV2 && !validLegacy) {
    throw new Error(`${path}.points does not match its scoring category`);
  }
  assertIsoTimestamp(event.occurredAt, `${path}.occurredAt`);
  assertString(event.reason, `${path}.reason`);
  assertEnum(
    event.repository,
    TARGET_REPOSITORIES.map((repository) => repository.id),
    `${path}.repository`,
  );
  const source = assertObject(event.source, `${path}.source`);
  assertString(source.id, `${path}.source.id`);
  assertEnum(
    source.kind,
    ["comment", "issue", "pull-request", "review"],
    `${path}.source.kind`,
  );
  assertPositiveInteger(source.number, `${path}.source.number`);
  assertString(source.title, `${path}.source.title`);
  assertRepositoryUrl(
    source.url,
    `${path}.source.url`,
    source.kind,
    source.number,
    event.repository as RepositoryId,
  );
  if (event.category !== "evaluated-contribution") {
    if ("evaluation" in event) {
      throw new Error(
        `${path}.evaluation is reserved for evaluated contributions`,
      );
    }
    return;
  }
  if (event.reason.length < 40) {
    throw new Error(`${path}.reason must explain the evaluated contribution`);
  }
  const evaluation = assertObject(event.evaluation, `${path}.evaluation`);
  const evaluationKeys = [
    "decisionUrl",
    "manifestPath",
    "manifestSha256",
    "reviewedAt",
    "reviewer",
  ];
  if (
    Object.keys(evaluation).sort().join("\0") !==
    evaluationKeys.sort().join("\0")
  ) {
    throw new Error(`${path}.evaluation has unexpected or missing fields`);
  }
  assertIsoTimestamp(evaluation.reviewedAt, `${path}.evaluation.reviewedAt`);
  if (parseIsoTime(evaluation.reviewedAt) < parseIsoTime(event.occurredAt)) {
    throw new Error(
      `${path}.evaluation review cannot precede the contribution`,
    );
  }
  assertString(evaluation.reviewer, `${path}.evaluation.reviewer`);
  if (
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u.test(
      evaluation.reviewer,
    )
  ) {
    throw new Error(`${path}.evaluation.reviewer must be a GitHub login`);
  }
  assertString(evaluation.decisionUrl, `${path}.evaluation.decisionUrl`);
  const decisionUrl = secureUrl(
    evaluation.decisionUrl,
    `${path}.evaluation.decisionUrl`,
  );
  if (
    decisionUrl.hostname !== "github.com" ||
    !/^\/(?:elizaOS\/(?:slopdotcash|army)|SlopDotCash\/slopdotcash)\/pull\/[1-9]\d*$/iu.test(
      decisionUrl.pathname,
    ) ||
    decisionUrl.search ||
    decisionUrl.hash
  ) {
    throw new Error(
      `${path}.evaluation.decisionUrl must be a Slop review pull request`,
    );
  }
  assertString(evaluation.manifestSha256, `${path}.evaluation.manifestSha256`);
  if (!/^[0-9a-f]{64}$/u.test(evaluation.manifestSha256)) {
    throw new Error(
      `${path}.evaluation.manifestSha256 must be a SHA-256 digest`,
    );
  }
  assertString(evaluation.manifestPath, `${path}.evaluation.manifestPath`);
  const projectId = findTargetRepositoryById(
    event.repository as RepositoryId,
  )?.projectId;
  if (
    !projectId ||
    !new RegExp(
      `^evaluations/${projectId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}/award-[a-z0-9][a-z0-9-]*\\.json$`,
      "u",
    ).test(evaluation.manifestPath)
  ) {
    throw new Error(`${path}.evaluation.manifestPath is outside its project`);
  }
}

function assertOpportunityValue(
  value: unknown,
  path: string,
): asserts value is ScoreOpportunity {
  const opportunity = assertObject(value, path);
  assertString(opportunity.id, `${path}.id`);
  assertActorValue(opportunity.actor, `${path}.actor`);
  assertEnum(
    opportunity.kind,
    [
      "near-material-test",
      "expand-review",
      "missing-evidence",
      "partial-evidence",
    ],
    `${path}.kind`,
  );
  assertEnum(
    opportunity.category,
    [
      "merged-pull-request",
      "resolved-issue",
      "material-test-change",
      "evidence",
      "substantive-review",
      "evaluated-contribution",
    ],
    `${path}.category`,
  );
  assertPositiveInteger(opportunity.potentialPoints, `${path}.potentialPoints`);
  const potentialPoints = Number(opportunity.potentialPoints);
  const kind = opportunity.kind as ScoreOpportunityKind;
  const category = opportunity.category as ScoreCategory;
  const validPair =
    (kind === "near-material-test" &&
      category === "material-test-change" &&
      potentialPoints === 4) ||
    (kind === "expand-review" &&
      category === "substantive-review" &&
      potentialPoints === 3) ||
    ((kind === "missing-evidence" || kind === "partial-evidence") &&
      category === "evidence" &&
      potentialPoints >= 1 &&
      potentialPoints <= 6);
  if (!validPair) {
    throw new Error(
      `${path} kind/category/potentialPoints combination is invalid`,
    );
  }
  assertIsoTimestamp(opportunity.occurredAt, `${path}.occurredAt`);
  assertString(opportunity.reason, `${path}.reason`);
  assertString(opportunity.hint, `${path}.hint`);
  if (
    opportunity.reason.length > 1000 ||
    opportunity.hint.length > 256 ||
    !(
      (kind === "near-material-test" &&
        opportunity.hint.startsWith("Add recognized test coverage")) ||
      (kind === "missing-evidence" &&
        opportunity.hint ===
          "Add verified screenshot, video, or log evidence before merge.") ||
      (kind === "partial-evidence" &&
        opportunity.hint ===
          "Finish verified evidence categories before merge.") ||
      (kind === "expand-review" &&
        opportunity.hint ===
          "Add at least 20 characters of review rationale or an inline comment before merge.")
    )
  ) {
    throw new Error(`${path}.hint must be an actionable next step`);
  }
  assertEnum(
    opportunity.repository,
    TARGET_REPOSITORIES.map((repository) => repository.id),
    `${path}.repository`,
  );
  const source = assertObject(opportunity.source, `${path}.source`);
  assertString(source.id, `${path}.source.id`);
  assertEnum(
    source.kind,
    ["issue", "pull-request", "review"],
    `${path}.source.kind`,
  );
  assertPositiveInteger(source.number, `${path}.source.number`);
  assertString(source.title, `${path}.source.title`);
  if (source.title.length > 256) {
    throw new Error(`${path}.source.title is too long`);
  }
  assertRepositoryUrl(
    source.url,
    `${path}.source.url`,
    source.kind,
    source.number,
    opportunity.repository as RepositoryId,
  );
  if (kind === "expand-review" && source.kind !== "review") {
    throw new Error(`${path}.source.kind must be review for expand-review`);
  }
  if (kind !== "expand-review" && source.kind !== "pull-request") {
    throw new Error(`${path}.source.kind must be pull-request for ${kind}`);
  }
}

function assertAttributionValue(
  value: unknown,
  path: string,
): asserts value is ModelAttribution {
  const attribution = assertObject(value, path);
  assertString(attribution.id, `${path}.id`);
  assertString(attribution.sourceId, `${path}.sourceId`);
  assertRepositoryUrl(attribution.sourceUrl, `${path}.sourceUrl`);
  assertString(attribution.artifactId, `${path}.artifactId`);
  assertNullableActor(attribution.actor, `${path}.actor`);
  assertString(attribution.provider, `${path}.provider`);
  assertString(attribution.model, `${path}.model`);
  assertString(attribution.identifier, `${path}.identifier`);
  if (
    attribution.identifier !==
    exactIdentifier(
      typeof attribution.provider === "string" ? attribution.provider : "",
      typeof attribution.model === "string" ? attribution.model : "",
    )
  ) {
    throw new Error(`${path}.identifier must match provider and model`);
  }
  if (attribution.client !== null) {
    assertString(attribution.client, `${path}.client`);
  }
  if (attribution.skillRevision !== null) {
    assertString(attribution.skillRevision, `${path}.skillRevision`);
  }
  if (attribution.run !== null) {
    assertProjectRunReceipt(attribution.run);
  }
  assertEnum(
    attribution.format,
    ["machine-marker", "visible-declaration"],
    `${path}.format`,
  );
  if (attribution.status !== "self-reported") {
    throw new Error(`${path}.status must be self-reported`);
  }
}

export function assertLeaderboardSnapshot(
  value: unknown,
): asserts value is LeaderboardSnapshot {
  const snapshot = assertObject(value, "snapshot");
  if (snapshot.schemaVersion !== LEADERBOARD_SCHEMA_VERSION) {
    throw new Error(
      `snapshot.schemaVersion must be ${LEADERBOARD_SCHEMA_VERSION}`,
    );
  }
  if (snapshot.repository !== LEADERBOARD_REPOSITORY) {
    throw new Error(`snapshot.repository must be ${LEADERBOARD_REPOSITORY}`);
  }
  if (
    !Array.isArray(snapshot.repositories) ||
    snapshot.repositories.length !== TARGET_REPOSITORIES.length
  ) {
    throw new Error(
      "snapshot.repositories must list the complete target repository registry",
    );
  }
  snapshot.repositories.forEach((value, index) => {
    const path = `snapshot.repositories[${index}]`;
    const published = assertObject(value, path);
    const registered = TARGET_REPOSITORIES[index];
    for (const key of [
      "id",
      "owner",
      "name",
      "displayName",
      "githubUrl",
      "description",
      "integrationBranch",
      "projectId",
      "role",
    ] as const) {
      if (published[key] !== registered[key]) {
        throw new Error(
          `${path}.${key} does not match the target repository registry`,
        );
      }
    }
    if (Object.keys(published).length !== 9) {
      throw new Error(`${path} must publish exactly the registry fields`);
    }
  });
  if (snapshot.ruleVersion !== SCORE_RULE_VERSION) {
    throw new Error(`snapshot.ruleVersion must be ${SCORE_RULE_VERSION}`);
  }
  if (snapshot.stale !== false) {
    throw new Error("A freshly generated snapshot must set stale=false");
  }
  assertIsoTimestamp(snapshot.generatedAt, "snapshot.generatedAt");
  assertIsoTimestamp(snapshot.sourceUpdatedAt, "snapshot.sourceUpdatedAt");
  const generatedAt = parseIsoTime(snapshot.generatedAt);
  if (parseIsoTime(snapshot.sourceUpdatedAt) > generatedAt) {
    throw new Error("snapshot.sourceUpdatedAt cannot follow generatedAt");
  }

  const window = assertObject(snapshot.window, "snapshot.window");
  assertFiniteNumber(window.days, "snapshot.window.days");
  if (window.days !== SCORE_WINDOW_DAYS) {
    throw new Error(`snapshot.window.days must be ${SCORE_WINDOW_DAYS}`);
  }
  assertIsoTimestamp(window.from, "snapshot.window.from");
  assertIsoTimestamp(window.to, "snapshot.window.to");
  const windowFrom = window.from;
  const windowTo = window.to;
  if (
    typeof window.from === "string" &&
    typeof window.to === "string" &&
    parseIsoTime(window.from) >= parseIsoTime(window.to)
  ) {
    throw new Error("snapshot.window.from must precede snapshot.window.to");
  }
  if (
    parseIsoTime(windowTo) > generatedAt ||
    parseIsoTime(windowTo) - parseIsoTime(windowFrom) !==
      SCORE_WINDOW_DAYS * 24 * 60 * 60 * 1000
  ) {
    throw new Error(
      "snapshot.window must be the exact rolling window ending no later than generation",
    );
  }

  if (!Array.isArray(snapshot.leaders)) {
    throw new Error("snapshot.leaders must be an array");
  }
  const validatedLeaders = snapshot.leaders.map((valueEntry, index) => {
    assertLeaderValue(valueEntry, `snapshot.leaders[${index}]`, index + 1);
    return valueEntry;
  });
  if (
    new Set(validatedLeaders.map((entry) => entry.actor.id)).size !==
    validatedLeaders.length
  ) {
    throw new Error("snapshot.leaders must contain unique actors");
  }
  for (let index = 1; index < validatedLeaders.length; index += 1) {
    if (
      compareRankedEntries(
        validatedLeaders[index - 1],
        validatedLeaders[index],
      ) > 0
    ) {
      throw new Error(
        "snapshot.leaders must follow the published rank ordering",
      );
    }
  }

  if (!Array.isArray(snapshot.ledger)) {
    throw new Error("snapshot.ledger must be an array");
  }
  const validatedLedger = snapshot.ledger.map((event, index) => {
    assertLedgerValue(event, `snapshot.ledger[${index}]`);
    return event;
  });
  if (
    new Set(validatedLedger.map((event) => event.id)).size !==
    validatedLedger.length
  ) {
    throw new Error("snapshot.ledger must contain unique score event IDs");
  }

  if (!Array.isArray(snapshot.opportunities)) {
    throw new Error("snapshot.opportunities must be an array");
  }
  const validatedOpportunities = snapshot.opportunities.map(
    (opportunity, index) => {
      assertOpportunityValue(opportunity, `snapshot.opportunities[${index}]`);
      return opportunity;
    },
  );
  if (
    new Set(validatedOpportunities.map((opportunity) => opportunity.id))
      .size !== validatedOpportunities.length
  ) {
    throw new Error("snapshot.opportunities must contain unique IDs");
  }
  for (let index = 1; index < validatedOpportunities.length; index += 1) {
    if (
      compareOpportunities(
        validatedOpportunities[index - 1],
        validatedOpportunities[index],
      ) > 0
    ) {
      throw new Error(
        "snapshot.opportunities must be ordered newest-first by occurredAt",
      );
    }
  }

  const evaluatedSources = new Set<string>();
  const nonEvaluatedSourceIds = new Set<string>();
  const nonEvaluatedSourceUrls = new Set<string>();
  const eventsByActor = new Map<string, ScoreEvent[]>();
  for (const event of validatedLedger) {
    if (event.category !== "evaluated-contribution") {
      nonEvaluatedSourceIds.add(`${event.repository}\0${event.source.id}`);
      nonEvaluatedSourceUrls.add(`${event.repository}\0${event.source.url}`);
    }
    const events = eventsByActor.get(event.actor.id) ?? [];
    events.push(event);
    eventsByActor.set(event.actor.id, events);
  }
  const mergedEventsByProjectMonth = new Map<string, ScoreEvent[]>();
  const projectCapUsage = new Map<
    string,
    {
      evidencePoints: number;
      evaluatedContributions: number;
      materialTestChanges: number;
      mergedPullRequests: number;
      resolvedIssues: number;
      substantiveReviews: number;
    }
  >();
  for (const event of validatedLedger) {
    const repository = findTargetRepositoryById(event.repository);
    if (!repository) {
      throw new Error(`snapshot.ledger event ${event.id} has no project`);
    }
    const capKey = `${event.actor.id}\0${repository.projectId}\0${event.occurredAt.slice(0, 7)}`;
    const usage = projectCapUsage.get(capKey) ?? {
      evidencePoints: 0,
      evaluatedContributions: 0,
      materialTestChanges: 0,
      mergedPullRequests: 0,
      resolvedIssues: 0,
      substantiveReviews: 0,
    };
    if (event.category === "merged-pull-request") {
      usage.mergedPullRequests += 1;
      const group = mergedEventsByProjectMonth.get(capKey) ?? [];
      group.push(event);
      mergedEventsByProjectMonth.set(capKey, group);
    } else if (event.category === "resolved-issue") usage.resolvedIssues += 1;
    else if (event.category === "material-test-change") {
      usage.materialTestChanges += 1;
    } else if (event.category === "evidence")
      usage.evidencePoints += event.points;
    else if (event.category === "substantive-review") {
      usage.substantiveReviews += 1;
    } else {
      usage.evaluatedContributions += 1;
      const sourceKey = `${event.repository}\0${event.source.id}`;
      if (evaluatedSources.has(sourceKey)) {
        throw new Error("snapshot.ledger repeats evaluated source credit");
      }
      evaluatedSources.add(sourceKey);
      if (
        nonEvaluatedSourceIds.has(sourceKey) ||
        nonEvaluatedSourceUrls.has(`${event.repository}\0${event.source.url}`)
      ) {
        throw new Error(
          `snapshot.ledger evaluated event ${event.id} duplicates another score source`,
        );
      }
    }
    const legacyEvent =
      parseIsoTime(event.occurredAt) < parseIsoTime(SCORE_V2_EFFECTIVE_AT);
    if (
      legacyEvent &&
      (usage.resolvedIssues > SCORE_CAPS.resolvedIssues ||
        usage.materialTestChanges > SCORE_CAPS.materialTestChanges ||
        usage.evidencePoints > SCORE_CAPS.evidencePoints ||
        usage.substantiveReviews > SCORE_CAPS.substantiveReviews ||
        usage.evaluatedContributions > SCORE_CAPS.evaluatedContributions)
    ) {
      throw new Error(
        `snapshot.ledger actor ${event.actor.login} exceeds a per-project score cap`,
      );
    }
    projectCapUsage.set(capKey, usage);
  }
  for (const events of mergedEventsByProjectMonth.values()) {
    const legacyEvents = events.filter(
      (event) =>
        parseIsoTime(event.occurredAt) < parseIsoTime(SCORE_V2_EFFECTIVE_AT),
    );
    legacyEvents
      .sort(
        (left, right) =>
          right.occurredAt.localeCompare(left.occurredAt) ||
          right.source.number - left.source.number ||
          left.id.localeCompare(right.id),
      )
      .forEach((event, index) => {
        const expectedPoints = mergedPullRequestPoints(index + 1);
        if (event.points !== expectedPoints) {
          throw new Error(
            `snapshot.ledger merged event ${event.id} must award ${expectedPoints} points at ordinal ${index + 1}`,
          );
        }
      });
  }
  const leaderByActorId = new Map(
    validatedLeaders.map((entry) => [entry.actor.id, entry]),
  );
  for (const event of validatedLedger) {
    if (!leaderByActorId.has(event.actor.id)) {
      throw new Error(
        `snapshot.ledger event ${event.id} has no corresponding leader`,
      );
    }
  }
  for (const leader of validatedLeaders) {
    const events = eventsByActor.get(leader.actor.id) ?? [];
    const pointThirds = {
      mergedPullRequests: 0,
      resolvedIssues: 0,
      materialTestChanges: 0,
      evidence: 0,
      substantiveReviews: 0,
      evaluatedContributions: 0,
    };
    const outcomes = {
      mergedPullRequests: 0,
      resolvedIssues: 0,
      materialTestChanges: 0,
      evidenceCategories: 0,
      substantiveReviews: 0,
      evaluatedContributions: 0,
    };
    for (const event of events) {
      const eventThirds = event.scoreThirds ?? event.points * 3;
      if (event.category === "merged-pull-request") {
        pointThirds.mergedPullRequests += eventThirds;
        outcomes.mergedPullRequests += 1;
      } else if (event.category === "resolved-issue") {
        pointThirds.resolvedIssues += eventThirds;
        outcomes.resolvedIssues += 1;
      } else if (event.category === "material-test-change") {
        pointThirds.materialTestChanges += eventThirds;
        outcomes.materialTestChanges += 1;
      } else if (event.category === "evidence") {
        pointThirds.evidence += eventThirds;
        outcomes.evidenceCategories += 1;
      } else if (event.category === "substantive-review") {
        pointThirds.substantiveReviews += eventThirds;
        outcomes.substantiveReviews += 1;
      } else {
        pointThirds.evaluatedContributions += eventThirds;
        outcomes.evaluatedContributions += 1;
      }
    }
    const ledgerThirds = events.reduce(
      (total, event) => total + (event.scoreThirds ?? event.points * 3),
      0,
    );
    if (
      Math.floor(ledgerThirds / 3) !== leader.score ||
      ledgerThirds !== leader.scoreThirds ||
      pointThirds.mergedPullRequests !==
        leader.pointThirds.mergedPullRequests ||
      pointThirds.resolvedIssues !== leader.pointThirds.resolvedIssues ||
      pointThirds.materialTestChanges !==
        leader.pointThirds.materialTestChanges ||
      pointThirds.evidence !== leader.pointThirds.evidence ||
      pointThirds.substantiveReviews !==
        leader.pointThirds.substantiveReviews ||
      pointThirds.evaluatedContributions !==
        leader.pointThirds.evaluatedContributions ||
      outcomes.mergedPullRequests !==
        leader.acceptedOutcomes.mergedPullRequests ||
      outcomes.resolvedIssues !== leader.acceptedOutcomes.resolvedIssues ||
      outcomes.materialTestChanges !==
        leader.acceptedOutcomes.materialTestChanges ||
      outcomes.evidenceCategories !==
        leader.acceptedOutcomes.evidenceCategories ||
      outcomes.substantiveReviews !==
        leader.acceptedOutcomes.substantiveReviews ||
      outcomes.evaluatedContributions !==
        leader.acceptedOutcomes.evaluatedContributions
    ) {
      throw new Error(
        `snapshot.leaders actor ${leader.actor.login} does not match the public ledger`,
      );
    }
  }
  if (!Array.isArray(snapshot.attributions)) {
    throw new Error("snapshot.attributions must be an array");
  }
  const validatedAttributions = snapshot.attributions.map(
    (attribution, index) => {
      assertAttributionValue(attribution, `snapshot.attributions[${index}]`);
      return attribution;
    },
  );
  if (
    new Set(validatedAttributions.map((attribution) => attribution.id)).size !==
    validatedAttributions.length
  ) {
    throw new Error("snapshot.attributions must contain unique IDs");
  }
  const receiptClaims = new Map<string, string>();
  for (const attribution of validatedAttributions) {
    if (!attribution.run?.traceUpload) continue;
    for (const [kind, value] of [
      ["client run", attribution.run.runId],
      ["server run", attribution.run.traceUpload.serverRunId],
      ["trace object", attribution.run.traceUpload.objectId],
    ] as const) {
      const key = `${kind}:${value}`;
      const prior = receiptClaims.get(key);
      if (prior !== undefined) {
        throw new Error(
          `snapshot attribution ${attribution.id} reuses ${kind} already claimed by ${prior}`,
        );
      }
      receiptClaims.set(key, attribution.id);
    }
  }
  const causalAttributionKeys = new Set<string>();
  const resolvedArtifactsByActor = new Set<string>();
  for (const event of validatedLedger) {
    if (event.source.kind === "pull-request") {
      causalAttributionKeys.add(
        `${event.actor.id}\0artifact\0${event.source.id}`,
      );
    }
    if (
      event.category === "substantive-review" &&
      (event.source.kind === "review" || event.source.kind === "comment")
    ) {
      causalAttributionKeys.add(
        `${event.actor.id}\0source\0${event.source.id}`,
      );
    }
    if (
      event.category === "evaluated-contribution" &&
      event.source.kind === "comment"
    ) {
      causalAttributionKeys.add(
        `${event.actor.id}\0source\0${event.source.id}`,
      );
    }
    if (event.category === "resolved-issue") {
      const separator = ":resolved-by:";
      const separatorIndex = event.id.lastIndexOf(separator);
      if (separatorIndex >= 0) {
        resolvedArtifactsByActor.add(
          `${event.actor.id}\0${event.id.slice(separatorIndex + separator.length)}`,
        );
      }
    }
  }
  for (const attribution of validatedAttributions) {
    const actorId = attribution.actor?.id;
    const hasCausalLedgerEvent =
      actorId !== undefined &&
      (causalAttributionKeys.has(
        `${actorId}\0artifact\0${attribution.artifactId}`,
      ) ||
        causalAttributionKeys.has(
          `${actorId}\0source\0${attribution.sourceId}`,
        ) ||
        resolvedArtifactsByActor.has(`${actorId}\0${attribution.artifactId}`));
    if (!hasCausalLedgerEvent) {
      throw new Error(
        `snapshot attribution ${attribution.id} is not causally linked to a public ledger event by the same actor`,
      );
    }
  }
  for (const event of validatedLedger) {
    const publishedBonus = event.evidenceBonusBasisPoints ?? 0;
    if (publishedBonus === 0) continue;
    const matchingRun = validatedAttributions.find(
      (attribution) =>
        attribution.actor?.id === event.actor.id &&
        (attribution.artifactId === event.source.id ||
          attribution.sourceId === event.source.id) &&
        attribution.run !== null,
    )?.run;
    const legacyUsageBonusPolicy =
      Date.parse(snapshot.generatedAt) <
      Date.parse(USAGE_NEUTRAL_EVIDENCE_POLICY_AT);
    const expectedBonus = matchingRun
      ? (matchingRun.traceUpload ? 1_500 : 0) +
        (legacyUsageBonusPolicy &&
        ["exact", "bounded"].includes(matchingRun.usage.confidence) &&
        matchingRun.usage.totalTokens > 0
          ? 1_000
          : 0)
      : 0;
    if (publishedBonus !== expectedBonus) {
      throw new Error(
        `snapshot.ledger event ${event.id} has no exact receipt for its evidence bonus`,
      );
    }
  }
  const reportedModelsByActor = new Map<string, Set<string>>();
  for (const attribution of validatedAttributions) {
    if (!attribution.actor) continue;
    const identifiers =
      reportedModelsByActor.get(attribution.actor.id) ?? new Set<string>();
    identifiers.add(attribution.identifier);
    reportedModelsByActor.set(attribution.actor.id, identifiers);
  }
  for (const leader of validatedLeaders) {
    const reportedModels = uniqueSorted(
      reportedModelsByActor.get(leader.actor.id) ?? [],
    );
    if (
      reportedModels.length !== leader.reportedModels.length ||
      reportedModels.some(
        (identifier, index) => identifier !== leader.reportedModels[index],
      )
    ) {
      throw new Error(
        `snapshot.leaders actor ${leader.actor.login} has untraceable reported models`,
      );
    }
  }
  if (!Array.isArray(snapshot.invalidAttributionMarkers)) {
    throw new Error("snapshot.invalidAttributionMarkers must be an array");
  }
  snapshot.invalidAttributionMarkers.forEach((markerValue, index) => {
    const markerPath = `snapshot.invalidAttributionMarkers[${index}]`;
    const marker = assertObject(markerValue, markerPath);
    assertString(marker.sourceId, `${markerPath}.sourceId`);
    assertRepositoryUrl(marker.sourceUrl, `${markerPath}.sourceUrl`);
    assertString(marker.reason, `${markerPath}.reason`);
  });
  const attributionCoverage = assertObject(
    snapshot.attributionCoverage,
    "snapshot.attributionCoverage",
  );
  const coverageCounts = assertCoverageCounts(
    attributionCoverage,
    "snapshot.attributionCoverage",
  );
  const attributedSourceIds = new Set(
    validatedAttributions.map((attribution) => attribution.sourceId),
  );
  const invalidSourceIds = new Set(
    snapshot.invalidAttributionMarkers.map((marker) =>
      isRecord(marker) && typeof marker.sourceId === "string"
        ? marker.sourceId
        : "",
    ),
  );
  if (
    attributedSourceIds.size > coverageCounts.validSourceCount ||
    invalidSourceIds.size !== coverageCounts.invalidSourceCount
  ) {
    throw new Error(
      "snapshot attribution records do not match attributionCoverage",
    );
  }

  const workQueue = assertObject(snapshot.workQueue, "snapshot.workQueue");
  if (
    !Array.isArray(workQueue.issues) ||
    !Array.isArray(workQueue.pullRequests)
  ) {
    throw new Error("snapshot.workQueue queues must be arrays");
  }
  const validatedIssues = workQueue.issues.map((item, index) => {
    assertWorkItemValue(item, `snapshot.workQueue.issues[${index}]`, "issue");
    return item;
  });
  const validatedPullRequests = workQueue.pullRequests.map((item, index) => {
    assertWorkItemValue(
      item,
      `snapshot.workQueue.pullRequests[${index}]`,
      "pull-request",
    );
    return item;
  });
  const openPullRequestIds = new Set(
    validatedPullRequests.map((pullRequest) => pullRequest.id),
  );
  for (const opportunity of validatedOpportunities) {
    const pullRequestId =
      opportunity.source.kind === "pull-request"
        ? opportunity.source.id
        : validatedPullRequests.find(
            (pullRequest) =>
              pullRequest.repository === opportunity.repository &&
              pullRequest.number === opportunity.source.number,
          )?.id;
    if (!pullRequestId || !openPullRequestIds.has(pullRequestId)) {
      throw new Error(
        `snapshot opportunity ${opportunity.id} has no corresponding open pull request`,
      );
    }
  }
  for (const [name, queue] of [
    ["issues", validatedIssues],
    ["pullRequests", validatedPullRequests],
  ] as const) {
    for (let index = 1; index < queue.length; index += 1) {
      if (compareWorkItems(queue[index - 1], queue[index]) > 0) {
        throw new Error(
          `snapshot.workQueue.${name} must prioritize actionable, unclaimed, labeled, recent work`,
        );
      }
    }
    for (const item of queue) {
      if (
        parseIsoTime(item.createdAt) > parseIsoTime(item.updatedAt) ||
        parseIsoTime(item.updatedAt) > generatedAt
      ) {
        throw new Error(
          `snapshot.workQueue.${name} contains impossible item timestamps`,
        );
      }
    }
  }
  assertActorCoherence([
    ...validatedLeaders.map((entry) => entry.actor),
    ...validatedLedger.map((event) => event.actor),
    ...validatedAttributions.flatMap((attribution) =>
      attribution.actor ? [attribution.actor] : [],
    ),
    ...validatedIssues.flatMap((item) => [
      ...(item.author ? [item.author] : []),
      ...item.claim.actors,
    ]),
    ...validatedPullRequests.flatMap((item) => [
      ...(item.author ? [item.author] : []),
      ...item.claim.actors,
    ]),
  ]);
  assertSourceValue(snapshot.source, "snapshot.source");
  const source = assertObject(snapshot.source, "snapshot.source");
  if (
    source.fetchedAt !== snapshot.generatedAt ||
    source.cutoffAt !== window.to
  ) {
    throw new Error(
      "snapshot source timestamps must match generatedAt and the scoring cutoff",
    );
  }
  const counts = assertObject(source.counts, "snapshot.source.counts");
  const verificationWindow = assertObject(
    source.verificationWindow,
    "snapshot.source.verificationWindow",
  );
  if (
    verificationWindow.to !== window.to ||
    typeof verificationWindow.from !== "string" ||
    typeof verificationWindow.to !== "string" ||
    parseIsoTime(verificationWindow.to) -
      parseIsoTime(verificationWindow.from) !==
      VERIFICATION_WINDOW_DAYS * 24 * 60 * 60 * 1000 ||
    parseIsoTime(verificationWindow.from) < parseIsoTime(window.from)
  ) {
    throw new Error(
      "snapshot.source.verificationWindow must equal the full 35-day rolling window",
    );
  }
  if (counts.openIssues !== workQueue.issues.length) {
    throw new Error(
      "snapshot.source.counts.openIssues must match the issue queue length",
    );
  }
  if (counts.openPullRequests !== workQueue.pullRequests.length) {
    throw new Error(
      "snapshot.source.counts.openPullRequests must match the pull request queue length",
    );
  }
  const mergedOutcomeEvents = validatedLedger.filter(
    (event) => event.category === "merged-pull-request",
  );
  const detailedPullRequestIds = new Set(
    validatedLedger
      .filter((event) =>
        ["material-test-change", "evidence", "substantive-review"].includes(
          event.category,
        ),
      )
      .map((event) =>
        event.category === "substantive-review"
          ? event.id.split(/:(?:automated-review|ratifier|reviewer):/u)[0]
          : event.source.id,
      ),
  );
  const resolvedIssueEvents = validatedLedger.filter(
    (event) => event.category === "resolved-issue",
  );
  const mergedPullRequestCount = counts.mergedPullRequests;
  const detailedMergedPullRequestCount = counts.detailedMergedPullRequests;
  const resolvedIssueCount = counts.resolvedIssues;
  assertNonNegativeInteger(
    mergedPullRequestCount,
    "snapshot.source.counts.mergedPullRequests",
  );
  assertNonNegativeInteger(
    detailedMergedPullRequestCount,
    "snapshot.source.counts.detailedMergedPullRequests",
  );
  assertNonNegativeInteger(
    resolvedIssueCount,
    "snapshot.source.counts.resolvedIssues",
  );
  if (
    mergedOutcomeEvents.length > mergedPullRequestCount ||
    detailedPullRequestIds.size > detailedMergedPullRequestCount ||
    resolvedIssueEvents.length > resolvedIssueCount
  ) {
    throw new Error(
      "snapshot ledger exceeds the collection coverage published in source.counts",
    );
  }
  assertMethodologyValue(snapshot.methodology, "snapshot.methodology");
}

export function assertPublishableLeaderboardSnapshot(
  value: unknown,
  now = Date.now(),
): asserts value is LeaderboardSnapshot {
  assertLeaderboardSnapshot(value);
  if (!Number.isFinite(now)) {
    throw new Error("publication time must be finite");
  }
  if (parseIsoTime(value.generatedAt) > now + 5 * 60 * 1000) {
    throw new Error("snapshot.generatedAt cannot be in the future");
  }
}
