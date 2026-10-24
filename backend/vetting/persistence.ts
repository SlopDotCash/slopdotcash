/**
 * D1 storage for vetting assessments and artifact quarantine records, and the
 * revision-bound clearance rule every executable surface asks before it
 * serves a project (PRD VET-01, VET-06, VET-07).
 */

import { canonicalJson } from "../../src/lib/canonical-json";
import { executableManifestContent } from "../../src/lib/project-revision-changes";
import type {
  AssessmentState,
  AssessmentSummary,
  VettingClearance,
  VettingPin,
} from "../../src/lib/vetting-contracts";
import {
  notifyProjectEnforcement,
  notifyVettingBanAudience,
} from "../notifications/events";
import {
  CloudflareProjectPersistence,
  enforcementStatement,
  type ProjectD1Database,
} from "../projects/cloudflare-persistence";
import type { GithubActor, ProjectEnforcement } from "../projects/contracts";
import {
  enforcedManifest,
  projectRestriction,
  repositoryIdentity,
} from "../projects/enforcement";
import { sha256Hex } from "../trace/validation";
import type { VettingArtifact, VettingResult } from "./result";

export type {
  AssessmentState,
  AssessmentSummary,
  VettingClearance,
  VettingPin,
} from "../../src/lib/vetting-contracts";

export type VettingAssessment = {
  id: string;
  projectId: string;
  revision: number;
  manifestSha256: string;
  contentSha256: string;
  /** The integration-branch commit the queue assigned to the scan. */
  commitSha: string;
  /** The skill template input digest the queue assigned to the scan. */
  templateSha256: string;
  requestedBy: GithubActor;
  requestedAt: string;
  requestReason: string;
  state: AssessmentState;
  policyVersion: string | null;
  result: VettingResult | null;
  resultSha256: string | null;
  signingKeySha256: string | null;
  completedAt: string | null;
};

/** Reads the live pin; throws when GitHub or the template cannot be read. */
export type VettingPinReader = () => Promise<VettingPin>;

type AssessmentRow = {
  id: string;
  project_id: string;
  revision: number;
  manifest_sha256: string;
  content_sha256: string;
  commit_sha: string;
  template_sha256: string;
  requested_by_github_id: string;
  requested_by_github_login: string;
  requested_at: string;
  request_reason: string;
  state: AssessmentState;
  policy_version: string | null;
  result: string | null;
  result_sha256: string | null;
  signing_key_sha256: string | null;
  completed_at: string | null;
};

const COLUMNS =
  "id, project_id, revision, manifest_sha256, content_sha256, commit_sha, template_sha256, requested_by_github_id, requested_by_github_login, requested_at, request_reason, state, policy_version, result, result_sha256, signing_key_sha256, completed_at";

function fromRow(row: AssessmentRow): VettingAssessment {
  return {
    id: row.id,
    projectId: row.project_id,
    revision: row.revision,
    manifestSha256: row.manifest_sha256,
    contentSha256: row.content_sha256,
    commitSha: row.commit_sha,
    templateSha256: row.template_sha256,
    requestedBy: {
      githubId: row.requested_by_github_id,
      githubLogin: row.requested_by_github_login,
    },
    requestedAt: row.requested_at,
    requestReason: row.request_reason,
    state: row.state,
    policyVersion: row.policy_version,
    result:
      row.result === null ? null : (JSON.parse(row.result) as VettingResult),
    resultSha256: row.result_sha256,
    signingKeySha256: row.signing_key_sha256,
    completedAt: row.completed_at,
  };
}

/**
 * The executable content of a manifest: the key-sorted canonical JSON of its
 * scanned fields (`executableManifestContent`). Activation, listing,
 * presentation and financial edits keep the digest, whatever key order the
 * editor sent; a change to the source or the skill inputs needs a fresh scan.
 */
export async function vettedContentSha256(manifest: object): Promise<string> {
  return sha256Hex(
    new TextEncoder().encode(
      canonicalJson(executableManifestContent(manifest)),
    ),
  );
}

export function summarize(assessment: VettingAssessment): AssessmentSummary {
  const artifacts: VettingArtifact[] = assessment.result?.artifacts ?? [];
  return {
    id: assessment.id,
    revision: assessment.revision,
    state: assessment.state,
    commitSha: assessment.commitSha,
    templateSha256: assessment.templateSha256,
    policyVersion: assessment.policyVersion,
    requestedAt: assessment.requestedAt,
    completedAt: assessment.completedAt,
    modelRuns: (assessment.result?.modelReviews ?? []).map((review) => ({
      reviewer: review.reviewer,
      provider: review.provider,
      model: review.model,
    })),
    artifacts: artifacts.length,
    heldArtifacts: artifacts.filter((artifact) => artifact.state !== "released")
      .length,
  };
}

function newest<T>(items: T[], match: (item: T) => boolean): T | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1)
    if (match(items[index])) return items[index];
  return undefined;
}

export class CloudflareVettingPersistence {
  constructor(
    private readonly db: ProjectD1Database,
    private readonly retainedEvidence?: (
      assessment: VettingAssessment,
    ) => Promise<boolean>,
  ) {}

  async listAssessments(): Promise<VettingAssessment[]> {
    const rows = await this.db
      .prepare(
        `SELECT ${COLUMNS} FROM vetting_assessments ORDER BY requested_at DESC, rowid DESC LIMIT 500`,
      )
      .all<AssessmentRow>();
    return (rows.results ?? []).map(fromRow);
  }

  async projectAssessments(projectId: string): Promise<VettingAssessment[]> {
    const rows = await this.db
      .prepare(
        `SELECT ${COLUMNS} FROM vetting_assessments WHERE project_id = ? ORDER BY requested_at, rowid`,
      )
      .bind(projectId)
      .all<AssessmentRow>();
    return (rows.results ?? []).map(fromRow);
  }

  async pendingAssessments(): Promise<VettingAssessment[]> {
    const rows = await this.db
      .prepare(
        `SELECT ${COLUMNS} FROM vetting_assessments WHERE state = 'pending' ORDER BY requested_at, rowid LIMIT 100`,
      )
      .all<AssessmentRow>();
    return (rows.results ?? []).map(fromRow);
  }

  async getAssessment(id: string): Promise<VettingAssessment | null> {
    const row = await this.db
      .prepare(`SELECT ${COLUMNS} FROM vetting_assessments WHERE id = ?`)
      .bind(id)
      .first<AssessmentRow>();
    return row === null ? null : fromRow(row);
  }

  /** Every revision of a project, oldest first, with its content digest. */
  async revisionContents(
    projectId: string,
  ): Promise<{ revision: number; contentSha256: string }[]> {
    const rows = await this.db
      .prepare(
        "SELECT revision, manifest FROM project_revisions WHERE project_id = ? ORDER BY revision",
      )
      .bind(projectId)
      .all<{ revision: number; manifest: string }>();
    return Promise.all(
      (rows.results ?? []).map(async (row) => ({
        revision: row.revision,
        contentSha256: await vettedContentSha256(JSON.parse(row.manifest)),
      })),
    );
  }

  /** Returns "conflict" when this revision already has a queued scan. */
  async createAssessment(
    assessment: Omit<
      VettingAssessment,
      | "state"
      | "policyVersion"
      | "result"
      | "resultSha256"
      | "signingKeySha256"
      | "completedAt"
    >,
  ): Promise<"created" | "conflict"> {
    try {
      await this.db
        .prepare(
          `INSERT INTO vetting_assessments (id, project_id, revision, manifest_sha256, content_sha256, commit_sha, template_sha256, requested_by_github_id, requested_by_github_login, requested_at, request_reason, state)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        )
        .bind(
          assessment.id,
          assessment.projectId,
          assessment.revision,
          assessment.manifestSha256,
          assessment.contentSha256,
          assessment.commitSha,
          assessment.templateSha256,
          assessment.requestedBy.githubId,
          assessment.requestedBy.githubLogin,
          assessment.requestedAt,
          assessment.requestReason,
        )
        .run();
      return "created";
    } catch (error) {
      if (error instanceof Error && /UNIQUE/u.test(error.message))
        return "conflict";
      throw error;
    }
  }

  /**
   * Records the one result of a pending assessment with its quarantine
   * records in one transaction. The update has no state filter on purpose:
   * the result-once trigger aborts the whole batch if a result already
   * landed, so artifacts can never attach to another result.
   */
  async recordResult(input: {
    result: VettingResult;
    resultText: string;
    resultSha256: string;
    signingKeySha256: string;
    operatorGithubIds?: readonly string[];
    at: string;
  }): Promise<"recorded" | "conflict"> {
    const { result } = input;
    let enforcement: ProjectEnforcement | null = null;
    if (result.disposition === "malicious") {
      if (!result.confirmation)
        throw new Error("Confirmed malicious evidence is required");
      const projects = new CloudflareProjectPersistence(this.db);
      const project = await projects.getProject(result.projectId);
      if (!project) throw new Error("The assessed project is missing");
      const restriction = projectRestriction(
        project.id,
        await projects.listEnforcements(),
      );
      const identity = repositoryIdentity(project.manifest);
      enforcement = {
        id: `enf_${result.assessmentId}`,
        projectId: project.id,
        sequence: restriction.nextSequence,
        action: "ban",
        stateAfter: "banned",
        appealAfter: restriction.appeal === "requested" ? "requested" : "none",
        reason:
          "Confirmed malicious evidence under the reviewed security vetting rule",
        evidenceReference: result.assessmentId,
        repositoryGithubId: restriction.repositoryGithubId ?? identity.githubId,
        repositoryKeys: [
          ...new Set([...restriction.repositoryKeys, ...identity.keys]),
        ],
        actor: null,
        actorRole: "vetting-service",
        decisionSource: "standing-rule",
        systemIssuer: {
          kind: "vetting-service",
          keySha256: input.signingKeySha256,
          assessmentId: result.assessmentId,
          policyVersion: result.policyVersion,
          rule: result.confirmation.rule,
        },
        beforeRevision: project.revision,
        beforeManifestSha256: project.manifestSha256,
        afterRevision: null,
        afterManifestSha256: null,
        result: enforcedManifest(project.manifest)
          ? "no_revision_needed"
          : "revision_pending",
        createdAt: input.at,
      };
    }
    try {
      await this.db.batch([
        this.db
          .prepare(
            `UPDATE vetting_assessments
                SET state = ?, policy_version = ?, result = ?,
                    result_sha256 = ?, signing_key_sha256 = ?, completed_at = ?
              WHERE id = ?`,
          )
          .bind(
            result.disposition,
            result.policyVersion,
            input.resultText,
            input.resultSha256,
            input.signingKeySha256,
            input.at,
            result.assessmentId,
          ),
        ...(enforcement
          ? [
              enforcementStatement(this.db, enforcement),
              notifyProjectEnforcement(this.db, enforcement.id),
              notifyVettingBanAudience(
                this.db,
                enforcement.id,
                input.operatorGithubIds ?? [],
              ),
            ]
          : []),
        ...result.artifacts.map((artifact, ordinal) =>
          this.db
            .prepare(
              `INSERT INTO vetting_artifacts (assessment_id, ordinal, sha256, parent_sha256, origin, path, artifact_type, state, analysis, requested_execution)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              result.assessmentId,
              ordinal,
              artifact.sha256,
              artifact.parentSha256,
              artifact.origin,
              artifact.path,
              artifact.type,
              artifact.state,
              artifact.analysis,
              artifact.requestedExecution ? 1 : 0,
            ),
        ),
      ]);
      return "recorded";
    } catch (error) {
      if (
        error instanceof Error &&
        /a vetting result is recorded once|enforcement sequence|NOT NULL constraint|UNIQUE constraint/u.test(
          error.message,
        )
      )
        return "conflict";
      throw error;
    }
  }

  /** The clearance of a manifest, a stored revision or an activation candidate. */
  async manifestClearance(
    projectId: string,
    manifest: object,
    throughRevision: number,
    readPin: VettingPinReader,
    forReinstatement = false,
  ): Promise<VettingClearance> {
    return this.clearance(
      projectId,
      await vettedContentSha256(manifest),
      throughRevision,
      readPin,
      forReinstatement,
    );
  }

  /**
   * The clearance of a project's content digest through a revision. A
   * confirmed-malicious result bans the project until an independent ADM-06
   * decision explicitly covers that exact finding with a later clean scan.
   * A clean scan alone cannot lift it. Otherwise only scans of the unbroken run of
   * revisions with the same content count, and of those only scans of the
   * live pin: the current integration-branch head and template digest. The
   * newest finished one decides (VET-07). A scan of another commit or
   * template is stale, so a moved branch or a new template is never served
   * on an old clearance.
   */
  async clearance(
    projectId: string,
    contentSha256: string,
    throughRevision: number,
    readPin: VettingPinReader,
    forReinstatement = false,
  ): Promise<VettingClearance> {
    const assessments = await this.projectAssessments(projectId);
    const reviewed = await this.db
      .prepare(
        `SELECT reviewed.value AS assessment_id
       FROM project_vetting_reinstatements r
       JOIN project_enforcements e ON e.id = r.enforcement_id,
       json_each(r.malicious_assessment_ids) reviewed
       WHERE e.project_id = ? AND e.action = 'reinstate'`,
      )
      .bind(projectId)
      .all<{ assessment_id: string }>();
    const waived = new Set(
      (reviewed.results ?? []).map((row) => row.assessment_id),
    );
    const findings = assessments.filter(
      (assessment) =>
        assessment.state === "malicious" && !waived.has(assessment.id),
    );
    const malicious = findings.at(-1);
    if (malicious && !forReinstatement)
      return { state: "banned", assessment: summarize(malicious) };
    const window = new Set<number>();
    const revisions = await this.revisionContents(projectId);
    for (let index = revisions.length - 1; index >= 0; index -= 1) {
      const revision = revisions[index];
      if (revision.revision > throughRevision) continue;
      if (revision.contentSha256 !== contentSha256) break;
      window.add(revision.revision);
    }
    const relevant = assessments.filter(
      (assessment) =>
        window.has(assessment.revision) &&
        assessment.contentSha256 === contentSha256,
    );
    const latest = relevant.at(-1);
    if (latest === undefined) return { state: "unscanned" };
    let live: VettingPin;
    try {
      live = await readPin();
    } catch (error) {
      return {
        state: "unverified",
        reason:
          `Slop could not read the live integration-branch head or skill template digest. ${error instanceof Error ? error.message : ""}`.trim(),
      };
    }
    const pinned = relevant.filter(
      (assessment) =>
        assessment.commitSha === live.commitSha &&
        assessment.templateSha256 === live.templateSha256,
    );
    const finished = newest(
      pinned,
      (assessment) => assessment.state !== "pending",
    );
    if (finished?.state === "clean") {
      if (
        malicious &&
        findings.some(
          (finding) =>
            finding.completedAt === null ||
            finished.requestedAt <= finding.completedAt,
        )
      )
        return { state: "banned", assessment: summarize(malicious) };
      if (!(await this.retainedEvidence?.(finished)))
        return {
          state: "unverified",
          reason:
            "The clean assessment has no current complete authorized canonical assembly and retained evidence. Its assembly may be incomplete or absent, or evidence may be unavailable, corrupt, expired, or outside the current operator-attested policy.",
        };
      return {
        state: "cleared",
        assessment: summarize(finished),
        ...(forReinstatement
          ? {
              reviewedMaliciousAssessmentIds: findings.map(
                (finding) => finding.id,
              ),
            }
          : {}),
      };
    }
    if (finished !== undefined)
      return { state: "quarantined", assessment: summarize(finished) };
    const queued = newest(
      pinned,
      (assessment) => assessment.state === "pending",
    );
    if (queued) return { state: "queued", assessment: summarize(queued) };
    return { state: "stale", assessment: summarize(latest), live };
  }
}
