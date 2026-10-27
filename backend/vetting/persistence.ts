/**
 * D1 storage for vetting assessments and artifact quarantine records, and the
 * repository admission and fresh reinstatement rules every executable surface asks before it
 * serves a project (PRD VET-01, VET-06, VET-07).
 */

import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import { canonicalJson } from "../../src/lib/canonical-json";
import type {
  GithubActor,
  ProjectEnforcement,
} from "../../src/lib/project-contracts";
import { executableManifestContent } from "../../src/lib/project-revision-changes";
import type { ProjectDefinition } from "../../src/lib/projects.mjs";
import type {
  AdmissionExemption,
  AssessmentState,
  AssessmentSummary,
  VettingClearance,
  VettingPin,
} from "../../src/lib/vetting-contracts";
import {
  notifyProjectEnforcement,
  notifyProjectScanFailed,
  notifyVettingBanAudience,
} from "../notifications/events";
import {
  CloudflareProjectPersistence,
  enforcementStatement,
  type ProjectD1Database,
} from "../projects/cloudflare-persistence";
import {
  enforcedManifest,
  planScanReinstatement,
  projectRestriction,
  repositoryIdentity,
} from "../projects/enforcement";
import type { VettingArtifact } from "./result";
import {
  isScanResult,
  type RecordedVettingResult,
  resultReviewers,
} from "./scan-result";

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
  result: RecordedVettingResult | null;
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
      row.result === null
        ? null
        : (JSON.parse(row.result) as RecordedVettingResult),
    resultSha256: row.result_sha256,
    signingKeySha256: row.signing_key_sha256,
    completedAt: row.completed_at,
  };
}

/**
 * The executable content of a manifest: the key-sorted canonical JSON of its
 * scanned fields (`executableManifestContent`). Activation, listing,
 * presentation and financial edits keep the digest, whatever key order the
 * editor sent. It remains the evidence digest even when routine later updates
 * keep the same repository admission.
 */
export async function vettedContentSha256(manifest: object): Promise<string> {
  return sha256Hex(
    new TextEncoder().encode(
      canonicalJson(executableManifestContent(manifest)),
    ),
  );
}

/** Admission follows one immutable repository, not a commit or mutable name. */
function admissionRepository(manifest: object): string | null {
  const { authority, repositories } = manifest as ProjectDefinition;
  if (
    repositories?.length !== 1 ||
    !authority?.repositoryId ||
    !authority.repositoryNodeId
  )
    return null;
  return canonicalJson({
    id: authority.repositoryId,
    nodeId: authority.repositoryNodeId,
  });
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
    modelRuns: assessment.result ? resultReviewers(assessment.result) : [],
    artifacts: artifacts.length,
    heldArtifacts: artifacts.filter((artifact) => artifact.state !== "released")
      .length,
  };
}

/** The request reason of a refresh that replaces an unavailable queued template. */
export const TEMPLATE_REPLACEMENT_REASON =
  "Automatic replacement of an unavailable queued template";

/** True when `next` only re-queues `previous` at a released template. */
function replacesTemplate(
  next: VettingAssessment,
  previous: VettingAssessment,
): boolean {
  return (
    next.requestReason === TEMPLATE_REPLACEMENT_REASON &&
    next.revision === previous.revision &&
    next.manifestSha256 === previous.manifestSha256 &&
    next.contentSha256 === previous.contentSha256 &&
    next.commitSha === previous.commitSha &&
    next.templateSha256 !== previous.templateSha256
  );
}

function newest<T>(items: T[], match: (item: T) => boolean): T | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1)
    if (match(items[index])) return items[index];
  return undefined;
}

type ExemptionRow = {
  id: string;
  project_id: string;
  revision: number;
  manifest_sha256: string;
  repository_id: string;
  repository_node_id: string;
  steward_id: string;
  steward_node_id: string;
  granted_by_github_id: string;
  granted_by_github_login: string;
  granted_at: string;
  reason: string;
  decision_reference: string;
  covered_assessment_ids: string;
  revoked_at: string | null;
  revoked_by_github_id: string | null;
  revoked_by_github_login: string | null;
  revocation_reason: string | null;
  revocation_decision_reference: string | null;
};
const EXEMPTION_SELECT = `SELECT g.*,r.revoked_at,r.revoked_by_github_id,r.revoked_by_github_login,r.reason AS revocation_reason,r.decision_reference AS revocation_decision_reference FROM vetting_admission_exemptions g LEFT JOIN vetting_admission_exemption_revocations r ON r.exemption_id=g.id`;
const UNREVIEWED_MALICIOUS = `SELECT 1 FROM vetting_assessments a WHERE a.project_id=? AND a.state='malicious' AND NOT EXISTS(SELECT 1 FROM project_vetting_reinstatements r JOIN project_enforcements e ON e.id=r.enforcement_id,json_each(r.malicious_assessment_ids) reviewed WHERE e.project_id=a.project_id AND e.action='reinstate' AND reviewed.value=a.id)`;
function exemptionView(row: ExemptionRow): AdmissionExemption {
  return {
    id: row.id,
    kind: "owner-approved-admission",
    projectId: row.project_id,
    revision: row.revision,
    manifestSha256: row.manifest_sha256,
    repositoryId: row.repository_id,
    repositoryNodeId: row.repository_node_id,
    stewardId: row.steward_id,
    stewardNodeId: row.steward_node_id,
    grantedBy: {
      githubId: row.granted_by_github_id,
      githubLogin: row.granted_by_github_login,
    },
    grantedAt: row.granted_at,
    reason: row.reason,
    decisionReference: row.decision_reference,
    revokedAt: row.revoked_at,
    revokedBy: row.revoked_by_github_id
      ? {
          githubId: row.revoked_by_github_id,
          githubLogin: row.revoked_by_github_login as string,
        }
      : null,
    revocationReason: row.revocation_reason,
    revocationDecisionReference: row.revocation_decision_reference,
  };
}

export class CloudflareVettingPersistence {
  constructor(
    private readonly db: ProjectD1Database,
    private readonly retainedEvidence?: (
      assessment: VettingAssessment,
    ) => Promise<boolean>,
  ) {}

  async listAdmissionExemptions(): Promise<AdmissionExemption[]> {
    const rows = await this.db
      .prepare(`${EXEMPTION_SELECT} ORDER BY g.sequence DESC`)
      .all<ExemptionRow>();
    return rows.results.map(exemptionView);
  }
  async admissionExemption(id: string): Promise<AdmissionExemption | null> {
    const row = await this.db
      .prepare(`${EXEMPTION_SELECT} WHERE g.id=?`)
      .bind(id)
      .first<ExemptionRow>();
    return row ? exemptionView(row) : null;
  }
  async hasUnreviewedMalicious(projectId: string): Promise<boolean> {
    return (
      (await this.db.prepare(UNREVIEWED_MALICIOUS).bind(projectId).first()) !==
      null
    );
  }
  async grantAdmissionExemption(input: {
    id: string;
    projectId: string;
    revision: number;
    manifestSha256: string;
    repositoryId: string;
    repositoryNodeId: string;
    stewardId: string;
    stewardNodeId: string;
    actor: GithubActor;
    at: string;
    reason: string;
    decisionReference: string;
    enforcementGeneration: number;
  }): Promise<boolean> {
    const result = await this.db
      .prepare(
        `INSERT INTO vetting_admission_exemptions(id,project_id,revision,manifest_sha256,repository_id,repository_node_id,steward_id,steward_node_id,granted_by_github_id,granted_by_github_login,granted_at,reason,decision_reference,covered_assessment_ids) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,(SELECT json_group_array(id) FROM vetting_assessments WHERE project_id=?) WHERE EXISTS(SELECT 1 FROM projects p WHERE p.id=? AND p.revision=? AND p.manifest_sha256=? AND json_extract(p.manifest,'$.authority.repositoryId')=? AND json_extract(p.manifest,'$.authority.repositoryNodeId')=? AND json_extract(p.manifest,'$.steward.github.actorId')=? AND json_extract(p.manifest,'$.steward.github.nodeId')=?) AND NOT EXISTS(${UNREVIEWED_MALICIOUS}) AND (SELECT COALESCE(MAX(rowid),0) FROM project_enforcements)=? AND NOT EXISTS(SELECT 1 FROM vetting_admission_exemptions g WHERE g.project_id=? AND g.repository_id=? AND g.repository_node_id=? AND g.steward_id=? AND g.steward_node_id=? AND NOT EXISTS(SELECT 1 FROM vetting_admission_exemption_revocations r WHERE r.exemption_id=g.id))`,
      )
      .bind(
        input.id,
        input.projectId,
        input.revision,
        input.manifestSha256,
        input.repositoryId,
        input.repositoryNodeId,
        input.stewardId,
        input.stewardNodeId,
        input.actor.githubId,
        input.actor.githubLogin,
        input.at,
        input.reason,
        input.decisionReference,
        input.projectId,
        input.projectId,
        input.revision,
        input.manifestSha256,
        input.repositoryId,
        input.repositoryNodeId,
        input.stewardId,
        input.stewardNodeId,
        input.projectId,
        input.enforcementGeneration,
        input.projectId,
        input.repositoryId,
        input.repositoryNodeId,
        input.stewardId,
        input.stewardNodeId,
      )
      .run();
    return result.meta?.changes === 1;
  }
  async revokeAdmissionExemption(
    id: string,
    actor: GithubActor,
    at: string,
    reason: string,
    decisionReference: string,
  ): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO vetting_admission_exemption_revocations(exemption_id,revoked_by_github_id,revoked_by_github_login,revoked_at,reason,decision_reference) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM vetting_admission_exemptions WHERE id=?) ON CONFLICT(exemption_id) DO NOTHING`,
      )
      .bind(
        id,
        actor.githubId,
        actor.githubLogin,
        at,
        reason,
        decisionReference,
        id,
      )
      .run();
  }

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
        `SELECT ${COLUMNS} FROM vetting_assessments
         WHERE state = 'pending' AND rowid = (
           SELECT MAX(current.rowid) FROM vetting_assessments current
           WHERE current.project_id = vetting_assessments.project_id
         ) ORDER BY requested_at, rowid LIMIT 100`,
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
  async revisionContents(projectId: string): Promise<
    {
      revision: number;
      contentSha256: string;
      repositoryIdentity: string | null;
    }[]
  > {
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
        repositoryIdentity: admissionRepository(JSON.parse(row.manifest)),
      })),
    );
  }

  /** A scan can resolve only the flags present when it was queued. */
  async assessmentCoversActiveFlags(assessmentId: string): Promise<boolean> {
    const row = await this.db
      .prepare(
        `SELECT NOT EXISTS (
      SELECT 1 FROM project_flags f WHERE f.project_id = a.project_id
        AND f.state = 'active' AND f.id NOT IN (SELECT value FROM json_each(a.flag_ids))
    ) AS covered FROM vetting_assessments a WHERE a.id = ?`,
      )
      .bind(assessmentId)
      .first<{ covered: number }>();
    return row?.covered === 1;
  }

  /** Refuses duplicate pins and stale replacements atomically. Older rows stay immutable. */
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
    replacesPendingId?: string,
  ): Promise<"created" | "conflict"> {
    try {
      await this.db
        .prepare(
          `INSERT INTO vetting_assessments (id, project_id, revision, manifest_sha256, content_sha256, commit_sha, template_sha256, requested_by_github_id, requested_by_github_login, requested_at, request_reason, state, flag_ids)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending',
             (SELECT json_group_array(id) FROM (SELECT id FROM project_flags WHERE project_id = ? AND state = 'active' ORDER BY id))
           WHERE ? IS NULL OR EXISTS (
             SELECT 1 FROM vetting_assessments previous
             WHERE previous.id = ? AND previous.project_id = ? AND previous.state = 'pending'
               AND previous.rowid = (SELECT MAX(rowid) FROM vetting_assessments WHERE project_id = ?)
           )`,
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
          assessment.projectId,
          replacesPendingId ?? null,
          replacesPendingId ?? null,
          assessment.projectId,
          assessment.projectId,
        )
        .run();
      if (replacesPendingId && !(await this.getAssessment(assessment.id)))
        return "conflict";
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
    result: RecordedVettingResult;
    resultText: string;
    resultSha256: string;
    signingKeySha256: string;
    operatorGithubIds?: readonly string[];
    livePin?: VettingPin | null;
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
    if (
      result.disposition === "clean" &&
      !(isScanResult(result) && result.reusedAssessmentId !== null)
    )
      // A clean fresh scan reinstates a project that flags alone paused
      // (PRD section 8). The record commits with the result or not at all.
      enforcement = await this.planFlagReinstatement(
        result.assessmentId,
        input.signingKeySha256,
        result.policyVersion,
        input.livePin,
        input.at,
      );
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
              // Reads back the record and writes only for a service ban.
              notifyVettingBanAudience(
                this.db,
                enforcement.id,
                input.operatorGithubIds ?? [],
              ),
            ]
          : []),
        // A scan that could not establish clearance tells the owners once.
        ...(result.disposition === "incomplete"
          ? [notifyProjectScanFailed(this.db, result.assessmentId)]
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
        /a vetting result is recorded once|enforcement sequence|scan reinstatement needs|NOT NULL constraint|UNIQUE constraint/u.test(
          error.message,
        )
      )
        return "conflict";
      throw error;
    }
  }

  /**
   * Plans the reinstatement of a flag-only pause from one fresh clean scan.
   * The scan must cover every active flag and, when a live pin is given,
   * match it; a null pin means the live pin could not be read.
   */
  private async planFlagReinstatement(
    assessmentId: string,
    keySha256: string,
    policyVersion: string,
    livePin: VettingPin | null | undefined,
    at: string,
  ): Promise<ProjectEnforcement | null> {
    const projects = new CloudflareProjectPersistence(this.db);
    const assessment = await this.getAssessment(assessmentId);
    const project = assessment
      ? await projects.getProject(assessment.projectId)
      : null;
    if (
      !project ||
      !assessment ||
      livePin === null ||
      (livePin !== undefined &&
        (assessment.commitSha !== livePin.commitSha ||
          assessment.templateSha256 !== livePin.templateSha256)) ||
      !(await this.assessmentCoversActiveFlags(assessment.id))
    )
      return null;
    return planScanReinstatement({
      project,
      restriction: projectRestriction(
        project.id,
        await projects.listEnforcements(),
      ),
      scan: {
        assessmentId: assessment.id,
        requestedAt: assessment.requestedAt,
        contentSha256: assessment.contentSha256,
        keySha256,
        policyVersion,
      },
      currentContentSha256: await vettedContentSha256(project.manifest),
      at,
    });
  }

  /**
   * Completes a flag-only reinstatement that a recorded fresh clean scan
   * could not write, for example because the live pin was unreadable when
   * the result landed. The scan must still match the current live pin.
   * Returns true when it wrote the reinstatement.
   */
  async reinstateFromRecordedScan(
    assessmentId: string,
    livePin: VettingPin,
    at: string,
  ): Promise<boolean> {
    const assessment = await this.getAssessment(assessmentId);
    const result = assessment?.result;
    if (
      assessment?.state !== "clean" ||
      !result ||
      (isScanResult(result) && result.reusedAssessmentId !== null) ||
      assessment.signingKeySha256 === null ||
      assessment.policyVersion === null
    )
      return false;
    const enforcement = await this.planFlagReinstatement(
      assessment.id,
      assessment.signingKeySha256,
      assessment.policyVersion,
      livePin,
      at,
    );
    if (!enforcement) return false;
    try {
      await this.db.batch([
        enforcementStatement(this.db, enforcement),
        notifyProjectEnforcement(this.db, enforcement.id),
      ]);
      return true;
    } catch (error) {
      if (
        error instanceof Error &&
        /enforcement sequence|scan reinstatement needs|UNIQUE constraint/u.test(
          error.message,
        )
      )
        return false;
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
      admissionRepository(manifest),
      (manifest as Partial<ProjectDefinition>).steward?.github,
    );
  }

  /** Admission uses the latest actual assessment of this repository identity.
   * Its original revision, commit and template remain evidence, never a claim
   * about later content. Explicit reinstatement still requires the current pin.
   * Malicious findings and retained-evidence checks apply to both paths. */
  private async clearance(
    projectId: string,
    contentSha256: string,
    throughRevision: number,
    readPin: VettingPinReader,
    forReinstatement = false,
    repositoryIdentity: string | null,
    steward: { actorId: string; nodeId: string } | undefined,
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
    const grandfathered = await this.db
      .prepare(
        `SELECT 1 AS found FROM vetting_grandfathered_projects WHERE project_id = ?`,
      )
      .bind(projectId)
      .first<{ found: number }>();
    if (grandfathered && !malicious && !forReinstatement)
      return { state: "cleared", assessment: null, grandfathered: true };
    if (
      !malicious &&
      !forReinstatement &&
      repositoryIdentity !== null &&
      steward
    ) {
      const identity = JSON.parse(repositoryIdentity) as {
        id: string;
        nodeId: string;
      };
      const exempt = await this.db
        .prepare(
          `${EXEMPTION_SELECT} WHERE g.project_id=? AND g.repository_id=? AND g.repository_node_id=? AND g.steward_id=? AND g.steward_node_id=? AND g.revision<=? AND r.exemption_id IS NULL ORDER BY g.sequence DESC LIMIT 1`,
        )
        .bind(
          projectId,
          identity.id,
          identity.nodeId,
          steward.actorId,
          steward.nodeId,
          throughRevision,
        )
        .first<ExemptionRow>();
      if (exempt) {
        const covered = new Set(
          JSON.parse(exempt.covered_assessment_ids) as string[],
        );
        // A template retry continues the covered request that it replaced.
        for (let index = 1; index < assessments.length; index += 1)
          if (
            covered.has(assessments[index - 1].id) &&
            replacesTemplate(assessments[index], assessments[index - 1])
          )
            covered.add(assessments[index].id);
        if (assessments.every((assessment) => covered.has(assessment.id)))
          return {
            state: "cleared",
            assessment: null,
            exemption: {
              id: exempt.id,
              kind: "owner-approved-admission",
              grantedAt: exempt.granted_at,
              grantedBy: {
                githubId: exempt.granted_by_github_id,
                githubLogin: exempt.granted_by_github_login,
              },
              repositoryId: exempt.repository_id,
              repositoryNodeId: exempt.repository_node_id,
            },
          };
      }
    }
    const revisions = await this.revisionContents(projectId);
    const window = new Map<number, string>();
    for (let index = revisions.length - 1; index >= 0; index -= 1) {
      const revision = revisions[index];
      if (revision.revision > throughRevision) continue;
      if (
        forReinstatement
          ? revision.contentSha256 !== contentSha256
          : repositoryIdentity === null ||
            revision.repositoryIdentity !== repositoryIdentity
      )
        break;
      window.set(revision.revision, revision.contentSha256);
    }
    const relevant = assessments.filter(
      (assessment) =>
        window.get(assessment.revision) === assessment.contentSha256,
    );
    const latest = relevant.at(-1);
    if (latest === undefined) return { state: "unscanned" };
    let live: VettingPin | undefined;
    let pinned = relevant;
    if (forReinstatement) {
      try {
        live = await readPin();
      } catch (error) {
        return {
          state: "unverified",
          reason:
            `Slop could not read the live integration-branch head or skill template digest. ${error instanceof Error ? error.message : ""}`.trim(),
        };
      }
      pinned = relevant.filter(
        (assessment) =>
          assessment.commitSha === live?.commitSha &&
          assessment.templateSha256 === live?.templateSha256,
      );
    }
    // An explicit later investigation still controls eligibility; an old clean
    // admission cannot override a pending or incomplete investigation.
    const finished = forReinstatement
      ? newest(pinned, (assessment) => assessment.state !== "pending")
      : latest.state === "pending"
        ? undefined
        : latest;
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
      let retained: boolean | undefined;
      try {
        retained = await this.retainedEvidence?.(finished);
      } catch {
        console.error("vetting evidence read failure");
        return {
          state: "unverified",
          reason:
            "Slop could not read the retained evidence of the clean assessment. Retry later.",
        };
      }
      if (!retained)
        return {
          state: "unverified",
          reason:
            "The clean assessment has no current complete authorized canonical assembly and retained evidence. Its assembly may be incomplete or absent, or evidence may be unavailable, corrupt or expired.",
        };
      return {
        state: "cleared",
        assessment: summarize(finished),
        ...(!forReinstatement ? { basis: "admission" as const } : {}),
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
    return live
      ? { state: "stale", assessment: summarize(latest), live }
      : { state: "unscanned" };
  }
}
