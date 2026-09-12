/** Public snapshot contracts. Historical records retain their original semantics. */

import type {
  LEADERBOARD_REPOSITORY,
  LEADERBOARD_SCHEMA_VERSION,
  REVIEW_EXCLUSION_REASONS,
  SCORE_RULE_VERSION,
} from "./leaderboard";
import type { RepositoryId, TargetRepository } from "./repositories.mjs";
import type { ProjectRunReceipt } from "./run-receipts";
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

export type ReviewExclusionReason = (typeof REVIEW_EXCLUSION_REASONS)[number];

export interface ReviewExclusion {
  id: string;
  reviewId: string;
  pullRequestId: string;
  pullRequestNumber: number;
  repository: RepositoryId;
  url: string;
  reason: ReviewExclusionReason;
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

/**
 * Complete text and review evidence for a merged pull request whose expensive
 * author-detail connections were not requested. Detail-only fields are
 * deliberately absent rather than represented by plausible empty values.
 */
export type MergedPullRequestReviewRecord = Pick<
  PullRequestRecord,
  | "id"
  | "number"
  | "title"
  | "url"
  | "body"
  | "createdAt"
  | "updatedAt"
  | "lastEditedAt"
  | "editor"
  | "mergedAt"
  | "headRefOid"
  | "author"
  | "comments"
  | "reviews"
>;

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
  continuity?: {
    sourceSnapshotSha256: string;
    decisionUrl: string;
  };
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
  /** Null when the row is useful guidance but cannot add standalone score. */
  potentialPoints: number | null;
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
  reviewExclusions?: ReviewExclusion[];
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
  reviewedMergedPullRequests?: MergedPullRequestReviewRecord[];
  detailEligibleMergedPullRequestIds: string[];
  closedIssueCount: number;
  resolvedIssues: IssueRecord[];
  openIssues: IssueRecord[];
  openPullRequests: PullRequestRecord[];
  verificationWindowFrom: string;
  verifiedEvidence: VerifiedEvidenceArtifact[];
  evaluatedContributions?: ScoreEvent[];
  /**
   * Previously published accepted review events. GitHub may delete a merged
   * pull request and its reviews; only events whose parent outcome is absent
   * are replayed, so live GitHub remains authoritative whenever it exists.
   */
  retainedReviewEvents?: ScoreEvent[];
  /** Signed attributions recovered from the same accepted snapshot. */
  retainedReviewAttributions?: ModelAttribution[];
  verifyRunReceipt?: (value: unknown) => ProjectRunReceipt;
}
