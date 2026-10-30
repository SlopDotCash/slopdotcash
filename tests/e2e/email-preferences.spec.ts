/** Actual Pages session + D1 preferences + shipped local notify Worker. No real email is sent. */
import { expect, expectAccessible, test } from "./fixtures";

test("verified activity email preference persists and can be withdrawn @registry", async ({
  browser,
}) => {
  // Each concurrent viewport owns its preference row in the real local D1.
  const tokens = JSON.parse(process.env.SLOP_E2E_EMAIL_TOKENS ?? "{}");
  const token = tokens[`email${test.info().project.use.viewport?.width}`];
  if (typeof token !== "string" || !token)
    throw new Error("Missing isolated email preference session");
  const context = await browser.newContext({
    viewport: test.info().project.use.viewport,
    recordVideo: { dir: test.info().outputPath("email-preference-video") },
  });
  const page = await context.newPage();
  await page.route("**/api/v1/payments/me", (route) =>
    route.fulfill({
      json: {
        githubUserId:
          test.info().project.use.viewport?.width === 320
            ? "900000104"
            : "900000101",
        wallets: [],
        payments: [],
        monthlyAwards: [],
        balances: [],
        directTransfers: [],
        walletObservations: [],
      },
    }),
  );
  const paymentReads: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/v1/payments/me")
      paymentReads.push(request.url());
  });
  // Firefox can render this page without resolving its navigation lifecycle
  // wait. Check the visible page and loaded fonts before starting the flow.
  await page.goto("/how-it-works", { waitUntil: "commit" });
  await expect(
    page.getByRole("heading", { name: "How Slop works", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.evaluate((token) => {
    document.cookie = `__Host-slop_points=${token}; Path=/; Secure; SameSite=Strict`;
  }, token);
  await page.goto("/inbox", { waitUntil: "networkidle" });
  await page
    .getByRole("link", { name: "Email preferences", exact: true })
    .click();
  await expect(page).toHaveURL(/account#notifications$/);
  const preferences = page.getByRole("region", { name: "Email preferences" });
  await expect(preferences).toHaveCount(1);
  await expect(
    page.locator("#wallets > summary, #notifications > summary"),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Wallets", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Local preview only/u)).toHaveCount(0);
  await expect(page.locator(".wallet-note")).toHaveCount(0);
  await expect(preferences).toContainText("applicant@example.com");
  const toggle = preferences.getByRole("switch", { name: "Activity email" });
  // Restore opt-out before exercising the complete consent workflow.
  if ((await toggle.getAttribute("aria-checked")) === "true")
    await toggle.click();
  await expect(toggle).not.toBeChecked();
  await page.screenshot({
    path: test.info().outputPath("optional-email-before.png"),
    fullPage: true,
  });
  await toggle.focus();
  const enabledResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/notifications/email",
  );
  await page.keyboard.press("Enter");
  expect((await enabledResponse).status()).toBe(200);
  await expect(toggle).toBeChecked();
  // Security email has its own consent, so the destination remains visible.
  await expect(preferences).toContainText("applicant@example.com");
  await page.screenshot({
    path: test.info().outputPath("optional-email-enabled.png"),
    fullPage: true,
  });
  await expectAccessible(page);
  await page.reload({ waitUntil: "networkidle" });
  await expect(toggle).toBeChecked();
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await expect(toggle).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("optional-email-zoom.png"),
    fullPage: true,
  });
  const disabledResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/notifications/email",
  );
  await toggle.click();
  expect((await disabledResponse).status()).toBe(200);
  await expect(toggle).not.toBeChecked();
  await expect(preferences).toContainText("applicant@example.com");
  await page.screenshot({
    path: test.info().outputPath("optional-email-disabled.png"),
    fullPage: true,
  });
  await expectAccessible(page);
  await page.reload({ waitUntil: "networkidle" });
  await expect(toggle).not.toBeChecked();
  expect(paymentReads.length).toBeGreaterThan(0);
  await context.close();
});
