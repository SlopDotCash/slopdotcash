import { expect, test } from "./fixtures";

test("private receipt response cannot be assigned to a later matching session", async ({
  page,
}) => {
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
  await page.goto(`/inbox?submission=${foreignId}`, {
    waitUntil: "networkidle",
  });
  expect(privateReads).toBe(1);
  await expect(page.getByRole("alert")).toContainText(
    "Private report status could not load.",
  );
  await expect(
    page.getByText(`Private report · ${foreignProject}`, { exact: true }),
  ).toHaveCount(0);
});

for (const mismatch of ["submissions", "cases"] as const) {
  test(`security page refuses ${mismatch} belonging to another response recipient`, async ({
    page,
  }) => {
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
    await expect(page.getByRole("alert")).toContainText("Your account changed.");
    await expect(page.getByText(foreignProject, { exact: false })).toHaveCount(
      0,
    );
  });
}
