import type { ProjectDefinition } from "./projects.mjs";
import type { VettingClearance } from "./vetting-contracts";

export type GithubActor = { githubId: string; githubLogin: string };

export type WebSession = GithubActor & { admin: boolean };

export type ProjectRecord = {
  id: string;
  status: ProjectDefinition["status"];
  revision: number;
  manifest: ProjectDefinition;
  manifestSha256: string;
  createdAt: string;
  updatedAt: string;
  sourceApplicationId: string | null;
  /** Immutable referral attribution (PRJ-05). */
  referrer: GithubActor | null;
};

export type ProjectRevision = {
  projectId: string;
  revision: number;
  manifest: ProjectDefinition;
  manifestSha256: string;
  reason: string;
  createdAt: string;
};

export type ApplicationStatus = "pending" | "approved" | "rejected";
export type AdminNotification = "pending" | "sent" | "failed";

export type ProjectApplication = {
  expectedRevision?: number;
  changeReason?: string;
  id: string;
  projectId: string;
  repositoryKey: string;
  manifest: ProjectDefinition;
  manifestSha256: string;
  acceptanceCriteria: string;
  applicant: GithubActor;
  submittedAt: string;
  status: ApplicationStatus;
  adminNotification: AdminNotification;
  adminNotificationAt: string | null;
  decidedAt: string | null;
  decidedBy: GithubActor | null;
  decisionReason: string | null;
  /** Public GitHub evidence about the applicant's repository control. */
  githubCheck: string | null;
  referrer: GithubActor | null;
};

export type ProjectRevisionInput = {
  applicationId?: string;
  projectId: string;
  /** Revision the caller read; the write fails if another write landed. */
  expectedRevision: number;
  manifest: ProjectDefinition;
  manifestText: string;
  manifestSha256: string;
  reason: string;
  actor: GithubActor;
  at: string;
};

export type DecisionInput = {
  applicationId: string;
  actor: GithubActor;
  reason: string | null;
  at: string;
};

export type EnforcementAction =
  | "quarantine"
  | "ban"
  | "request_reinstatement"
  | "reinstate"
  | "reinstate_accounts"
  | "deny_reinstatement";
export type EnforcementActorRole =
  | "project-moderator"
  | "project-steward"
  | "project-applicant"
  | "banned-account"
  | "vetting-service"
  | "contributor-flags";
export type RestrictionState = "clear" | "quarantined" | "banned";
export type AppealState = "none" | "requested" | "granted" | "denied";
export type EnforcementResult =
  | "revision_appended"
  | "revision_pending"
  | "no_revision_needed";

/** One append-only ADM-06 record with the ADM-05 audit fields. */
export type ProjectEnforcement = {
  id: string;
  projectId: string;
  sequence: number;
  action: EnforcementAction;
  stateAfter: RestrictionState;
  appealAfter: AppealState;
  reason: string;
  evidenceReference: string;
  /** Immutable GitHub repository id from the manifest authority. */
  repositoryGithubId: string;
  /** Lowercase repository paths, including transfer aliases. */
  repositoryKeys: string[];
  actor: GithubActor | null;
  systemIssuer?:
    | {
        kind: "vetting-service";
        keySha256: string;
        assessmentId: string;
        policyVersion: string;
        rule: string;
      }
    | {
        /** Two distinct active contributor flags paused the project. */
        kind: "contributor-flags";
        threshold: number;
        flagIds: string[];
      };
  /** Owners and banned accounts may only file a reinstatement request. */
  actorRole: EnforcementActorRole;
  decisionSource:
    | "admin-panel"
    | "owner-request"
    | "account-request"
    | "standing-rule";
  beforeRevision: number;
  beforeManifestSha256: string;
  afterRevision: number | null;
  afterManifestSha256: string | null;
  result: EnforcementResult;
  /** Exact scan and malicious findings covered by this independent decision. */
  vettingReview?: { assessmentId: string; maliciousAssessmentIds: string[] };
  /**
   * Maintainer accounts a moderator banned with the project when deciding a
   * confirmed malicious result (PRD section 8). Only that decision has them.
   */
  maintainerBans?: GithubActor[];
  accountReinstatements?: (GithubActor & { banEnforcementId: string })[];
  createdAt: string;
};

/** The application response omits its internal repository key. */
export type PublicProjectApplication = Omit<
  ProjectApplication,
  "repositoryKey"
> & { repository: string | null };

export type AdminProject = ProjectRecord & {
  enforcement: ProjectEnforcementState;
};

export interface ProjectEnforcementState {
  state: RestrictionState;
  appeal: AppealState;
  /** The current project request, separate from kept or account-only appeals. */
  projectAppeal: AppealState;
  since: string | null;
  restrictedBy: GithubActor[];
  nextSequence: number;
  /** The restriction holds but its paused, retired revision has not landed. */
  revisionPending: boolean;
  moderation: "unconfigured" | "moderator" | "not-moderator";
  /**
   * A confirmed malicious scan result banned the project and no moderator
   * has decided it yet: ban the project and its maintainer, or reinstate.
   */
  decisionRequired: boolean;
  /** Maintainer accounts banned with the restriction in force. */
  bannedMaintainers: GithubActor[];
  records: ProjectEnforcement[];
}

/** The server's plan for one action; the confirmed write must match it. */
export interface EnforcementPreview {
  projectId: string;
  projectName: string;
  action: EnforcementAction;
  sequence: number;
  stateBefore: ProjectEnforcementState["state"];
  stateAfter: ProjectEnforcementState["state"];
  appealBefore: ProjectEnforcementState["appeal"];
  appealAfter: ProjectEnforcementState["appeal"];
  result: EnforcementResult;
  pendingReason: string | null;
  /** Maintainer accounts the action bans with the project. */
  maintainerBans: GithubActor[];
  accountReinstatements?: (GithubActor & { banEnforcementId: string })[];
  revision: {
    before: number;
    after: number | null;
    statusBefore: ProjectDefinition["status"];
    statusAfter: ProjectDefinition["status"];
    listingTierBefore: ProjectDefinition["listingTier"];
    listingTierAfter: ProjectDefinition["listingTier"];
  };
}

/** The registered Slopbot GitHub App (`workers/slopbot/README.md`). */
export const SLOPBOT_INSTALL_URL =
  "https://github.com/apps/slopdotcash/installations/new";

/**
 * What the Slopbot installation reports for one repository and one GitHub
 * account. `permission` is GitHub's base access level, which maps maintain to
 * write; `roleName` is the role GitHub names, for display only.
 */
export type RepositoryAccess =
  | { installation: "missing" }
  | { installation: "suspended"; installationId: number }
  | {
      installation: "installed";
      installationId: number;
      permission: "admin" | "write" | "read" | "none";
      roleName: string | null;
      /** Requested by newer Pages clients; never a caller-supplied authority claim. */
      repository?: RepositoryIdentity;
    };

/** The Slopbot internal route for one repository's public GitHub reads. */
export const REPOSITORY_READ_URL =
  "https://slopbot.internal/v1/repository-read";
/** Marks a response that is GitHub's own answer through the installation. */
export const REPOSITORY_READ_HEADER = "x-slopbot-repository-read";

/**
 * The public reads that project setup and security vetting make for one
 * repository: its facts, paginated branches, one branch, and its LICENSE at
 * one commit.
 */
export const REPOSITORY_READ_PATH =
  /^\/repos\/([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})(?:\/branches(?:\/[A-Za-z0-9._%-]{1,765}|\?per_page=100&page=[1-9][0-9]{0,2})|\/license\?ref=[0-9a-f]{40})?$/u;

/** Public identity fields returned by the authenticated GitHub repository read. */
export type RepositoryIdentity = {
  id: number;
  node_id: string;
  full_name: string;
  private: boolean;
  owner: {
    id: number;
    node_id: string;
    login: string;
    type: "User" | "Organization";
  };
};

export function parseRepositoryIdentity(value: unknown): RepositoryIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Repository identity is unavailable");
  const repo = value as Record<string, unknown>;
  const owner = repo.owner as Record<string, unknown> | null | undefined;
  if (
    typeof repo.id !== "number" ||
    !Number.isSafeInteger(repo.id) ||
    repo.id < 1 ||
    typeof repo.node_id !== "string" ||
    !repo.node_id ||
    typeof repo.full_name !== "string" ||
    !validRepositoryPath(repo.full_name) ||
    typeof repo.private !== "boolean" ||
    !owner ||
    typeof owner !== "object" ||
    typeof owner.id !== "number" ||
    !Number.isSafeInteger(owner.id) ||
    owner.id < 1 ||
    typeof owner.node_id !== "string" ||
    !owner.node_id ||
    typeof owner.login !== "string" ||
    !owner.login ||
    (owner.type !== "User" && owner.type !== "Organization")
  )
    throw new TypeError("Repository identity is incomplete");
  return {
    id: repo.id,
    node_id: repo.node_id,
    full_name: repo.full_name,
    private: repo.private,
    owner: {
      id: owner.id,
      node_id: owner.node_id,
      login: owner.login,
      type: owner.type,
    },
  };
}

/** Current GitHub authority of the signed-in account over a repository. */
export type SetupAuthority =
  /** The Slopbot installation read write, maintain or admin access. */
  | { state: "verified"; message: string }
  | { state: "denied"; message: string }
  | { state: "retry"; message: string };

export type SetupNextAction =
  | "retry_authority"
  | "ask_maintainer"
  | "install_slopbot"
  | "retry_installation"
  | "wait_for_scan"
  | "retry_scan"
  | "request_scan"
  | "restricted"
  | "none";

/**
 * One setup status for a project (PRD section 4): the result, the single
 * next action and every check, with funding reported separately because a
 * project works without it.
 */
export type ProjectSetupStatus = {
  projectId: string;
  name: string;
  slug: string;
  revision: number;
  status: ProjectDefinition["status"];
  state: "ready" | "action_required" | "waiting" | "retry" | "restricted";
  nextAction: { kind: SetupNextAction; message: string; href: string | null };
  checks: {
    authority: SetupAuthority;
    installation: {
      state: "installed" | "missing" | "suspended" | "retry";
      message: string;
    };
    scan: {
      state: VettingClearance["state"] | "unavailable";
      message: string;
      /** Recorded exemption (PRD section 8); never a passed scan. */
      exempt?: true;
      exemptionKind?: "existing-project" | "owner-approved-admission";
    };
  };
  funding:
    | { mode: "none" }
    | {
        mode: "bounty";
        network: string | null;
        symbol: string;
        awardAmountMinor: string;
        decimals: number;
        state: "pledged" | "verified";
      }
    | {
        mode: "monthly";
        network: string;
        symbol: string;
        /** Integer base units of the asset, which has `decimals`. */
        monthlyAmountMinor: string;
        decimals: number;
        state: "pledged" | "committed";
        payments: "enabled" | "disabled";
      };
  /** Set when this check appended the activation revision. */
  activatedRevision: number | null;
  checkedAt: string;
};

export type ProjectApplicationNotice = {
  applicationId: string;
  projectId: string;
  projectName: string;
  repository: string;
  applicantLogin: string;
  submittedAt: string;
  reviewUrl: string;
};

export interface OwnedRepository {
  repository: string;
  /** The repository's own GitHub description, or null when it has none. */
  description: string | null;
}

export interface RepositoryLookup {
  repository: string;
  description: string | null;
  numericId: string;
  nodeId: string;
  defaultBranch: string;
  branches: string[];
  /** Immutable heads returned by GitHub; older lookup responses may omit them. */
  branchCommits?: Record<string, string>;
  owner: {
    login: string;
    actorId: string;
    nodeId: string;
    kind: "individual" | "organization";
  };
  license:
    | { state: "verified"; spdx: string; commitSha: string; fileSha256: string }
    | { state: "unknown"; reason: string };
}

const REPOSITORY_PATH = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;

export function validRepositoryPath(value: string): boolean {
  return value.length <= 201 && REPOSITORY_PATH.test(value);
}
