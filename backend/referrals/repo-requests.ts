/**
 * Requested repos (PRD section 11, "Referral program"; operator decision,
 * 22 November 2026). A signed-in member with merged work on Slop flags a
 * public GitHub repository that is not on Slop as one they would work on.
 * Anyone can then pitch the maintainer with the count and their own referral
 * link; capture and referral credit are unchanged.
 *
 * `GET /api/v1/repo-requests` is public: repositories with at least one
 * active flag, the count, the newest flag date, never who flagged. A signed-in
 * viewer also gets their own flags. `POST` flags, renews or withdraws one.
 *
 * Only accounts with merged accepted work may flag: a head Points revision
 * (no successor) crediting the member with a merged pull request of positive
 * amount. Team accounts may not flag. A repository is read on GitHub once per
 * flag: public, not a fork, not archived, not the member's own, not already
 * on Slop (the project registry, matched by GitHub id or listed name). Slop
 * never writes to GitHub for a flag.
 */

import type { ProjectRecord } from "../../src/lib/project-contracts";
import {
  type MyRepoRequest,
  REPO_PATH_RULE,
  REPO_REQUEST_BOARD_LIMIT,
  REPO_REQUEST_DAYS,
  REPO_REQUEST_LIMIT,
  REPO_REQUESTS_API,
  type RepoRequestAnswer,
  type RepoRequestBoard,
  type RequestedRepo,
  validRepoPath,
} from "../../src/lib/repo-requests";
import type { D1Database, D1QueryStatement } from "../d1";
import {
  apiErrorResponse,
  exactKeys,
  fail,
  isSameOriginJsonWrite,
  json,
  requireActor,
  requireJsonObject,
} from "../http";
import { repositoryIdentity } from "../projects/enforcement";
import { type GithubFetch, githubJson } from "../projects/github-lookup";

const MAX_BODY_BYTES = 1024;
const DAY_MS = 86_400_000;
const PUBLIC_CACHE = "public, max-age=300";

type Actor = { githubId: string; githubLogin: string };

type RepoRequestDependencies = {
  db: D1Database<D1QueryStatement>;
  sessionActor(request: Request): Promise<Actor | null>;
  /** Administrators and moderators: never counted as demand. */
  teamGithubIds: ReadonlySet<string>;
  /** The D1 project registry, the only listed-repository source. */
  projects: { listProjects(): Promise<ProjectRecord[]> };
  github: { fetch: GithubFetch; token: string | undefined; apiOrigin: string };
  now: () => Date;
};

/** The listed project that holds a repository, by GitHub id or listed name. */
export function listedProjectFor(
  projects: readonly ProjectRecord[],
  repoId: string,
  fullName: string,
): string | null {
  const path = fullName.toLowerCase();
  for (const project of projects) {
    const identity = repositoryIdentity(project.manifest);
    if (identity.githubIds.includes(repoId) || identity.keys.includes(path))
      return project.id;
  }
  return null;
}

/** True when the member has at least one current merged-work award. */
async function hasMergedWork(
  db: RepoRequestDependencies["db"],
  githubId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT EXISTS (
         SELECT 1 FROM points_members m
           JOIN points_revisions r
             ON json_extract(r.payload, '$.award.actor.id') = m.actor_id
          WHERE m.github_id = ?
            AND json_extract(r.payload, '$.award.category') = 'merged-pull-request'
            AND json_extract(r.payload, '$.award.amount') > 0
            AND NOT EXISTS (
              SELECT 1 FROM points_revisions s WHERE s.previous = r.id)
       ) AS ok`,
    )
    .bind(githubId)
    .first<{ ok: number }>();
  return row?.ok === 1;
}

type GithubRepo = {
  id: string;
  fullName: string;
  ownerId: string;
  ownerLogin: string;
};

async function readRepository(
  deps: RepoRequestDependencies,
  path: string,
): Promise<GithubRepo> {
  let repo: Record<string, unknown> | null;
  try {
    repo = await githubJson(
      deps.github.fetch,
      deps.github.token,
      `/repos/${path}`,
      deps.github.apiOrigin,
    );
  } catch {
    fail(503, "github_unavailable", "GitHub did not answer. Try again.");
  }
  if (repo === null || repo.private !== false)
    fail(422, "not_found", "GitHub has no public repository with that name.");
  const owner = repo.owner as Record<string, unknown> | undefined;
  if (
    !Number.isSafeInteger(repo.id) ||
    Number(repo.id) <= 0 ||
    !validRepoPath(repo.full_name) ||
    typeof repo.fork !== "boolean" ||
    typeof repo.archived !== "boolean" ||
    !owner ||
    !Number.isSafeInteger(owner.id) ||
    typeof owner.login !== "string"
  )
    fail(
      503,
      "github_unavailable",
      "GitHub returned incomplete repository facts. Try again.",
    );
  if (repo.fork)
    fail(
      422,
      "fork",
      "That repository is a fork. Flag the original repository.",
    );
  if (repo.archived) fail(422, "archived", "That repository is archived.");
  return {
    id: String(repo.id),
    fullName: repo.full_name as string,
    ownerId: String(owner.id),
    ownerLogin: owner.login,
  };
}

async function activeCount(
  db: RepoRequestDependencies["db"],
  repoId: string,
  now: string,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT count(*) AS n FROM repo_requests
        WHERE repo_id = ? AND withdrawn_at IS NULL AND expires_at > ?`,
    )
    .bind(repoId, now)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function flag(
  deps: RepoRequestDependencies,
  actor: Actor,
  path: string,
  origin: string,
): Promise<RepoRequestAnswer> {
  if (deps.teamGithubIds.has(actor.githubId))
    fail(403, "team_account", "Slop team accounts cannot flag repos.");
  if (!(await hasMergedWork(deps.db, actor.githubId)))
    fail(
      403,
      "no_merged_work",
      "Flag a repo after your first pull request is merged on a Slop project.",
    );
  const at = deps.now();
  const now = at.toISOString();
  const limitReached = `You already flag ${REPO_REQUEST_LIMIT} repos. Withdraw one first.`;
  // Refuse before reading GitHub when the account is at its limit and this
  // is not one of its active flags; the write below checks again.
  const held = await deps.db
    .prepare(
      `SELECT count(*) AS n,
              sum(lower(full_name) = lower(?)) AS same
         FROM repo_requests
        WHERE github_id = ? AND withdrawn_at IS NULL AND expires_at > ?`,
    )
    .bind(path, actor.githubId, now)
    .first<{ n: number; same: number | null }>();
  if ((held?.n ?? 0) >= REPO_REQUEST_LIMIT && !(held?.same ?? 0))
    fail(409, "request_limit", limitReached);
  const repo = await readRepository(deps, path);
  const listedAs = listedProjectFor(
    await deps.projects.listProjects(),
    repo.id,
    repo.fullName,
  );
  if (listedAs !== null)
    fail(
      409,
      "already_listed",
      `${repo.fullName} is already on Slop. See ${origin}/projects/${listedAs}.`,
    );
  if (
    repo.ownerId === actor.githubId ||
    repo.ownerLogin.toLowerCase() === actor.githubLogin.toLowerCase()
  )
    fail(409, "own_repo", "You cannot flag your own repository.");
  const expiresAt = new Date(
    at.getTime() + REPO_REQUEST_DAYS * DAY_MS,
  ).toISOString();
  // One statement: insert or renew only while the account stays inside its
  // limit, counting its other active flags.
  const written = await deps.db
    .prepare(
      `INSERT INTO repo_requests
         (repo_id, github_id, full_name, created_at, flagged_at, expires_at, withdrawn_at)
       SELECT ?, ?, ?, ?, ?, ?, NULL
        WHERE (SELECT count(*) FROM repo_requests
                WHERE github_id = ? AND repo_id <> ?
                  AND withdrawn_at IS NULL AND expires_at > ?) < ?
       ON CONFLICT (repo_id, github_id) DO UPDATE SET
         full_name = excluded.full_name,
         flagged_at = excluded.flagged_at,
         expires_at = excluded.expires_at,
         withdrawn_at = NULL`,
    )
    .bind(
      repo.id,
      actor.githubId,
      repo.fullName,
      now,
      now,
      expiresAt,
      actor.githubId,
      repo.id,
      now,
      REPO_REQUEST_LIMIT,
    )
    .run();
  if ((written.meta?.changes ?? 0) === 0)
    fail(409, "request_limit", limitReached);
  return {
    repo: repo.fullName,
    count: await activeCount(deps.db, repo.id, now),
    flagged: true,
    expiresAt,
  };
}

async function withdraw(
  deps: RepoRequestDependencies,
  actor: Actor,
  path: string,
): Promise<RepoRequestAnswer> {
  const now = deps.now().toISOString();
  const row = await deps.db
    .prepare(
      `SELECT repo_id, full_name FROM repo_requests
        WHERE github_id = ? AND lower(full_name) = lower(?)
          AND withdrawn_at IS NULL AND expires_at > ?`,
    )
    .bind(actor.githubId, path, now)
    .first<{ repo_id: string; full_name: string }>();
  if (row === null)
    fail(404, "not_flagged", "You do not flag that repository.");
  await deps.db
    .prepare(
      `UPDATE repo_requests SET withdrawn_at = ?
        WHERE repo_id = ? AND github_id = ? AND withdrawn_at IS NULL`,
    )
    .bind(now, row.repo_id, actor.githubId)
    .run();
  return {
    repo: row.full_name,
    count: await activeCount(deps.db, row.repo_id, now),
    flagged: false,
    expiresAt: null,
  };
}

async function board(
  deps: RepoRequestDependencies,
  actor: Actor | null,
): Promise<RepoRequestBoard> {
  const now = deps.now().toISOString();
  const projects = await deps.projects.listProjects();
  const listedIds = new Set(
    projects.flatMap(
      (project) => repositoryIdentity(project.manifest).githubIds,
    ),
  );
  const { results } = await deps.db
    .prepare(
      `SELECT r.repo_id, count(*) AS n, max(r.flagged_at) AS newest,
              (SELECT full_name FROM repo_requests l
                WHERE l.repo_id = r.repo_id
                ORDER BY l.flagged_at DESC, l.github_id LIMIT 1) AS full_name
         FROM repo_requests r
        WHERE r.withdrawn_at IS NULL AND r.expires_at > ?
        GROUP BY r.repo_id
        ORDER BY n DESC, newest DESC, r.repo_id
        LIMIT ?`,
    )
    .bind(now, REPO_REQUEST_BOARD_LIMIT + listedIds.size)
    .all<{ repo_id: string; n: number; newest: string; full_name: string }>();
  const repos: RequestedRepo[] = results
    .filter(
      (row) => listedProjectFor(projects, row.repo_id, row.full_name) === null,
    )
    .slice(0, REPO_REQUEST_BOARD_LIMIT)
    .map((row) => ({
      repo: row.full_name,
      count: row.n,
      newestAt: row.newest,
    }));
  let mine: MyRepoRequest[] | null = null;
  if (actor !== null) {
    const own = await deps.db
      .prepare(
        `SELECT repo_id, full_name, expires_at FROM repo_requests
          WHERE github_id = ? AND withdrawn_at IS NULL AND expires_at > ?
          ORDER BY flagged_at DESC, repo_id`,
      )
      .bind(actor.githubId, now)
      .all<{ repo_id: string; full_name: string; expires_at: string }>();
    mine = own.results.map((row) => ({
      repo: row.full_name,
      expiresAt: row.expires_at,
      listedAs: listedProjectFor(projects, row.repo_id, row.full_name),
    }));
  }
  return { repos, mine };
}

export async function handleRepoRequests(
  request: Request,
  deps: RepoRequestDependencies,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== REPO_REQUESTS_API) return null;
  if (request.method === "GET" || request.method === "HEAD") {
    try {
      const actor = await deps.sessionActor(request);
      return json(200, await board(deps, actor), {
        cacheControl: actor === null ? PUBLIC_CACHE : "private, no-store",
        headers: { vary: "cookie" },
      });
    } catch (caught) {
      return apiErrorResponse(caught, { label: "repo requests read failure" });
    }
  }
  if (request.method !== "POST" || !isSameOriginJsonWrite(request))
    return json(403, { error: "origin_forbidden" });
  try {
    const actor = await requireActor(request, deps);
    const body = await requireJsonObject(
      request,
      MAX_BODY_BYTES,
      "Repo request",
    );
    exactKeys(body, ["repo", "action"]);
    if (body.action !== "flag" && body.action !== "withdraw")
      fail(400, "invalid_request", "Action must be flag or withdraw.");
    if (!validRepoPath(body.repo)) fail(422, "invalid_repo", REPO_PATH_RULE);
    return json(
      200,
      body.action === "flag"
        ? await flag(deps, actor, body.repo, new URL(request.url).origin)
        : await withdraw(deps, actor, body.repo),
    );
  } catch (caught) {
    return apiErrorResponse(caught, {
      label: "repo requests API failure",
      publicMessage: (_status, error) => error.code === "github_unavailable",
    });
  }
}
