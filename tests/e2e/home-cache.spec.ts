/**
 * First-visit discovery waits only for the project registry, which the site
 * reads from D1 at runtime; no other API or public data response may block it.
 */

import { homeProjects } from "../../src/lib/home-projects";
import { expect, expectAccessible, test } from "./fixtures";

test.use({ video: "on" });

test("renders bundled projects with data stalled and GitHub blocked", async ({
  diagnostics,
  page,
}) => {
  // The blocked GitHub requests.
  diagnostics.allow(/^console Failed to load resource: net::/u);
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    /\/(?:data|api)\/|\/\.well-known\/slop\/projects\.json$/,
    async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (
        path !== "/api/v1/projects" &&
        path !== "/data/fixture-project-registry.json"
      )
        await held;
      await route.fallback();
    },
  );
  await page.route(/https:\/\/[^/]*github[^/]*\//, (route) => route.abort());
  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const expected = homeProjects().filter(
      (project) => project.listingTier === "featured",
    );
    expect(expected.length).toBeGreaterThan(0);
    await expect(page.locator(".project-card")).toHaveCount(expected.length);
    for (const project of expected) {
      await expect(
        page.getByRole("heading", { name: project.name, exact: true }),
      ).toBeVisible();
    }
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath("cached-projects.png"),
      fullPage: true,
    });
    // Keep at least 320 CSS pixels for reflow. Doubling the 320px viewport
    // tests a 160px layout, below the site's supported minimum.
    if ((page.viewportSize()?.width ?? 0) >= 640) {
      await page.evaluate(() => {
        document.documentElement.style.zoom = "2";
      });
    }
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    await expectAccessible(page);
    // Project owner avatars are optional decoration: a blocked avatar falls
    // back to the bundled initial and never delays the project list.
    const avatar = /^https:\/\/avatars\.githubusercontent\.com\//u;
    expect(
      requests.filter((url) => !avatar.test(url) && /github/.test(url)),
    ).toEqual([]);
    await expect(page.locator("img.project-avatar")).toHaveCount(0);
  } finally {
    await test.info().attach("homepage-network", {
      body: JSON.stringify({ requests }, null, 2),
      contentType: "application/json",
    });
    release();
  }
});

test("an unavailable registry with no last good copy shows an error, never an empty list", async ({
  diagnostics,
  page,
}) => {
  diagnostics.allowPreviewApiMisses();
  diagnostics.allow(
    /^console Failed to load resource: the server responded with a status of (?:503|404) .*\/data\/(?:fixture-)?project-registry\.json$/u,
    /^(?:503 GET http:\/\/[^ ]+\/data\/fixture-project-registry|404 GET http:\/\/[^ ]+\/data\/project-registry)\.json$/u,
  );
  // The fixture build reads its live registry from this file.
  await page.route("**/data/fixture-project-registry.json", (route) =>
    route.fulfill({ status: 503, json: { error: "unavailable" } }),
  );
  // A pull-request build publishes no last good registry.
  await page.route("**/data/project-registry.json", (route) =>
    route.fulfill({ status: 404, body: "Not Found" }),
  );
  await page.goto("/");
  // With no last good registry, the failure is an alert with a retry, never
  // a list.
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Project data could not load.");
  await expect(alert.getByRole("button")).toBeVisible();
  await expect(page.locator("#projects")).toHaveCount(0);
  await expectAccessible(page);
  for (const [path, heading] of [
    ["/account", "Settings"],
    ["/login", "Log in"],
  ]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      heading,
    );
    await expect(
      page.getByRole("heading", { name: "Projects are unavailable" }),
    ).toHaveCount(0);
  }
});

test("a failed registry read keeps the last good projects with a stale label", async ({
  diagnostics,
  page,
}) => {
  diagnostics.allowPreviewApiMisses();
  diagnostics.allow(
    /^console Failed to load resource: the server responded with a status of 503 .*\/data\/fixture-project-registry\.json$/u,
    /^503 GET http:\/\/[^ ]+\/data\/fixture-project-registry\.json$/u,
  );
  const published: number[] = [];
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === "/data/project-registry.json")
      published.push(response.status());
  });
  // The fixture build reads its live registry from this file. The build
  // publishes its synced snapshot at /data/project-registry.json.
  await page.route("**/data/fixture-project-registry.json", (route) =>
    route.fulfill({ status: 503, json: { error: "unavailable" } }),
  );
  await page.goto("/", { waitUntil: "networkidle" });
  const notice = page
    .getByRole("complementary", { name: "Project data status" })
    .getByRole("status");
  await expect(notice).toContainText("Projects may be outdated");
  await expect(notice).toContainText("Oct 16, 2026");
  await expect(notice.getByRole("button", { name: "Try again" })).toBeVisible();
  expect(published).toEqual([200]);
  // The last good list is shown, never an outage page or an empty list.
  const expected = homeProjects().filter(
    (project) => project.listingTier === "featured",
  );
  expect(expected.length).toBeGreaterThan(0);
  await expect(page.locator(".project-card")).toHaveCount(expected.length);
  await expect(
    page.getByRole("heading", { name: "Projects are unavailable" }),
  ).toHaveCount(0);
  await page.screenshot({
    path: test.info().outputPath("stale-registry-home.png"),
    fullPage: true,
  });
  await expectAccessible(page);
  // The retry control is reachable by keyboard, and the label reflows at
  // 200% zoom (only where that keeps at least 320 CSS pixels).
  const retry = notice.getByRole("button", { name: "Try again" });
  for (let step = 0; step < 12; step += 1) {
    if (await retry.evaluate((element) => element === document.activeElement))
      break;
    await page.keyboard.press("Tab");
  }
  await expect(retry).toBeFocused();
  if ((page.viewportSize()?.width ?? 0) >= 640) {
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    await expect(notice).toBeVisible();
  }

  const project = expected[0];
  await page.goto(`/projects/${project.slug}`, { waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", { level: 1, name: project.name }),
  ).toBeVisible();
  await expect(notice).toContainText("Projects may be outdated");

  // Pages that act on the current manifest never use the last good copy.
  await page.goto(`/projects/${project.slug}/manage`, {
    waitUntil: "networkidle",
  });
  await expect(
    page.getByRole("heading", { name: "Projects are unavailable" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    "This page needs current project data.",
  );
  await expect(notice).toHaveCount(0);

  // Account routes do not depend on the registry and show no label.
  await page.goto("/account", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Settings",
  );
  await expect(notice).toHaveCount(0);
});

test("a failed snapshot refresh keeps the last good sponsor report with a stale label", async ({
  diagnostics,
  page,
}) => {
  diagnostics.allowPreviewApiMisses();
  const start = Date.now();
  await page.clock.setFixedTime(start);
  // The refused snapshot reads below; each cancels its paired cycle index
  // read.
  diagnostics.allow(
    /^console Failed to load resource: the server responded with a status of 503 .*\/data\/leaderboard\.json\?\S*$/u,
    /^503 GET http:\/\/[^ ]+\/data\/leaderboard\.json\?\S*$/u,
    /^net::ERR_ABORTED GET http:\/\/[^ ]+\/data\/cycles\/index\.json\?\S*$/u,
  );
  let failSnapshot = false;
  let failedSnapshotReads = 0;
  await page.route("**/data/leaderboard.json?*", (route) => {
    if (!failSnapshot) return route.fallback();
    failedSnapshotReads++;
    return route.fulfill({ status: 503, json: { error: "unavailable" } });
  });
  await page.goto("/sponsors", { waitUntil: "networkidle" });
  const scoreRows = page
    .getByRole("list", { name: "Project funding pools" })
    .getByRole("listitem");
  await expect(scoreRows.first()).toBeVisible();
  const rowCount = await scoreRows.count();

  // A report refresh must retain its prior data until fresh data is available.
  await page.getByRole("link", { name: "How it works", exact: true }).click();
  await expect(page).toHaveURL(/\/how-it-works$/u);
  failSnapshot = true;
  // Expire the 60-second public cache before testing a failed refresh.
  await page.clock.setFixedTime(start + 61_000);
  await page.goBack();
  await expect(page).toHaveURL(/\/sponsors$/u);
  await page
    .locator("summary")
    .filter({ hasText: "Audience report ·" })
    .click();
  const notice = page
    .getByRole("main")
    .getByRole("status")
    .filter({ has: page.getByRole("button", { name: "Retry" }) });
  await expect(notice).toContainText("Points may be outdated");
  expect(failedSnapshotReads).toBeGreaterThan(0);
  await expect(notice.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(scoreRows).toHaveCount(rowCount);
  await expect(page.getByText("Data could not load.")).toHaveCount(0);
  await page.screenshot({
    path: test.info().outputPath("stale-snapshot-project.png"),
    fullPage: true,
  });
  await expectAccessible(page);

  // A successful retry clears the stale label and keeps the scores.
  failSnapshot = false;
  await notice.getByRole("button", { name: "Retry" }).click();
  await expect(notice).toHaveCount(0);
  await expect(scoreRows).toHaveCount(rowCount);
});
