import { enlargeText } from "../text-size";
import { expect, expectAccessible, test } from "./fixtures";

test("compact Inbox keeps private report metadata scoped through refresh and outages", async ({
  page,
  diagnostics,
}, info) => {
  const id = "ss_unsaved_correction";
  const caseId = "sc_selected_reference";
  const cursor = JSON.stringify(["2026-10-27T12:00:00.000Z", "report:older"]);
  const olderPath = `/api/v1/notifications?${new URLSearchParams({ cursor })}`;
  const report = {
    summary: "Original private summary",
    description:
      "Original private report details for the isolated browser fixture.",
  };
  const submission = {
    id,
    projectId: "asi",
    repository: "example/private",
    origin: "slop",
    state: "draft",
    revision: 2,
    attempt: 0,
    advisory: null,
    githubCreatedAt: null,
    failureCode: null,
    caseId: "sc_unsaved_correction",
    retryAllowed: false,
    reconcileAfter: null,
    intake: {
      state: "needs-information",
      receivedAt: "2026-10-27T12:00:00.000Z",
      revision: 2,
      reason: "Add reproduction details.",
      reviewedAt: null,
      canReview: false,
      canForward: false,
      canRetryScreening: false,
      canAuthorize: false,
      canRevise: true,
    },
  };
  const selectedCase = {
    id: caseId,
    projectId: "asi",
    revision: 1,
    view: "reporter",
    viewerRoles: ["reporter"],
    allowedActions: [],
    nextStep: "The owner is reviewing the private findings.",
    nextStepDueAt: null,
    submissionState: "verified",
    receivedAt: "2026-10-27T12:00:00.000Z",
    receivedAtSource: "slop-received",
    policyRevision: null,
    terms: null,
    awardState: "not-decided",
    award: null,
    relatedParty: "unrelated",
    relatedPartyReview: "not-applicable",
    paymentState: "not-scheduled",
    paymentRail: "unavailable",
    paymentNetworks: [],
    settlement: null,
    paymentDeadline: null,
    disclosureState: "embargoed",
  };
  let actor = "42";
  const authorityUnavailable = true;
  let mode: "ready" | "error" | "signed-out" = "error";
  let release: (() => void) | undefined;
  let notificationsStarted: (() => void) | undefined;
  let notificationRead = new Promise<void>((resolve) => {
    notificationsStarted = resolve;
  });
  let blocked: Promise<void> | undefined;
  const writes: string[] = [];
  let reportReads = 0;
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.slice("/api/v1/".length);
    if (route.request().method() !== "GET") writes.push(path);
    if (path === "notifications") {
      notificationsStarted?.();
      if (blocked) await blocked;
      return route.fulfill({
        status: mode === "signed-out" ? 401 : mode === "error" ? 503 : 200,
        json:
          mode === "ready"
            ? {
                recipientGithubId: actor,
                notifications: [],
                unread: 0,
                nextCursor: url.search ? null : cursor,
              }
            : { error: mode },
      });
    }
    if (path === "project-session")
      return route.fulfill({
        json: {
          session:
            mode === "signed-out"
              ? null
              : { githubId: actor, githubLogin: `reporter-${actor}` },
        },
      });
    if (path === "security-cases")
      return route.fulfill({
        json: {
          viewer: { githubId: actor, githubLogin: `reporter-${actor}` },
          cases: actor === "42" ? [selectedCase] : [],
          programs: [],
        },
      });
    if (path === `security-cases/${caseId}` && actor === "42")
      return route.fulfill({ json: { case: selectedCase } });
    if (path === "security-submissions")
      return route.fulfill({
        json: {
          recipientGithubId: actor,
          automatic: false,
          authorityUnavailable,
          submissions: actor === "42" ? [submission] : [],
        },
      });
    if (path === `security-submissions/${id}` && actor === "42") {
      reportReads++;
      return route.fulfill({ json: { submission, report } });
    }
    if (path === "projects")
      return route.fulfill({ json: { schemaVersion: "1", projects: [] } });
    throw new Error(`Unexpected private-inbox fixture request: ${path}`);
  });
  diagnostics.allowResponse(503, "GET", "/api/v1/notifications");
  await page.goto(`/inbox?view=notifications&submission=${id}`, {
    waitUntil: "networkidle",
  });
  const receipt = page.getByRole("list", { name: "Private report receipt" });
  await expect(receipt).toContainText("More evidence needed");
  await expect(page.getByText(report.description, { exact: true })).toHaveCount(
    0,
  );
  await expect(page.locator("textarea")).toHaveCount(0);
  expect(reportReads).toBe(0);
  const restoreText = await enlargeText(page.locator("main"));
  await expectAccessible(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("compact-inbox-text200.png"),
    fullPage: true,
  });
  await restoreText();
  mode = "ready";
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Notifications" })).toContainText(
    "More evidence needed",
  );
  blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  notificationRead = new Promise<void>((resolve) => {
    notificationsStarted = resolve;
  });
  await page
    .getByRole("button", { name: "Older notifications", exact: true })
    .click();
  await notificationRead;
  mode = "error";
  release?.();
  blocked = undefined;
  diagnostics.allowResponse(503, "GET", olderPath);
  await expect(page.getByRole("alert")).toContainText(
    "The inbox could not load",
  );
  await expect(receipt).toContainText("More evidence needed");
  actor = "43";
  // The account change resets the cursor, which starts a second, first-page
  // read. It must fail in "error" mode before the fixture recovers, or that
  // read races the mode switch and the Retry control never appears.
  const firstPageRetry = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/notifications" &&
      new URL(response.url()).search === "" &&
      response.status() === 503,
  );
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(receipt).toHaveCount(0);
  await expect(page).toHaveURL(/\/inbox\?view=notifications$/u);
  await expect(page.locator("textarea")).toHaveCount(0);
  await firstPageRetry;
  await expect(page.getByRole("alert")).toContainText(
    "The inbox could not load",
  );
  mode = "ready";
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText("You have no notifications.")).toBeVisible();
  actor = "42";
  await page.goto(`/inbox?view=notifications&submission=${id}`, {
    waitUntil: "networkidle",
  });
  await expect(page.getByRole("list", { name: "Notifications" })).toContainText(
    "More evidence needed",
  );
  mode = "signed-out";
  diagnostics.allowResponse(401, "GET", olderPath);
  diagnostics.allowResponse(401, "GET", "/api/v1/notifications");
  await page
    .getByRole("button", { name: "Older notifications", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Sign in with GitHub", exact: true }),
  ).toBeVisible();
  await expect(receipt).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Open case", exact: true }),
  ).toHaveCount(0);
  expect(reportReads).toBe(0);
  expect(writes).toEqual([]);
});
