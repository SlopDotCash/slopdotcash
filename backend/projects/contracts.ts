import type { ProjectDefinition } from "../../src/lib/projects.mjs";

export const PROJECT_API_CONTRACT_VERSION = "project-registry-v1";
/** Bounds open applications so one account cannot flood the review queue. */
export const MAX_PENDING_APPLICATIONS_PER_APPLICANT = 3;
/** Bounds submissions so one account cannot flood the review queue. */
export const MAX_DAILY_SUBMISSIONS_PER_APPLICANT = 5;

/**
 * GitHub's answer on whether the applicant controls the repository. It is
 * shown to the admin who decides; a mismatch means the manifest misstates the
 * repository and is refused.
 */
export type RepositoryControl =
  | { state: "proven"; reason: string }
  | { state: "unproven"; reason: string }
  | { state: "mismatch"; reason: string };

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
};

export type ProjectRevisionInput = {
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

export interface ProjectPersistence {
  listProjects(): Promise<ProjectRecord[]>;
  getProject(id: string): Promise<ProjectRecord | null>;
  /** The complete append-only policy history, oldest first per project. */
  listRevisions(): Promise<ProjectRevision[]>;
  /** One approved revision with its exact stored manifest bytes. */
  getRevisionText(
    projectId: string,
    revision: number,
  ): Promise<{ manifestText: string; manifestSha256: string } | null>;
  getApplication(id: string): Promise<ProjectApplication | null>;
  listApplications(status: ApplicationStatus): Promise<ProjectApplication[]>;
  listApplicantApplications(githubId: string): Promise<ProjectApplication[]>;
  countPendingApplications(githubId: string): Promise<number>;
  /** Applications the account submitted at or after `since`, in any state. */
  countApplicationsSince(githubId: string, since: string): Promise<number>;
  /** Returns "conflict" when the project or repository already has an open application. */
  createApplication(
    application: ProjectApplication & { manifestText: string },
  ): Promise<"created" | "conflict">;
  recordAdminNotification(
    applicationId: string,
    outcome: Exclude<AdminNotification, "pending">,
    at: string,
  ): Promise<void>;
  /** Atomically lists the submitted manifest as revision 1 of a paused project. */
  approveApplication(input: DecisionInput): Promise<"approved" | "conflict">;
  rejectApplication(
    input: DecisionInput & { reason: string },
  ): Promise<"rejected" | "conflict">;
  appendProjectRevision(
    input: ProjectRevisionInput,
  ): Promise<"updated" | "conflict">;
}
