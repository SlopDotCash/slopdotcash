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
 *
 * The same read also counts every open outside pull request, answered or
 * not, for a maintainer's intake cap (operator decision, 17 November 2026;
 * `src/lib/intake-cap.mjs`). A project with an intake cap is read at every
 * hourly run instead of once a day, so its pause follows the queue.
 *
 * For a project with a wanted label (operator decision, 21 November 2026;
 * `src/lib/wanted-label.mjs`) the read also lists the open issues that carry
 * the label, and Slopbot creates the label on the repository once if it is
 * missing. That label creation is the only GitHub write here. Such a project
 * is read every six hours so its list follows the maintainers' labelling.
 */

import { type IntakeCount, intakeCap } from "../../src/lib/intake-cap.mjs";
import { validRepositoryPath } from "../../src/lib/project-contracts";
import type { ProjectDefinition } from "../../src/lib/projects.mjs";
import {
  WANTED_ISSUES_SHOWN,
  wantedLabel,
} from "../../src/lib/wanted-label.mjs";
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
/** A project with an intake cap is read again at the next hourly run. */
const INTAKE_REFRESH_AFTER_MS = 45 * 60 * 1000;
/** A project with a wanted label is read again after six hours. */
const WANTED_REFRESH_AFTER_MS = 6 * 60 * 60 * 1000;
/** Wanted issues stored per repository, oldest first. */
const WANTED_PAGE = 20;
/** Repositories read per scheduled run, so one run stays short. */
export const REPOSITORIES_PER_RUN = 15;
const OPEN_PAGE = 50;
const OPEN_PAGES = 6;
/** Open pull requests past the waiting pages are only counted, in lighter pages. */
const COUNT_PAGE = 100;
const COUNT_PAGES = 7;
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
  /** Open outside pull requests, drafts left out, answered or not. */
  openOutside: number;
  /** More open pull requests exist than one read counts; the count is a floor. */
  openOutsideCapped: boolean;
  /** Open issues carrying the project's wanted label; null when it has none. */
  wanted: WantedIssues | null;
};

/** One open issue that carries the wanted label. */
export type WantedIssue = {
  number: number;
  title: string;
  url: string;
  /** Open pull requests GitHub links as closing this issue. */
  openPullRequests: number;
};

export type WantedIssues = { label: string; issues: WantedIssue[] };

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
  /** Open outside pull requests counted beyond `open`, and whether more remain. */
  counted: { more: number; capped: boolean } = { more: 0, capped: false },
): Omit<MergeActivity, "wanted"> {
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
    openOutside:
      open.filter((pull) => pull.outside && !pull.isDraft).length +
      counted.more,
    openOutsideCapped: counted.capped,
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

const COUNT_QUERY = `query($owner:String!,$name:String!,$after:String){
  repository(owner:$owner,name:$name){
    pullRequests(states:OPEN,first:${COUNT_PAGE},after:$after,orderBy:{field:CREATED_AT,direction:ASC}){
      pageInfo{hasNextPage endCursor}
      nodes{isDraft authorAssociation author{__typename}}
    }
  }
}`;

const WANTED_QUERY = `query($owner:String!,$name:String!,$label:String!){
  repository(owner:$owner,name:$name){
    issues(states:OPEN,labels:[$label],first:${WANTED_PAGE},orderBy:{field:CREATED_AT,direction:ASC}){
      nodes{number title url
        closedByPullRequestsReferences(first:1,includeClosedPrs:false){totalCount}}
    }
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
  label: string | null = null,
): Promise<MergeActivity> {
  const [owner, name] = repository.split("/");
  const waitingBefore = now.getTime() - WAITING_DAYS * DAY_MS;
  const open: OpenPull[] = [];
  let latestMergedAt: string | null = null;
  let after: string | null = null;
  let openCapped = false;
  let countAfter: string | null = null;
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
    if (!connection.pageInfo.hasNextPage) break;
    after = connection.pageInfo.endCursor;
    if (reachedRecent || page === OPEN_PAGES - 1) {
      if (!reachedRecent) openCapped = true;
      countAfter = after;
      break;
    }
  }
  // The rest of the open list is only counted for the intake cap.
  const counted = { more: 0, capped: false };
  for (let page = 0; countAfter !== null; page += 1) {
    if (page === COUNT_PAGES) {
      counted.capped = true;
      break;
    }
    type CountData = {
      repository: {
        pullRequests: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: Array<Associated & { isDraft: boolean }>;
        };
      } | null;
    };
    const data: CountData = await graphql<CountData>(
      fetcher,
      token,
      COUNT_QUERY,
      { owner, name, after: countAfter },
    );
    if (!data.repository) throw new Error("github-repository-missing");
    const connection = data.repository.pullRequests;
    for (const node of connection.nodes)
      if (!node.isDraft && outsideAuthor(node)) counted.more += 1;
    countAfter = connection.pageInfo.hasNextPage
      ? connection.pageInfo.endCursor
      : null;
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
  return {
    ...summarizeMergeActivity(
      open,
      openCapped,
      merged,
      latestMergedAt,
      now,
      counted,
    ),
    wanted:
      label === null
        ? null
        : await readWantedIssues(fetcher, token, owner, name, label),
  };
}

/** The open issues of one repository that carry the wanted label, oldest first. */
async function readWantedIssues(
  fetcher: Fetch,
  token: string,
  owner: string,
  name: string,
  label: string,
): Promise<WantedIssues> {
  type WantedData = {
    repository: {
      issues: {
        nodes: Array<{
          number: number;
          title: string;
          url: string;
          closedByPullRequestsReferences: { totalCount: number } | null;
        }>;
      };
    } | null;
  };
  const data = await graphql<WantedData>(fetcher, token, WANTED_QUERY, {
    owner,
    name,
    label,
  });
  if (!data.repository) throw new Error("github-repository-missing");
  const issues = data.repository.issues.nodes.map((node) => {
    if (
      !Number.isSafeInteger(node.number) ||
      typeof node.title !== "string" ||
      typeof node.url !== "string" ||
      node.url.toLowerCase() !==
        `https://github.com/${owner}/${name}/issues/${node.number}`.toLowerCase()
    )
      throw new Error("github-wanted-issue-invalid");
    return {
      number: node.number,
      title: node.title.slice(0, 200),
      url: node.url,
      openPullRequests: Math.max(
        0,
        node.closedByPullRequestsReferences?.totalCount ?? 0,
      ),
    };
  });
  return { label, issues: issues.slice(0, WANTED_ISSUES_SHOWN * 2) };
}

/** Repository paths a project lists now, in registry order. */
function listedRepositories(project: ProjectDefinition): string[] {
  return project.repositories
    .map((repository) =>
      repository.githubUrl
        ? new URL(repository.githubUrl).pathname.replace(/^\/|\/$/gu, "")
        : repository.id,
    )
    .filter(validRepositoryPath);
}

/** Repository paths of an active, listed project, in registry order. */
export function measuredRepositories(project: ProjectDefinition): string[] {
  if (project.status !== "active" || project.listingTier === "retired")
    return [];
  return listedRepositories(project);
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
  open_outside: number | null;
  open_outside_capped: number | null;
  wanted_label: string | null;
  wanted_issues: string | null;
  wanted_label_ready: string | null;
};

/**
 * True when the repository is due: never read, stale, or a failure an hour
 * old. `intake` is true for a project with an intake cap, which is read at
 * every hourly run. `wanted` is the project's wanted label: a project with
 * one is read every six hours, and at once after the label changes.
 */
export function due(
  row:
    | (Pick<StoredRow, "attempted_at" | "failure"> &
        Partial<Pick<StoredRow, "wanted_label">>)
    | undefined,
  now: Date,
  intake = false,
  wanted: string | null = null,
): boolean {
  if (!row) return true;
  const attempted = Date.parse(row.attempted_at);
  if (row.failure !== null)
    return (
      now.getTime() - attempted >=
      (intake ? INTAKE_REFRESH_AFTER_MS : RETRY_AFTER_MS)
    );
  if (wanted !== null && (row.wanted_label ?? null) !== wanted) return true;
  const refresh = intake
    ? INTAKE_REFRESH_AFTER_MS
    : wanted !== null
      ? WANTED_REFRESH_AFTER_MS
      : REFRESH_AFTER_MS;
  return now.getTime() - attempted >= refresh;
}

/**
 * Reads up to `REPOSITORIES_PER_RUN` due repositories and stores the results.
 * Never throws for a GitHub failure: that repository records the failure and
 * keeps its last values. Drops the row of a path its project no longer lists,
 * such as the old path of a transferred repository.
 */
export async function refreshMergeActivity(
  db: Database,
  projects: readonly ProjectDefinition[],
  tokenFor: (repository: string) => Promise<string | null>,
  fetcher: Fetch,
  now: Date,
  ensureLabel?: (repository: string, label: string) => Promise<boolean>,
): Promise<{ read: number; failed: number }> {
  const { results } = await db
    .prepare(
      "SELECT project_id, repository, observed_at, attempted_at, failure, wanted_label, wanted_label_ready FROM repository_merge_activity",
    )
    .all<StoredRow>();
  const stored = new Map(
    (results ?? []).map((row) => [`${row.project_id}\n${row.repository}`, row]),
  );
  // A transfer moves a repository to a new path; the old path is never read
  // again, and its row would keep adding stale values to the project.
  const listed = new Map(
    projects.map((project) => [project.id, listedRepositories(project)]),
  );
  for (const row of results ?? [])
    if (listed.get(row.project_id)?.includes(row.repository) === false)
      await db
        .prepare(
          "DELETE FROM repository_merge_activity WHERE project_id = ? AND repository = ?",
        )
        .bind(row.project_id, row.repository)
        .run();
  const queue: Array<{
    projectId: string;
    repository: string;
    since: number;
    label: string | null;
    ready: string | null;
  }> = [];
  for (const project of projects) {
    const label = wantedLabel(project);
    for (const repository of measuredRepositories(project)) {
      const row = stored.get(`${project.id}\n${repository}`);
      if (due(row, now, intakeCap(project) !== null, label))
        queue.push({
          projectId: project.id,
          repository,
          since: row ? Date.parse(row.attempted_at) : 0,
          label,
          ready: row?.wanted_label_ready ?? null,
        });
    }
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
        item.label,
      );
      // Creating a missing label is best effort: a failure leaves the list
      // as read and is retried at the next read.
      let ready = item.ready;
      if (item.label !== null && ready !== item.label && ensureLabel)
        try {
          if (await ensureLabel(item.repository, item.label))
            ready = item.label;
        } catch {
          // retried at the next read
        }
      await db
        .prepare(
          `INSERT INTO repository_merge_activity
             (project_id, repository, observed_at, attempted_at, failure,
              last_merged_at, waiting_outside, waiting_capped,
              merged_outside_30d, median_merge_hours,
              open_outside, open_outside_capped,
              wanted_label, wanted_issues, wanted_label_ready)
           VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (project_id, repository) DO UPDATE SET
             observed_at = excluded.observed_at,
             attempted_at = excluded.attempted_at,
             failure = NULL,
             last_merged_at = excluded.last_merged_at,
             waiting_outside = excluded.waiting_outside,
             waiting_capped = excluded.waiting_capped,
             merged_outside_30d = excluded.merged_outside_30d,
             median_merge_hours = excluded.median_merge_hours,
             open_outside = excluded.open_outside,
             open_outside_capped = excluded.open_outside_capped,
             wanted_label = excluded.wanted_label,
             wanted_issues = excluded.wanted_issues,
             wanted_label_ready = excluded.wanted_label_ready`,
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
          activity.openOutside,
          activity.openOutsideCapped ? 1 : 0,
          activity.wanted?.label ?? null,
          activity.wanted ? JSON.stringify(activity.wanted.issues) : null,
          item.label === null ? null : ready,
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

/**
 * The stored counts by project for the intake cap (`intakePaused` in
 * src/lib/intake-cap.mjs) and the backlog rule (`backlogOutOfRotation` in
 * src/lib/backlog-rule.mjs): open and waiting outside pull requests and the
 * last merge of every repository read at least once. Throws when D1 cannot be
 * read; callers fail open.
 */
export async function readIntakeCounts(
  db: Database,
): Promise<Map<string, IntakeCount[]>> {
  const { results } = await db
    .prepare(
      `SELECT project_id, observed_at, open_outside, waiting_outside,
              last_merged_at
         FROM repository_merge_activity
        WHERE observed_at IS NOT NULL`,
    )
    .all<
      Pick<
        StoredRow,
        | "project_id"
        | "observed_at"
        | "open_outside"
        | "waiting_outside"
        | "last_merged_at"
      >
    >();
  const index = new Map<string, IntakeCount[]>();
  for (const row of results ?? []) {
    const list = index.get(row.project_id) ?? [];
    list.push({
      openOutside: row.open_outside,
      waitingOutside: row.waiting_outside,
      lastMergedAt: row.last_merged_at,
      observedAt: row.observed_at,
    });
    index.set(row.project_id, list);
  }
  return index;
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
                merged_outside_30d, median_merge_hours,
                open_outside, open_outside_capped,
                wanted_label, wanted_issues
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
        openOutside: row.open_outside,
        openOutsideCapped: row.open_outside_capped === 1,
        ...(row.wanted_label !== null && row.wanted_issues !== null
          ? {
              wantedLabel: row.wanted_label,
              wantedIssues: JSON.parse(row.wanted_issues) as WantedIssue[],
            }
          : {}),
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
