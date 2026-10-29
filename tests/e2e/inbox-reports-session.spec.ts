import { expect, expectAccessible, test } from "./fixtures";

const record = (id: string) => ({
  id: `sc_actor_${id}_private`,
  projectId: `private-project-${id}`,
  revision: 1,
  view: "reporter",
  viewerRoles: ["reporter"],
  allowedActions: [],
  nextStep: `Private account ${id} finding`,
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
});

test("one Inbox shows reports and notifications for its confirmed recipient", async ({
  page,
}) => {
  let actor = "42";
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/projects")
      return route.fulfill({ json: { schemaVersion: "1", projects: [] } });
    if (path === "/api/v1/notifications/read") {
      await pending;
      return route.fulfill({ json: { ok: true } });
    }
    if (path === "/api/v1/notifications")
      return route.fulfill({
        json: {
          recipientGithubId: actor,
          unread: actor === "42" ? 1 : 0,
          nextCursor: null,
          notifications:
            actor === "42"
              ? [
                  {
                    eventKey: "wallet:fixture",
                    kind: "wallet_changed",
                    subject: "base",
                    detail: null,
                    actionPath: "/account#wallets",
                    sourceAt: "2026-10-27T12:00:00.000Z",
                    createdAt: "2026-10-27T12:00:00.000Z",
                    readAt: null,
                  },
                ]
              : [],
        },
      });
    if (path === "/api/v1/project-session")
      return route.fulfill({
        json: { session: { githubId: actor, githubLogin: `viewer-${actor}` } },
      });
    if (path === "/api/v1/security-cases")
      return route.fulfill({
        json: {
          viewer: { githubId: actor, githubLogin: `viewer-${actor}` },
          programs: [],
          cases: [record(actor)],
        },
      });
    if (path === "/api/v1/security-submissions")
      return route.fulfill({
        json: { recipientGithubId: actor, automatic: false, submissions: [] },
      });
    throw new Error(`Unexpected request: ${path}`);
  });
  try {
    await page.goto("/inbox?view=reports", { waitUntil: "networkidle" });
    await expect(
      page.getByText("Private account 42 finding", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Inbox views" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /^(Reports|Notifications)$/u }),
    ).toHaveCount(0);
    const notifications = page.getByRole("list", { name: "Notifications" });
    await expect(notifications).toContainText(
      "A base payout wallet was added to your account.",
    );
    await expect(
      page.getByText("Link or import a GitHub report", { exact: true }),
    ).toHaveCount(0);
    await expectAccessible(page);
    await page.screenshot({
      path: test.info().outputPath("unified-inbox.png"),
      fullPage: false,
    });
    await page
      .getByRole("button", { name: "Mark shown as read", exact: true })
      .click();
    await expect(
      page.getByText("Private account 42 finding", { exact: true }),
    ).toBeHidden();
    actor = "43";
    release();
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByText("Private account 42 finding", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("Private account 43 finding", { exact: true }),
    ).toBeVisible();
    await expect(notifications).toHaveCount(0);
  } finally {
    release();
  }
});

test("Reports view retains sign-in and account-error recovery", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowResponse(401, "GET", "/api/v1/notifications");
  diagnostics.allowResponse(503, "GET", "/api/v1/notifications");
  diagnostics.allowResponse(503, "GET", "/api/v1/project-session");
  let mode: "signed-out" | "error" | "ready" = "signed-out";
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/projects")
      return route.fulfill({ json: { schemaVersion: "1", projects: [] } });
    if (path === "/api/v1/notifications")
      return route.fulfill({
        status: mode === "signed-out" ? 401 : mode === "error" ? 503 : 200,
        json:
          mode === "ready"
            ? {
                recipientGithubId: "42",
                notifications: [],
                unread: 0,
                nextCursor: null,
              }
            : { error: mode },
      });
    if (path === "/api/v1/project-session")
      return route.fulfill({
        status: mode === "error" ? 503 : 200,
        json: {
          session:
            mode === "signed-out"
              ? null
              : { githubId: "42", githubLogin: "viewer-42" },
        },
      });
    if (path === "/api/v1/security-cases")
      return route.fulfill({
        json: {
          viewer: { githubId: "42", githubLogin: "viewer-42" },
          programs: [],
          cases: [],
        },
      });
    if (path === "/api/v1/security-submissions")
      return route.fulfill({
        json: { recipientGithubId: "42", automatic: false, submissions: [] },
      });
    throw new Error(`Unexpected request: ${path}`);
  });
  await page.goto("/inbox?view=reports", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("link", { name: "Sign in with GitHub", exact: true }),
  ).toBeVisible();
  mode = "error";
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("alert")).toContainText("could not load");
  mode = "ready";
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    page.getByText("You have no private reports yet.", { exact: true }),
  ).toBeVisible();
});

test("the financial filter keeps remediation distinct from payment", async ({
  page,
}) => {
  const paid = {
    ...record("42"),
    paymentState: "paid",
    awardState: "approved",
    remediationState: "investigating",
    nextStep: "Record remediation for this paid finding.",
  };
  const ineligible = {
    ...record("43"),
    awardState: "ineligible",
    receiptState: "rejected",
    nextStep: "This finding is ineligible for an award.",
  };
  const pending = { ...record("44"), nextStep: "The owner review is pending." };
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/projects")
      return route.fulfill({ json: { schemaVersion: "1", projects: [] } });
    if (path === "/api/v1/notifications")
      return route.fulfill({
        json: {
          recipientGithubId: "42",
          notifications: [],
          unread: 0,
          nextCursor: null,
        },
      });
    if (path === "/api/v1/project-session")
      return route.fulfill({
        json: { session: { githubId: "42", githubLogin: "reviewer" } },
      });
    if (path === "/api/v1/security-cases")
      return route.fulfill({
        json: {
          viewer: { githubId: "42", githubLogin: "reviewer" },
          programs: [
            { projectId: "private-project-42", roles: ["security-maintainer"] },
          ],
          cases: [paid, ineligible, pending],
        },
      });
    if (path === "/api/v1/security-submissions")
      return route.fulfill({
        json: { recipientGithubId: "42", automatic: false, submissions: [] },
      });
    throw new Error(`Unexpected request: ${path}`);
  });
  await page.goto("/inbox?view=reports", { waitUntil: "networkidle" });
  await expect(page.getByText(pending.nextStep, { exact: true })).toBeVisible();
  const filter = page.getByRole("combobox", {
    name: "Show reports",
    exact: true,
  });
  await filter.selectOption({ label: "Paid or ineligible" });
  await expect(page.getByText(pending.nextStep, { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByText(paid.nextStep, { exact: true })).toBeVisible();
  await expect(
    page.getByText(ineligible.nextStep, { exact: true }),
  ).toBeVisible();
  await filter.selectOption({ label: "All reports" });
  await expect(page.getByText(pending.nextStep, { exact: true })).toBeVisible();
});
