/**
 * A project page owns the stale notice for its shared snapshot read:
 * ContributorStandings suppresses its own DataNotice when the caller passes
 * scoreState (showDataNotice = !scoreState), so the caller must render the
 * notice itself, as ProfilePage does. ProjectPage passed scoreState and
 * rendered nothing, so its standings carried no age signal at all. The
 * frozen fixture snapshot is older than eight hours, so the section must
 * show the stale label (PRD section 9).
 */

import type { Page } from "@playwright/test";
import { expect, expectAccessible, test } from "./fixtures";

async function stubAvatars(page: Page) {
  // Preview serves frozen data; the clearance index is a production route.
  await page.route("**/.well-known/slop/projects.json", (route) =>
    route.fulfill({ json: { schemaVersion: "1", projects: [] } }),
  );
  await page.route("https://avatars.githubusercontent.com/**", async (route) =>
    route.fulfill({ response: await page.request.get("/slop-mark.svg") }),
  );
}

test("project page shows the stale label above its contributor standings", async ({
  page,
}) => {
  await stubAvatars(page);
  await page.goto("/projects/eliza", { waitUntil: "networkidle" });
  const section = page.locator("#contributors");
  await expect(section).toBeVisible();
  await expect(
    section.getByRole("status").filter({ hasText: "Points may be outdated" }),
  ).toBeVisible();
  await expect(section.locator(".data-notice")).toContainText("updated");
  await expectAccessible(page);
});
