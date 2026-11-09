/** Evidence transport and file-change records shared by the value evidence collectors. */
import type { TargetRepository } from "../../src/lib/repositories.mjs";

// Shared by the installation worker and the historical reviewer. Missing or
// moving evidence prevents assessment; pagination limits never imply coverage.
export interface EvidenceClient {
  get<T>(path: string): Promise<T | null>;
  graphql?<T>(query: string, variables: Record<string, unknown>): Promise<T>;
}

export interface FileChange {
  filename: string;
  previous_filename?: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
  blob_url: string | null;
  fullComparison?: {
    baseSha: string;
    headSha: string;
    before: { blobSha: string; text: string };
    after: { blobSha: string; text: string };
  };
  removedComparison?: {
    baseSha: string;
    headSha: string;
    before: { blobSha: string; text: string };
  };
  addedComparison?: {
    baseSha: string;
    headSha: string;
    after: { blobSha: string; text: string };
  };
  unchangedRename?: { baseSha: string; headSha: string; blobSha: string };
  addedBinary?: AddedBinaryProof;
}

/** Private source bytes, not a textual patch or proof of what a recording shows. */
interface AddedBinaryProof {
  schemaVersion: 1;
  path: string;
  baseSha: string;
  headSha: string;
  baseTreeSha: string;
  headTreeSha: string;
  mode: "100644";
  blobSha: string;
  size: number;
  sha256: string;
  contentBase64: string;
  contentReview: "unviewed";
}

export interface Actor {
  node_id: string;
  login: string;
  type: string;
}

export interface Pull {
  node_id: string;
  number: number;
  html_url: string;
  title: string;
  body: string | null;
  user: Actor;
  merged_by: Actor | null;
  state: string;
  merged_at: string | null;
  closed_at: string | null;
  merge_commit_sha: string | null;
  updated_at: string;
  head: { sha: string };
  base: { sha: string; ref: string };
  changed_files: number;
  comments: number;
  review_comments: number;
  commits: number;
}

export interface Review {
  node_id: string;
  id: number;
  html_url: string;
  body: string;
  user: Actor | null;
  submitted_at: string | null;
  state: string;
  commit_id: string;
}

export interface Comment {
  node_id: string;
  html_url: string;
  body: string;
  user: Actor | null;
  created_at: string;
  updated_at: string;
  pull_request_review_id?: number;
}

export interface Commit {
  sha: string;
  html_url: string;
  author: Actor | null;
  committer: Actor | null;
  parents: { sha: string }[];
  commit: {
    message: string;
    author: { date: string };
    committer: { date: string };
  };
}

export interface CommitChangeEvidence {
  sha: string;
  html_url: string;
  parents: { sha: string }[];
  stats: { additions: number; deletions: number; total: number };
  files: FileChange[];
}

export interface CommitAttribution {
  sha: string;
  actorNodeIds: string[];
  changedPaths: string[] | null;
  // Private source evidence for retained-copy reconciliation. Paths alone
  // cannot establish which original changes survived a cherry-pick.
  files?: FileChange[];
  limitations: string[];
}

export interface RelatedPullRequest {
  id: string;
  number: number;
  url: string;
  repository: string;
}

export interface ValueEvidence {
  repository: string;
  repositoryPolicy: Pick<
    TargetRepository,
    "id" | "projectId" | "integrationBranch" | "expectedNodeId"
  > | null;
  repositoryNodeId: string;
  repositoryDatabaseId: number;
  collectedAt: string;
  pull: Pull;
  files: FileChange[];
  mergeCommitEvidence: CommitChangeEvidence | null;
  acceptedRange?: AcceptedValueRange;
  acceptedPatchReplay?: AcceptedPatchReplay;
  indirectAcceptance?: IndirectValueAcceptance;
  commits: Commit[];
  reviews: Review[];
  comments: Comment[];
  reviewComments: Comment[];
  limitations: string[];
  evidenceUrls: string[];
  eligibleReviewIds: string[];
  implementationActorNodeIds: string[];
  historicalBranchPolicy?: ValueBranchPolicy;
  noChangePromotion?: NoChangePromotionProof;
  commitAttribution: CommitAttribution[];
  mergeResolutions?: ValueMergeResolution[];
  retainedMergeReferences?: RetainedMergeReference[];
  relatedPullRequests: RelatedPullRequest[];
  contextFiles?: {
    path: string;
    ref: string;
    blobSha: string;
    text: string;
    url: string;
  }[];
}

export interface IndirectValueAcceptance {
  historicalHeadSha: string;
  integrationSha: string;
  integrationParentSha: string;
  acceptedTipSha: string;
  branch: string;
  observedOnBranchAt: string;
  observationRunId: number;
  observationUrl: string;
  acceptedCommitShas: string[];
  alreadyPresentCommitShas: string[];
  laterCommitShas: string[];
  integrationFiles: CommitChangeEvidence["files"];
  retainedFiles: IndirectRetainedFile[];
}

export interface NoChangePromotionProof {
  schemaVersion: "slop-no-change-promotion:v1";
  baseSha: string;
  headSha: string;
  mergeSha: string;
  treeSha: string;
}

export interface ValueMergeResolution {
  commitSha: string;
  parents: [string, string];
  gitVersion: string;
  automaticTree: string;
  resolvedTree: string;
  hadConflicts: boolean;
  patch: string;
  patchSha256: string;
  paths: string[];
  /** Byte-identical directory moves performed by Git, not resolution work. */
  automaticRelocations?: {
    sourceParent: string;
    sourcePath: string;
    path: string;
    blobSha: string;
    headSha: string;
    sourceCommitShas: string[];
  }[];
}

export interface RetainedMergeReference {
  commentNodeId: string;
  acknowledgementSha256: string;
  abbreviation: string;
  commitSha: string;
}

export interface AcceptedValueRange {
  headSha: string;
  mergeSha: string;
  parentSha: string;
  files: {
    path: string;
    blobSha: string | null;
    mode?: string;
    alreadyPresent: boolean;
  }[];
}

export interface AcceptedPatchReplay {
  schemaVersion: 1;
  headSha: string;
  mergeSha: string;
  parentSha: string;
  files: {
    path: string;
    mode: string;
    submittedBlobSha: string;
    parentBlobSha: string | null;
    acceptedBlobSha: string;
  }[];
}

/** Historical authority comes from accepted base policy, never a PR's head. */
export interface ValueBranchPolicy {
  baseSha: string;
  path: "CONTRIBUTING.md";
  text: string;
}

export interface TextVersion {
  blobSha: string;
  mode: string;
  text: string;
}

export interface IndirectRetainedFile {
  sourcePath: string;
  acceptedPath: string;
  historical: TextVersion | null;
  accepted: TextVersion | null;
}
