/** Time-derived UI state changes while a view stays mounted. */

import { PROJECTS } from "../../src/lib/projects.mjs";
import { archivedPaidCycleIndex } from "../fixtures";
import { expect, test } from "./fixtures";
import { serveProjectMaintainer } from "./project-maintainer-fixture";

test.use({ video: "on" });

test("the passage of a cycle review deadline shows awaiting approval", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  const index = archivedPaidCycleIndex();
  const cycle = index.cycles[0];
  cycle.state = "review";
  cycle.approvedAt = null;
  cycle.settledAt = null;
  cycle.reward.approvedMinor = "0";
  cycle.reward.paidMinor = "0";
  cycle.reward.feeMinor = "0";
  cycle.files.allocation = null;
  cycle.files.executionPlan = null;
  cycle.files.settlement = null;
  cycle.contributors[0].state = "unclaimed";
  cycle.contributors[0].wallet = null;
  cycle.contributors[0].approvedMinor = "0";
  cycle.contributors[0].paidMinor = "0";
  const deadline = Date.parse(cycle.reviewEndsAt as string);
  await page.clock.install({ time: new Date(deadline - 30_000) });
  await page.route("**/data/cycles/index.json?**", (route) =>
    route.fulfill({ json: index }),
  );
  await page.goto(`/cycles/${cycle.projectId}/${cycle.cycleId}`, {
    waitUntil: "networkidle",
  });
  await expect(
    page.getByText("Under review, awaiting approval", { exact: true }),
  ).toHaveCount(0);
  await page.clock.pauseAt(new Date(deadline - 1));
  await page.screenshot({
    path: test.info().outputPath("review-open.png"),
    fullPage: true,
  });
  await page.clock.fastForward(1);
  await expect(
    page.getByText("Under review, awaiting approval", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("review-ended.png"),
    fullPage: true,
  });
});

test("an open funding edit advances its effective month at UTC rollover", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  const registered = PROJECTS.find((project) => project.id === "eliza");
  if (!registered) throw new Error("Missing project fixture");
  await serveProjectMaintainer(page, () => registered);
  await page.clock.install({ time: new Date("2026-07-31T00:00:00Z") });
  await page.goto("/projects/eliza/manage", { waitUntil: "networkidle" });
  await page
    .locator("summary")
    .filter({ hasText: /^Monthly rewards$/ })
    .click();
  await page
    .getByRole("radio", { name: "Monthly rewards", exact: true })
    .check();
  const amount = page.getByLabel(/^Monthly amount/);
  await amount.fill("2000");
  await expect(
    page.getByText(
      "Financial changes apply from 2026-08 (UTC). Funded awards keep their terms.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.clock.pauseAt(new Date("2026-07-31T23:59:59.999Z"));
  await page.clock.fastForward(1);
  await expect(
    page.getByText(
      "Financial changes apply from 2026-09 (UTC). Funded awards keep their terms.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("funding-month-rollover.png"),
    fullPage: true,
  });
});
