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

async function fixtures(page: Page, paymentRead = () => {}) {
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
    contributors.map((entry) => {
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
