import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { deploymentOrigins, deploymentTier } from "../../src/lib/deployment";
import {
  appendPointAwards,
  assemblePoints,
  emptyPointsJournal,
  type PointsIndex,
  pointKey,
  pointMembers,
} from "../../src/lib/points";
import { publishedPointsMembers } from "../../src/lib/points-members";
import { expect, test } from "./fixtures";

const actor = {
  id: "MDQ6VXNlcjk4NzY1NDMyMTA=",
  login: "points-refresh-person",
};
const at = "2026-10-31T23:59:30.000Z";

/** One valid October award, published through the real sixteen-shard format. */
function pointsFixture() {
  const sourceId = "PR_points_refresh_fixture";
  const journal = appendPointAwards(
    emptyPointsJournal(at),
    [
      {
        key: pointKey("eliza", actor.id, "merged-pull-request", sourceId),
        actor,
        projectId: "eliza",
        category: "merged-pull-request",
        amount: 10,
        occurredAt: "2026-10-31T23:58:00.000Z",
        sourceId,
        sourceUrl: "https://github.com/elizaOS/eliza/pull/1",
        workUnitId: `history_${sourceId}`,
        provisional: true,
      },
    ],
    "a".repeat(64),
    "github-merged-history-v1",
    at,
  );
  const bucket = Number.parseInt(journal.revisions[0].award.key[0], 16);
  const parts = Array.from({ length: 16 }, (_, i) =>
    JSON.stringify(
      i === bucket ? [{ sequence: 0, revision: journal.revisions[0] }] : [],
    ),
  );
  const index: PointsIndex = {
    schemaVersion: journal.schemaVersion,
    ruleVersion: journal.ruleVersion,
    generatedAt: journal.generatedAt,
    coverage: journal.coverage,
    revisionCount: 1,
    shards: parts.map((part, i) => ({
      path: `/data/points/${i.toString(16)}.json`,
      sha256: createHash("sha256").update(part).digest("hex"),
      count: i === bucket ? 1 : 0,
    })),
  };
  assemblePoints(index, parts);
  const members = publishedPointsMembers(
    journal,
    pointMembers(journal),
    createHash("sha256").update(JSON.stringify(index)).digest("hex"),
  );
  return { index, parts, members };
}

/** All product APIs are local read-only fixtures; no identity or chain service. */
async function servePointsSite(page: Page) {
  const deployment = deploymentOrigins(
    deploymentTier(process.env.VITE_SLOP_ENVIRONMENT),
  );
  const points = pointsFixture();
  let unavailable = false;
  let reads = 0;
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== "GET") return route.abort();
    if (url.pathname.startsWith("/api/")) {
      if (![deployment.site, deployment.api].includes(url.origin))
        return route.abort();
      if (url.pathname === "/api/v1/payments/received") return route.fallback();
      if (url.pathname === "/api/v1/project-session")
        return route.fulfill({ json: { session: null } });
      if (
        url.pathname.startsWith("/api/v1/points/") ||
        /^\/api\/v1\/wallet-claims\/actors\/\d+\/current$/u.test(url.pathname)
      )
        return route.fulfill({ json: null });
      if (url.pathname.endsWith("/direct-transfers"))
        return route.fulfill({ json: { transfers: [], totalMicro: "0" } });
      if (url.pathname.endsWith("/vault-payments"))
        return route.fulfill({
          json: { payments: [], through: 0, next: null, total: 0 },
        });
      return route.abort();
    }
    if (url.origin === "https://avatars.githubusercontent.com")
      return route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"/>',
      });
    if (url.origin !== deployment.site) return route.abort();
    // The profile reads the member record; the leaderboard reads the journal.
    if (url.pathname === "/data/points-members.json") {
      reads++;
      return unavailable
        ? route.fulfill({ status: 503, body: "Points temporarily unavailable" })
        : route.fulfill({ json: points.members });
    }
    if (url.pathname === "/data/points.json") {
      reads++;
      return unavailable
        ? route.fulfill({ status: 503, body: "Points temporarily unavailable" })
        : route.fulfill({ json: points.index });
    }
    const shard = /^\/data\/points\/([0-9a-f])\.json$/u.exec(url.pathname);
    if (shard)
      return route.fulfill({
        contentType: "application/json",
        body: points.parts[Number.parseInt(shard[1], 16)],
      });
    if (url.pathname === "/data/profiles.json") {
      const directory = JSON.parse(
        readFileSync(join(process.cwd(), "dist/data/profiles.json"), "utf8"),
      );
      directory.people.push({
        ...actor,
        avatarUrl: "https://avatars.githubusercontent.com/u/9876543210?v=4",
        repositories: [],
      });
      return route.fulfill({ json: directory });
    }
    return route.fulfill({
      path: join(
        process.cwd(),
        "dist",
        request.resourceType() === "document" ? "index.html" : url.pathname,
      ),
    });
  });
  return {
    site: deployment.site,
    fail: () => (unavailable = true),
    recover: () => (unavailable = false),
    reads: () => reads,
  };
}

test("a failed Points refresh keeps verified totals, marks them stale and retries across the UTC month boundary", async ({
  diagnostics,
  page,
}, info) => {
  const fixture = await servePointsSite(page);
  diagnostics.allow(
    /^(?:console Failed to load resource: the server responded with a status of 503 .* at |503 GET )https:\/\/[^ ]+\/data\/points(?:-members)?\.json$/u,
  );
  await page.clock.install({ time: new Date(at) });
  await page.goto(`${fixture.site}/contributors/${actor.login}`, {
    waitUntil: "networkidle",
  });
  const total = page.locator(".profile-totals strong").last();
  await expect(total).toHaveText("10");
  expect(fixture.reads()).toBe(1);
  await page.clock.fastForward(61_000);
  fixture.fail();
  await page
    .getByRole("banner")
    .getByRole("link", { name: "Slop home", exact: true })
    .click();
  await page.waitForLoadState("networkidle");
  await page.goBack({ waitUntil: "networkidle" });
  await expect(
    page.getByRole("button", { name: "Retry points", exact: true }),
  ).toBeVisible();
  await expect(total).toHaveText("10");
  await expect(
    page.getByText("Points may be outdated.", { exact: true }),
  ).toBeVisible();
  expect(fixture.reads()).toBe(2);
  await page.screenshot({
    path: info.outputPath("points-stale.png"),
    fullPage: true,
  });
  // The retained October journal must not report October's award as November work.
  await page
    .getByRole("banner")
    .getByRole("link", { name: "Slop home", exact: true })
    .click();
  await page
    .getByRole("link", { name: "View leaderboard", exact: true })
    .click();
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "This month", exact: true }).click();
  const table = page.getByRole("region", {
    name: "Contributor standings table",
    exact: true,
  });
  await expect(table.getByText(actor.login, { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "All time", exact: true }).click();
  await expect(
    table.getByRole("row").filter({ hasText: actor.login }),
  ).toContainText("10");
  const readsBeforeRetry = fixture.reads();
  fixture.recover();
  await page.getByRole("button", { name: "Retry points", exact: true }).click();
  await expect(
    page.getByText("Points may be outdated.", { exact: true }),
  ).toHaveCount(0);
  await expect(
    table.getByRole("row").filter({ hasText: actor.login }),
  ).toContainText("10");
  expect(fixture.reads()).toBe(readsBeforeRetry + 1);
});

test("an initial Points failure remains unavailable without a verified journal", async ({
  diagnostics,
  page,
}) => {
  const fixture = await servePointsSite(page);
  fixture.fail();
  diagnostics.allow(
    /^(?:console Failed to load resource: the server responded with a status of 503 .* at |503 GET )https:\/\/[^ ]+\/data\/points\.json$/u,
  );
  await page.goto(`${fixture.site}/points`, { waitUntil: "networkidle" });
  await expect(
    page.getByText("Points could not load.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Points may be outdated.", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", {
      name: "Contributor standings table",
      exact: true,
    }),
  ).toHaveCount(0);
});
