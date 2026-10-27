/** Shared public assessment and revision-clearance contracts. */
export const VETTING_DISPOSITIONS = [
  "clean",
  "incomplete",
  "malicious",
] as const;
export type VettingDisposition = (typeof VETTING_DISPOSITIONS)[number];

export type AssessmentState = "pending" | VettingDisposition;

/** The safe public summary of one assessment (VET-01 display fields). */
export type AssessmentSummary = {
  id: string;
  revision: number;
  state: AssessmentState;
  commitSha: string;
  templateSha256: string;
  policyVersion: string | null;
  requestedAt: string;
  completedAt: string | null;
  modelRuns: { reviewer: string; provider: string; model: string }[];
  artifacts: number;
  heldArtifacts: number;
};

/**
 * The exact code an assessment scanned (PRD VET-07): the head commit of the
 * project's integration branch and the content digest of the skill template
 * inputs Slop renders the project skills from.
 */
export type VettingPin = { commitSha: string; templateSha256: string };

/** Audited normal-admission waiver; no code was represented as scanned. */
export type AdmissionExemption = {
  id: string;
  kind: "owner-approved-admission";
  projectId: string;
  revision: number;
  manifestSha256: string;
  repositoryId: string;
  repositoryNodeId: string;
  stewardId: string;
  stewardNodeId: string;
  grantedBy: { githubId: string; githubLogin: string };
  grantedAt: string;
  reason: string;
  decisionReference: string;
  revokedAt: string | null;
  revokedBy: { githubId: string; githubLogin: string } | null;
  revocationReason: string | null;
  revocationDecisionReference: string | null;
};

/**
 * What a repository may do. Only "cleared" lets Slop serve skills, list the
 * project for discovery, or activate it. Normal clearance is admission evidence
 * for the same immutable repository, not proof that later code was scanned.
 * "stale" applies to current-pin reinstatement; "unverified" means required
 * retained evidence or the remedial live pin cannot be verified. A project
 * registered before the gate is grandfathered: "cleared" with no assessment.
 */
export type VettingClearance =
  | { state: "unscanned" }
  | { state: "unverified"; reason: string }
  | { state: "queued"; assessment: AssessmentSummary }
  | { state: "quarantined"; assessment: AssessmentSummary }
  | { state: "stale"; assessment: AssessmentSummary; live: VettingPin }
  | {
      state: "cleared";
      assessment: AssessmentSummary;
      /** Admission eligibility; the assessment still describes its original revision. */
      basis?: "admission";
      reviewedMaliciousAssessmentIds?: string[];
    }
  | { state: "cleared"; assessment: null; grandfathered: true }
  | {
      state: "cleared";
      assessment: null;
      exemption: Pick<
        AdmissionExemption,
        | "id"
        | "kind"
        | "grantedAt"
        | "grantedBy"
        | "repositoryId"
        | "repositoryNodeId"
      >;
    }
  | { state: "banned"; assessment: AssessmentSummary };
