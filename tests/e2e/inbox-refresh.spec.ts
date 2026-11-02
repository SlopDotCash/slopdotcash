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

test("an identity change removes the loaded notifications before the refresh lands", async ({
  page,
}) => {
  let actor = "42";
  let holdNotifications = false;
  let releaseNotifications: (() => void) | undefined;
  const notificationsFor = (id: string) => ({
    recipientGithubId: id,
    unread: 1,
    nextCursor: null,
    notifications: [
      {
        eventKey: `project-revision:fixture-project:${id}`,
        kind: "project_revision",
        subject: "fixture-project",
        detail: id === "42" ? "Fixture notice detail" : "Second account notice",
        actionPath: "/projects/fixture-project",
        sourceAt: "2026-10-27T12:00:00.000Z",
        createdAt: "2026-10-27T12:00:00.000Z",
        readAt: null,
      },
    ],
  });
  const submissionFor = (id: string) => ({
    id: `ss_account_${id}_private`,
    projectId: `private-project-${id}`,
    repository: "example/private",
    origin: "slop",
    state: "draft",
    revision: 1,
    attempt: 0,
    advisory: null,
    githubCreatedAt: null,
    failureCode: null,
    caseId: `sc_account_${id}_private`,
    retryAllowed: false,
    reconcileAfter: null,
    intake: {
      state: "legitimate",
      receivedAt: "2026-10-27T12:00:00.000Z",
      routingState: "routed",
      revision: 1,
      reason: null,
      reviewedAt: null,
      canReview: true,
      canForward: false,
      canRetryScreening: false,
      canAuthorize: false,
      canRevise: false,
    },
  });
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/api/v1/projects")
      return route.fulfill({ json: { schemaVersion: "1", projects: [] } });
    if (pathname === "/api/v1/project-session")
      return route.fulfill({
        json: {
          session: { githubId: actor, githubLogin: `viewer-${actor}` },
        },
      });
    if (pathname === "/api/v1/notifications") {
      if (holdNotifications)
        await new Promise<void>((resolve) => {
          releaseNotifications = resolve;
        });
      return route.fulfill({ json: notificationsFor(actor) });
    }
    if (pathname === "/api/v1/security-cases")
      return route.fulfill({
        json: {
          viewer: { githubId: actor, githubLogin: `viewer-${actor}` },
          programs: [],
          cases: [],
        },
      });
    if (pathname === "/api/v1/security-submissions")
      return route.fulfill({
        json: {
          recipientGithubId: actor,
          automatic: false,
          submissions: [submissionFor(actor)],
        },
      });
    throw new Error(
      `Unexpected identity-change fixture request: ${request.method()} ${pathname}`,
    );
  });
  await page.goto("/inbox", { waitUntil: "networkidle" });
  const notice = page.getByText("Fixture notice detail", { exact: true });
  await expect(notice).toBeVisible();

  // The reports panel learns the session now belongs to another account and
  // reports the identity change; the notifications refresh that triggers is
  // held back, and the previous account's list must already be gone.
  actor = "43";
  holdNotifications = true;
  await page
    .getByRole("button", { name: "Refresh reports", exact: true })
    .click();
  await expect(notice).toHaveCount(0);

  releaseNotifications?.();
  await expect(
    page.getByText("Second account notice", { exact: true }),
  ).toBeVisible();
});
