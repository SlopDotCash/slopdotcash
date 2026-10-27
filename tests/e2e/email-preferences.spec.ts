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
  await page.goto("/how-it-works", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: "How Slop works", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.evaluate((token) => {
    document.cookie = `__Host-slop_points=${token}; Path=/; Secure; SameSite=Strict`;
  }, token);
  await page.goto("/inbox", { waitUntil: "networkidle" });
  const preferences = page.getByRole("region", { name: "Email preferences" });
  await expect(preferences).toContainText("applicant@example.com");
  // Restore opt-out before exercising the complete consent workflow.
  const off = preferences.getByRole("button", {
    name: "Turn off activity email",
  });
  if (await off.isVisible()) await off.click();
  await page.screenshot({
    path: test.info().outputPath("optional-email-before.png"),
    fullPage: true,
  });
  await preferences
    .getByRole("button", { name: "Turn on activity email" })
    .focus();
  const enabledResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/notifications/email",
  );
  await page.keyboard.press("Enter");
  expect((await enabledResponse).status()).toBe(200);
  await expect(preferences.getByRole("status")).toContainText(
    "Optional activity email is on.",
  );
  await page.screenshot({
    path: test.info().outputPath("optional-email-enabled.png"),
    fullPage: true,
  });
  await expectAccessible(page);
  await page.reload({ waitUntil: "networkidle" });
  await expect(
    preferences.getByRole("button", { name: "Turn off activity email" }),
  ).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await expect(
    preferences.getByRole("button", { name: "Turn off activity email" }),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("optional-email-zoom.png"),
    fullPage: true,
  });
  const disabledResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/notifications/email",
  );
  await preferences
    .getByRole("button", { name: "Turn off activity email" })
    .click();
  expect((await disabledResponse).status()).toBe(200);
  await expect(preferences.getByRole("status")).toContainText(
    "Optional activity email is off.",
  );
  await page.screenshot({
    path: test.info().outputPath("optional-email-disabled.png"),
    fullPage: true,
  });
  await expectAccessible(page);
  await page.reload({ waitUntil: "networkidle" });
  await expect(
    preferences.getByRole("button", { name: "Turn on activity email" }),
  ).toBeVisible();
  await context.close();
});
