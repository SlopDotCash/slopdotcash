import { expect, expectAccessible, test } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await page.route("https://avatars.githubusercontent.com/**", (route) =>
    route.fulfill({ path: "public/slop-mark.svg" }),
  );
});

test("a project page names a failed snapshot read and recovers on Retry", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  // Each snapshot read carries a cache-busting query, so match it here.
  const failed = /^503 GET \S+\/data\/leaderboard\.json\?\S+$/u;
  diagnostics.allow(
    failed,
    /^console Failed to load resource: the server responded with a status of 503 \(Service Unavailable\) at \S+\/data\/leaderboard\.json\?\S+$/u,
    // The shared read cancels its paired cycle index read when the snapshot fails.
    /^net::ERR_ABORTED GET \S+\/data\/cycles\/index\.json\?\S+$/u,
  );
  let failSnapshot = true;
  let failedReads = 0;
  await page.route("**/data/leaderboard.json?**", (route) => {
    if (!failSnapshot) return route.continue();
    failedReads += 1;
    return route.fulfill({ status: 503, body: "unavailable" });
  });
  await page.goto("/projects/eliza", { waitUntil: "networkidle" });
  const alert = page.getByRole("alert").filter({
    hasText: "Data could not load.",
  });
  await expect(alert).toBeVisible({ timeout: 20_000 });
  // The read and its one retry both failed.
  expect(failedReads).toBe(2);
  expect(diagnostics.count(failed)).toBe(2);
  const standings = page.getByRole("heading", {
    name: "Contributor standings",
  });
  await expect(standings).toHaveCount(0);
  await page.screenshot({
    path: test.info().outputPath("project-snapshot-error.png"),
    fullPage: true,
  });
  await expectAccessible(page);

  failSnapshot = false;
  await alert.getByRole("button", { name: "Retry" }).click();
  await expect(standings).toBeVisible({ timeout: 20_000 });
  await expect(alert).toHaveCount(0);
  await page.screenshot({
    path: test.info().outputPath("project-snapshot-recovered.png"),
    fullPage: true,
  });
});

test("a project page shows that its records are loading", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/data/leaderboard.json?**", async (route) => {
    await held;
    await route.continue();
  });
  await page.goto("/projects/eliza");
  const loading = page.getByRole("status").filter({
    hasText: "Loading records…",
  });
  await expect(loading).toBeVisible();
  release();
  await expect(
    page.getByRole("heading", { name: "Contributor standings" }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(loading).toHaveCount(0);
});
