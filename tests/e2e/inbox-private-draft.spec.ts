import { enlargeText } from "../text-size";
import { expect, expectAccessible, test } from "./fixtures";

test("notification refresh preserves private edits only for the same account", async ({
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
  let authorityUnavailable = true;
  let mode: "ready" | "error" | "signed-out" = "error";
  let release: (() => void) | undefined;
  let notificationsStarted: (() => void) | undefined;
  let notificationRead = new Promise<void>((resolve) => {
    notificationsStarted = resolve;
  });
  let blocked: Promise<void> | undefined;
  const writes: string[] = [];
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
          automatic: false,
          authorityUnavailable,
          submissions: actor === "42" ? [submission] : [],
        },
      });
    if (path === `security-submissions/${id}` && actor === "42")
      return route.fulfill({ json: { submission, report } });
    if (path === "projects")
      return route.fulfill({ json: { schemaVersion: "1", projects: [] } });
    throw new Error(`Unexpected private-inbox fixture request: ${path}`);
  });
  diagnostics.allowResponse(503, "GET", "/api/v1/notifications");
  await page.goto(`/inbox?submission=${id}`, { waitUntil: "networkidle" });
  const card = page.locator(`[aria-labelledby="submission-${id}"]`);
  await expect(card.locator(".security-report-text")).toHaveText(
    report.description,
  );
  await card
    .getByText("Add evidence or correct report", { exact: true })
    .click();
  const correction = card.getByRole("textbox", {
    name: /^Description/u,
  });
  const text =
    "Unsaved corrected private reproduction steps. Keep this text only in memory.";
  await correction.fill(text);
  await page.getByRole("button", { name: /Case eference/u }).click();
  const selected = page.locator(`[aria-labelledby="case-${caseId}"]`);
  await expect(selected).toBeVisible();
  const partialNotice = page.getByText(
    "Some maintainer access could not be checked. Your own reports are shown.",
    { exact: false },
  );
  await expect(partialNotice).toBeVisible();
  const restoreText = await enlargeText(page.locator("main"));
  try {
    await expectAccessible(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("private-inbox-text200.png"),
      fullPage: true,
    });
  } finally {
    await restoreText();
  }
  authorityUnavailable = false;
  await page
    .getByRole("button", { name: "Retry access check", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(partialNotice).toHaveCount(0);
  await expect(correction).toHaveValue(text);
  // A notification outage must not block the independently authenticated report.
  await expect(page.getByRole("alert")).toContainText(
    "The inbox could not load",
  );
  mode = "ready";
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(correction).toHaveValue(text);
  await expect(selected).toBeVisible();
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
  try {
    await expect(correction).toHaveValue(text);
    await expect(selected).toBeVisible();
    mode = "error";
  } finally {
    release?.();
    blocked = undefined;
  }
  await expect(page.getByRole("alert")).toContainText(
    "The inbox could not load",
  );
  await expect(correction).toHaveValue(text);
  await expect(selected).toBeVisible();
  diagnostics.allowResponse(503, "GET", olderPath);
  blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  notificationRead = new Promise<void>((resolve) => {
    notificationsStarted = resolve;
  });
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await notificationRead;
  try {
    await expect(correction).toHaveValue(text);
    await expect(selected).toBeVisible();
    mode = "ready";
  } finally {
    release?.();
    blocked = undefined;
  }
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(correction).toHaveValue(text);
  await expect(selected).toBeVisible();
  await expectAccessible(page);
  await page.screenshot({
    path: info.outputPath("private-correction-retained.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Newer notifications", exact: true })
    .click();
  await expect(correction).toHaveValue(text);
  actor = "43";
  await page
    .getByRole("button", { name: "Older notifications", exact: true })
    .click();
  await expect(
    page.getByText("You have no private security cases."),
  ).toBeVisible();
  await expect(card).toHaveCount(0);
  await expect(selected).toHaveCount(0);
  await expect(page.locator("textarea")).toHaveCount(0);
  await expect(page).toHaveURL(/\/inbox$/u);
  await expect(
    page.getByRole("button", { name: "Newer notifications", exact: true }),
  ).toBeDisabled();
  actor = "42";
  await page
    .getByRole("button", { name: "Older notifications", exact: true })
    .click();
  await expect(card).toBeVisible();
  await expect(selected).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Newer notifications", exact: true }),
  ).toBeDisabled();
  await card.getByText("Read private report", { exact: true }).click();
  await card
    .getByText("Add evidence or correct report", { exact: true })
    .click();
  await expect(correction).toHaveValue(report.description);
  await page.screenshot({
    path: info.outputPath("account-switch-reset.png"),
    fullPage: true,
  });
  await correction.fill(text);
  mode = "signed-out";
  diagnostics.allowResponse(401, "GET", "/api/v1/notifications");
  diagnostics.allowResponse(401, "GET", olderPath);
  await page
    .getByRole("button", { name: "Older notifications", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Sign in with GitHub", exact: true }),
  ).toBeVisible();
  await expect(card).toHaveCount(0);
  await expect(page.locator("textarea")).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("signed-out-cleared.png"),
    fullPage: true,
  });
  expect(writes).toEqual([]);
  expect(
    await page.evaluate(
      (value) =>
        [localStorage, sessionStorage].some((storage) =>
          Object.values(storage).some((entry) => entry.includes(value)),
        ),
      text,
    ),
  ).toBe(false);
});
