/**
 * The home "Top sloperators" table renders the points summary's all-time
 * totals but never read the summary's own generatedAt, so it carried no age
 * signal in any state: when publication stalls, the front door presents
 * days-old totals as current. These tests pin the stale label the rest of
 * the site uses for the same situation (PRD section 9; DataNotice's stale
 * branch), keyed on the summary's generatedAt, and pin its absence while
 * the summary is fresh.
 */

import type { Page } from "@playwright/test";
import { expect, expectAccessible, test } from "./fixtures";

async function serveSummary(page: Page, generatedAt: string) {
  // Preview serves frozen data; the clearance index is a production route.
  await page.route("**/.well-known/slop/projects.json", (route) =>
    route.fulfill({ json: { schemaVersion: "1", projects: [] } }),
  );
  await page.route("https://avatars.githubusercontent.com/**", async (route) =>
    route.fulfill({ response: await page.request.get("/slop-mark.svg") }),
  );
  await page.route("**/data/points-summary.json**", async (route) => {
    const response = await route.fetch();
    const summary = (await response.json()) as Record<string, unknown>;
    await route.fulfill({ json: { ...summary, generatedAt } });
  });
}

test("home standings show the stale label when the summary is old", async ({
  page,
}) => {
  await serveSummary(page, "2026-10-31T04:08:13.648Z");
  await page.goto("/", { waitUntil: "networkidle" });
  const panel = page.locator('section[aria-label="Top sloperators"]');
  await expect(
    panel.getByRole("status").filter({ hasText: "Points may be outdated" }),
  ).toBeVisible();
  await expect(panel.locator(".data-notice")).toContainText(
    "updated Oct 31, 2026",
  );
  await expectAccessible(page);
});

test("home standings show no stale label when the summary is fresh", async ({
  page,
}) => {
  await serveSummary(page, new Date().toISOString());
  await page.goto("/", { waitUntil: "networkidle" });
  const panel = page.locator('section[aria-label="Top sloperators"]');
  await expect(panel.locator("table")).toBeVisible();
  await expect(panel.locator(".data-notice")).toHaveCount(0);
});
