import { appealSeedSql, runAppealFixtureSql } from "../slopbot-appeal-fixture";
import { expect, expectAccessible, test } from "./fixtures";

// The worker workflow test covers the actual escalation and mail dispatch.
// This browser check uses its writer against the real local Pages/D1 fixture.
test("an escalated contribution appeal opens from the moderator Inbox and shows resolution @registry", async ({
  diagnostics,
  page,
}) => {
  diagnostics.allowCanceledBackgroundReads();
  const persist = process.env.SLOP_E2E_PERSIST_TO;
  const token = process.env.SLOP_E2E_MODERATOR_TOKEN;
  if (!persist || !token) throw new Error("Missing isolated registry fixture");
  const sql = (command: string) => runAppealFixtureSql(persist, command);
  const quote = (value: unknown) => `'${String(value).replaceAll("'", "''")}'`;
  const key = `appeal:browser-${test.info().project.name}:revision`;
  const at = new Date().toISOString();
  await sql(appealSeedSql(key, at));
  await page.goto("/how-it-works", { waitUntil: "networkidle" });
  await page.evaluate((value) => {
    document.cookie = `__Host-slop_points=${value}; Path=/; Secure; SameSite=Strict`;
  }, token);
  await page.goto("/inbox", { waitUntil: "networkidle" });
  const path = `/api/v1/notifications/appeals/${encodeURIComponent(key)}`;
  const item = page.locator(".inbox-item", {
    has: page.locator(`a[href="${path}"]`),
  });
  await expect(item).toHaveCount(1);
  await expect(
    item.getByText("A contribution appeal needs your decision on GitHub."),
  ).toBeVisible();
  // Fetch the real authenticated redirect with the browser's request headers,
  // then hold it so this synthetic contribution never reaches live GitHub.
  await page.route(`**${path}`, async (route) => {
    const response = await route.fetch({ maxRedirects: 0 });
    expect(response.status()).toBe(302);
    expect(response.headers().location).toBe(
      "https://github.com/example/project/pull/5",
    );
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "Verified GitHub appeal redirect",
    });
  });
  await item.getByRole("link", { name: /Open appeal on GitHub/u }).click();
  await expect(page.getByText("Verified GitHub appeal redirect")).toBeVisible();
  await page.goto("/inbox", { waitUntil: "networkidle" });
  await item.getByRole("button", { name: "Mark as read" }).focus();
  await page.keyboard.press("Enter");
  await expect(item.locator(".inbox-state")).toHaveText("Read");
  await expectAccessible(page, { everyRule: true });
  await page.screenshot({
    path: test.info().outputPath("appeal-review.png"),
    fullPage: true,
  });
  await sql(
    `UPDATE slopbot_appeals SET resolved_at=${quote(new Date().toISOString())},resolution='denied',resolved_by='moderator' WHERE appeal_key=${quote(key)};`,
  );
  await page.reload({ waitUntil: "networkidle" });
  await expect(
    item.getByText("The contribution appeal was resolved."),
  ).toBeVisible();
  await expect(
    item.getByText("A contribution appeal needs your decision on GitHub."),
  ).toHaveCount(0);
  await page.screenshot({
    path: test.info().outputPath("appeal-resolved.png"),
    fullPage: true,
  });
});
