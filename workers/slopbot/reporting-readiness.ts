import type { D1Database, D1QueryStatement } from "../../backend/d1";
import { githubAppReportingReader } from "../../backend/security/github-advisories";
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
