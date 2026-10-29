import { expect, test } from "./fixtures";

test("a delayed Inbox response cannot expose the prior recipient after an account change", async ({
  page,
}) => {
  let actor = "42";
  let release!: () => void;
  let started!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requested = new Promise<void>((resolve) => {
    started = resolve;
  });
  const privateNotice = "Account 42 notification only";
  const privateReport = "Account 42 report only";
  const writes: string[] = [];
  await page.addInitScript(
    (markers) => {
      let leaked = false;
      Object.defineProperty(window, "__privateInboxLeaked", {
        get: () => leaked,
      });
      new MutationObserver(() => {
        const text = document.body?.textContent ?? "";
        leaked ||= markers.some((marker) => text.includes(marker));
      }).observe(document, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    },
    [privateNotice, privateReport],
  );
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== "GET") writes.push(path);
    if (path === "/api/v1/projects")
      return route.fulfill({ json: { schemaVersion: "1", projects: [] } });
    if (path === "/api/v1/project-session")
      return route.fulfill({
        json: { session: { githubId: actor, githubLogin: `viewer-${actor}` } },
      });
    if (path === "/api/v1/notifications") {
      const recipient = actor;
      if (recipient === "42") {
        started();
        await pending;
      }
      return route.fulfill({
        json: {
          recipientGithubId: recipient,
          unread: 1,
          nextCursor: null,
          notifications: [
            {
              eventKey: `account:${recipient}:notice`,
              kind: "project_revision",
              subject: `account-${recipient}`,
              detail:
                recipient === "42"
                  ? privateNotice
                  : "Account 43 notification only",
              actionPath: "/projects/eliza",
              sourceAt: "2026-10-27T12:00:00.000Z",
              createdAt: "2026-10-27T12:00:00.000Z",
              readAt: null,
            },
          ],
        },
      });
    }
    if (path === "/api/v1/security-cases")
      return route.fulfill({
        json: {
          viewer: { githubId: actor, githubLogin: `viewer-${actor}` },
          programs: [],
          cases: [
            {
              id: `sc_account_${actor}_private`,
              projectId: `private-project-${actor}`,
              revision: 1,
              view: "reporter",
              viewerRoles: ["reporter"],
              allowedActions: [],
              nextStep:
                actor === "42" ? privateReport : "Account 43 report only",
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
            },
          ],
        },
      });
    if (path === "/api/v1/security-submissions")
      return route.fulfill({
        json: { recipientGithubId: actor, automatic: false, submissions: [] },
      });
    throw new Error(
      `Unexpected private-inbox request: ${request.method()} ${path}`,
    );
  });
  try {
    await page.goto("/inbox", { waitUntil: "domcontentloaded" });
    await requested;
    actor = "43";
    release();
    await expect(
      page.getByRole("button", { name: "Retry", exact: true }),
    ).toBeVisible();
    await expect(page.getByText(privateNotice, { exact: true })).toHaveCount(0);
    await expect(page.getByText(privateReport, { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(
      page.getByText("Account 43 notification only", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Account 43 report only", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          (window as Window & { __privateInboxLeaked?: boolean })
            .__privateInboxLeaked,
      ),
    ).toBe(false);
    expect(writes).toEqual([]);
  } finally {
    release();
  }
});

test("private receipt response cannot be assigned to a later matching session", async ({
  page,
}, info) => {
  const foreignId = "ss_foreign_receipt";
  const foreignProject = "foreign-private-project";
  let privateReads = 0;
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
        json: { session: { githubId: "42", githubLogin: "viewer-a" } },
      });
    if (path === "/api/v1/security-cases")
      return route.fulfill({
        json: {
          viewer: { githubId: "42", githubLogin: "viewer-a" },
          programs: [],
          cases: [],
        },
      });
    if (path === "/api/v1/security-submissions") {
      privateReads++;
      // The private request used B's cookie after another tab changed sessions.
      // Before its response arrived, A signed in again. The next session GET
      // therefore returns A, but this response still belongs to B.
      return route.fulfill({
        json: {
          recipientGithubId: "43",
          automatic: false,
          submissions: [
            {
              id: foreignId,
              projectId: foreignProject,
              repository: "private/b",
              origin: "slop",
              state: "draft",
              revision: 1,
              attempt: 0,
              advisory: null,
              githubCreatedAt: null,
              failureCode: null,
              caseId: "sc_foreign_receipt",
              retryAllowed: false,
              reconcileAfter: null,
              intake: {
                state: "needs-information",
                receivedAt: "2026-10-27T12:00:00.000Z",
                revision: 1,
                reason: "Private B-only metadata",
                reviewedAt: null,
                canReview: false,
                canForward: false,
                canRetryScreening: false,
              },
            },
          ],
        },
      });
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  await page.goto(`/inbox?view=notifications&submission=${foreignId}`, {
    waitUntil: "networkidle",
  });
  expect(privateReads).toBe(1);
  await expect(page.getByRole("alert")).toContainText(
    "This private response belongs to another account.",
  );
  await expect(
    page.getByText(`Private report · ${foreignProject}`, { exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("private-list-refusal.png"),
    fullPage: true,
  });
});

for (const mismatch of ["submissions", "cases"] as const) {
  test(`security page refuses ${mismatch} belonging to another response recipient`, async ({
    page,
  }, info) => {
    const foreignProject = "foreign-private-project";
    await page.route("**/api/v1/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/v1/projects")
        return route.fulfill({ json: { schemaVersion: "1", projects: [] } });
      if (path === "/api/v1/project-session")
        return route.fulfill({
          json: { session: { githubId: "42", githubLogin: "viewer-a" } },
        });
      if (path === "/api/v1/security-cases")
        return route.fulfill({
          json: {
            viewer: {
              githubId: mismatch === "cases" ? "43" : "42",
              githubLogin: "viewer",
            },
            programs: [],
            cases:
              mismatch === "cases"
                ? [
                    {
                      id: "sc_foreign_case",
                      projectId: foreignProject,
                      revision: 1,
                      view: "reporter",
                      viewerRoles: ["reporter"],
                      allowedActions: [],
                      nextStep: "Private B-only case",
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
                    },
                  ]
                : [],
          },
        });
      if (path === "/api/v1/security-submissions")
        return route.fulfill({
          json: {
            recipientGithubId: "43",
            automatic: false,
            submissions: [
              {
                id: "ss_foreign_receipt",
                projectId: foreignProject,
                repository: "private/b",
                origin: "slop",
                state: "draft",
                revision: 1,
                attempt: 0,
                advisory: null,
                githubCreatedAt: null,
                failureCode: null,
                caseId: null,
                retryAllowed: false,
                reconcileAfter: null,
                intake: {
                  state: "needs-information",
                  receivedAt: "2026-10-27T12:00:00.000Z",
                  revision: 1,
                  reason: "Private B-only metadata",
                  reviewedAt: null,
                  canReview: false,
                  canForward: false,
                  canRetryScreening: false,
                },
              },
            ],
          },
        });
      throw new Error(`Unexpected request: ${path}`);
    });
    await page.goto("/security", { waitUntil: "networkidle" });
    await expect(page.getByRole("alert")).toContainText(
      "This private response belongs to another account.",
    );
    await expect(
      page.getByRole("button", { name: "Retry private session", exact: true }),
    ).toBeVisible();
    await expect(page.getByText(foreignProject, { exact: false })).toHaveCount(
      0,
    );
    await page.screenshot({
      path: info.outputPath("private-list-refusal.png"),
      fullPage: true,
    });
  });
}
