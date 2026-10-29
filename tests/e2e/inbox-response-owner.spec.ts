import { expect, test } from "./fixtures";

for (const action of ["acknowledge", "read"] as const) {
  test(`${action} binds the Inbox recipient before posting and rechecks rejected actions`, async ({
    page,
    diagnostics,
  }) => {
    let actor = "42";
    let sessionUnavailable = false;
    let hold = false;
    let started!: () => void;
    let release!: () => void;
    let pending = Promise.resolve();
    const actions: { actor: string; path: string }[] = [];
    const caseId = (id: string) => `sc_action_${id}_fixture`;
    const path =
      action === "read"
        ? "/api/v1/notifications/read"
        : `/api/v1/security-cases/${caseId("42")}/acknowledge`;
    diagnostics.allowResponse(403, "POST", path);
    diagnostics.allowResponse(503, "GET", "/api/v1/project-session");
    await page.route("**/api/v1/**", async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (pathname === "/api/v1/projects")
        return route.fulfill({ json: { schemaVersion: "1", projects: [] } });
      if (pathname === "/api/v1/project-session")
        return route.fulfill({
          status: sessionUnavailable ? 503 : 200,
          json: sessionUnavailable
            ? { error: "unavailable" }
            : {
                session: { githubId: actor, githubLogin: `viewer-${actor}` },
              },
        });
      if (pathname === "/api/v1/notifications")
        return route.fulfill({
          json: {
            recipientGithubId: actor,
            unread: 1,
            nextCursor: null,
            notifications: [
              {
                eventKey: `security-case:${caseId(actor)}:triage`,
                kind: "security_case",
                subject: caseId(actor),
                detail: `Private notice for ${actor}`,
                actionPath: `/inbox?case=${caseId(actor)}`,
                sourceAt: "2026-10-27T12:00:00.000Z",
                createdAt: "2026-10-27T12:00:00.000Z",
                readAt: null,
                acknowledgedAt: null,
              },
            ],
          },
        });
      if (pathname === "/api/v1/security-cases")
        return route.fulfill({
          json: {
            viewer: { githubId: actor, githubLogin: `viewer-${actor}` },
            programs: [],
            cases: [
              {
                id: caseId(actor),
                projectId: `private-project-${actor}`,
                revision: 1,
                view: "reporter",
                viewerRoles: ["reporter"],
                allowedActions: [],
                nextStep: `Private report for ${actor}`,
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
      if (pathname === "/api/v1/security-submissions")
        return route.fulfill({
          json: { recipientGithubId: actor, automatic: false, submissions: [] },
        });
      if (request.method() === "POST" && pathname === path) {
        actions.push({ actor, path: pathname });
        if (hold) {
          started();
          await pending;
        }
        return route.fulfill({ status: 403, json: { error: "forbidden" } });
      }
      throw new Error(
        `Unexpected Inbox action fixture request: ${request.method()} ${pathname}`,
      );
    });
    const trigger = () =>
      action === "read"
        ? page.getByRole("button", { name: "Mark shown as read", exact: true })
        : page.getByRole("button", { name: /^Acknowledge:/u });
    const report = (id: string) =>
      page.getByText(`Private report for ${id}`, { exact: true });
    const notice = (id: string) =>
      page.getByText(`Private notice for ${id}`, { exact: true });
    const expectCurrentRecipient = async () => {
      await expect(report("42")).toHaveCount(0);
      await expect(notice("42")).toHaveCount(0);
      const retry = page.getByRole("button", { name: "Retry", exact: true });
      if (await retry.isVisible()) await retry.click();
      await expect(report("43")).toBeVisible();
      await expect(notice("43")).toBeVisible();
    };
    try {
      await page.goto("/inbox", { waitUntil: "networkidle" });
      await expect(report("42")).toBeVisible();
      // A denied action may retain metadata only after verifying the same account.
      await trigger().click();
      await expect(
        page
          .getByRole("alert")
          .filter({ hasText: /Could not (?:mark|acknowledge)/u }),
      ).toBeVisible();
      await expect(report("42")).toBeVisible();
      await expect(notice("42")).toBeVisible();
      expect(actions).toHaveLength(1);
      hold = true;
      const requested = new Promise<void>((resolve) => {
        started = resolve;
      });
      pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      await trigger().click();
      await requested;
      actor = "43";
      release();
      hold = false;
      await expectCurrentRecipient();
      expect(actions).toHaveLength(2);
      // A session changed before the click must not post the previous recipient's event.
      actor = "42";
      await page.goto("/inbox", { waitUntil: "networkidle" });
      await expect(report("42")).toBeVisible();
      actor = "43";
      await trigger().click();
      await expectCurrentRecipient();
      expect(actions).toHaveLength(2);
      expect(actions.every((entry) => entry.actor === "42")).toBe(true);
      // Failure to verify the account after a denied action cannot retain private data.
      actor = "42";
      await page.goto("/inbox", { waitUntil: "networkidle" });
      await expect(report("42")).toBeVisible();
      hold = true;
      const unknownRequested = new Promise<void>((resolve) => {
        started = resolve;
      });
      pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      await trigger().click();
      await unknownRequested;
      sessionUnavailable = true;
      release();
      hold = false;
      await expect(report("42")).toHaveCount(0);
      await expect(notice("42")).toHaveCount(0);
      await expect(
        page.getByRole("region", {
          name: "Private security reports",
          exact: true,
        }),
      ).toHaveCount(0);
      expect(actions).toHaveLength(3);
      expect(actions.every((entry) => entry.actor === "42")).toBe(true);
      sessionUnavailable = false;
      await page.getByRole("button", { name: "Retry", exact: true }).click();
      await expect(report("42")).toBeVisible();
      await expect(notice("42")).toBeVisible();
    } finally {
      release?.();
    }
  });
}

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
