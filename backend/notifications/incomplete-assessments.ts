/** Current maintainer/admin Inbox list for ordinary PR source gaps (PRD 7). */
import type { IncompleteAssessments } from "../../src/lib/incomplete-assessments";
import type { GithubActor } from "../../src/lib/project-contracts";
import { assertProjectDefinition } from "../../src/lib/project-schema.mjs";
import type { D1Database, D1QueryStatement } from "../d1";
import { fail, json } from "../http";
import {
  currentRepositoryPath,
  type RepositoryAccessReader,
} from "../projects/setup";

type Dependencies = {
  db: D1Database<D1QueryStatement>;
  adminGithubIds?: ReadonlySet<string>;
  repositoryAccess?: RepositoryAccessReader;
};
type Context = {
  project_id: string;
  revision: number;
  manifest: string;
  repository_id: number;
  owner: string;
  repo: string;
};
type Row = {
  project_id: string;
  repository_id: number;
  pull_request_number: number;
  since: string;
  retry_at: string | null;
  running: number;
};

export async function readIncompleteAssessments(
  request: Request,
  deps: Dependencies,
  actor: { githubId: string; githubLogin?: string },
) {
  const rawCursor = new URL(request.url).searchParams.get("after");
  let cursor: [string, number, number] | null = null;
  if (rawCursor !== null) {
    try {
      const value = JSON.parse(rawCursor);
      if (
        rawCursor.length > 1000 ||
        !Array.isArray(value) ||
        value.length !== 3 ||
        typeof value[0] !== "string" ||
        !/^[a-z0-9-]+$/u.test(value[0]) ||
        !value
          .slice(1)
          .every((number) => Number.isSafeInteger(number) && number > 0)
      )
        throw new Error();
      cursor = value as [string, number, number];
    } catch {
      fail(400, "invalid_cursor", "Invalid assessment page.");
    }
  }
  // The marker survives claims and transient failures. Existing terminal
  // outcomes clear it; attempts-exhausted remains an incomplete assessment.
  const source = `
    FROM slopbot_value_processing p
    JOIN slopbot_value_requests r ON r.delivery_id=p.delivery_id
    JOIN project_repositories registry ON registry.repository_key=lower(r.owner || '/' || r.repo)
    JOIN projects project ON project.id=registry.project_id
    WHERE p.incomplete_since IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM slopbot_value_requests resolved
        JOIN slopbot_value_processing done ON done.delivery_id=resolved.delivery_id
        WHERE resolved.repository_id=r.repository_id AND resolved.pull_request_number=r.pull_request_number
          AND done.state='completed' AND done.outcome IN ('published','current','open','historical','missing')
          AND done.updated_at >= p.incomplete_since)`;
  const contexts = await deps.db
    .prepare(`SELECT DISTINCT project.id AS project_id,
    project.revision,project.manifest,r.repository_id,r.owner,r.repo ${source}`)
    .all<Context>();
  const admin = deps.adminGithubIds?.has(actor.githubId) === true;
  const checked = new Set<string>();
  const allowed = new Map<
    string,
    {
      projectId: string;
      projectName: string;
      repository: string;
      repositoryId: number;
    }
  >();
  const manifests = new Map<string, string>();
  for (const row of contexts.results) {
    const manifest = assertProjectDefinition(JSON.parse(row.manifest));
    const original = `${row.owner}/${row.repo}`.toLowerCase();
    const index = manifest.repositories.findIndex((repository) =>
      [
        repository.id,
        currentRepositoryPath(repository),
        ...(repository.aliases ?? []),
      ].some((name) => name.toLowerCase() === original),
    );
    if (
      index < 0 ||
      (index === 0 &&
        String(row.repository_id) !== manifest.authority.repositoryId)
    )
      continue;
    const repository = currentRepositoryPath(manifest.repositories[index]);
    const scope = `${manifest.id}:${row.repository_id}`;
    if (!checked.has(scope)) {
      let access = admin;
      if (!admin) {
        if (!deps.repositoryAccess || !actor.githubLogin)
          fail(
            503,
            "github_unavailable",
            "Maintainer access could not be checked.",
          );
        try {
          const result = await deps.repositoryAccess(
            { path: repository, githubId: String(row.repository_id) },
            actor as GithubActor,
          );
          if (
            result.installation !== "installed" ||
            !result.repository ||
            result.repository.id !== row.repository_id ||
            result.repository.full_name.toLowerCase() !==
              repository.toLowerCase()
          )
            fail(
              503,
              "github_unavailable",
              "Repository identity could not be checked.",
            );
          access =
            (result.permission === "admin" || result.permission === "write") &&
            result.repository.private === false;
        } catch {
          fail(
            503,
            "github_unavailable",
            "Maintainer access could not be checked.",
          );
        }
      }
      checked.add(scope);
      if (access) {
        allowed.set(scope, {
          projectId: manifest.id,
          projectName: manifest.name,
          repository,
          repositoryId: row.repository_id,
        });
        manifests.set(row.project_id, row.manifest);
      }
    }
  }
  const rows = await deps.db
    .prepare(`SELECT project.id AS project_id,r.repository_id,r.pull_request_number,
    MIN(p.incomplete_since) AS since,MIN(p.retry_at) AS retry_at,
    EXISTS(SELECT 1 FROM slopbot_value_requests current
      JOIN slopbot_value_processing active ON active.delivery_id=current.delivery_id
      WHERE current.repository_id=r.repository_id AND current.pull_request_number=r.pull_request_number
        AND active.state='running') AS running
    ${source}
    AND EXISTS(SELECT 1 FROM json_each(?1) scope
      WHERE json_extract(scope.value,'$[0]')=project.id AND json_extract(scope.value,'$[1]')=r.repository_id)
    AND (?2 IS NULL OR project.id > ?2 OR (project.id=?2 AND
      (r.repository_id > ?3 OR (r.repository_id=?3 AND r.pull_request_number > ?4))))
    GROUP BY project.id,r.repository_id,r.pull_request_number
    ORDER BY project.id COLLATE BINARY,r.repository_id,r.pull_request_number LIMIT 26`)
    .bind(
      JSON.stringify(
        [...allowed.values()].map((item) => [
          item.projectId,
          item.repositoryId,
        ]),
      ),
      cursor?.[0] ?? null,
      cursor?.[1] ?? 0,
      cursor?.[2] ?? 0,
    )
    .all<Row>();
  const page = rows.results.slice(0, 25);
  const items = page.map((row) => {
    const context = allowed.get(`${row.project_id}:${row.repository_id}`);
    if (!context) throw new Error("Assessment context changed");
    return {
      projectId: context.projectId,
      projectName: context.projectName,
      repository: context.repository,
      pullRequest: row.pull_request_number,
      since: row.since,
      retryAt: row.retry_at,
      running: row.running === 1,
    };
  });
  const last = page.at(-1);
  const next =
    rows.results.length > 25 && last
      ? JSON.stringify([
          last.project_id,
          last.repository_id,
          last.pull_request_number,
        ])
      : null;
  // An authority read must not expose a superseded project binding.
  for (const [id, manifest] of manifests) {
    const current = await deps.db
      .prepare("SELECT manifest FROM projects WHERE id=?")
      .bind(id)
      .first<{ manifest: string }>();
    if (current?.manifest !== manifest)
      fail(503, "project_changed", "Project access changed. Retry.");
  }
  return {
    recipientGithubId: actor.githubId,
    items,
    next,
  } satisfies IncompleteAssessments;
}

export async function incompleteAssessments(
  request: Request,
  deps: Dependencies,
  actor: { githubId: string; githubLogin?: string },
) {
  return json(200, await readIncompleteAssessments(request, deps, actor));
}
