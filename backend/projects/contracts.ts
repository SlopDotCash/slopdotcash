import type {
  DecisionInput,
  GithubActor,
  ProjectApplication,
  ProjectEnforcement,
  ProjectRecord,
  ProjectRevision,
  ProjectRevisionInput,
} from "../../src/lib/project-contracts";
import type { ProjectDefinition } from "../../src/lib/projects.mjs";

export const PROJECT_API_CONTRACT_VERSION = "project-registry-v1";
/**
 * Public GitHub facts about the repository and the signed-in account. A
 * mismatch means the manifest misstates the repository and is refused;
 * `proven` (owner of a user repository, or public member of its
 * organization) lets an owner create and edit the paused project before
 * Slopbot can read the exact repository permission.
 */
export type RepositoryControl =
  | { state: "proven"; reason: string }
  | { state: "unproven"; reason: string }
  | { state: "mismatch"; reason: string };

/** A project created by its owner through self-service setup. */
export type NewProjectInput = {
  manifest: ProjectDefinition;
  manifestText: string;
  manifestSha256: string;
  reason: string;
  actor: GithubActor;
  at: string;
  referrer: GithubActor | null;
};

export type {
  AdminNotification,
  AppealState,
  ApplicationStatus,
  DecisionInput,
  EnforcementAction,
  EnforcementActorRole,
  EnforcementResult,
  GithubActor,
  ProjectApplication,
  ProjectEnforcement,
  ProjectRecord,
  ProjectRevision,
  ProjectRevisionInput,
  RestrictionState,
  WebSession,
} from "../../src/lib/project-contracts";

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
  listApplicantApplications(githubId: string): Promise<ProjectApplication[]>;
  /** Projects the account created, applied for, or stewards on GitHub. */
  listOwnedProjects(githubId: string): Promise<ProjectRecord[]>;
  /** The account that listed the project: its applicant, else its creator. */
  projectCreator(projectId: string): Promise<GithubActor | null>;
  /** Membership is keyed by the immutable current GitHub actor ID. */
  hasSignedInActor(githubId: string): Promise<boolean>;
  /** Atomically lists revision 1 of a paused project; "conflict" on a taken id or repository. */
  createProject(input: NewProjectInput): Promise<"created" | "conflict">;
  /**
   * Lists a pending application from before self-service setup as revision 1
   * of a paused project, published by its applicant.
   */
  publishApplication(input: DecisionInput): Promise<"published" | "conflict">;
  /**
   * Appends the revision only while the project is at `expectedRevision`
   * and the enforcement generation is still `expectedEnforcementGeneration`.
   */
  appendProjectRevision(
    input: ProjectRevisionInput,
    expectedEnforcementGeneration: number,
  ): Promise<"updated" | "conflict">;
  /** Every enforcement record, oldest first per project. */
  listEnforcements(): Promise<ProjectEnforcement[]>;
  /** Changes on every enforcement record; it keys the public edge cache. */
  enforcementGeneration(): Promise<number>;
  /**
   * Atomically appends the record and, when given, the matching revision.
   * Both apply only while the project is still at `beforeRevision`. The
   * same write adds the inbox rows for the project's applicant and steward,
   * and for `appealReviewers` when the record requests reinstatement.
   */
  appendEnforcement(
    record: ProjectEnforcement,
    revision: ProjectRevisionInput | null,
    appealReviewers: readonly string[],
  ): Promise<"recorded" | "conflict">;
}
