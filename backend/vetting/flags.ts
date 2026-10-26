/**
 * Two-contributor flags (PRD sections 4 and 8; audit finding 9; issue #911).
 *
 * An eligible signed-in member reports a malicious-code or injection risk
 * with evidence (owner decision D3: a GitHub account at least 30 days old,
 * at least one accepted contribution, and not a steward or maintainer of the
 * project). Each member holds at most one active flag per project. The
 * second distinct active reporter pauses the project at once, through the
 * existing append-only enforcement record, in the same D1 transaction as the
 * flag, and notifies moderators once. No moderator approves a flag first.
 *
 * Flags stop counting when they close: the reporter withdraws, a clean scan
 * requested after the flag resolves it, the project is reinstated
 * (migration 0060 triggers), or the flag reaches FLAG_ACTIVE_LIFETIME_MS. A clean fresh scan reinstates a project that
 * flags alone paused; a moderator decides only after a confirmed malicious
 * result. Flag evidence is visible to the reporter and administrators only.
 */

import type { SetupAuthority } from "../../src/lib/project-contracts";
import {
  apiErrorResponse,
  fail,
  isSameOriginJsonWrite,
  json as jsonResponse,
  pathParts,
  requireActor,
} from "../http";
import { notifyProjectEnforcement } from "../notifications/events";
import {
  hasParticipationBan,
  PARTICIPATION_BAN_QUERY,
} from "../projects/account-bans";
import {
  type CloudflareProjectPersistence,
  ENFORCEMENT_COLUMNS,
  type ProjectD1Database,
} from "../projects/cloudflare-persistence";
import type { GithubActor, ProjectRecord } from "../projects/contracts";
import { type EdgeCache, purgeProjectCache } from "../projects/edge-cache";
import {
  FLAG_PAUSE_THRESHOLD,
  pausedByFlagsOnly,
  projectRestriction,
  repositoryIdentity,
} from "../projects/enforcement";
import { readJsonObject } from "../trace/validation";
import type {
  FlaggerStanding,
  FlaggerStandingReader,
} from "./flagger-standing";
import { SCAN_THREATS } from "./scan-result";

export const FLAG_CATEGORIES = [...SCAN_THREATS, "other"] as const;
export type FlagCategory = (typeof FLAG_CATEGORIES)[number];

/**
 * How long an unresolved flag keeps counting (owner decision D3: 90 days).
 * Migration 0060 refuses a pause that counts an older flag.
 */
export const FLAG_ACTIVE_LIFETIME_MS = 7_776_000_000;
/** The youngest GitHub account that may flag (owner decision D3: 30 days). */
export const FLAGGER_MIN_ACCOUNT_AGE_MS = 2_592_000_000;

/** Flags filed at or before this instant no longer count. */
export function flagCutoff(at: Date): string {
  return new Date(at.getTime() - FLAG_ACTIVE_LIFETIME_MS).toISOString();
}

const MIN_EVIDENCE = 20;
const MAX_EVIDENCE = 4000;
const PROJECT_ID = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/u;

export type ProjectFlag = {
  id: string;
  projectId: string;
  reporter: GithubActor;
  revision: number;
  category: FlagCategory;
  evidence: string;
  evidenceUrl: string | null;
  createdAt: string;
  state: "active" | "withdrawn" | "resolved" | "expired";
  closedAt: string | null;
  closedBy: "reporter" | "clean-scan" | "reinstatement" | "lifetime" | null;
  closedReference: string | null;
};

type FlagRow = {
  id: string;
  project_id: string;
  reporter_github_id: string;
  reporter_github_login: string;
  revision: number;
  category: FlagCategory;
  evidence: string;
  evidence_url: string | null;
  created_at: string;
  state: ProjectFlag["state"];
  closed_at: string | null;
  closed_by: ProjectFlag["closedBy"];
  closed_reference: string | null;
};

const COLUMNS =
  "id, project_id, reporter_github_id, reporter_github_login, revision, category, evidence, evidence_url, created_at, state, closed_at, closed_by, closed_reference";

function fromRow(row: FlagRow): ProjectFlag {
  return {
    id: row.id,
    projectId: row.project_id,
    reporter: {
      githubId: row.reporter_github_id,
      githubLogin: row.reporter_github_login,
    },
    revision: row.revision,
    category: row.category,
    evidence: row.evidence,
    evidenceUrl: row.evidence_url,
    createdAt: row.created_at,
    state: row.state,
    closedAt: row.closed_at,
    closedBy: row.closed_by,
    closedReference: row.closed_reference,
  };
}

/** SQL that keeps only canonical GitHub account ids as recipients. */
const GITHUB_ID = (column: string) =>
  `typeof(${column}) = 'text' AND length(${column}) BETWEEN 1 AND 20
   AND ${column} GLOB '[1-9]*' AND ${column} NOT GLOB '*[^0-9]*'`;

export type FiledFlag = {
  flag: ProjectFlag;
  /** The enforcement record this flag completed, or null. */
  pauseRecordId: string | null;
};

export class ProjectFlagStore {
  constructor(private readonly db: ProjectD1Database) {}

  async assertCanFile(githubId: string): Promise<void> {
    if (await hasParticipationBan(this.db, githubId))
      fail(
        403,
        "participation_banned",
        "This account cannot file new Slop flags. You can still read or withdraw an existing flag.",
      );
  }

  async get(id: string): Promise<ProjectFlag | null> {
    const row = await this.db
      .prepare(`SELECT ${COLUMNS} FROM project_flags WHERE id = ?`)
      .bind(id)
      .first<FlagRow>();
    return row === null ? null : fromRow(row);
  }

  /** The reporter's one counting flag on a project, if any. */
  async activeFor(
    projectId: string,
    githubId: string,
    at: Date,
  ): Promise<ProjectFlag | null> {
    const row = await this.db
      .prepare(
        `SELECT ${COLUMNS} FROM project_flags
          WHERE project_id = ? AND reporter_github_id = ? AND state = 'active'
            AND created_at > ?`,
      )
      .bind(projectId, githubId, flagCutoff(at))
      .first<FlagRow>();
    return row === null ? null : fromRow(row);
  }

  /** Every counting flag, for the restricted moderator view. */
  async activeFlags(at: Date): Promise<ProjectFlag[]> {
    const rows = await this.db
      .prepare(
        `SELECT ${COLUMNS} FROM project_flags
          WHERE state = 'active' AND created_at > ?
          ORDER BY project_id, created_at, id LIMIT 500`,
      )
      .bind(flagCutoff(at))
      .all<FlagRow>();
    return (rows.results ?? []).map(fromRow);
  }

  /**
   * Records one flag and, in the same transaction, the pause it completes.
   * The pause lands only when the project's own records are clear and at
   * least FLAG_PAUSE_THRESHOLD distinct members hold an active flag, read
   * inside the write itself, so concurrent flags cannot both miss it.
   * Flags older than FLAG_ACTIVE_LIFETIME_MS close as expired first, so they
   * neither count nor block their reporter from filing again.
   * Returns "conflict" when the reporter already holds an active flag.
   */
  async file(input: {
    flagId: string;
    pauseRecordId: string;
    project: ProjectRecord;
    repositoryGithubId: string;
    repositoryKeys: string[];
    reporter: GithubActor;
    category: FlagCategory;
    evidence: string;
    evidenceUrl: string | null;
    moderatorGithubIds: readonly string[];
    at: string;
  }): Promise<FiledFlag | "conflict"> {
    await this.assertCanFile(input.reporter.githubId);
    const statements = [
      this.db
        .prepare(
          `UPDATE project_flags
              SET state = 'expired', closed_at = ?, closed_by = 'lifetime'
            WHERE project_id = ? AND state = 'active' AND created_at <= ?`,
        )
        .bind(input.at, input.project.id, flagCutoff(new Date(input.at))),
      this.db
        .prepare(
          `INSERT INTO project_flags (
             id, project_id, reporter_github_id, reporter_github_login,
             revision, manifest_sha256, category, evidence, evidence_url,
             created_at
           )
           SELECT ?, id, ?, ?, revision, manifest_sha256, ?, ?, ?, ?
             FROM projects WHERE id = ? AND NOT EXISTS (${PARTICIPATION_BAN_QUERY})`,
        )
        .bind(
          input.flagId,
          input.reporter.githubId,
          input.reporter.githubLogin,
          input.category,
          input.evidence,
          input.evidenceUrl,
          input.at,
          input.project.id,
          input.reporter.githubId,
        ),
      this.db
        .prepare(
          `INSERT INTO project_enforcements (${ENFORCEMENT_COLUMNS})
           SELECT ?1, p.id,
                  (SELECT COALESCE(MAX(sequence), 0) + 1
                     FROM project_enforcements WHERE project_id = p.id),
                  'quarantine', 'quarantined', 'none', ?2, ?3, ?4, ?5,
                  NULL, NULL, 'contributor-flags', 'standing-rule',
                  p.revision, p.manifest_sha256, NULL, NULL,
                  CASE WHEN json_extract(p.manifest, '$.status') = 'paused'
                        AND json_extract(p.manifest, '$.listingTier') = 'retired'
                       THEN 'no_revision_needed' ELSE 'revision_pending' END,
                  ?6,
                  json_object(
                    'kind', 'contributor-flags',
                    'threshold', ?7,
                    'flagIds', json((
                      SELECT json_group_array(id) FROM (
                        SELECT id FROM project_flags
                         WHERE project_id = p.id AND state = 'active'
                         ORDER BY created_at, id
                      )
                    ))
                  )
             FROM projects p
            WHERE p.id = ?8
              AND EXISTS (SELECT 1 FROM project_flags WHERE id = ?9)
              AND (SELECT COUNT(DISTINCT reporter_github_id) FROM project_flags
                    WHERE project_id = p.id AND state = 'active') >= ?7
              AND COALESCE((
                    SELECT state_after FROM project_enforcements
                     WHERE project_id = p.id ORDER BY sequence DESC LIMIT 1
                  ), 'clear') = 'clear'`,
        )
        .bind(
          input.pauseRecordId,
          "Two distinct contributor flags paused the project. A clean fresh security scan reinstates it.",
          `flag:${input.flagId}`,
          input.repositoryGithubId,
          JSON.stringify(input.repositoryKeys),
          input.at,
          FLAG_PAUSE_THRESHOLD,
          input.project.id,
          input.flagId,
        ),
      // One notice per moderator for this pause; no-op when no pause landed.
      this.db
        .prepare(
          `INSERT INTO notifications (
             event_key, recipient_github_id, kind, subject, detail,
             action_path, source_at, created_at
           )
           SELECT 'project-enforcement:' || e.id, r.value, 'project_quarantined',
                  e.project_id, NULL, '/admin', e.created_at, e.created_at
             FROM project_enforcements e, json_each(?2) r
            WHERE e.id = ?1 AND e.actor_role = 'contributor-flags'
              AND ${GITHUB_ID("r.value")}
           ON CONFLICT (event_key, recipient_github_id) DO NOTHING`,
        )
        .bind(
          input.pauseRecordId,
          JSON.stringify([...new Set(input.moderatorGithubIds)]),
        ),
      notifyProjectEnforcement(this.db, input.pauseRecordId),
    ];
    try {
      const results = await this.db.batch(statements);
      if (results[1]?.meta?.changes !== 1) {
        await this.assertCanFile(input.reporter.githubId);
        return "conflict";
      }
    } catch (error) {
      if (
        error instanceof Error &&
        /UNIQUE constraint failed: project_flags|enforcement sequence|a flag pause needs/u.test(
          error.message,
        )
      )
        return "conflict";
      throw error;
    }
    const flag = await this.get(input.flagId);
    if (flag === null) throw new Error("The flag was not recorded");
    const paused = await this.db
      .prepare("SELECT id FROM project_enforcements WHERE id = ?")
      .bind(input.pauseRecordId)
      .first<{ id: string }>();
    return { flag, pauseRecordId: paused === null ? null : paused.id };
  }

  /** Closes the reporter's active flag. A pause it helped place stands. */
  async withdraw(
    projectId: string,
    githubId: string,
    at: string,
  ): Promise<boolean> {
    const cutoff = flagCutoff(new Date(at));
    const results = await this.db.batch([
      this.db
        .prepare(
          `UPDATE project_flags
              SET state = 'expired', closed_at = ?, closed_by = 'lifetime'
            WHERE project_id = ? AND state = 'active' AND created_at <= ?`,
        )
        .bind(at, projectId, cutoff),
      this.db
        .prepare(
          `UPDATE project_flags
              SET state = 'withdrawn', closed_at = ?, closed_by = 'reporter'
            WHERE project_id = ? AND reporter_github_id = ?
              AND state = 'active' AND created_at > ?`,
        )
        .bind(at, projectId, githubId, cutoff),
    ]);
    return results[1]?.meta?.changes === 1;
  }
}

export type ProjectFlagApiDependencies = {
  flags: ProjectFlagStore;
  projects: Pick<
    CloudflareProjectPersistence,
    "getProject" | "listEnforcements" | "enforcementGeneration"
  >;
  sessionActor: (request: Request) => Promise<GithubActor | null>;
  /** Reads account age and accepted contributions from GitHub. */
  flaggerStanding: FlaggerStandingReader;
  /**
   * The member's authority over the project repository, read as project
   * setup reads it. "verified" means a maintainer, who cannot flag.
   */
  repositoryAuthority: (
    manifest: ProjectRecord["manifest"],
    actor: GithubActor,
  ) => Promise<SetupAuthority>;
  /** Configured project moderators and administrators to notify. */
  moderatorGithubIds: readonly string[];
  /** Queues a fresh scan after a pause; failures wait for the next refresh. */
  queueFreshScan?: (project: ProjectRecord) => Promise<unknown>;
  now: () => Date;
  randomId: () => string;
  cache?: EdgeCache;
};

function json(status: number, body: Record<string, unknown>): Response {
  return jsonResponse(status, body, { cacheControl: "no-store" });
}

/** The reporter's own view; it never reveals other members' flags. */
function reporterFlag(flag: ProjectFlag | null) {
  return flag === null
    ? null
    : {
        id: flag.id,
        category: flag.category,
        evidence: flag.evidence,
        evidenceUrl: flag.evidenceUrl,
        revision: flag.revision,
        createdAt: flag.createdAt,
        expiresAt: new Date(
          Date.parse(flag.createdAt) + FLAG_ACTIVE_LIFETIME_MS,
        ).toISOString(),
        state: flag.state,
      };
}

function readEvidence(value: unknown): string {
  const evidence = typeof value === "string" ? value.trim() : "";
  if (
    evidence.length < MIN_EVIDENCE ||
    evidence.length > MAX_EVIDENCE ||
    // Allow line breaks and tabs; refuse other control characters.
    /\p{Cc}/u.test(evidence.replace(/[\n\r\t]/gu, ""))
  )
    fail(
      400,
      "invalid_request",
      `Describe the evidence in ${MIN_EVIDENCE} to ${MAX_EVIDENCE} characters: the file, command or behavior and what it does`,
    );
  return evidence;
}

function readEvidenceUrl(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 500)
    fail(400, "invalid_request", "evidenceUrl must be a GitHub URL");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail(400, "invalid_request", "evidenceUrl must be a GitHub URL");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.username ||
    url.password ||
    url.port ||
    url.href.length < 20
  )
    fail(
      400,
      "invalid_request",
      "evidenceUrl must be an https://github.com URL",
    );
  return url.href;
}

function flaggerStandingUnavailable(): never {
  fail(
    503,
    "flagger_standing_unavailable",
    "Slop could not confirm your GitHub account and contributions. Nothing was filed. Try again later.",
  );
}

/** Owner decision D3: who may flag. A failed read refuses the flag. */
async function requireEligibleFlagger(
  deps: ProjectFlagApiDependencies,
  actor: GithubActor,
  project: ProjectRecord,
): Promise<void> {
  let authority: SetupAuthority;
  let standing: FlaggerStanding;
  try {
    authority = await deps.repositoryAuthority(project.manifest, actor);
    standing = await deps.flaggerStanding(actor);
  } catch {
    console.error("flagger standing read failure");
    flaggerStandingUnavailable();
  }
  if (authority.state === "verified")
    fail(
      403,
      "maintainer_cannot_flag",
      "Project maintainers fix or pause their own project instead of flagging it",
    );
  if (authority.state === "retry") flaggerStandingUnavailable();
  if (
    deps.now().getTime() - Date.parse(standing.accountCreatedAt) <
    FLAGGER_MIN_ACCOUNT_AGE_MS
  )
    fail(
      403,
      "flagger_account_too_new",
      "Your GitHub account must be at least 30 days old to flag a project",
    );
  if (!standing.hasAcceptedContribution)
    fail(
      403,
      "flagger_needs_accepted_contribution",
      "You need at least 1 accepted contribution to a Slop project to flag a project",
    );
}

async function readProject(
  deps: ProjectFlagApiDependencies,
  projectId: string,
): Promise<ProjectRecord> {
  if (!PROJECT_ID.test(projectId)) fail(404, "not_found", "Project not found");
  const project = await deps.projects.getProject(projectId);
  if (project === null) fail(404, "not_found", "Project not found");
  return project;
}

async function projectState(
  deps: ProjectFlagApiDependencies,
  project: ProjectRecord,
) {
  const restriction = projectRestriction(
    project.id,
    await deps.projects.listEnforcements(),
  );
  return {
    restriction: restriction.state,
    pausedByFlags: pausedByFlagsOnly(restriction),
  };
}

async function mine(
  request: Request,
  deps: ProjectFlagApiDependencies,
  projectId: string,
): Promise<Response> {
  const actor = await requireActor(request, deps);
  const project = await readProject(deps, projectId);
  return json(200, {
    projectId: project.id,
    flag: reporterFlag(
      await deps.flags.activeFor(project.id, actor.githubId, deps.now()),
    ),
    ...(await projectState(deps, project)),
  });
}

async function file(
  request: Request,
  deps: ProjectFlagApiDependencies,
  projectId: string,
): Promise<Response> {
  const actor = await requireActor(request, deps);
  await deps.flags.assertCanFile(actor.githubId);
  const body = await readJsonObject(request);
  const keys = Object.keys(body);
  if (
    keys.some((key) => !["category", "evidence", "evidenceUrl"].includes(key))
  )
    fail(400, "invalid_request", "Send category, evidence and evidenceUrl");
  if (!FLAG_CATEGORIES.includes(body.category as FlagCategory))
    fail(
      400,
      "invalid_request",
      `category must be one of ${FLAG_CATEGORIES.join(", ")}`,
    );
  const evidence = readEvidence(body.evidence);
  const evidenceUrl = readEvidenceUrl(body.evidenceUrl);
  const project = await readProject(deps, projectId);
  // The steward controls the project directly and pauses it there.
  if (project.manifest.steward.github.actorId === actor.githubId)
    fail(
      403,
      "owner_cannot_flag",
      "Project owners pause or update their own project instead of flagging it",
    );
  await requireEligibleFlagger(deps, actor, project);
  const records = await deps.projects.listEnforcements();
  const restriction = projectRestriction(project.id, records);
  const identity = repositoryIdentity(project.manifest);
  const suffix = () => deps.randomId().replaceAll("-", "").toLowerCase();
  const at = deps.now().toISOString();
  const filed = await deps.flags.file({
    flagId: `flg_${suffix()}`,
    pauseRecordId: `enf_flags_${suffix()}`,
    project,
    repositoryGithubId: restriction.repositoryGithubId ?? identity.githubId,
    repositoryKeys: [
      ...new Set([...restriction.repositoryKeys, ...identity.keys]),
    ],
    reporter: actor,
    category: body.category as FlagCategory,
    evidence,
    evidenceUrl,
    moderatorGithubIds: deps.moderatorGithubIds,
    at,
  });
  if (filed === "conflict") {
    if (await deps.flags.activeFor(project.id, actor.githubId, deps.now()))
      fail(
        409,
        "flag_active",
        "You already have an active flag on this project. Withdraw it to file a new one.",
      );
    fail(
      409,
      "flag_retry",
      "The project changed while the flag was recorded. Retry.",
    );
  }
  let scan: unknown = null;
  if (filed.pauseRecordId !== null) {
    // Skills and discovery close with the pause, so drop cached copies.
    await purgeProjectCache(
      deps.cache,
      new URL(request.url).origin,
      project.id,
      [project.manifest.skill.id, project.manifest.reviewSkill.id],
      await deps.projects.enforcementGeneration(),
    );
    scan = (await deps.queueFreshScan?.(project)) ?? null;
  }
  return json(201, {
    projectId: project.id,
    flag: reporterFlag(filed.flag),
    paused: filed.pauseRecordId !== null,
    freshScan: scan,
    ...(await projectState(deps, project)),
  });
}

async function withdraw(
  request: Request,
  deps: ProjectFlagApiDependencies,
  projectId: string,
): Promise<Response> {
  const actor = await requireActor(request, deps);
  const body = await readJsonObject(request);
  if (Object.keys(body).length !== 0)
    fail(400, "invalid_request", "Send an empty JSON object");
  const project = await readProject(deps, projectId);
  if (
    !(await deps.flags.withdraw(
      project.id,
      actor.githubId,
      deps.now().toISOString(),
    ))
  )
    fail(404, "not_found", "You have no active flag on this project");
  return json(200, {
    projectId: project.id,
    flag: null,
    ...(await projectState(deps, project)),
  });
}

/** Routes under /api/v1/project-flags; returns null for any other path. */
export async function handleProjectFlagsApi(
  request: Request,
  deps: ProjectFlagApiDependencies,
): Promise<Response | null> {
  const parts = pathParts(request);
  if (parts[0] !== "project-flags") return null;
  try {
    // Session writes must come from this site.
    if (request.method !== "GET" && !isSameOriginJsonWrite(request))
      fail(403, "origin_forbidden", "Requests must come from this site");
    const projectId = parts[1] ?? "";
    const route = `${request.method} ${parts.length === 3 ? parts[2] : parts.length === 2 ? "" : "?"}`;
    switch (route) {
      case "GET ":
        return await mine(request, deps, projectId);
      case "POST ":
        return await file(request, deps, projectId);
      case "POST withdraw":
        return await withdraw(request, deps, projectId);
    }
    return json(404, { error: "not_found" });
  } catch (caught) {
    return apiErrorResponse(caught, {
      label: "project flag API failure",
      respond: json,
    });
  }
}
