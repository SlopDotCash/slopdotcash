import { expect, test } from "./fixtures";

test("a failed focus refresh keeps the loaded notifications and offers a retry", async ({
  page,
  diagnostics,
}) => {
  let inboxDown = false;
  diagnostics.allowResponse(503, "GET", "/api/v1/notifications");
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/api/v1/projects")
      return route.fulfill({ json: { schemaVersion: "1", projects: [] } });
    if (pathname === "/api/v1/project-session")
      return route.fulfill({
        json: { session: { githubId: "42", githubLogin: "viewer-42" } },
      });
    if (pathname === "/api/v1/notifications")
      return inboxDown
        ? route.fulfill({ status: 503, json: { error: "unavailable" } })
        : route.fulfill({
            json: {
              recipientGithubId: "42",
              unread: 1,
              nextCursor: null,
              notifications: [
                {
                  eventKey: "project-revision:fixture-project:1",
                  kind: "project_revision",
                  subject: "fixture-project",
                  detail: "Fixture notice detail",
                  actionPath: "/projects/fixture-project",
                  sourceAt: "2026-10-27T12:00:00.000Z",
                  createdAt: "2026-10-27T12:00:00.000Z",
                  readAt: null,
                },
              ],
            },
          });
    if (pathname === "/api/v1/security-cases")
      return route.fulfill({
        json: {
          viewer: { githubId: "42", githubLogin: "viewer-42" },
          programs: [],
          cases: [],
        },
      });
    if (pathname === "/api/v1/security-submissions")
      return route.fulfill({
        json: { recipientGithubId: "42", automatic: false, submissions: [] },
      });
    throw new Error(
      `Unexpected inbox refresh fixture request: ${request.method()} ${pathname}`,
    );
  });
  await page.goto("/inbox", { waitUntil: "networkidle" });
  const notice = page.getByText("Fixture notice detail", { exact: true });
  await expect(notice).toBeVisible();

  // Returning to the tab refreshes the inbox; an outage during that refresh
  // must not replace the loaded list with an error screen.
  inboxDown = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const banner = page
    .getByRole("alert")
    .filter({ hasText: "Showing the last loaded notifications." });
  await expect(banner).toBeVisible();
  await expect(notice).toBeVisible();

  inboxDown = false;
  await banner.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(banner).toHaveCount(0);
  await expect(notice).toBeVisible();
});
