/** Actual Inbox controls with explicit private API responses; no provider delivery. */
import type { Page, Route } from "@playwright/test";
import type { Submission } from "../../src/PrivateReportSummary";
import { expect, expectAccessible, test } from "./fixtures";

const id = "ss_composition";
function submission(): Submission {
  return {
    id,
    projectId: "fixture-project",
    repository: "example/fixture-project",
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
    intake: null,
  };
}

async function mount(
  page: Page,
  current: () => Submission,
  action: (path: string, route: Route) => Promise<void>,
) {
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.slice(
      "/api/v1/".length,
    );
    if (path === "project-session")
      return route.fulfill({
        json: { session: { githubId: "42", githubLogin: "fixture-reporter" } },
      });
    if (path === "projects")
      return route.fulfill({ json: { schemaVersion: "1", projects: [] } });
    if (path === "notifications")
      return route.fulfill({
        json: { recipientGithubId: "42", notifications: [], unread: 0 },
      });
    if (path === "security-cases")
      return route.fulfill({
        json: {
          viewer: { githubId: "42", githubLogin: "fixture-reporter" },
          cases: [],
          programs: [],
        },
      });
    if (path === "security-submissions")
      return route.fulfill({
        json: {
          recipientGithubId: "42",
          automatic: true,
          submissions: [current()],
        },
      });
    return action(path, route);
  });
  await page.goto(`/inbox?submission=${id}`, { waitUntil: "networkidle" });
  return page.locator(`[aria-labelledby="submission-${id}"]`);
}

test("intake routing and GitHub receipt remain independent in one report", async ({
  page,
}) => {
  let current: Submission = {
    ...submission(),
    state: "failed",
    failureCode: "forbidden",
    intake: {
      state: "legitimate",
      receivedAt: "2026-11-01T00:00:00.000Z",
      routingState: "pending",
      revision: 7,
      reason: null,
      reviewedAt: "2026-11-01T01:00:00.000Z",
      canReview: false,
      canForward: true,
      canRetryScreening: true,
      canAuthorize: true,
    },
  };
  const card = await mount(
    page,
    () => current,
    async (path, route) => {
      expect(path).toBe(`security-submissions/${id}/screen`);
      expect(route.request().postDataJSON()).toEqual({ expectedRevision: 7 });
      if (!current.intake) throw new Error("Missing intake fixture");
      current = {
        ...current,
        intake: {
          ...current.intake,
          routingState: "routed",
          revision: 8,
          canRetryScreening: false,
        },
      };
      await route.fulfill({ json: { submission: current } });
    },
  );
  await expect(
    card.getByText(
      "Report cleared for review. The owner notification is pending.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    card.getByText("GitHub refused the report for your account.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    card.getByRole("textbox", { name: "Summary", exact: true }),
  ).toHaveCount(0);
  await card
    .getByRole("button", { name: "Retry owner notification", exact: true })
    .click();
  await expect(
    card.getByText(
      "A maintainer cleared this report for owner review. No award has been approved by this routing decision.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    card.getByText("GitHub refused the report for your account.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    card.getByRole("button", { name: "Retry owner notification", exact: true }),
  ).toHaveCount(0);
  await expectAccessible(page);
});

for (const [canReview, canAuthorize, visible] of [
  [true, undefined, false],
  [false, undefined, true],
  [false, false, false],
] as const) {
  test(`saved forwarding respects explicit authorization and legacy fallback ${canReview}/${canAuthorize}`, async ({
    page,
  }) => {
    const current: Submission = {
      ...submission(),
      intake: {
        state: "legitimate",
        receivedAt: "2026-11-01T00:00:00.000Z",
        routingState: "routed",
        revision: 2,
        reason: null,
        reviewedAt: null,
        canReview,
        canForward: true,
        canRetryScreening: false,
        ...(canAuthorize === undefined ? {} : { canAuthorize }),
      },
    };
    const card = await mount(
      page,
      () => current,
      async (path) => {
        throw new Error(`Unexpected action: ${path}`);
      },
    );
    await expect(
      card.getByText("Also send privately to GitHub", { exact: true }),
    ).toHaveCount(visible ? 1 : 0);
    await expect(
      card.getByRole("textbox", { name: "Summary", exact: true }),
    ).toHaveCount(0);
    await expect(
      card.getByText(
        "Screening complete. Ready for the project owner's review.",
        { exact: true },
      ),
    ).toBeVisible();
  });
}

test("grant recovery saves the local draft and stays busy until navigation", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  diagnostics.allowResponse(
    409,
    "POST",
    `/api/v1/security-submissions/${id}/send`,
  );
  let current = submission();
  let grant = false;
  let authorizations = 0;
  let releaseNavigation: (() => void) | undefined;
  await page.addInitScript(
    ({ id }) => {
      sessionStorage.setItem(
        `slop-intake-draft:${id}`,
        JSON.stringify({
          summary: "Synthetic grant recovery",
          description:
            "Synthetic private evidence retained through authorization.",
          severity: "",
          cvss: "",
          cwe: "",
        }),
      );
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (
          (window as Window & { rejectDraftWrite?: boolean })
            .rejectDraftWrite &&
          key.startsWith("slop-intake-draft:")
        )
          throw new DOMException(
            "Fixture storage unavailable",
            "QuotaExceededError",
          );
        return original.call(this, key, value);
      };
    },
    { id },
  );
  await page.route("**/fixture/authorize", async (route) => {
    await new Promise<void>((resolve) => {
      releaseNavigation = resolve;
    });
    await route.fulfill({
      contentType: "text/html",
      body: "<h1>Fixture GitHub authorization</h1>",
    });
  });
  const card = await mount(
    page,
    () => current,
    async (path, route) => {
      if (path.endsWith("/authorize")) {
        authorizations++;
        expect(route.request().postDataJSON()).toEqual({});
        return route.fulfill({
          json: {
            authorizeUrl: new URL("/fixture/authorize", page.url()).href,
          },
        });
      }
      if (path.endsWith("/send")) {
        expect(route.request().postDataJSON().expectedRevision).toBe(1);
        if (!grant)
          return route.fulfill({
            status: 409,
            json: {
              error: "grant_required",
              message: "Authorize GitHub first.",
            },
          });
        current = { ...current, state: "submitted", revision: 2, attempt: 1 };
        return route.fulfill({ json: { submission: current } });
      }
      if (path.endsWith("/reconcile")) {
        expect(route.request().postDataJSON()).toEqual({ expectedRevision: 2 });
        current = {
          ...current,
          state: "receipt-verified",
          revision: 3,
          advisory: {
            ghsa: "GHSA-xxxx-yyyy-zzzz",
            url: "https://github.com/example/fixture-project/security/advisories/GHSA-xxxx-yyyy-zzzz",
          },
          githubCreatedAt: "2026-11-01T01:00:00.000Z",
        };
        return route.fulfill({ json: { submission: current } });
      }
      throw new Error(`Unexpected action: ${path}`);
    },
  );
  try {
    await card
      .getByRole("button", { name: "Submit privately", exact: true })
      .click();
    const authorize = card.getByRole("button", {
      name: "Authorize GitHub to submit as you",
      exact: true,
    });
    await expect(authorize).toBeVisible();
    await page.evaluate(() => {
      (window as Window & { rejectDraftWrite?: boolean }).rejectDraftWrite =
        true;
    });
    await authorize.click();
    await expect(
      card.getByText(
        /This browser could not keep your report during GitHub authorization/,
      ),
    ).toBeVisible();
    expect(authorizations).toBe(0);
    await page.evaluate(() => {
      (window as Window & { rejectDraftWrite?: boolean }).rejectDraftWrite =
        false;
    });
    const navigating = page.waitForRequest("**/fixture/authorize");
    await authorize.click({ noWaitAfter: true });
    await navigating;
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(authorize).toBeDisabled();
    await expect(
      card.getByRole("button", { name: "Submit privately", exact: true }),
    ).toBeDisabled();
    expect(authorizations).toBe(1);
    grant = true;
    releaseNavigation?.();
    await expect(
      page.getByRole("heading", { name: "Fixture GitHub authorization" }),
    ).toBeVisible();
    await page.goto(`/inbox?submission=${id}`, { waitUntil: "networkidle" });
    await expect(
      card.getByRole("textbox", { name: "Summary", exact: true }),
    ).toHaveValue("Synthetic grant recovery");
    await card
      .getByRole("button", { name: "Submit privately", exact: true })
      .click();
    await expect(
      card.getByRole("button", { name: "Check again", exact: true }),
    ).toBeVisible();
    await expect(
      card.getByRole("textbox", { name: "Summary", exact: true }),
    ).toHaveCount(0);
    await card
      .getByRole("button", { name: "Check again", exact: true })
      .click();
    await expect(
      card.getByRole("link", { name: "GHSA-xxxx-yyyy-zzzz", exact: true }),
    ).toBeVisible();
    await expect(
      card.getByRole("button", { name: "Check again", exact: true }),
    ).toHaveCount(0);
  } finally {
    releaseNavigation?.();
  }
});
