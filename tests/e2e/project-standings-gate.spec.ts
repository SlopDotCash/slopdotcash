/** The project standings section must follow the Points journal, not the cycle view. */
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { deploymentOrigins, deploymentTier } from "../../src/lib/deployment";
import {
  appendPointAwards,
  emptyPointsJournal,
  pointKey,
  pointMembers,
} from "../../src/lib/points";
import { PROJECTS } from "../../src/lib/projects.mjs";
import { sha256Hex } from "../../src/lib/sha256";
import { cycleIndexFixture } from "../fixtures";
import { expect, expectAccessible, test } from "./fixtures";

const site = deploymentOrigins(
  deploymentTier(process.env.VITE_SLOP_ENVIRONMENT),
).site;
// The e2e fixture pair (frozen registry + the frozen 2026-10-16 ledger)
// collects delta-star's repository but holds zero ledger events for it, so
// the snapshot cycle view is built with no leaders. The Points journal
// below gives the project one lifetime member, mirroring delta-star's real
// history: its accepted work predates the snapshot window, so the standings
// hold content the cycle view cannot see. The section must render from the
// journal; gating it on the cycle view's leaders hides it entirely.
const instant = "2026-10-16T12:00:00.000Z";
const contributor = {
  projectId: "delta-star",
  id: "U_gate_delta_star",
  login: "synthetic-gate-delta-star",
  points: 30,
  occurredAt: "2026-09-01T00:00:00.000Z",
};

async function fixtures(page: Page) {
  await page.clock.setFixedTime(new Date(instant));
  await page.route(`${site}/**`, (route) =>
    route.fulfill({
      path: join(
        process.cwd(),
        "dist",
        route.request().resourceType() === "document"
          ? "index.html"
          : new URL(route.request().url()).pathname,
      ),
    }),
  );
  await page.route("**/.well-known/slop/projects.json", (route) =>
    route.fulfill({ json: { schemaVersion: "1", projects: [] } }),
  );
  await page.route("**/data/cycles/index.json*", (route) =>
    route.fulfill({ json: cycleIndexFixture() }),
  );
  await page.route("**/api/v1/points/**", (route) =>
    route.fulfill({ json: null }),
  );
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({ json: { session: null } }),
  );
  await page.route("**/api/v1/slopbot/summary", (route) =>
    route.fulfill({ json: { repositories: [] } }),
  );
  await page.route("https://avatars.githubusercontent.com/**", (route) =>
    route.fulfill({ path: join(process.cwd(), "public/slop-mark.svg") }),
  );
  await page.route("**/api/v1/payments/projects/*/direct-transfers", (route) =>
    route.fulfill({ json: { totalMicro: "0", transfers: [] } }),
  );
  await page.route("**/api/v1/payments/received", (route) =>
    route.fulfill({ status: 503, body: "Payment source unavailable" }),
  );
  const repository = PROJECTS.find(
    (project) => project.id === contributor.projectId,
  )?.links.repository;
  if (!repository) throw new Error("Missing standings project fixture");
  const sourceId = `PR_${contributor.id}`;
  const journal = appendPointAwards(
    emptyPointsJournal(instant),
    [
      {
        key: pointKey(
          contributor.projectId,
          contributor.id,
          "merged-pull-request",
          sourceId,
        ),
        actor: { id: contributor.id, login: contributor.login },
        projectId: contributor.projectId,
        category: "merged-pull-request" as const,
        amount: contributor.points,
        occurredAt: contributor.occurredAt,
        sourceId,
        sourceUrl: `${repository}/pull/1`,
        workUnitId: sourceId,
        provisional: false,
      },
    ],
    "a".repeat(64),
    "github-merged-history-v1",
    instant,
  );
  const parts = Array.from({ length: 16 }, (_, index) =>
    JSON.stringify(
      journal.revisions
        .map((revision, sequence) => ({ sequence, revision }))
        .filter(({ revision }) =>
          revision.award.key.startsWith(index.toString(16)),
        ),
    ),
  );
  const index = {
    schemaVersion: "1",
    ruleVersion: journal.ruleVersion,
    generatedAt: instant,
    coverage: journal.coverage,
    revisionCount: journal.revisions.length,
    shards: parts.map((part, position) => ({
      path: `/data/points/${position.toString(16)}.json`,
      sha256: sha256Hex(part),
      count: JSON.parse(part).length,
    })),
  };
  await page.route("**/data/points.json", (route) =>
    route.fulfill({ json: index }),
  );
  for (const [position, part] of parts.entries())
    await page.route(`**/data/points/${position.toString(16)}.json`, (route) =>
      route.fulfill({ contentType: "application/json", body: part }),
    );
  const members = pointMembers(journal);
  await page.route("**/data/points-summary.json", (route) =>
    route.fulfill({
      json: {
        schemaVersion: "1",
        ruleVersion: journal.ruleVersion,
        generatedAt: instant,
        indexDigest: sha256Hex(JSON.stringify(index)),
        totals: {
          contributors: members.length,
          points: members.reduce((sum, member) => sum + member.total, 0),
        },
        contributors: members.map(({ actor, total }) => ({ actor, total })),
      },
    }),
  );
}

test("project standings render when the snapshot cycle view has no leaders", async ({
  page,
}) => {
  await fixtures(page);
  // Plain navigation is the acceptance case: no ?period=lifetime, so the
  // panel must show the lifetime-only contributor on its own.
  await page.goto(`${site}/projects/delta-star`);
  const standings = page.getByRole("region", {
    name: "Contributor standings",
    exact: true,
  });
  await expect(page.locator("#contributors")).toHaveCount(1);
  await expect(standings).toBeVisible();
  await expect(
    standings.getByRole("row").filter({ hasText: "synthetic-gate-delta-star" }),
  ).toContainText("30 pts");
  await expectAccessible(page);
});
