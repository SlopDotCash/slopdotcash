import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("maintainer reviews August cap, preserves excluded rows, and follows funding and payment states", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/projects/eliza/funding");
  const panel = page.locator(".funding-workbench");
  await expect(panel.getByLabel("Contribution month")).toHaveValue("2026-08");
  await expect(panel).toContainText("10,000 USDC");
  await expect(panel.locator("tbody tr")).toHaveCount(108);
  await panel.getByLabel("Missing wallets only").check();
  await expect(panel.locator("tbody tr")).toHaveCount(52);
  await panel.getByLabel("Find contributor").fill("lalalune");
  await expect(panel.locator("tbody tr")).toHaveCount(1);
  await expect(panel).toContainText("Not locked");
  await panel
    .getByLabel("Decision for lalalune", { exact: true })
    .selectOption("exclude");
  await expect(
    panel.getByRole("button", { name: "Download review", exact: true }),
  ).toBeDisabled();
  await panel
    .getByLabel("Reason for lalalune", { exact: true })
    .fill("Proposed related-party exclusion for review");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    panel.getByRole("button", { name: "Download review", exact: true }).click(),
  ]);
  const path = await download.path();
  if (!path) throw new Error("Missing downloaded review");
  const review = JSON.parse(await readFile(path, "utf8"));
  expect(review.capMinor).toBe("10000000000");
  expect(review.rows).toHaveLength(108);
  const row = review.rows.find(
    (r: { actor: { login: string } }) => r.actor.login === "lalalune",
  );
  expect(row.proposedMinor).toBe("0");
  expect(BigInt(row.suggestedMinor)).toBeGreaterThan(3000000000n);
  await panel.getByRole("button", { name: "Prepare funding" }).click();
  await expect(panel).toContainText("No reviewed monthly vault yet");
  await expect(panel).toContainText("Payments are disabled for this project");
  await panel.getByRole("button", { name: "Approve cycle" }).click();
  await expect(panel).toContainText("14 days");
  await panel.getByRole("button", { name: "Track payments" }).click();
  await expect(panel).toContainText("Payments have not been authorized");
  await expect(
    panel.getByRole("link", { name: "Download unsigned execution plan" }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(
    (await new AxeBuilder({ page }).include(".funding-workbench").analyze())
      .violations,
  ).toEqual([]);
});

test("invalid amounts cannot export an older valid award", async ({ page }) => {
  await page.goto("/projects/eliza/funding");
  const panel = page.locator(".funding-workbench");
  await panel.getByLabel("Find contributor").fill("lalalune");
  await panel.getByLabel("USDC for lalalune", { exact: true }).fill("1e8");
  await expect(
    panel.getByRole("button", { name: "Download review", exact: true }),
  ).toBeDisabled();
});

test("malformed funding reviews remain an error instead of an empty census", async ({
  page,
}) => {
  await page.route("**/data/funding-reviews.json?*", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ reviews: [] }),
    }),
  );
  await page.goto("/projects/asi/funding");
  const panel = page.locator(".funding-workbench");
  await expect(
    panel.getByRole("button", { name: "Retry funding reviews" }),
  ).toBeVisible();
  await expect(panel).not.toContainText(
    "No complete monthly review has been published",
  );
});
