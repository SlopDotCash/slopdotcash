import { assertCycleIndex } from "../../src/lib/cycle-index";
import { createProjectView } from "../../src/lib/project-view";
import { archivedPaidCycleIndex } from "../fixtures";
import { expect, expectAccessible, test } from "./fixtures";
import { readLeaderboardResponse } from "./leaderboard-response";

/** The cycle page date format (Presentation formatDate). */
const day = (value: string | number) =>
  new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(value));

test.beforeEach(async ({ page }) => {
  await page.route("https://avatars.githubusercontent.com/**", (route) =>
    route.fulfill({ path: "public/slop-mark.svg" }),
  );
});

test("a recorded cycle ends on its last contribution day", async ({ page }) => {
  // The record's window is [2026-07-07, 2026-08-01): July 31 is the last day.
  const index = archivedPaidCycleIndex();
  assertCycleIndex(index);
  const record = index.cycles[0];
  expect(record.contributionWindow.to).toBe("2026-08-01T00:00:00.000Z");
  await page.route("**/data/cycles/index.json?**", (route) =>
    route.fulfill({ json: index }),
  );
  await page.goto("/cycles/eliza/2026-07", { waitUntil: "networkidle" });
  const lead = page.locator(".cycle-hero .route-lead");
  await expect(lead).toHaveText("Jul 7, 2026–Jul 31, 2026");
  const contribution = page
    .locator(".cycle-hero li, .cycle-page li")
    .filter({ has: page.getByText("Contribution", { exact: true }) });
  await expect(contribution).toHaveText("ContributionJul 7, 2026–Jul 31, 2026");
  await page.screenshot({
    path: test.info().outputPath("recorded-cycle-window.png"),
    fullPage: true,
  });
  await expectAccessible(page);
});

test("the open cycle ends on the last day of its UTC month", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  const response = await page.request.get("/data/leaderboard.json");
  expect(response.ok()).toBe(true);
  const view = createProjectView(
    await readLeaderboardResponse(response, page.request),
    "eliza",
  );
  const endsAt = Date.parse(view.cycle.endsAt);
  // The window end is the first instant of the next month, which is excluded.
  expect(new Date(endsAt).getUTCDate()).toBe(1);
  await page.goto(`/cycles/eliza/${view.cycle.id}`, {
    waitUntil: "networkidle",
  });
  const lead = page.locator(".cycle-hero .route-lead");
  await expect(lead).toHaveText(`${day(view.cycle.from)}–${day(endsAt - 1)}`);
  await expect(lead).not.toContainText(day(endsAt));
  await page.screenshot({
    path: test.info().outputPath("open-cycle-window.png"),
    fullPage: true,
  });
});
