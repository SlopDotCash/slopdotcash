import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

async function privateReports(page: Page, standalone = false) {
  const state = {
    actor: "42" as string | null,
    sessionUnavailable: false,
    reportsUnavailable: false,
    revokedStatus: null as 401 | 404 | null,
    raceAtNextDetail: false,
    rejectedActorBindings: 0,
    mutations: 0,
  };
  const id = (actor: string) => `ss_account_${actor}_private`;
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const actor = state.actor;
    const session = actor
      ? { githubId: actor, githubLogin: `account-${actor}` }
      : null;
    if (path === "/api/v1/projects")
      return route.fulfill({ json: { schemaVersion: "1", projects: [] } });
    if (path === "/api/v1/project-session")
      return route.fulfill({
        status: state.sessionUnavailable ? 503 : 200,
        json: state.sessionUnavailable ? { error: "unavailable" } : { session },
      });
    if (path === "/api/v1/notifications")
      return route.fulfill({
        status: actor ? 200 : 401,
        json: actor
          ? {
              recipientGithubId: actor,
              notifications: [],
              unread: 0,
              nextCursor: null,
            }
          : { error: "unauthorized" },
      });
    if (path === "/api/v1/security-cases")
      return route.fulfill({
        status: actor ? 200 : 401,
        json: actor
          ? { viewer: session, programs: [], cases: [] }
          : { error: "unauthorized" },
      });
    const submission = actor
      ? {
          id: id(actor),
          projectId: `private-project-${actor}`,
          repository: "example/private",
          origin: "slop",
          state: "draft",
          revision: 1,
          attempt: 0,
          advisory: null,
          githubCreatedAt: null,
          failureCode: null,
          caseId: `sc_account_${actor}_private`,
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
        }
      : null;
    if (path === "/api/v1/security-submissions" && state.revokedStatus) {
      const status = state.revokedStatus;
      if (status === 401) state.actor = null;
      return route.fulfill({ status, json: { error: "access_changed" } });
    }
    if (path === "/api/v1/security-submissions")
      return route.fulfill({
        status: state.reportsUnavailable ? 503 : actor ? 200 : 401,
        json: state.reportsUnavailable
          ? { error: "unavailable" }
          : actor
            ? {
                recipientGithubId: actor,
                automatic: false,
                submissions: [submission],
              }
            : { error: "unauthorized" },
      });
    if (path.endsWith("/review")) {
      state.mutations++;
      return route.fulfill({ status: 403, json: { error: "forbidden" } });
    }
    if (
      path.startsWith("/api/v1/security-submissions/") &&
      state.raceAtNextDetail
    ) {
      state.raceAtNextDetail = false;
      // The session reads before and after this request still see account A.
      // Only the request-time binding can reject account B's response.
      const expected = request.headers()["x-slop-expected-github-id"];
      if (expected && expected !== "43") {
        state.rejectedActorBindings++;
        return route.fulfill({
          status: 403,
          json: { error: "actor_changed" },
        });
      }
      return route.fulfill({
        json: {
          submission,
          report: {
            summary: "Account B's privileged view",
            description: "Confidential authority data for account 43.",
          },
        },
      });
    }
    if (path.startsWith("/api/v1/security-submissions/"))
      return route.fulfill({
        status: actor && path.endsWith(`/${id(actor)}`) ? 200 : 404,
        json:
          actor && path.endsWith(`/${id(actor)}`)
            ? {
                submission,
                report: {
                  summary: `Private finding ${actor}`,
                  description: `Confidential retained evidence for account ${actor}.`,
                },
              }
            : { error: "not_found" },
      });
    throw new Error(`Unexpected request: ${path}`);
  });
  await page.goto(
    standalone
      ? `/security?submission=${id("42")}`
      : `/inbox?view=reports&submission=${id("42")}`,
    { waitUntil: "networkidle" },
  );
  await page.bringToFront();
  await page.waitForLoadState("networkidle");
  const evidence = page.getByText(
    "Confidential retained evidence for account 42.",
    { exact: true },
  );
  if (!(await evidence.isVisible()))
    await page.getByText("Read private report", { exact: true }).click();
  await expect(evidence).toBeVisible();
  return state;
}

test("Reports refresh removes the previous account's retained report", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  const state = await privateReports(page);
  state.actor = "43";
  await page
    .getByRole("button", { name: "Refresh reports", exact: true })
    .click();
  await expect(
    page.getByText("Confidential retained evidence for account 42.", {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", {
      name: "Private report · private-project-43",
      exact: true,
    }),
  ).toBeVisible();
});

test("Reports focus clears retained evidence after sign-out", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  diagnostics.allowResponse(401, "GET", "/api/v1/notifications");
  const state = await privateReports(page);
  state.actor = null;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByText("Confidential retained evidence for account 42.", {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Sign in with GitHub", exact: true }),
  ).toBeVisible();
});

test("a report action rechecks the account before sending a mutation", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  diagnostics.allowResponse(
    403,
    "POST",
    "/api/v1/security-submissions/ss_account_42_private/review",
  );
  const state = await privateReports(page);
  await page
    .getByLabel("Review reason", { exact: true })
    .fill("The private evidence is ready for owner review.");
  state.actor = "43";
  await page
    .getByRole("button", { name: "Approve for owner review", exact: true })
    .click();
  await expect(
    page.getByText("Confidential retained evidence for account 42.", {
      exact: true,
    }),
  ).toHaveCount(0);
  expect(state.mutations).toBe(0);
});

test("report errors retain evidence only while the current account is verified", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  diagnostics.allowResponse(503, "GET", "/api/v1/security-submissions");
  diagnostics.allowResponse(503, "GET", "/api/v1/project-session");
  const state = await privateReports(page);
  state.reportsUnavailable = true;
  await page
    .getByRole("button", { name: "Refresh reports", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByText("Confidential retained evidence for account 42.", {
      exact: true,
    }),
  ).toBeVisible();
  state.sessionUnavailable = true;
  await page
    .getByRole("button", { name: "Refresh reports", exact: true })
    .click();
  await expect(
    page.getByText("Confidential retained evidence for account 42.", {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(page.getByRole("alert")).toBeVisible();
});

for (const status of [401, 404] as const) {
  test(`revoked private-report access (${status}) removes retained evidence`, async ({
    page,
    diagnostics,
  }) => {
    diagnostics.allowPreviewApiMisses();
    diagnostics.allowResponse(status, "GET", "/api/v1/security-submissions");
    if (status === 401)
      diagnostics.allowResponse(401, "GET", "/api/v1/notifications");
    const state = await privateReports(page);
    state.revokedStatus = status;
    await page
      .getByRole("button", { name: "Refresh reports", exact: true })
      .click();
    await expect(
      page.getByText("Confidential retained evidence for account 42.", {
        exact: true,
      }),
    ).toHaveCount(0);
    if (status === 401)
      await expect(
        page.getByRole("link", { name: "Sign in with GitHub", exact: true }),
      ).toBeVisible();
    else await expect(page.getByRole("alert")).toBeVisible();
  });
}

test("request-time account binding refuses an A-to-B-to-A detail response", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  diagnostics.allowResponse(
    403,
    "GET",
    "/api/v1/security-submissions/ss_account_42_private",
  );
  const state = await privateReports(page);
  const detail = page.getByText("Read private report", { exact: true });
  await detail.click();
  await expect(
    page.getByText("Confidential retained evidence for account 42.", {
      exact: true,
    }),
  ).toHaveCount(0);
  state.raceAtNextDetail = true;
  await detail.click();
  await expect.poll(() => state.rejectedActorBindings).toBe(1);
  await expect(
    page.getByText("Confidential authority data for account 43.", {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(page.getByRole("alert")).toBeVisible();
});

test("a standalone private workspace clears drafts when its request loses authentication", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  diagnostics.allowResponse(401, "GET", "/api/v1/security-submissions");
  const state = await privateReports(page, true);
  const key = "slop-report-compose:42:private-test";
  await page.evaluate((draftKey) => {
    sessionStorage.setItem(
      draftKey,
      JSON.stringify({ private: "test evidence" }),
    );
  }, key);
  state.revokedStatus = 401;
  await page
    .getByRole("button", { name: "Refresh reports", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate((draftKey) => sessionStorage.getItem(draftKey), key),
    )
    .toBeNull();
  await expect(
    page.getByText("Confidential retained evidence for account 42.", {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(page.getByRole("alert")).toBeVisible();
});
