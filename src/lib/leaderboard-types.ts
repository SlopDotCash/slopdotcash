import type { readValueDecision } from "../../workers/slopbot/value-consumption";
import type { consumeWorkUnitHistory } from "../../workers/slopbot/value-work-unit-consumption";
import type { ValueScoringPolicy } from "./scoring-policy";
/** Public snapshot contracts. Historical records retain their original semantics. */

import type {
  ExternalSourceEvidence,
  ExternalSourcePlatform,
} from "./external-sources";
import type {
  LEADERBOARD_REPOSITORY,
  LEADERBOARD_SCHEMA_VERSION,
  REVIEW_EXCLUSION_REASONS,
  SCORE_RULE_VERSION,
} from "./leaderboard";
import type { RepositoryId, TargetRepository } from "./repositories.mjs";
import type { ProjectRunReceipt } from "./run-receipts";
/**
 * Closed value sets that the snapshot validator checks; each type below is
 * derived from its list, so the two cannot differ.
 */
export const GITHUB_ACTOR_KINDS = [
  "Bot",
  "Mannequin",
  "Organization",
  "User",
  "Unknown",
] as const;
export type GitHubActorKind = (typeof GITHUB_ACTOR_KINDS)[number];

export interface GitHubActor {
  id: string;
  login: string;
  avatarUrl: string;
  url: string;
  kind: GitHubActorKind;
}

/** The stable identity of an actor in cycle and reward records. */
export type ActorRef = Pick<GitHubActor, "id" | "login">;

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
  /** Exact reviewed commit; older inputs may not retain this GitHub fact. */
  commitId?: string | null;
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
  /**
   * Collected GitHub identity, so even a review-only profile can resolve its
   * immutable actor ID. Absent when GitHub returned no reviewer, and in
   * snapshots published before this field existed.
   */
  reviewer?: GitHubActor;
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
  closedAt?: string | null;
  headRefOid: string;
  isDraft: boolean;
  reviewDecision: string | null;
  activeReviewRequestCount: number;
  author: GitHubActor | null;
  assignees: GitHubActor[];
  labels: GitHubLabel[];
  /** Null is unavailable GitHub diff detail on an excluded open draft. */
  files: PullRequestFile[] | null;
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
  /** Exact source head; older saved inputs can omit it but cannot use valuations. */
  headRefOid?: string;
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
  /** Target branch; only integration-branch merges share commit credit. */
  baseRefName: string;
  /** Complete commit SHAs and linked GitHub authors; null for legacy evidence or non-integration merges. */
  commits: Array<{ oid: string; author: GitHubActor | null }> | null;
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
  /** GitHub timeline references; only an inventoried open PR can claim work. */
  referencedPullRequestIds?: string[];
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

export const EVIDENCE_CATEGORIES = [
  "screenshot",
  "video",
  "logs",
  "trajectory",
  "domain-artifact",
] as const;
export type EvidenceCategory = (typeof EVIDENCE_CATEGORIES)[number];

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

export const COVERAGE_STATUSES = [
  "complete",
  "partial",
  "missing",
  "invalid",
] as const;

export interface AttributionCoverage {
  status: (typeof COVERAGE_STATUSES)[number];
  eligibleSourceCount: number;
  validSourceCount: number;
  missingSourceCount: number;
  invalidSourceCount: number;
  humanOnlySourceCount: number;
}

export const SCORE_CATEGORIES = [
  "merged-pull-request",
  "resolved-issue",
  "material-test-change",
  "evidence",
  "substantive-review",
  "evaluated-contribution",
] as const;
export type ScoreCategory = (typeof SCORE_CATEGORIES)[number];

export interface ScoreEvent {
  id: string;
  actor: GitHubActor;
  category: ScoreCategory;
  points: number;
  scoreThirds?: number;
  evidenceBonusBasisPoints?: 0 | 1_000 | 1_500 | 2_500;
  workUnitId?: string;
  scoreDecisionSourceId?: string;
  scoreDecisionAt?: string;
  /** Accepted on the integration branch while the source PR stayed unmerged. */
  acceptanceKind?: "indirect-integration";
  occurredAt: string;
  repository: RepositoryId;
  source: {
    id: string;
    kind: "comment" | "external" | "issue" | "pull-request" | "review";
    /** Zero for external sources, which have no GitHub number. */
    number: number;
    title: string;
    url: string;
    /** Present only when kind is external. */
    platform?: ExternalSourcePlatform;
    /** Present only when kind is external. */
    evidence?: ExternalSourceEvidence;
  };
  reason: string;
  /** Audit only: qualifying decisions on distinct commits, starting at source. */
  reviewHistory?: {
    sourceId: string;
    state: "APPROVED" | "CHANGES_REQUESTED";
    commitId: string;
    submittedAt: string;
    url: string;
  }[];
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

/** One unreversed Slopbot debit from the published penalty table, as the
 * hosted feed returns it (PRD section 7). Units are Slop Score thirds. */
export interface PenaltyFeedRecord {
  itemNodeId: string;
  authorGithubId: string;
  category: string;
  tableVersion: string;
  debitThirds: number;
  /** The UTC month (YYYY-MM) Slopbot recorded once for the debit. */
  period: string;
  /** When Slopbot recorded the close; its UTC month is `period`. */
  recordedAt: string;
}

/** Safe retained Slopbot state. Absence never proves a reversal. */
export interface PenaltyHistoryRecord extends PenaltyFeedRecord {
  projectId: string;
  reversedAt: string | null;
  reversal: "appeal_upheld" | "maintainer_reopen" | null;
}

/**
 * A debit bound to a closed, unmerged pull request in the snapshot census.
 * GitHub supplies the author; Slopbot's recorded close time supplies the
 * month. The debit reduces only that actor's score for the same project and
 * UTC month, never below zero.
 */
export interface PublishedPenalty {
  id: string;
  actor: GitHubActor;
  repository: RepositoryId;
  /** Slopbot's recorded close time; its UTC month is the debited month. A
   * later reopen and close on GitHub never changes it. */
  occurredAt: string;
  category: string;
  tableVersion: string;
  debitThirds: number;
  source: {
    id: string;
    kind: "pull-request";
    number: number;
    title: string;
    url: string;
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
  /** Applied penalty thirds; present only when positive. */
  penaltyThirds?: number;
  reportedModels: string[];
}

export const WORK_ITEM_CLAIM_SOURCES = [
  "assignee",
  "label",
  "claim-comment",
  "pull-request",
  "none",
] as const;

export interface WorkItemClaimStatus {
  status: "claimed" | "unclaimed";
  source: (typeof WORK_ITEM_CLAIM_SOURCES)[number];
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

export const WORK_ITEM_CANDIDATE_EXCLUSIONS = [
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
] as const;
export type WorkItemCandidateExclusion =
  (typeof WORK_ITEM_CANDIDATE_EXCLUSIONS)[number];

export const WORK_ITEM_PRIORITIES = [
  "urgent",
  "high",
  "normal",
  "low",
] as const;
export const WORK_ITEM_ACTIONABILITIES = [
  "actionable",
  "blocked",
  "draft",
] as const;

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
  priority: (typeof WORK_ITEM_PRIORITIES)[number];
  actionability: (typeof WORK_ITEM_ACTIONABILITIES)[number];
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

/** A bound GraphQL observation; NOT_FOUND alone does not establish deletion. */
export interface UnavailableSource {
  nodeId: string;
  reason: "NOT_FOUND";
  /** Still enumerated by the second census, but unavailable on an exact re-probe. */
  unavailableInMergedCensus?: true;
}

/** A complete joint assessment is withheld while a required source is unavailable. */
export interface HeldWorkUnit {
  recordDigest: string;
  sourceNodeIds: string[];
  unavailableNodeIds: string[];
}

export interface LeaderboardSourceMetadata {
  provider: "github-graphql";
  fetchedAt: string;
  cutoffAt: string;
  /** The primary repository's GraphQL node ID; null for an empty registry. */
  repositoryId: string | null;
  repositories: Array<{ id: RepositoryId; repositoryId: string }>;
  requestCount: number;
  searchSliceCount: number;
  /** Absent from older snapshots. Counts observations, not proven deletions. */
  unavailableSources?: UnavailableSource[];
  heldWorkUnits?: HeldWorkUnit[];
  rateLimit: {
    cost: number;
    consumedDuringRun?: number;
    limit: number;
    remaining: number;
    resetAt: string;
  };
  counts: {
    unavailableSources?: number;
    unavailableMergedPullRequests?: number;
    heldWorkUnits?: number;
    closedUnmergedPullRequests?: number;
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
  /** Selected value-policy boundary; absent from older snapshots. */
  valuePolicyEffectiveAt?: string;
  valueAssessmentCoverage?: {
    pullRequestId: string;
    repository: RepositoryId;
    pullRequestNumber: number;
    status: string;
    recordDigest: string | null;
  }[];
  reviewExclusions?: ReviewExclusion[];
  /** Unreversed debits; absent from snapshots published before penalties. */
  penalties?: PublishedPenalty[];
  penaltyHistory?: PenaltyHistoryRecord[];
  /** Separate allocation weights; never consumed by Score or Points. */
  paymentReviewBasis?: {
    policy: "scr-05-payments-production-v1";
    effectiveAt: string;
    leaders: LeaderboardEntry[];
    /** Changed or added records only; unchanged records reuse the score ledger. */
    ledger: ScoreEvent[];
    removedEventIds: string[];
    removedAttributionIds: string[];
    attributionOrder: string[];
    reviewExclusions: ReviewExclusion[];
    attributions: ModelAttribution[];
    invalidAttributionMarkers: InvalidAttributionMarker[];
    attributionCoverage: AttributionCoverage;
    opportunities: ScoreOpportunity[];
  };
  /**
   * Publisher-verified omission of paymentReviewBasis (#1411 S3). Present only
   * when the complete census has no formal review before the payment cutoff, so
   * score and payment weights are identical. Mutually exclusive with
   * paymentReviewBasis. Absent from older or incomplete snapshots.
   */
  paymentReviewBasisOmitted?: {
    policy: "scr-05-payments-production-v1";
    effectiveAt: string;
    reason: "no-pre-policy-reviews";
  };
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
  /** The versioned policy that value decisions apply under; required with them. */
  valuePolicy?: ValueScoringPolicy;
  /** GitHub-resolved identities for assessment coauthors absent from ordinary hydration. */
  valueActors?: ReadonlyMap<string, GitHubActor>;
  /** Trusted journal decisions verified against fresh complete source evidence. */
  valueDecisions?: ReadonlyMap<
    string,
    Awaited<ReturnType<typeof readValueDecision>>
  >;
  /** A shared decision is indexed by each member PR, but scored once per unit. */
  jointValueDecisions?: ReadonlyMap<
    string,
    | Awaited<ReturnType<typeof consumeWorkUnitHistory>>
    | (Pick<
        Awaited<ReturnType<typeof consumeWorkUnitHistory>>,
        "history" | "throughSequence" | "latestDigest"
      > & {
        status: "unresolved";
        sourceUnavailable: true;
      })
  >;
  /** Complete human context for joint members outside the census; never counted as new outcomes. */
  valueContextPullRequests?: MergedPullRequestReviewRecord[];
  generatedAt: string;
  windowFrom: string;
  windowTo: string;
  sourceUpdatedAt: string;
  source: LeaderboardSourceMetadata;
  mergedPullRequestOutcomes: MergedPullRequestOutcome[];
  mergedPullRequests: PullRequestRecord[];
  reviewedMergedPullRequests?: MergedPullRequestReviewRecord[];
  closedUnmergedPullRequests?: PullRequestRecord[];
  /** Unreversed debits from the hosted feed; bound to the closed census. */
  penalties?: PenaltyFeedRecord[];
  penaltyHistory?: PenaltyHistoryRecord[];
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
  /** Active account bans: GitHub actor node ID to the earliest ban start. */
  participationBans?: ReadonlyMap<string, string>;
}
