/** A fixed project route must win over filters retained by a reused standings view. */
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
const instant = "2026-10-16T12:00:00.000Z";
const contributors = [
  {
    projectId: "eliza",
    id: "U_navigation_eliza",
    login: "synthetic-eliza",
    points: 111,
  },
  {
    projectId: "slopdotcash",
    id: "U_navigation_slop",
    login: "synthetic-slop",
    points: 222,
  },
  {
    projectId: "slopdotcash",
    id: "U_navigation_tie",
    login: "synthetic-tie",
    points: 222,
  },
];

const paginatedContributors = Array.from({ length: 28 }, (_, index) => ({
  projectId: "slopdotcash",
  id: `U_navigation_page_${String(index + 1).padStart(2, "0")}`,
  login: `page-person-${String(index + 1).padStart(2, "0")}`,
  points: 300 - index,
}));

async function fixtures(
  page: Page,
  paymentRead = () => {},
  records = contributors,
) {
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
  // Payment history remains separate from the points-only leaderboard.
  await page.route("**/api/v1/payments/projects/*/direct-transfers", (route) =>
    route.fulfill({ json: { totalMicro: "0", transfers: [] } }),
  );
  await page.route("**/api/v1/payments/received", (route) => {
    paymentRead();
    return route.fulfill({ status: 503, body: "Payment source unavailable" });
  });
  const journal = appendPointAwards(
    emptyPointsJournal(instant),
    records.map((entry) => {
      const sourceId = `PR_${entry.id}`;
      const repository = PROJECTS.find(
        (project) => project.id === entry.projectId,
      )?.links.repository;
      if (!repository) throw new Error("Missing standings project fixture");
      return {
        key: pointKey(
          entry.projectId,
          entry.id,
          "merged-pull-request",
          sourceId,
        ),
        actor: { id: entry.id, login: entry.login },
        projectId: entry.projectId,
        category: "merged-pull-request" as const,
        amount: entry.points,
        occurredAt: instant,
        sourceId,
        sourceUrl: `${repository}/pull/1`,
        workUnitId: sourceId,
        provisional: false,
      };
    }),
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

test("point rankings and ties do not depend on payment availability", async ({
  page,
}, info) => {
  let paymentReads = 0;
  await fixtures(page, () => paymentReads++);
  await page.goto(`${site}/points?sort=money&period=lifetime`);
  const standings = page.getByRole("region", {
    name: "Contributor standings",
    exact: true,
  });
  await expect(
    standings.getByText(/Money received|Payment records unavailable/u),
  ).toHaveCount(0);
  await expect(standings.locator("tbody tr")).toHaveCount(3);
  await expect(standings.locator("tbody tr").first()).toContainText(
    "synthetic-slop",
  );
  await expect(standings.locator("tbody tr td:first-child")).toHaveText([
    "1",
    "1",
    "3",
  ]);
  await expect(
    standings.getByRole("link", { name: "synthetic-slop", exact: true }),
  ).toHaveAttribute("href", "/contributors/synthetic-slop");
  await expect(page).not.toHaveURL(/sort=money/u);
  expect(paymentReads).toBe(0);
  await page.screenshot({
    path: info.outputPath("points-only-rankings.png"),
    fullPage: true,
  });
  await expectAccessible(page);
});

test("history navigation keeps contributor standings scoped to the current project", async ({
  page,
}, info) => {
  await fixtures(page);
  await page.goto(`${site}/projects/slopdotcash?project=eliza&period=lifetime`);
  const standings = page.getByRole("region", {
    name: "Contributor standings",
    exact: true,
  });
  const slop = standings.getByRole("row").filter({ hasText: "synthetic-slop" });
  const eliza = standings
    .getByRole("row")
    .filter({ hasText: "synthetic-eliza" });
  await expect(slop).toContainText("222 pts");
  await expect(eliza).toHaveCount(0);
  await standings.scrollIntoViewIfNeeded();
  const document = await page.evaluate(() => performance.timeOrigin);
  await page
    .getByRole("banner")
    .getByRole("link", { name: "Slop home", exact: true })
    .click();
  await page.locator('a.project-card[href="/projects/eliza"]').click();
  await expect(eliza).toContainText("111 pts");
  await page.evaluate(() => history.go(-2));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Slop");
  await standings.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath("returned-to-slop.png"),
    fullPage: true,
  });
  await info.attach("returned-project-standings", {
    body: JSON.stringify({
      route: page.url(),
      text: await standings.innerText(),
    }),
    contentType: "application/json",
  });
  await expect(slop).toContainText("222 pts");
  await expect(eliza).toHaveCount(0);
  await expectAccessible(page);
  await page.evaluate(() => history.go(2));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Eliza");
  await expect(eliza).toContainText("111 pts");
  await expect(slop).toHaveCount(0);
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(document);
});

test("legacy project and contributor URLs keep points-only ranking", async ({
  page,
}) => {
  await fixtures(page);
  await page.goto(`${site}/projects/eliza?sort=money&period=lifetime`);
  await expect(
    page.getByRole("link", { name: /Full standings|View leaderboard/u }),
  ).toHaveCount(0);
  await page.goto(`${site}/?period=lifetime&sort=money`);
  const fullView = page.getByRole("link", {
    name: "View leaderboard",
    exact: true,
  });
  // The home table is all time, so its full view opens recorded history.
  await expect(fullView).toHaveAttribute("href", "/points?period=lifetime");
  await expectAccessible(page);
  await fullView.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/points\?period=lifetime/);
  const standings = page.getByRole("region", {
    name: "Contributor standings",
    exact: true,
  });
  await expect(standings.getByLabel("Project", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Find a contributor")).toHaveCount(0);
  await expect(page.locator(".points-coverage-details")).toHaveCount(0);
  await page.goto(`${site}/points?period=lifetime&project=eliza`);
  await expect(
    standings
      .getByRole("row")
      .filter({ hasText: "synthetic-eliza" })
      .locator("td")
      .last(),
  ).toHaveText("111");
  await expect(
    standings.getByRole("row").filter({ hasText: "synthetic-slop" }),
  ).toHaveCount(0);
  await page.goto(`${site}/points?period=lifetime&project=slopdotcash`);
  await expect(
    standings
      .getByRole("row")
      .filter({ hasText: "synthetic-slop" })
      .locator("td")
      .last(),
  ).toHaveText("222");
  await expect(
    standings.getByRole("row").filter({ hasText: "synthetic-eliza" }),
  ).toHaveCount(0);
  await page.goto(`${site}/points?period=lifetime`);
  await expect(
    standings.getByRole("row").filter({ hasText: "synthetic-eliza" }),
  ).toBeVisible();
  await page.goto(`${site}/points?period=lifetime&q=synthetic-slop`);
  await expect(
    standings.getByRole("row").filter({ hasText: "synthetic-eliza" }),
  ).toHaveCount(0);
  await expect(
    standings.getByRole("row").filter({ hasText: "synthetic-slop" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/q=synthetic-slop/);
  await expect(
    standings.getByRole("columnheader", { name: "Points", exact: true }),
  ).toHaveAttribute("aria-sort", "descending");
  await expect(page).not.toHaveURL(/sort=money/u);
  await expectAccessible(page);
});

// Source-only additions: these definitions have not been run in this audit.
test("a contributor query retains the rank from the selected whole leaderboard", async ({
  page,
}) => {
  await fixtures(page);
  await page.goto(`${site}/points?period=lifetime&q=synthetic-eliza`);
  const standings = page.getByRole("region", {
    name: "Contributor standings",
    exact: true,
  });
  await expect(standings.locator("tbody tr")).toHaveCount(1);
  await expect(standings.locator("tbody tr td:first-child")).toHaveText(["3"]);
  await page.goto(
    `${site}/points?period=lifetime&project=eliza&q=synthetic-eliza`,
  );
  await expect(standings.locator("tbody tr")).toHaveCount(1);
  await expect(standings.locator("tbody tr td:first-child")).toHaveText(["1"]);
});

test("an oversized page clamps its rows until Previous replaces the requested page", async ({
  page,
}) => {
  await fixtures(page, undefined, paginatedContributors);
  await page.goto(`${site}/points?period=lifetime&page=99`);
  const standings = page.getByRole("region", {
    name: "Contributor standings",
    exact: true,
  });
  await expect(standings.locator("tbody tr")).toHaveCount(3);
  await expect(standings.locator("tbody tr").first()).toContainText(
    "page-person-26",
  );
  await expect(standings.getByText("Page 2 of 2", { exact: true })).toBeVisible();
  await expect(standings.getByRole("button", { name: "Next", exact: true }))
    .toBeDisabled();
  await expect(page).toHaveURL(/page=99/u);
  await standings.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(standings.locator("tbody tr")).toHaveCount(25);
  await expect(standings.locator("tbody tr").first()).toContainText(
    "page-person-01",
  );
  await expect(page).not.toHaveURL(/[?&]page=/u);
});

for (const [rawPage, firstLogin, rowCount] of [
  ["0", "page-person-01", 25],
  ["-9", "page-person-01", 25],
  ["invalid", "page-person-01", 25],
  ["2tail", "page-person-26", 3],
] as const) {
  test(`page ${rawPage} follows the saved URL integer-prefix rule`, async ({
    page,
  }) => {
    await fixtures(page, undefined, paginatedContributors);
    await page.goto(`${site}/points?period=lifetime&page=${rawPage}`);
    const standings = page.getByRole("region", {
      name: "Contributor standings",
      exact: true,
    });
    await expect(standings.locator("tbody tr")).toHaveCount(rowCount);
    await expect(standings.locator("tbody tr").first()).toContainText(firstLogin);
    if (rawPage === "2tail") await expect(page).toHaveURL(/[?&]page=2(?:&|$)/u);
    else await expect(page).not.toHaveURL(/[?&]page=/u);
  });
}

test("changing period resets a clamped requested page and preserves unrelated URL fields", async ({
  page,
}) => {
  await fixtures(page, undefined, paginatedContributors);
  await page.goto(
    `${site}/points?period=lifetime&page=99&q=page-person&campaign=retained#rules`,
  );
  const standings = page.getByRole("region", {
    name: "Contributor standings",
    exact: true,
  });
  await expect(standings.locator("tbody tr")).toHaveCount(3);
  await page.getByRole("button", { name: "This month", exact: true }).click();
  await expect(standings.locator("tbody tr")).toHaveCount(25);
  await expect.poll(() => {
    const url = new URL(page.url());
    return {
      period: url.searchParams.get("period"),
      page: url.searchParams.get("page"),
      query: url.searchParams.get("q"),
      campaign: url.searchParams.get("campaign"),
      hash: url.hash,
    };
  }).toEqual({
    period: null,
    page: null,
    query: "page-person",
    campaign: "retained",
    hash: "#rules",
  });
});

test("history restoration clamps a narrowed query without erasing its requested page", async ({
  page,
}) => {
  await fixtures(page, undefined, paginatedContributors);
  await page.goto(`${site}/points?period=lifetime&page=2`);
  const standings = page.getByRole("region", {
    name: "Contributor standings",
    exact: true,
  });
  await expect(standings.locator("tbody tr")).toHaveCount(3);
  await page.evaluate(() => {
    history.pushState({}, "", "/points?period=lifetime&page=99&q=page-person-28");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(standings.locator("tbody tr")).toHaveCount(1);
  await expect(standings.locator("tbody tr td:first-child")).toHaveText(["28"]);
  await expect(standings.getByRole("button", { name: "Next", exact: true }))
    .toHaveCount(0);
  await expect(page).toHaveURL(/page=99/u);
  await page.evaluate(() => history.back());
  await expect(standings.locator("tbody tr")).toHaveCount(3);
  await expect(standings.locator("tbody tr").first()).toContainText(
    "page-person-26",
  );
  await expect(page).toHaveURL(/[?&]page=2(?:&|$)/u);
});

test("an empty query result has no pager even with an oversized saved page", async ({
  page,
}) => {
  await fixtures(page, undefined, paginatedContributors);
  await page.goto(`${site}/points?period=lifetime&page=99&q=no-match`);
  const standings = page.getByRole("region", {
    name: "Contributor standings",
    exact: true,
  });
  await expect(standings.locator("tbody tr")).toHaveCount(0);
  await expect(standings.getByText("No contributors match this view."))
    .toBeVisible();
  await expect(standings.getByRole("button", { name: "Previous", exact: true }))
    .toHaveCount(0);
  await expect(page).toHaveURL(/page=99/u);
});

test("a compact project keeps its award month while applying ten-row pagination", async ({
  page,
}) => {
  await fixtures(page, undefined, paginatedContributors);
  await page.goto(
    `${site}/projects/slopdotcash?period=2026-10&page=2&project=eliza`,
  );
  const standings = page.getByRole("region", {
    name: "Contributor standings",
    exact: true,
  });
  await expect(standings.locator("tbody tr")).toHaveCount(10);
  await expect(standings.locator("tbody tr").first()).toContainText(
    "page-person-11",
  );
  await expect(standings.getByText("Page 2 of 3", { exact: true })).toBeVisible();
  await expect.poll(() => {
    const url = new URL(page.url());
    return {
      period: url.searchParams.get("period"),
      project: url.searchParams.get("project"),
    };
  }).toEqual({ period: "2026-10", project: null });
  await standings.getByRole("button", { name: "Next", exact: true }).click();
  await expect(standings.locator("tbody tr")).toHaveCount(8);
  await expect(standings.locator("tbody tr").first()).toContainText(
    "page-person-21",
  );
  await expect(page).toHaveURL(/period=2026-10/u);
});
