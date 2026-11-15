/**
 * Merge activity per registered repository (#1993, operator decision of
 * 15 November 2026). Once a day the Slopbot schedule reads public GitHub facts
 * for each repository of an active project and stores them in D1:
 *
 * - when the repository last merged a pull request;
 * - outside pull requests (author is not an owner, member or collaborator,
 *   and not a bot; drafts left out) open seven days or more with no review or
 *   comment from anyone who can merge;
 * - the median time to merge of outside pull requests merged in the last 30
 *   days.
 *
 * Project pages read the stored rows through `GET /api/v1/merge-activity`;
 * they never read GitHub per page view (PRD section 9). A failed read keeps
 * the last values with their date. Nothing here writes to GitHub.
 */

import { validRepositoryPath } from "../../src/lib/project-contracts";
import type { ProjectDefinition } from "../../src/lib/projects.mjs";
import type { D1Database, D1QueryStatement } from "../d1";
import { apiErrorResponse, json } from "../http";

type Database = D1Database<D1QueryStatement>;

export const MERGE_ACTIVITY_PATH = "/api/v1/merge-activity";
const CACHE_CONTROL = "public, max-age=300";
const DAY_MS = 24 * 60 * 60 * 1000;
export const WAITING_DAYS = 7;
export const MEDIAN_WINDOW_DAYS = 30;
/** A repository is read again after this long; failures retry after an hour. */
const REFRESH_AFTER_MS = 20 * 60 * 60 * 1000;
const RETRY_AFTER_MS = 60 * 60 * 1000;
/** Repositories read per scheduled run, so one run stays short. */
export const REPOSITORIES_PER_RUN = 15;
const OPEN_PAGE = 50;
const OPEN_PAGES = 6;
const MERGED_PAGE = 100;
const MERGED_PAGES = 3;
const MAINTAINER = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

export type OpenPull = {
  createdAt: string;
  isDraft: boolean;
  outside: boolean;
  maintainerResponded: boolean;
};
export type MergedPull = {
  createdAt: string;
  mergedAt: string;
  outside: boolean;
};

export type MergeActivity = {
  lastMergedAt: string | null;
  waitingOutside: number;
  waitingCapped: boolean;
  mergedOutside30d: number;
  medianMergeHours: number | null;
};

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Pure summary of one repository's pull requests at `now`. */
export function summarizeMergeActivity(
  open: readonly OpenPull[],
  openCapped: boolean,
  merged: readonly MergedPull[],
  latestMergedAt: string | null,
  now: Date,
): MergeActivity {
  const waitingBefore = now.getTime() - WAITING_DAYS * DAY_MS;
  const windowStart = now.getTime() - MEDIAN_WINDOW_DAYS * DAY_MS;
  const waitingOutside = open.filter(
    (pull) =>
      pull.outside &&
      !pull.isDraft &&
      !pull.maintainerResponded &&
      Date.parse(pull.createdAt) <= waitingBefore,
  ).length;
  const recent = merged.filter(
    (pull) => pull.outside && Date.parse(pull.mergedAt) >= windowStart,
  );
  const hours = recent
    .map(
      (pull) =>
        (Date.parse(pull.mergedAt) - Date.parse(pull.createdAt)) / 3_600_000,
    )
    .filter((value) => Number.isFinite(value) && value >= 0);
  let lastMergedAt = latestMergedAt;
  for (const pull of merged)
    if (lastMergedAt === null || pull.mergedAt > lastMergedAt)
      lastMergedAt = pull.mergedAt;
  return {
    lastMergedAt,
    waitingOutside,
    waitingCapped: openCapped,
    mergedOutside30d: recent.length,
    medianMergeHours: median(hours),
  };
}

type Actor = { __typename?: string } | null;
type Associated = { authorAssociation?: string; author?: Actor };

function outsideAuthor(node: Associated): boolean {
  return (
    node.author?.__typename !== "Bot" &&
    !MAINTAINER.has(String(node.authorAssociation ?? ""))
  );
}

function maintainerNode(node: Associated): boolean {
  return (
    node.author?.__typename !== "Bot" &&
    MAINTAINER.has(String(node.authorAssociation ?? ""))
  );
}

const OPEN_QUERY = `query($owner:String!,$name:String!,$after:String){
  repository(owner:$owner,name:$name){
    pullRequests(states:OPEN,first:${OPEN_PAGE},after:$after,orderBy:{field:CREATED_AT,direction:ASC}){
      pageInfo{hasNextPage endCursor}
      nodes{createdAt isDraft authorAssociation author{__typename}
        reviews(first:40){nodes{authorAssociation author{__typename}}}
        comments(first:60){nodes{authorAssociation author{__typename}}}}
    }
    latest:pullRequests(states:MERGED,first:10,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{mergedAt}}
  }
}`;

const MERGED_QUERY = `query($q:String!,$after:String){
  search(query:$q,type:ISSUE,first:${MERGED_PAGE},after:$after){
    pageInfo{hasNextPage endCursor}
    nodes{... on PullRequest{createdAt mergedAt authorAssociation author{__typename}}}
  }
}`;

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

async function graphql<T>(
  fetcher: Fetch,
  token: string,
  query: string,
  variables: Record<string, string | null>,
): Promise<T> {
  const response = await fetcher("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "user-agent": "slop.cash-merge-activity",
    },
    body: JSON.stringify({ query, variables }),
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`github-${response.status}`);
  }
  const body = (await response.json()) as { data?: T; errors?: unknown };
  if (!body?.data || body.errors) throw new Error("github-graphql-error");
  return body.data;
}

/** Reads one public repository's pull request facts. Throws on any failure. */
export async function readMergeActivity(
  fetcher: Fetch,
  token: string,
  repository: string,
  now: Date,
): Promise<MergeActivity> {
  const [owner, name] = repository.split("/");
  const waitingBefore = now.getTime() - WAITING_DAYS * DAY_MS;
  const open: OpenPull[] = [];
  let latestMergedAt: string | null = null;
  let after: string | null = null;
  let openCapped = false;
  for (let page = 0; page < OPEN_PAGES; page += 1) {
    type OpenData = {
      repository: {
        pullRequests: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: Array<
            Associated & {
              createdAt: string;
              isDraft: boolean;
              reviews: { nodes: Associated[] };
              comments: { nodes: Associated[] };
            }
          >;
        };
        latest: { nodes: Array<{ mergedAt: string | null }> };
      } | null;
    };
    const data: OpenData = await graphql<OpenData>(fetcher, token, OPEN_QUERY, {
      owner,
      name,
      after,
    });
    if (!data.repository) throw new Error("github-repository-missing");
    if (page === 0)
      for (const node of data.repository.latest.nodes)
        if (
          node.mergedAt &&
          (latestMergedAt === null || node.mergedAt > latestMergedAt)
        )
          latestMergedAt = node.mergedAt;
    const connection = data.repository.pullRequests;
    let reachedRecent = false;
    for (const node of connection.nodes) {
      if (Date.parse(node.createdAt) > waitingBefore) reachedRecent = true;
      open.push({
        createdAt: node.createdAt,
        isDraft: node.isDraft,
        outside: outsideAuthor(node),
        maintainerResponded:
          node.reviews.nodes.some(maintainerNode) ||
          node.comments.nodes.some(maintainerNode),
      });
    }
    // Oldest first: once a page reaches pull requests newer than seven days,
    // the rest cannot be waiting.
    if (!connection.pageInfo.hasNextPage || reachedRecent) break;
    if (page === OPEN_PAGES - 1) openCapped = true;
    after = connection.pageInfo.endCursor;
  }
  const since = new Date(now.getTime() - MEDIAN_WINDOW_DAYS * DAY_MS)
    .toISOString()
    .slice(0, 10);
  const merged: MergedPull[] = [];
  after = null;
  for (let page = 0; page < MERGED_PAGES; page += 1) {
    type MergedData = {
      search: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: Array<
          Associated & { createdAt?: string; mergedAt?: string | null }
        >;
      };
    };
    const data: MergedData = await graphql<MergedData>(
      fetcher,
      token,
      MERGED_QUERY,
      {
        q: `repo:${repository} is:pr is:merged merged:>=${since} sort:updated-desc`,
        after,
      },
    );
    for (const node of data.search.nodes)
      if (node.createdAt && node.mergedAt)
        merged.push({
          createdAt: node.createdAt,
          mergedAt: node.mergedAt,
          outside: outsideAuthor(node),
        });
    if (!data.search.pageInfo.hasNextPage) break;
    after = data.search.pageInfo.endCursor;
  }
  return summarizeMergeActivity(open, openCapped, merged, latestMergedAt, now);
}

/** Repository paths of an active, listed project, in registry order. */
export function measuredRepositories(project: ProjectDefinition): string[] {
  if (project.status !== "active" || project.listingTier === "retired")
    return [];
  return project.repositories
    .map((repository) =>
      repository.githubUrl
        ? new URL(repository.githubUrl).pathname.replace(/^\/|\/$/gu, "")
        : repository.id,
    )
    .filter(validRepositoryPath);
}

type StoredRow = {
  project_id: string;
  repository: string;
  observed_at: string | null;
  attempted_at: string;
  failure: string | null;
  last_merged_at: string | null;
  waiting_outside: number | null;
  waiting_capped: number | null;
  merged_outside_30d: number | null;
  median_merge_hours: number | null;
};

/** True when the repository is due: never read, stale, or a failure an hour old. */
export function due(row: StoredRow | undefined, now: Date): boolean {
  if (!row) return true;
  const attempted = Date.parse(row.attempted_at);
  if (row.failure !== null) return now.getTime() - attempted >= RETRY_AFTER_MS;
  return now.getTime() - attempted >= REFRESH_AFTER_MS;
}

/**
 * Reads up to `REPOSITORIES_PER_RUN` due repositories and stores the results.
 * Never throws for a GitHub failure: that repository records the failure and
 * keeps its last values.
 */
export async function refreshMergeActivity(
  db: Database,
  projects: readonly ProjectDefinition[],
  tokenFor: (repository: string) => Promise<string | null>,
  fetcher: Fetch,
  now: Date,
): Promise<{ read: number; failed: number }> {
  const { results } = await db
    .prepare(
      "SELECT project_id, repository, observed_at, attempted_at, failure FROM repository_merge_activity",
    )
    .all<StoredRow>();
  const stored = new Map(
    (results ?? []).map((row) => [`${row.project_id}\n${row.repository}`, row]),
  );
  const queue: Array<{ projectId: string; repository: string; since: number }> =
    [];
  for (const project of projects)
    for (const repository of measuredRepositories(project)) {
      const row = stored.get(`${project.id}\n${repository}`);
      if (due(row, now))
        queue.push({
          projectId: project.id,
          repository,
          since: row ? Date.parse(row.attempted_at) : 0,
        });
    }
  queue.sort((a, b) => a.since - b.since);
  let read = 0;
  let failed = 0;
  for (const item of queue.slice(0, REPOSITORIES_PER_RUN)) {
    const at = now.toISOString();
    try {
      const token = await tokenFor(item.repository);
      if (token === null) throw new Error("app-not-installed");
      const activity = await readMergeActivity(
        fetcher,
        token,
        item.repository,
        now,
      );
      await db
        .prepare(
          `INSERT INTO repository_merge_activity
             (project_id, repository, observed_at, attempted_at, failure,
              last_merged_at, waiting_outside, waiting_capped,
              merged_outside_30d, median_merge_hours)
           VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
           ON CONFLICT (project_id, repository) DO UPDATE SET
             observed_at = excluded.observed_at,
             attempted_at = excluded.attempted_at,
             failure = NULL,
             last_merged_at = excluded.last_merged_at,
             waiting_outside = excluded.waiting_outside,
             waiting_capped = excluded.waiting_capped,
             merged_outside_30d = excluded.merged_outside_30d,
             median_merge_hours = excluded.median_merge_hours`,
        )
        .bind(
          item.projectId,
          item.repository,
          at,
          at,
          activity.lastMergedAt,
          activity.waitingOutside,
          activity.waitingCapped ? 1 : 0,
          activity.mergedOutside30d,
          activity.medianMergeHours,
        )
        .run();
      read += 1;
    } catch (caught) {
      const failure =
        caught instanceof Error && /^[a-z0-9-]{1,40}$/u.test(caught.message)
          ? caught.message
          : "read-failed";
      await db
        .prepare(
          `INSERT INTO repository_merge_activity
             (project_id, repository, attempted_at, failure)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (project_id, repository) DO UPDATE SET
             attempted_at = excluded.attempted_at,
             failure = excluded.failure`,
        )
        .bind(item.projectId, item.repository, at, failure)
        .run();
      failed += 1;
    }
  }
  return { read, failed };
}

/** `GET /api/v1/merge-activity`: every stored repository row, by project. */
export async function handleMergeActivityApi(
  request: Request,
  deps: { db: Database },
): Promise<Response | null> {
  const url = new URL(request.url);
  if (
    url.pathname !== MERGE_ACTIVITY_PATH &&
    url.pathname !== `${MERGE_ACTIVITY_PATH}/`
  )
    return null;
  if (request.method !== "GET" && request.method !== "HEAD")
    return json(
      405,
      { error: "method_not_allowed" },
      { cacheControl: CACHE_CONTROL },
    );
  try {
    const { results } = await deps.db
      .prepare(
        `SELECT project_id, repository, observed_at, attempted_at, failure,
                last_merged_at, waiting_outside, waiting_capped,
                merged_outside_30d, median_merge_hours
           FROM repository_merge_activity
          WHERE observed_at IS NOT NULL
          ORDER BY project_id, repository`,
      )
      .all<StoredRow>();
    const projects = new Map<string, unknown[]>();
    for (const row of results ?? []) {
      const list = projects.get(row.project_id) ?? [];
      list.push({
        repository: row.repository,
        observedAt: row.observed_at,
        lastAttemptFailed: row.failure !== null,
        lastMergedAt: row.last_merged_at,
        waitingOutside: row.waiting_outside,
        waitingCapped: row.waiting_capped === 1,
        mergedOutsideLast30Days: row.merged_outside_30d,
        medianHoursToMerge: row.median_merge_hours,
      });
      projects.set(row.project_id, list);
    }
    return json(
      200,
      {
        schema: "slop-merge-activity-v1",
        waitingDays: WAITING_DAYS,
        medianWindowDays: MEDIAN_WINDOW_DAYS,
        projects: [...projects].map(([projectId, repositories]) => ({
          projectId,
          repositories,
        })),
      },
      { cacheControl: CACHE_CONTROL },
    );
  } catch (caught) {
    return apiErrorResponse(caught, { label: "merge activity API failure" });
  }
}
