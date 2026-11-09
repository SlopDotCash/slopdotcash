import { expect, expectAccessible, test } from "./fixtures";

const actor = { githubId: "42", githubLogin: "reviewer" };
const projectId = "intake-review-fixture";

function submission(intake: Record<string, unknown>) {
  return {
    id: "ss_00000000intake01",
    projectId,
    repository: "example/private",
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
      state: "spam",
      receivedAt: "2026-10-27T12:00:00.000Z",
      routingState: "pending",
      revision: 3,
      reason: null,
      reviewedAt: null,
      canReview: true,
      canForward: false,
      canRetryScreening: false,
      canAuthorize: false,
      canRevise: false,
      ...intake,
    },
  };
}

test("a request for more evidence sends the reason and revision and closes the held review", async ({
  page,
}) => {
  let current = submission({});
  const reviews: unknown[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/v1/projects")
      return route.fulfill({ json: { schemaVersion: "1", projects: [] } });
    if (path === "/api/v1/project-session")
      return route.fulfill({ json: { session: actor } });
    if (path === "/api/v1/notifications")
      return route.fulfill({
        json: {
          recipientGithubId: actor.githubId,
          notifications: [],
          unread: 0,
          nextCursor: null,
        },
      });
    if (path === "/api/v1/security-cases")
      return route.fulfill({
        json: {
          viewer: actor,
          programs: [{ projectId, roles: ["security-maintainer"] }],
          cases: [],
        },
      });
    if (path === "/api/v1/security-submissions")
      return route.fulfill({
        json: {
          recipientGithubId: actor.githubId,
          automatic: true,
          submissions: [current],
        },
      });
    if (
      path === `/api/v1/security-submissions/${current.id}/review` &&
      request.method() === "POST"
    ) {
      expect(request.headers()["x-slop-expected-github-id"]).toBe("42");
      reviews.push(request.postDataJSON());
      current = submission({
        state: "needs-information",
        revision: 4,
        reason: "Attach a reproduction against the current release.",
        reviewedAt: "2026-10-28T09:00:00.000Z",
        canReview: false,
      });
      return route.fulfill({ json: { submission: current } });
    }
    if (path === `/api/v1/security-submissions/${current.id}`)
      return route.fulfill({
        json: {
          submission: current,
          report: {
            summary: "Synthetic held finding",
            description: "Synthetic private evidence held by screening.",
          },
        },
      });
    throw new Error(`Unexpected request: ${request.method()} ${path}`);
  });
  await page.goto("/inbox?view=reports", { waitUntil: "networkidle" });
  const report = page.locator("article").filter({
    has: page.getByRole("heading", {
      name: `Private report · ${projectId}`,
      exact: true,
    }),
  });
  await expect(report).toHaveCount(1);
  await expect(
    report.getByText(
      "Held as spam or unsupported; available for owner review.",
      { exact: true },
    ),
  ).toBeVisible();
  // A held report that the viewer can route opens without a click.
  await report.getByText("Read private report", { exact: true }).click();
  await expect(
    report.getByText("Synthetic private evidence held by screening.", {
      exact: true,
    }),
  ).toBeVisible();
  const ask = report.getByRole("button", {
    name: "Request more evidence",
    exact: true,
  });
  const approve = report.getByRole("button", {
    name: "Approve for owner review",
    exact: true,
  });
  // A routing decision needs a reason of at least eight characters.
  await expect(ask).toBeDisabled();
  await report.getByLabel("Review reason").fill("Short");
  await expect(ask).toBeDisabled();
  await report
    .getByLabel("Review reason")
    .fill("Attach a reproduction against the current release.");
  await expect(ask).toBeEnabled();
  await expect(approve).toBeEnabled();
  await ask.click();
  await expect
    .poll(() => reviews)
    .toEqual([
      {
        expectedRevision: 3,
        decision: "request-information",
        reason: "Attach a reproduction against the current release.",
      },
    ]);
  await expect(
    report.getByText("More evidence needed before owner review.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(ask).toHaveCount(0);
  await expect(approve).toHaveCount(0);
  expect(reviews).toHaveLength(1);
  await expectAccessible(page);
});
