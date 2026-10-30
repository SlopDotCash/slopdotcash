/** A monthly target must not look like an active payment offer. */

import { createProjectView } from "../../src/lib/project-view";
import { PROJECTS } from "../../src/lib/projects.mjs";
import {
  expect,
  expectAccessible,
  serveProjectCycleIndex,
  test,
} from "./fixtures";

test("monthly targets remain distinct from verified payment records", async ({
  page,
}, info) => {
  const original = PROJECTS.find((project) => project.id === "eliza");
  if (!original) throw new Error("Missing project fixture");
  const project = {
    ...original,
    status: "active",
    reward: { ...original.reward, paymentMode: "disabled" },
  };
  await page.route(
    /\/(?:api\/v1\/projects|data\/fixture-project-registry\.json)$/,
    (route) =>
      route.fulfill({ json: { schemaVersion: "1", projects: [project] } }),
  );
  await page.route("**/api/v1/projects/eliza", (route) =>
    route.fulfill({ json: { project, revision: 1 } }),
  );
  await serveProjectCycleIndex(page, [project.id]);
  await page.route("**/.well-known/slop/projects.json", (route) =>
    route.fulfill({ json: { schemaVersion: "1", projects: [] } }),
  );
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({ json: { session: null } }),
  );
  await page.goto("/", { waitUntil: "networkidle" });
  const card = page.locator('a.project-card[href="/projects/eliza"]');
  await expect(
    card.getByText("Payments not active", { exact: true }),
  ).toHaveCount(0);
  await expect(card).toContainText("/mo");
  await expect(card.locator(".project-money-state")).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("home-payment-unavailable.png"),
    fullPage: true,
  });
  await card.click();
  await expect(
    page.getByRole("heading", { name: "Eliza", exact: true, level: 1 }),
  ).toBeVisible();
  await expect(page.locator(".project-reward-status")).toContainText(
    "monthly, split between contributors",
  );
  await page.screenshot({
    path: info.outputPath("project-payment-unavailable.png"),
    fullPage: true,
  });
  await page.goto("/projects/eliza/funding", { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/projects\/eliza#funding$/u);
  await expect(page.locator(".project-reward-status")).toHaveCount(1);
  await page.screenshot({
    path: info.outputPath("funding-payment-unavailable.png"),
    fullPage: true,
  });
  await page.goto("/sponsors", { waitUntil: "networkidle" });
  const pool = page
    .getByRole("list", { name: "Project funding pools" })
    .getByRole("listitem")
    .filter({ has: page.getByRole("link", { name: "Eliza", exact: true }) });
  await expect(
    pool.getByText("Payments: Disabled", { exact: true }),
  ).toBeVisible();
  await expect(
    pool.getByText("Vault: Not set up", { exact: true }),
  ).toBeVisible();
  await expectAccessible(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(1);
});

test("a cycle record offers a funding check without inventing a vault balance", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  const response = await page.request.get("/data/leaderboard.json");
  expect(response.ok()).toBe(true);
  const snapshot = await response.json();
  const view = createProjectView(snapshot, "eliza");
  await page.clock.install({ time: new Date(view.cycle.endsAt) });
  await page.goto(`/cycles/eliza/${view.cycle.id}`, {
    waitUntil: "networkidle",
  });
  const notice = page.locator(".cycle-reminder");
  await expect(notice).toContainText(
    "does not verify the month's funding status",
  );
  await expect(notice).not.toContainText("Unfunded");
  await expect(notice).not.toContainText("Underfunded");
  await page.screenshot({
    path: test.info().outputPath("cycle-funding-check.png"),
    fullPage: true,
  });
  await expectAccessible(page);
  const link = notice.getByRole("link", { name: "View project funding" });
  await expect(link).toHaveAttribute("href", "/projects/eliza/funding");
  await link.click();
  await expect(page).toHaveURL(/\/projects\/eliza#funding$/u);
});
