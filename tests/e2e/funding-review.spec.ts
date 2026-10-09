import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("maintainer reviews August cap, preserves excluded rows, and follows funding and payment states", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/projects/eliza/funding#payouts");
  const panel = page.locator(".funding-workbench");
  // The page opens on the newest month; later freezes must not move this test.
  await panel.getByLabel("Contribution month").selectOption("2026-08");
  await expect(panel.getByLabel("Contribution month")).toHaveValue("2026-08");
  await expect(panel).toContainText("10,000 USDC");
  await expect(page.getByRole("note")).toContainText(
    "Payments are disabled for this project",
  );
  await expect(panel.locator(".recipient-row")).toHaveCount(25);
  await expect(panel).toContainText("Showing 1–25 of 108 matching");
  await panel.getByRole("button", { name: "Missing destination (52)" }).click();
  await expect(panel).toContainText("of 52 matching");
  await panel.getByLabel("Find contributor").fill("lalalune");
  await expect(panel.locator(".recipient-row")).toHaveCount(1);
  await expect(panel.locator(".recipient-row")).toContainText("Not locked");
  await panel.getByRole("button", { name: "Details for lalalune" }).click();
  await panel
    .getByLabel("Decision for lalalune", { exact: true })
    .selectOption("exclude");
  await expect(
    panel.getByRole("button", { name: "Download review", exact: true }),
  ).toBeDisabled();
  await expect(panel.locator(".recipient-row")).toContainText("Needs a reason");
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
  await panel.getByRole("button", { name: /Prepare funding/u }).click();
  await expect(panel).toContainText("No reviewed vault");
  await expect(panel).toContainText(
    "Payments are disabled in the project manifest",
  );
  await panel.getByRole("button", { name: /Approve cycle/u }).click();
  await expect(panel).toContainText("14 days");
  await expect(panel.locator(".workflow-inputs")).toContainText("propose");
  await expect(
    panel.locator(".workflow-inputs").getByText("main", { exact: true }),
  ).toBeVisible();
  await panel.getByRole("button", { name: /Track payments/u }).click();
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

test("recipient edits survive search, quick filters and pagination", async ({
  page,
}) => {
  await page.goto("/projects/eliza/funding#payouts");
  const panel = page.locator(".funding-workbench");
  await panel.getByLabel("Contribution month").selectOption("2026-08");
  await panel.getByRole("button", { name: "Next page" }).click();
  await expect(panel).toContainText("Showing 26–50 of 108 matching");
  const row = panel.locator(".recipient-row").first();
  const login = (await row.locator("th a").innerText()).trim();
  await row.getByRole("button", { name: `Details for ${login}` }).click();
  await panel.getByLabel(`USDC for ${login}`, { exact: true }).fill("1.5");
  await expect(row).toContainText("$1.50");
  await expect(row).toContainText("Needs a reason");
  await panel.getByRole("button", { name: "Needs review (1)" }).click();
  await expect(panel.locator(".recipient-row")).toHaveCount(1);
  await panel
    .getByLabel(`Reason for ${login}`, { exact: true })
    .fill("Test-only reduction kept across views");
  await panel.getByRole("button", { name: "Changed amount (1)" }).click();
  await expect(panel.locator(".recipient-row")).toHaveCount(1);
  await expect(panel.locator(".recipient-row")).not.toContainText(
    "Needs a reason",
  );
  await panel.getByRole("button", { name: "All (108)" }).click();
  await panel.getByLabel("Find contributor").fill(login);
  await panel.getByLabel("Find contributor").fill("");
  await panel.getByRole("button", { name: "Next page" }).click();
  await expect(
    panel.getByLabel(`USDC for ${login}`, { exact: true }),
  ).toHaveValue("1.5");
  await expect(
    panel.getByLabel(`Reason for ${login}`, { exact: true }),
  ).toHaveValue("Test-only reduction kept across views");
  await page.getByRole("tab", { name: "Funding records", exact: true }).click();
  await expect(panel).toBeHidden();
  await page.getByRole("tab", { name: "Manage payouts", exact: true }).click();
  await expect(panel.getByLabel("Contribution month")).toHaveValue("2026-08");
  await expect(
    panel.getByLabel(`USDC for ${login}`, { exact: true }),
  ).toHaveValue("1.5");
  await expect(
    panel.getByLabel(`Reason for ${login}`, { exact: true }),
  ).toHaveValue("Test-only reduction kept across views");
  await expect(panel.locator(".review-working-summary")).toContainText(
    "Proposed",
  );
});

test("invalid amounts cannot export an older valid award", async ({ page }) => {
  await page.goto("/projects/eliza/funding#payouts");
  const panel = page.locator(".funding-workbench");
  await panel.getByLabel("Contribution month").selectOption("2026-08");
  await panel.getByLabel("Find contributor").fill("lalalune");
  await panel.getByRole("button", { name: "Details for lalalune" }).click();
  await panel.getByLabel("USDC for lalalune", { exact: true }).fill("1e8");
  await expect(
    panel.getByRole("button", { name: "Download review", exact: true }),
  ).toBeDisabled();
  await expect(panel.locator(".recipient-row")).toContainText("Invalid amount");
});

test("public funding records and the payout workspace are separate tabs", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/projects/eliza");
  await page.getByRole("link", { name: "Manage payouts" }).click();
  await expect(page).toHaveURL(/\/projects\/eliza\/funding#payouts$/u);
  const payouts = page.getByRole("tab", { name: "Manage payouts" });
  await expect(payouts).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".funding-workbench")).toBeVisible();
  await payouts.focus();
  await page.keyboard.press("ArrowLeft");
  const records = page.getByRole("tab", { name: "Funding records" });
  await expect(records).toBeFocused();
  await expect(records).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/\/projects\/eliza\/funding$/u);
  const panel = page.getByRole("tabpanel", { name: "Funding records" });
  await expect(panel).toContainText("Pledged, not committed");
  await expect(panel).toContainText("Not deployed");
  await expect(panel).toContainText(
    "No reviewed public funding transactions have been published yet.",
  );
  await expect(page.locator(".funding-workbench")).toBeHidden();
  await page.reload();
  await expect(records).toHaveAttribute("aria-selected", "true");
  await page.goto("/projects/eliza/funding#payouts");
  await expect(payouts).toHaveAttribute("aria-selected", "true");
  // Audit the settled workspace, not its loading transition.
  await expect(page.locator(".recipient-row").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save draft on this device" }),
  ).toBeEnabled();
  expect(errors).toEqual([]);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
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
  await page.goto("/projects/asi/funding#payouts");
  const panel = page.locator(".funding-workbench");
  await expect(
    panel.getByRole("button", { name: "Retry funding reviews" }),
  ).toBeVisible();
  await expect(panel).not.toContainText(
    "No complete monthly review has been published",
  );
});
