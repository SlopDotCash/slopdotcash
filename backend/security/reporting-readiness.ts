import { validRepositoryPath } from "../../src/lib/project-contracts";
import type { ProjectDefinition } from "../../src/lib/projects.mjs";
import type { D1Database, D1QueryStatement } from "../d1";

type Database = D1Database<D1QueryStatement>;
export const REPORTING_OBSERVATION_SECONDS = 60 * 60;

export type ReportingTarget = {
  projectId: string;
  revision: number;
  repository: string;
  repositoryId: string | null;
  repositoryNodeId: string | null;
};
export type ReportingObservation =
  | {
      kind: "verified";
      enabled: boolean;
      repositoryId: string;
      repositoryNodeId: string;
    }
  | { kind: "unavailable" | "app-not-installed" | "identity-mismatch" };
export type ReportingReader = (
  target: ReportingTarget,
) => Promise<ReportingObservation>;

/** The selected repository comes from the live registry, including paused projects. */
export function reportingTarget(
  project: ProjectDefinition,
  revision: number,
): ReportingTarget {
  const selected =
    project.securityBounty?.intake.repository ?? project.repositories[0]?.id;
  const index = project.repositories.findIndex((repository) =>
    [repository.id, ...(repository.aliases ?? [])].some(
      (name) => name.toLowerCase() === selected?.toLowerCase(),
    ),
  );
  if (index < 0 || !Number.isSafeInteger(revision) || revision < 1)
    throw new Error("Reporting repository is not registered");
  const repository = project.repositories[index];
  const name = repository.githubUrl
    ? new URL(repository.githubUrl).pathname.replace(/^\/|\/$/gu, "")
    : repository.id;
  if (!validRepositoryPath(name))
    throw new Error("Invalid reporting repository");
  return {
    projectId: project.id,
    revision,
    repository: name,
    repositoryId: index === 0 ? project.authority.repositoryId : null,
    repositoryNodeId: index === 0 ? project.authority.repositoryNodeId : null,
  };
}

type Row = {
  repository_id: string | null;
  repository_node_id: string | null;
  enabled: number | null;
  verified_at: string | null;
  attempted_at: string;
  failure: Exclude<ReportingObservation["kind"], "verified"> | null;
};
async function observation(db: Database, target: ReportingTarget) {
  return db
    .prepare(`SELECT repository_id, repository_node_id, enabled, verified_at, attempted_at, failure
    FROM repository_reporting_status WHERE project_id = ? AND project_revision = ? AND repository_key = ?`)
    .bind(target.projectId, target.revision, target.repository.toLowerCase())
    .first<Row>();
}

export async function cachedReportingReadiness(
  db: Database,
  target: ReportingTarget,
  now: Date,
) {
  const row = await observation(db, target);
  const matches =
    row !== null &&
    (target.repositoryId === null ||
      row.repository_id === target.repositoryId) &&
    (target.repositoryNodeId === null ||
      row.repository_node_id === target.repositoryNodeId);
  const age = row?.verified_at
    ? now.getTime() - Date.parse(row.verified_at)
    : NaN;
  const known =
    matches &&
    (row.enabled === 0 || row.enabled === 1) &&
    Number.isFinite(age) &&
    age >= 0;
  const stale =
    !known ||
    row.failure !== null ||
    age >= REPORTING_OBSERVATION_SECONDS * 1000;
  return {
    state: known
      ? row.enabled === 1
        ? ("ready" as const)
        : ("disabled" as const)
      : ("unavailable" as const),
    checkedAt: known ? row.verified_at : null,
    stale,
    failure: row?.failure ?? null,
    maxAgeSeconds: stale
      ? 0
      : Math.max(0, Math.floor(REPORTING_OBSERVATION_SECONDS - age / 1000)),
  };
}

/** Preserve successful bytes and identity on a failed refresh, including revocation. */
export async function refreshReportingObservation(
  db: Database,
  target: ReportingTarget,
  read: ReportingReader,
  now: Date,
) {
  let result: ReportingObservation;
  try {
    result = await read(target);
  } catch {
    result = { kind: "unavailable" };
  }
  if (
    result.kind === "verified" &&
    (!/^[1-9]\d*$/u.test(result.repositoryId) ||
      !/^[A-Za-z0-9_=-]{4,256}$/u.test(result.repositoryNodeId) ||
      (target.repositoryId !== null &&
        result.repositoryId !== target.repositoryId) ||
      (target.repositoryNodeId !== null &&
        result.repositoryNodeId !== target.repositoryNodeId))
  )
    result = { kind: "identity-mismatch" };
  const verified = result.kind === "verified" ? result : null;
  const at = now.toISOString();
  // The identity check is part of the write, so simultaneous first observations
  // cannot replace the immutable identity of a secondary registered repository.
  const sameIdentity = `(repository_reporting_status.repository_id IS NULL OR
    excluded.repository_id IS NULL OR
    (repository_reporting_status.repository_id = excluded.repository_id AND
     repository_reporting_status.repository_node_id = excluded.repository_node_id))`;
  await db
    .prepare(`INSERT INTO repository_reporting_status
    (project_id, project_revision, repository_key, repository_id, repository_node_id, enabled, verified_at, attempted_at, failure)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, project_revision, repository_key) DO UPDATE SET
      repository_id = COALESCE(repository_reporting_status.repository_id, excluded.repository_id),
      repository_node_id = COALESCE(repository_reporting_status.repository_node_id, excluded.repository_node_id),
      enabled = CASE WHEN ${sameIdentity} THEN COALESCE(excluded.enabled, repository_reporting_status.enabled)
        ELSE repository_reporting_status.enabled END,
      verified_at = CASE WHEN ${sameIdentity} THEN COALESCE(excluded.verified_at, repository_reporting_status.verified_at)
        ELSE repository_reporting_status.verified_at END,
      attempted_at = excluded.attempted_at,
      failure = CASE WHEN ${sameIdentity} THEN excluded.failure ELSE 'identity-mismatch' END
    WHERE excluded.attempted_at > repository_reporting_status.attempted_at`)
    .bind(
      target.projectId,
      target.revision,
      target.repository.toLowerCase(),
      verified?.repositoryId ?? null,
      verified?.repositoryNodeId ?? null,
      verified ? Number(verified.enabled) : null,
      verified ? at : null,
      at,
      result.kind === "verified" ? null : result.kind,
    )
    .run();
  if (result.kind === "verified") {
    const stored = await observation(db, target);
    if (
      stored?.repository_id !== result.repositoryId ||
      stored.repository_node_id !== result.repositoryNodeId
    )
      return { kind: "identity-mismatch" } as const;
  }
  return result;
}
