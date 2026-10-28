/**
 * Signed-out visits to the Payouts and Inbox pages read the session first and
 * never send the signed-in reads the browser would log as 401 failures
 * (PRD section 7, Member; CLAUDE.md "zero first-party request failures").
 */
import { expect, test } from "./fixtures";

const SIGNED_IN_READS = ["/api/v1/payments/me", "/api/v1/notifications"];

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({ json: { session: null } }),
  );
  await page.route("**/api/v1/points/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      json: path.endsWith("/sessions")
        ? { sessions: [] }
        : path.endsWith("/x/me")
          ? { configured: false, account: null, award: null }
          : null,
    });
  });
});

for (const [path, heading, prompt] of [
  ["/earnings", "Payouts", "Sign in with GitHub"],
  ["/inbox", "Inbox", "Sign in with GitHub"],
] as const) {
  test(`signed-out ${path} sends no signed-in read`, async ({
    page,
    diagnostics,
  }) => {
    diagnostics.allowPreviewApiMisses();
    const sent: string[] = [];
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (SIGNED_IN_READS.includes(pathname)) sent.push(pathname);
    });
    await page.goto(path, { waitUntil: "networkidle" });
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: prompt }).first(),
    ).toBeVisible();
    expect(sent).toEqual([]);
  });
}

test("a failed session read still lets the payouts read decide", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  diagnostics.allowResponse(503, "GET", "/api/v1/project-session");
  diagnostics.allowResponse(401, "GET", "/api/v1/payments/me");
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({ status: 503, json: { error: "unavailable" } }),
  );
  await page.route("**/api/v1/payments/me", (route) =>
    route.fulfill({ status: 401, json: { error: "unauthorized" } }),
  );
  await page.goto("/earnings", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("link", { name: "Sign in with GitHub" }).first(),
  ).toBeVisible();
});
