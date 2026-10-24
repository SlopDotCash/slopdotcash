import type { ProjectDefinition } from "../../src/lib/projects.mjs";
import type {
  D1QueryStatement as D1Statement,
  D1TransactionalDatabase,
} from "../d1";
import {
  notifyProjectEnforcement,
  notifyProjectRevision,
  notifyReinstatementReviewers,
} from "../notifications/events";
import type {
  AdminNotification,
  ApplicationStatus,
  DecisionInput,
  GithubActor,
  NewProjectInput,
  ProjectApplication,
  ProjectEnforcement,
  ProjectPersistence,
  ProjectRecord,
  ProjectRevision,
  ProjectRevisionInput,
} from "./contracts";
export type ProjectD1Database = D1TransactionalDatabase<D1Statement>;

type ProjectRow = {
  id: string;
  status: ProjectDefinition["status"];
  revision: number;
  manifest: string;
  manifest_sha256: string;
  created_at: string;
  updated_at: string;
  source_application_id: string | null;
  referrer_github_id: string | null;
  referrer_github_login: string | null;
};

type ApplicationRow = {
  expected_revision: number | null;
  change_reason: string | null;
  id: string;
  project_id: string;
  repository_key: string;
  manifest: string;
  manifest_sha256: string;
  acceptance_criteria: string;
  applicant_github_id: string;
  applicant_github_login: string;
  submitted_at: string;
  status: ApplicationStatus;
  admin_notification: AdminNotification;
  admin_notification_at: string | null;
  decided_at: string | null;
  decided_by_github_id: string | null;
  decided_by_github_login: string | null;
  decision_reason: string | null;
  github_check: string | null;
  referrer_github_id: string | null;
  referrer_github_login: string | null;
};

const PROJECT_COLUMNS =
  "id, status, revision, manifest, manifest_sha256, created_at, updated_at, source_application_id, referrer_github_id, referrer_github_login";
const APPLICATION_COLUMNS =
  "id, project_id, repository_key, manifest, manifest_sha256, acceptance_criteria, applicant_github_id, applicant_github_login, submitted_at, status, admin_notification, admin_notification_at, decided_at, decided_by_github_id, decided_by_github_login, decision_reason, github_check, expected_revision, change_reason, referrer_github_id, referrer_github_login";

function referrerFromRow(row: {
  referrer_github_id: string | null;
  referrer_github_login: string | null;
}): GithubActor | null {
  return row.referrer_github_id !== null && row.referrer_github_login !== null
    ? {
        githubId: row.referrer_github_id,
        githubLogin: row.referrer_github_login,
      }
    : null;
}

function projectFromRow(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    status: row.status,
    revision: row.revision,
    manifest: JSON.parse(row.manifest) as ProjectDefinition,
    manifestSha256: row.manifest_sha256,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sourceApplicationId: row.source_application_id,
    referrer: referrerFromRow(row),
  };
}

function applicationFromRow(row: ApplicationRow): ProjectApplication {
  return {
    id: row.id,
    projectId: row.project_id,
    repositoryKey: row.repository_key,
    ...(row.expected_revision === null
      ? {}
      : {
          expectedRevision: row.expected_revision,
          changeReason: row.change_reason ?? "",
        }),
    manifest: JSON.parse(row.manifest) as ProjectDefinition,
    manifestSha256: row.manifest_sha256,
    acceptanceCriteria: row.acceptance_criteria,
    applicant: {
      githubId: row.applicant_github_id,
      githubLogin: row.applicant_github_login,
    },
    submittedAt: row.submitted_at,
    status: row.status,
    adminNotification: row.admin_notification,
    adminNotificationAt: row.admin_notification_at,
    decidedAt: row.decided_at,
    decidedBy:
      row.decided_by_github_id === null || row.decided_by_github_login === null
        ? null
        : {
            githubId: row.decided_by_github_id,
            githubLogin: row.decided_by_github_login,
          },
    decisionReason: row.decision_reason,
    githubCheck: row.github_check,
    referrer: referrerFromRow(row),
  };
}

type EnforcementRow = {
  id: string;
  project_id: string;
  sequence: number;
  action: ProjectEnforcement["action"];
  state_after: ProjectEnforcement["stateAfter"];
  appeal_after: ProjectEnforcement["appealAfter"];
  reason: string;
  evidence_reference: string;
  repository_github_id: string;
  repository_keys: string;
  actor_github_id: string | null;
  actor_github_login: string | null;
  system_issuer: string | null;
  actor_role: ProjectEnforcement["actorRole"];
  decision_source: ProjectEnforcement["decisionSource"];
  before_revision: number;
  before_manifest_sha256: string;
  after_revision: number | null;
  after_manifest_sha256: string | null;
  result: ProjectEnforcement["result"];
  created_at: string;
};

export const ENFORCEMENT_COLUMNS =
  "id, project_id, sequence, action, state_after, appeal_after, reason, evidence_reference, repository_github_id, repository_keys, actor_github_id, actor_github_login, actor_role, decision_source, before_revision, before_manifest_sha256, after_revision, after_manifest_sha256, result, created_at, system_issuer";

function enforcementFromRow(row: EnforcementRow): ProjectEnforcement {
  return {
    id: row.id,
    projectId: row.project_id,
    sequence: row.sequence,
    action: row.action,
    stateAfter: row.state_after,
    appealAfter: row.appeal_after,
    reason: row.reason,
    evidenceReference: row.evidence_reference,
    repositoryGithubId: row.repository_github_id,
    repositoryKeys: JSON.parse(row.repository_keys) as string[],
    actor:
      row.actor_github_id !== null && row.actor_github_login !== null
        ? {
            githubId: row.actor_github_id,
            githubLogin: row.actor_github_login,
          }
        : null,
    ...(row.system_issuer
      ? {
          systemIssuer: JSON.parse(
            row.system_issuer,
          ) as ProjectEnforcement["systemIssuer"],
        }
      : {}),
    actorRole: row.actor_role,
    decisionSource: row.decision_source,
    beforeRevision: row.before_revision,
    beforeManifestSha256: row.before_manifest_sha256,
    afterRevision: row.after_revision,
    afterManifestSha256: row.after_manifest_sha256,
    result: row.result,
    createdAt: row.created_at,
  };
}

export function enforcementStatement(
  db: ProjectD1Database,
  record: ProjectEnforcement,
): D1Statement {
  return db
    .prepare(
      `INSERT INTO project_enforcements (${ENFORCEMENT_COLUMNS})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
       (SELECT revision FROM projects WHERE id = ? AND revision = ? AND manifest_sha256 = ?),
       ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      record.id,
      record.projectId,
      record.sequence,
      record.action,
      record.stateAfter,
      record.appealAfter,
      record.reason,
      record.evidenceReference,
      record.repositoryGithubId,
      JSON.stringify(record.repositoryKeys),
      record.actor?.githubId ?? null,
      record.actor?.githubLogin ?? null,
      record.actorRole,
      record.decisionSource,
      record.projectId,
      record.beforeRevision,
      record.beforeManifestSha256,
      record.beforeManifestSha256,
      record.afterRevision,
      record.afterManifestSha256,
      record.result,
      record.createdAt,
      record.systemIssuer ? JSON.stringify(record.systemIssuer) : null,
    );
}

/** Constraint failures are expected races; anything else is a real fault. */
function isConstraintConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    /UNIQUE constraint failed|PRIMARY KEY|project (?:row|update) requires|enforcement sequence|NOT NULL constraint failed: project_enforcements.before_revision/u.test(
      error.message,
    )
  );
}

export class CloudflareProjectPersistence implements ProjectPersistence {
  constructor(private readonly db: ProjectD1Database) {}

  async listProjects(): Promise<ProjectRecord[]> {
    const result = await this.db
      .prepare(`SELECT ${PROJECT_COLUMNS} FROM projects ORDER BY id`)
      .all<ProjectRow>();
    return (result.results ?? []).map(projectFromRow);
  }

  async getProject(id: string): Promise<ProjectRecord | null> {
    const row = await this.db
      .prepare(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE id = ?`)
      .bind(id)
      .first<ProjectRow>();
    return row === null ? null : projectFromRow(row);
  }

  async listRevisions(): Promise<ProjectRevision[]> {
    const result = await this.db
      .prepare(
        `SELECT project_id, revision, manifest, manifest_sha256, reason, created_at
           FROM project_revisions ORDER BY project_id, revision`,
      )
      .all<{
        project_id: string;
        revision: number;
        manifest: string;
        manifest_sha256: string;
        reason: string;
        created_at: string;
      }>();
    return (result.results ?? []).map((row) => ({
      projectId: row.project_id,
      revision: row.revision,
      manifest: JSON.parse(row.manifest) as ProjectDefinition,
      manifestSha256: row.manifest_sha256,
      reason: row.reason,
      createdAt: row.created_at,
    }));
  }

  async getRevisionText(
    projectId: string,
    revision: number,
  ): Promise<{ manifestText: string; manifestSha256: string } | null> {
    const row = await this.db
      .prepare(
        `SELECT manifest, manifest_sha256 FROM project_revisions
          WHERE project_id = ? AND revision = ?`,
      )
      .bind(projectId, revision)
      .first<{ manifest: string; manifest_sha256: string }>();
    return row === null
      ? null
      : { manifestText: row.manifest, manifestSha256: row.manifest_sha256 };
  }

  async getApplication(id: string): Promise<ProjectApplication | null> {
    const row = await this.db
      .prepare(
        `SELECT ${APPLICATION_COLUMNS} FROM project_applications WHERE id = ?`,
      )
      .bind(id)
      .first<ApplicationRow>();
    return row === null ? null : applicationFromRow(row);
  }

  async listApplicantApplications(
    githubId: string,
  ): Promise<ProjectApplication[]> {
    const result = await this.db
      .prepare(
        `SELECT ${APPLICATION_COLUMNS} FROM project_applications
          WHERE applicant_github_id = ? ORDER BY submitted_at DESC, id LIMIT 50`,
      )
      .bind(githubId)
      .all<ApplicationRow>();
    return (result.results ?? []).map(applicationFromRow);
  }

  async hasSignedInActor(githubId: string): Promise<boolean> {
    return (
      (await this.db
        .prepare("SELECT github_id FROM points_members WHERE github_id = ?")
        .bind(githubId)
        .first()) !== null
    );
  }

  async listOwnedProjects(githubId: string): Promise<ProjectRecord[]> {
    const result = await this.db
      .prepare(
        `SELECT ${PROJECT_COLUMNS.split(", ")
          .map((column) => `p.${column}`)
          .join(", ")}
           FROM projects p
           LEFT JOIN project_applications a ON a.id = p.source_application_id
           LEFT JOIN project_revisions r ON r.project_id = p.id AND r.revision = 1
          WHERE a.applicant_github_id = ?1
             OR (p.source_application_id IS NULL AND r.actor_github_id = ?1)
             OR json_extract(p.manifest, '$.steward.github.actorId') = ?1
          ORDER BY p.id LIMIT 100`,
      )
      .bind(githubId)
      .all<ProjectRow>();
    return (result.results ?? []).map(projectFromRow);
  }

  async projectCreator(projectId: string): Promise<GithubActor | null> {
    const row = await this.db
      .prepare(
        `SELECT COALESCE(a.applicant_github_id, r.actor_github_id) AS github_id,
                COALESCE(a.applicant_github_login, r.actor_github_login) AS github_login
           FROM projects p
           LEFT JOIN project_applications a ON a.id = p.source_application_id
           LEFT JOIN project_revisions r ON r.project_id = p.id AND r.revision = 1
            AND p.source_application_id IS NULL
          WHERE p.id = ?`,
      )
      .bind(projectId)
      .first<{ github_id: string | null; github_login: string | null }>();
    return row?.github_id && row.github_login
      ? { githubId: row.github_id, githubLogin: row.github_login }
      : null;
  }

  async createProject(input: NewProjectInput): Promise<"created" | "conflict"> {
    const statements = [
      this.db
        .prepare(
          `INSERT INTO project_revisions (
             project_id, revision, manifest, manifest_sha256, reason,
             actor_github_id, actor_github_login, created_at
           ) VALUES (?, 1, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          input.manifest.id,
          input.manifestText,
          input.manifestSha256,
          input.reason.slice(0, 1000),
          input.actor.githubId,
          input.actor.githubLogin,
          input.at,
        ),
      this.db
        .prepare(
          `INSERT INTO projects (${PROJECT_COLUMNS})
           VALUES (?, 'paused', 1, ?, ?, ?, ?, NULL, ?, ?)`,
        )
        .bind(
          input.manifest.id,
          input.manifestText,
          input.manifestSha256,
          input.at,
          input.at,
          input.referrer?.githubId ?? null,
          input.referrer?.githubLogin ?? null,
        ),
      ...input.manifest.repositories.map((repository) =>
        this.db
          .prepare(
            "INSERT INTO project_repositories (repository_key, project_id) VALUES (?, ?)",
          )
          .bind(repository.id.toLowerCase(), input.manifest.id),
      ),
    ];
    try {
      await this.db.batch(statements);
      return "created";
    } catch (error) {
      if (isConstraintConflict(error)) return "conflict";
      throw error;
    }
  }

  async publishApplication(
    input: DecisionInput,
  ): Promise<"published" | "conflict"> {
    const application = await this.getApplication(input.applicationId);
    if (application === null || application.status !== "pending") {
      return "conflict";
    }
    const pending = `EXISTS (SELECT 1 FROM project_applications WHERE id = ? AND status = 'pending')`;
    const manifestText = JSON.stringify(application.manifest);
    const reason = `Published application ${application.id}${input.reason ? `: ${input.reason}` : ""}`;
    const statements = [
      this.db
        .prepare(
          `INSERT INTO project_revisions (
             project_id, revision, manifest, manifest_sha256, reason,
             actor_github_id, actor_github_login, created_at
           ) SELECT ?, 1, ?, ?, ?, ?, ?, ? WHERE ${pending}`,
        )
        .bind(
          application.projectId,
          manifestText,
          application.manifestSha256,
          reason.slice(0, 1000),
          input.actor.githubId,
          input.actor.githubLogin,
          input.at,
          application.id,
        ),
      this.db
        .prepare(
          `INSERT INTO projects (${PROJECT_COLUMNS})
           SELECT ?, 'paused', 1, ?, ?, ?, ?, ?, ?, ? WHERE ${pending}`,
        )
        .bind(
          application.projectId,
          manifestText,
          application.manifestSha256,
          input.at,
          input.at,
          application.id,
          application.referrer?.githubId ?? null,
          application.referrer?.githubLogin ?? null,
          application.id,
        ),
      ...application.manifest.repositories.map((repository) =>
        this.db
          .prepare(
            `INSERT INTO project_repositories (repository_key, project_id)
             SELECT ?, ? WHERE ${pending}`,
          )
          .bind(
            repository.id.toLowerCase(),
            application.projectId,
            application.id,
          ),
      ),
      this.db
        .prepare(
          `UPDATE project_applications
              SET status = 'approved', decided_at = ?, decided_by_github_id = ?,
                  decided_by_github_login = ?, decision_reason = ?
            WHERE id = ? AND status = 'pending'`,
        )
        .bind(
          input.at,
          input.actor.githubId,
          input.actor.githubLogin,
          input.reason,
          application.id,
        ),
    ];
    try {
      const results = await this.db.batch(statements);
      return results.at(-1)?.meta?.changes === 1 ? "published" : "conflict";
    } catch (error) {
      if (isConstraintConflict(error)) return "conflict";
      throw error;
    }
  }

  async appendProjectRevision(
    input: ProjectRevisionInput,
    expectedEnforcementGeneration: number,
  ): Promise<"updated" | "conflict"> {
    const nextRevision = input.expectedRevision + 1;
    // The revision applies only while no enforcement record has landed since
    // the caller read the restrictions it checked.
    const unrestricted =
      "(SELECT COALESCE(MAX(rowid), 0) FROM project_enforcements) = ?" +
      (input.applicationId
        ? " AND EXISTS (SELECT 1 FROM project_applications WHERE id = ? AND status = 'pending' AND expected_revision = ?)"
        : "");
    const applicationBindings = input.applicationId
      ? [input.applicationId, input.expectedRevision]
      : [];
    const current = `EXISTS (SELECT 1 FROM projects WHERE id = ? AND revision = ?) AND ${unrestricted}`;
    try {
      const results = await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO project_revisions (
               project_id, revision, manifest, manifest_sha256, reason,
               actor_github_id, actor_github_login, created_at
             ) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${current}`,
          )
          .bind(
            input.projectId,
            nextRevision,
            input.manifestText,
            input.manifestSha256,
            input.reason,
            input.actor.githubId,
            input.actor.githubLogin,
            input.at,
            input.projectId,
            input.expectedRevision,
            expectedEnforcementGeneration,
            ...applicationBindings,
          ),
        this.db
          .prepare(
            `UPDATE projects
                SET status = ?, revision = ?, manifest = ?, manifest_sha256 = ?,
                    updated_at = ?
              WHERE id = ? AND revision = ? AND ${unrestricted}`,
          )
          .bind(
            input.manifest.status,
            nextRevision,
            input.manifestText,
            input.manifestSha256,
            input.at,
            input.projectId,
            input.expectedRevision,
            expectedEnforcementGeneration,
            ...applicationBindings,
          ),
        ...(input.applicationId
          ? [
              this.db
                .prepare(
                  `UPDATE project_applications SET status = 'approved', decided_at = ?, decided_by_github_id = ?, decided_by_github_login = ?, decision_reason = ? WHERE id = ? AND status = 'pending' AND changes() = 1 AND EXISTS (SELECT 1 FROM project_revisions WHERE project_id = ? AND revision = ? AND manifest_sha256 = ? AND created_at = ?)`,
                )
                .bind(
                  input.at,
                  input.actor.githubId,
                  input.actor.githubLogin,
                  input.reason,
                  input.applicationId,
                  input.projectId,
                  nextRevision,
                  input.manifestSha256,
                  input.at,
                ),
            ]
          : []),
        notifyProjectRevision(
          this.db,
          input.projectId,
          nextRevision,
          input.manifestSha256,
          input.at,
        ),
      ]);
      return results[1]?.meta?.changes === 1 ? "updated" : "conflict";
    } catch (error) {
      if (isConstraintConflict(error)) return "conflict";
      throw error;
    }
  }

  async listEnforcements(): Promise<ProjectEnforcement[]> {
    const result = await this.db
      .prepare(
        `SELECT ${ENFORCEMENT_COLUMNS} FROM project_enforcements
          ORDER BY project_id, sequence`,
      )
      .all<EnforcementRow>();
    const reviews = await this.db
      .prepare(
        "SELECT enforcement_id, assessment_id, malicious_assessment_ids FROM project_vetting_reinstatements",
      )
      .all<{
        enforcement_id: string;
        assessment_id: string;
        malicious_assessment_ids: string;
      }>();
    const byEnforcement = new Map(
      (reviews.results ?? []).map((review) => [
        review.enforcement_id,
        {
          assessmentId: review.assessment_id,
          maliciousAssessmentIds: JSON.parse(
            review.malicious_assessment_ids,
          ) as string[],
        },
      ]),
    );
    return (result.results ?? []).map((row) => ({
      ...enforcementFromRow(row),
      ...(byEnforcement.has(row.id)
        ? { vettingReview: byEnforcement.get(row.id) }
        : {}),
    }));
  }

  async enforcementGeneration(): Promise<number> {
    // Records are never updated or deleted, so the newest rowid changes on
    // every append and on nothing else.
    const row = await this.db
      .prepare(
        "SELECT COALESCE(MAX(rowid), 0) AS generation FROM project_enforcements",
      )
      .first<{ generation: number }>();
    if (row === null || !Number.isSafeInteger(row.generation))
      throw new Error("Enforcement generation is unavailable");
    return row.generation;
  }

  async appendEnforcement(
    record: ProjectEnforcement,
    revision: ProjectRevisionInput | null,
    appealReviewers: readonly string[],
  ): Promise<"recorded" | "conflict"> {
    const statements = [enforcementStatement(this.db, record)];
    if (record.vettingReview) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO project_vetting_reinstatements
             (enforcement_id, assessment_id, malicious_assessment_ids)
           VALUES (?, ?, ?)`,
          )
          .bind(
            record.id,
            record.vettingReview.assessmentId,
            JSON.stringify(record.vettingReview.maliciousAssessmentIds),
          ),
      );
    }
    if (revision !== null) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO project_revisions (
               project_id, revision, manifest, manifest_sha256, reason,
               actor_github_id, actor_github_login, created_at
             ) SELECT ?, ?, ?, ?, ?, ?, ?, ?
                WHERE EXISTS (SELECT 1 FROM projects WHERE id = ? AND revision = ?)`,
          )
          .bind(
            revision.projectId,
            revision.expectedRevision + 1,
            revision.manifestText,
            revision.manifestSha256,
            revision.reason,
            revision.actor.githubId,
            revision.actor.githubLogin,
            revision.at,
            revision.projectId,
            revision.expectedRevision,
          ),
        this.db
          .prepare(
            `UPDATE projects
                SET status = ?, revision = ?, manifest = ?, manifest_sha256 = ?,
                    updated_at = ?
              WHERE id = ? AND revision = ?`,
          )
          .bind(
            revision.manifest.status,
            revision.expectedRevision + 1,
            revision.manifestText,
            revision.manifestSha256,
            revision.at,
            revision.projectId,
            revision.expectedRevision,
          ),
      );
    }
    // The inbox rows are no-ops on replay, so only the source writes are
    // checked.
    const checked = statements.length;
    statements.push(
      notifyProjectEnforcement(this.db, record.id),
      notifyReinstatementReviewers(this.db, record.id, appealReviewers),
    );
    try {
      const results = await this.db.batch(statements);
      return results
        .slice(0, checked)
        .every((entry) => entry.meta?.changes === 1)
        ? "recorded"
        : "conflict";
    } catch (error) {
      if (isConstraintConflict(error)) return "conflict";
      throw error;
    }
  }
}
