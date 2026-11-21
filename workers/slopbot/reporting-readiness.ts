import type { D1Database, D1QueryStatement } from "../../backend/d1";
import { refreshMergeActivity } from "../../backend/projects/merge-activity";
import {
  githubAppReportingReader,
  githubAppRepositoryToken,
} from "../../backend/security/github-advisories";
import {
  type ReportingReader,
  refreshReportingObservation,
  reportingTarget,
} from "../../backend/security/reporting-readiness";
import { assertProjectDefinition } from "../../src/lib/project-schema.mjs";

export type ReportingRefreshEnv = {
  SLOPBOT_DB: D1Database<D1QueryStatement>;
  SLOPBOT_APP_ID: string;
  SLOPBOT_APP_PRIVATE_KEY: string;
};

/** Scheduled safe observations, including unfunded and paused registered projects. */
export async function refreshRegisteredReporting(
  env: ReportingRefreshEnv,
  read: ReportingReader = githubAppReportingReader({
    appId: env.SLOPBOT_APP_ID,
    privateKey: env.SLOPBOT_APP_PRIVATE_KEY,
    apiOrigin: "https://api.github.com",
    fetch: (url, init) => fetch(url, init),
    now: () => new Date(),
  }),
) {
  const rows = await env.SLOPBOT_DB.prepare(
    "SELECT manifest, revision FROM projects ORDER BY id",
  ).all<{ manifest: string; revision: number }>();
  let checked = 0;
  let failed = 0;
  for (const row of rows.results ?? []) {
    const project = assertProjectDefinition(JSON.parse(row.manifest));
    if (project.listingTier === "retired") continue;
    const result = await refreshReportingObservation(
      env.SLOPBOT_DB,
      reportingTarget(project, row.revision),
      read,
      new Date(),
    );
    checked += 1;
    // A paused listing without the App installed is a recorded state only its
    // owner can change, not a refresh failure; counting it would fail the
    // hourly identity schedule indefinitely. Active projects still count.
    if (
      result.kind !== "verified" &&
      !(result.kind === "app-not-installed" && project.status === "paused")
    )
      failed += 1;
  }
  return { checked, failed };
}

/** The wanted label's look on GitHub (PRD section 5). */
export const WANTED_LABEL_COLOR = "f97316";
export const WANTED_LABEL_DESCRIPTION =
  "Most wanted by the maintainers. Listed on slop.cash.";

/**
 * Creates the project's wanted label on one repository when it is missing
 * (operator decision, 21 November 2026). True once the label exists. It only
 * reads and creates the label; it never edits, renames or applies one.
 */
export async function ensureWantedLabel(
  fetcher: (url: string, init: RequestInit) => Promise<Response>,
  token: string,
  repository: string,
  label: string,
): Promise<boolean> {
  const headers = {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "slop.cash-wanted-label",
  };
  const found = await fetcher(
    `https://api.github.com/repos/${repository}/labels/${encodeURIComponent(label)}`,
    { headers, redirect: "manual", signal: AbortSignal.timeout(10_000) },
  );
  await found.body?.cancel().catch(() => undefined);
  if (found.status === 200) return true;
  if (found.status !== 404) return false;
  const created = await fetcher(
    `https://api.github.com/repos/${repository}/labels`,
    {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        name: label,
        color: WANTED_LABEL_COLOR,
        description: WANTED_LABEL_DESCRIPTION,
      }),
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    },
  );
  await created.body?.cancel().catch(() => undefined);
  // 422 means another request created it first.
  return created.status === 201 || created.status === 422;
}

/**
 * Daily merge activity of active projects' repositories (#1993). Reads a few
 * due repositories per hourly run; a GitHub failure is recorded on that
 * repository and never fails the schedule. The same read lists wanted issues
 * and creates a missing wanted label (PRD section 5).
 */
export async function refreshRegisteredMergeActivity(
  env: ReportingRefreshEnv,
  now: Date = new Date(),
) {
  const rows = await env.SLOPBOT_DB.prepare(
    "SELECT manifest FROM projects ORDER BY id",
  ).all<{ manifest: string }>();
  const projects = (rows.results ?? []).map((row) =>
    assertProjectDefinition(JSON.parse(row.manifest)),
  );
  const credentials = {
    appId: env.SLOPBOT_APP_ID,
    privateKey: env.SLOPBOT_APP_PRIVATE_KEY,
    apiOrigin: "https://api.github.com",
    fetch: (url: string, init: RequestInit) => fetch(url, init),
    now: () => new Date(),
  };
  const labelToken = githubAppRepositoryToken(credentials, { issues: "write" });
  return refreshMergeActivity(
    env.SLOPBOT_DB,
    projects,
    githubAppRepositoryToken(credentials, {
      pull_requests: "read",
      issues: "read",
    }),
    (url, init) => fetch(url, init),
    now,
    async (repository, label) => {
      const token = await labelToken(repository);
      return token === null
        ? false
        : ensureWantedLabel(
            (url, init) => fetch(url, init),
            token,
            repository,
            label,
          );
    },
  );
}
