import type { Page } from "@playwright/test";
import { assertLeaderboardSnapshot } from "../../src/lib/leaderboard";
import { cycleIndexFixture, snapshotFixture } from "../fixtures";
import { expect, expectAccessible, test } from "./fixtures";

test.use({ video: "on" });

async function serve(page: Page, snapshot = snapshotFixture()) {
  assertLeaderboardSnapshot(snapshot);
  await page.route("**/data/leaderboard.json?**", (route) =>
    route.fulfill({ json: snapshot }),
  );
  await page.route("**/data/cycles/index.json?**", (route) =>
    route.fulfill({ json: cycleIndexFixture() }),
  );
  await page.route("**/.well-known/slop/projects.json", (route) =>
    route.fulfill({
      json: { schemaVersion: "1", projects: [{ project_id: "eliza" }] },
    }),
  );
  await page.route("https://avatars.githubusercontent.com/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg"/>',
    }),
  );
  await page.context().route("https://github.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>GitHub target fixture</title>",
    }),
  );
}

test("project exposes eligible work with GitHub targets and keyboard access", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  const snapshot = snapshotFixture();
  const excluded = structuredClone(snapshot.workQueue.issues[0]);
  excluded.id = "I_blocked";
  excluded.number = 17328;
  excluded.url = "https://github.com/elizaOS/eliza/issues/17328";
  excluded.title = "Do not advertise blocked work";
  excluded.labels.push("blocked");
  excluded.actionability = "blocked";
  excluded.selection = { status: "excluded", reasons: ["blocked"] };
  snapshot.workQueue.issues.push(excluded);
  snapshot.source.counts.openIssues = snapshot.workQueue.issues.length;
  await serve(page, snapshot);
  await page.goto("/projects/eliza");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Eliza");
  await expect(
    page.getByRole("columnheader", { name: "Contributor", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("project-work-page.png"),
    fullPage: true,
  });
  const work = page.getByRole("region", { name: "Suggested work" });
  await expect(work).toBeVisible();
  const issue = work.getByRole("link", {
    name: "Issue #17326: Launch the slop.cash contribution protocol",
  });
  await expect(issue).toHaveAttribute("href", snapshot.workQueue.issues[0].url);
  const review = work.getByRole("link", {
    name: "PR #17340: Finish the open contribution checklist",
  });
  await expect(review).toHaveAttribute(
    "href",
    snapshot.workQueue.pullRequests[0].url,
  );
  await expect(work.getByRole("link")).toHaveCount(2);
  await expect(work).not.toContainText(excluded.title);
  await expect(work).not.toContainText("Proximity");
  for (
    let step = 0;
    step < 40 &&
    !(await issue.evaluate((element) => element === document.activeElement));
    step += 1
  ) {
    await page.keyboard.press("Tab");
  }
  await expect(issue).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(review).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(issue).toBeFocused();
  const opened = page.waitForEvent("popup");
  await page.keyboard.press("Enter");
  const target = await opened;
  await target.waitForLoadState();
  await expect(target).toHaveTitle("GitHub target fixture");
  expect(target.url()).toBe(snapshot.workQueue.issues[0].url);
  await target.close();
  const box = await issue.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
  await expect(work.locator("time")).toHaveCount(0);
  await expectAccessible(page, { include: ".project-work" });
  await test.info().attach("project-work-accessibility-tree", {
    body: await work.ariaSnapshot(),
    contentType: "text/plain",
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await page.screenshot({
    path: test.info().outputPath("project-work.png"),
    fullPage: true,
  });
  if ((page.viewportSize()?.width ?? 0) >= 640) {
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    await expectAccessible(page, { include: ".project-work" });
    expect(
      await work.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await work.screenshot({
      path: test.info().outputPath("project-work-200percent.png"),
    });
  }
});

test("old work stays dated and an empty queue does not claim availability", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  const snapshot = snapshotFixture("2026-07-30T00:00:00.000Z");
  snapshot.workQueue = { issues: [], pullRequests: [] };
  snapshot.opportunities = [];
  snapshot.source.counts.openIssues = 0;
  snapshot.source.counts.openPullRequests = 0;
  await serve(page, snapshot);
  await page.goto("/projects/eliza");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Eliza");
  const work = page.getByRole("region", { name: "Suggested work" });
  await expect(work).toBeVisible();
  // One stale notice per page, whichever section shows it.
  await expect(page.getByText(/Points may be outdated/)).toHaveCount(1);
  await expect(work).toContainText("No suggested work right now.");
  await expect(work.getByRole("link")).toHaveCount(0);
});

test("all eligible suggestions stay reachable and long titles reflow", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  const snapshot = snapshotFixture();
  const issue = snapshot.workQueue.issues[0];
  snapshot.workQueue.issues = Array.from({ length: 4 }, (_, index) => ({
    ...structuredClone(issue),
    id: `I_bounded_${index}`,
    number: 18003 - index,
    url: `https://github.com/elizaOS/eliza/issues/${18003 - index}`,
    title:
      index === 0
        ? `Long title ${"word".repeat(80)}`
        : `Suggested issue ${index}`,
  }));
  snapshot.source.counts.openIssues = snapshot.workQueue.issues.length;
  await serve(page, snapshot);
  await page.goto("/projects/eliza");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Eliza");
  const work = page.getByRole("region", { name: "Suggested work" });
  await expect(work.getByRole("link")).toHaveCount(5);
  await expect(
    work.getByRole("link", { name: /Suggested issue 3/ }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await page.addStyleTag({ content: "html { font-size: 200%; }" });
  await expectAccessible(page, { include: ".project-work" });
  expect(
    await work.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath("project-work-reflow.png"),
    fullPage: true,
  });
});

test("loading and failed work can recover through Retry", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  diagnostics.allow(
    /^503 GET http:\/\/127\.0\.0\.1:\d+\/data\/leaderboard\.json\?/u,
    /^console Failed to load resource: the server responded with a status of 503 .+ at http:\/\/127\.0\.0\.1:\d+\/data\/leaderboard\.json\?/u,
  );
  // Each of the two injected 503s aborts its parallel cycle-index read.
  const canceledCycle =
    /^net::ERR_ABORTED GET http:\/\/127\.0\.0\.1:\d+\/data\/cycles\/index\.json\?attempt=0&retry=[01]&at=\d+$/u;
  diagnostics.allow(canceledCycle);
  const snapshot = snapshotFixture();
  await serve(page, snapshot);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  await page.route("**/data/leaderboard.json?**", async (route) => {
    calls += 1;
    if (calls === 1) await pending;
    if (calls <= 2) await route.fulfill({ status: 503, body: "Unavailable" });
    else await route.fulfill({ json: snapshot });
  });
  await page.goto("/projects/eliza");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Eliza");
  const work = page.getByRole("region", { name: "Suggested work" });
  await expect(work.getByRole("status")).toHaveText("Loading work…");
  release();
  await expect(work.getByRole("alert")).toContainText("Work unavailable.");
  await work.getByRole("button", { name: "Retry" }).click();
  await expect(work.getByRole("link")).toHaveCount(2);
  await expect(work.getByRole("alert")).toHaveCount(0);
  expect(calls).toBeGreaterThanOrEqual(3);
  expect(diagnostics.count(canceledCycle)).toBeLessThanOrEqual(2);
  await expectAccessible(page, { include: ".project-work" });
});

test("a paused project does not advertise snapshot work", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  await serve(page);
  await page.route("**/data/fixture-project-registry.json", async (route) => {
    const response = await route.fetch();
    const registry = await response.json();
    registry.projects = registry.projects.map(
      (project: { id: string; status: string }) =>
        project.id === "eliza" ? { ...project, status: "paused" } : project,
    );
    await route.fulfill({ json: registry });
  });
  await page.goto("/projects/eliza");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Eliza");
  await expect(
    page.getByRole("region", { name: "Suggested work" }),
  ).toHaveCount(0);
});

test("work remains available before a project's reward cycle starts", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  await serve(page);
  await page.route("**/data/fixture-project-registry.json", async (route) => {
    const response = await route.fetch();
    const registry = await response.json();
    registry.projects = registry.projects.map(
      (project: { id: string; reward: Record<string, unknown> }) =>
        project.id === "eliza"
          ? {
              ...project,
              reward: {
                ...project.reward,
                rewardStartAt: "2099-01-01T00:00:00.000Z",
              },
            }
          : project,
    );
    await route.fulfill({ json: registry });
  });
  await page.goto("/projects/eliza");
  const work = page.getByRole("region", { name: "Suggested work" });
  await expect(work.getByRole("link")).toHaveCount(2);
  await expect(
    page.getByRole("region", { name: "Contributor standings" }),
  ).toHaveCount(0);
});
