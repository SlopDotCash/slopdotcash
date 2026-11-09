/** Joint value work-unit records shared by the work-unit builder, model source and retained-copy checks. */
import type { ValueEvidence } from "./value-evidence-types";
import type { ValueMergeRecipe } from "./value-merge-profile";

export interface WorkUnitSource {
  evidence: ValueEvidence;
  policy: { sha: string; text: string };
  mergeRecipe?: ValueMergeRecipe;
}

export interface WorkUnitClaim {
  id: string;
  repositoryNodeId: string;
  commitSha: string;
  path: string;
  carrierPullRequestIds: string[];
  creditPullRequestId: string;
  implementationActorNodeIds: string[];
  retainedCopy?: {
    acceptancePullRequestId: string;
    acceptedCommitSha: string;
    preexistingCommitShas: string[];
  };
}

export interface WorkUnitEvidence {
  projectId: string;
  sources: WorkUnitSource[];
  sourceDigests: { pullRequestNodeId: string; digest: string }[];
  claims: WorkUnitClaim[];
  limitations: string[];
  sourceDigest: string;
}
