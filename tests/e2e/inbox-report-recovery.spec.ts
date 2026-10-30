import { expect, expectAccessible, test } from "./fixtures";

test("a signed-out Reports link shows sign-in instead of a blank workspace", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  diagnostics.allowResponse(401, "GET", "/api/v1/notifications");
  await page.route("**/api/v1/notifications", (route) =>
    route.fulfill({ status: 401, json: { error: "unauthorized" } }),
  );
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({ json: { session: null } }),
  );
  await page.goto("/inbox?view=reports");
  await expect(
    page.getByRole("link", { name: "Sign in with GitHub" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Private security reports" }),
  ).toHaveCount(0);
  await expectAccessible(page);
});

test("Reports can retry an initial Inbox outage without exposing private state", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  diagnostics.allowResponse(503, "GET", "/api/v1/notifications");
  let available = false;
  const actor = { githubId: "42", githubLogin: "reviewer" };
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({ json: { session: actor } }),
  );
  await page.route("**/api/v1/notifications", (route) =>
    route.fulfill({
      status: available ? 200 : 503,
      json: available
        ? {
            recipientGithubId: "42",
            notifications: [],
            unread: 0,
            nextCursor: null,
          }
        : { error: "unavailable" },
    }),
  );
  await page.route("**/api/v1/security-cases", (route) =>
    route.fulfill({ json: { viewer: actor, programs: [], cases: [] } }),
  );
  await page.route("**/api/v1/security-submissions", (route) =>
    route.fulfill({
      json: { recipientGithubId: "42", automatic: true, submissions: [] },
    }),
  );
  await page.goto("/inbox?view=reports");
  await expect(
    page.getByRole("button", { name: "Retry", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toBeVisible();
  available = true;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    page.getByText("You have no private reports yet."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry", exact: true }),
  ).toHaveCount(0);
  await expectAccessible(page);
});
