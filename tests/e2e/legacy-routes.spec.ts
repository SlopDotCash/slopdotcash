import { expect, test } from "./fixtures";

// Legacy and alias URLs that the router maps onto a current page. Each one
// must reach that page, not the missing-page view, and keep its query.

test("the legacy X callback path /points?x opens Account, while /points stays Points", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({ json: { session: null } }),
  );
  await page.goto("/points?x", { waitUntil: "networkidle" });
  await expect(page).toHaveTitle("Account · Slop");
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Page not found", exact: true }),
  ).toHaveCount(0);
  await page.goto("/points", { waitUntil: "networkidle" });
  await expect(page).not.toHaveTitle("Account · Slop");
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toHaveCount(0);
});

test("an emailed /admin/applications/<id> link opens Admin; other admin paths are missing", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({ json: { session: null } }),
  );
  await page.goto("/admin/applications/app_0000000000000001", {
    waitUntil: "networkidle",
  });
  await expect(page).toHaveTitle("Admin · Slop");
  await expect(
    page.getByRole("heading", { name: "Page not found", exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("link", { name: "Sign in with GitHub", exact: true })
      .first(),
  ).toBeVisible();
  // Only the three-segment application link is an alias.
  for (const path of [
    "/admin/applications",
    "/admin/projects/app_0000000000000001",
    "/admin/applications/app_0000000000000001/extra",
  ]) {
    await page.goto(path, { waitUntil: "networkidle" });
    await expect(
      page.getByRole("heading", { name: "Page not found", exact: true }),
    ).toBeVisible();
  }
});

test("a legacy manage#security-settings link moves to the security page and keeps its query", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  diagnostics.allowCanceledBackgroundReads();
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({ json: { session: null } }),
  );
  await page.goto("/how-it-works", { waitUntil: "networkidle" });
  await page.goto("/projects/eliza/manage?from=email#security-settings", {
    waitUntil: "networkidle",
  });
  await expect(page).toHaveURL(
    /\/projects\/eliza\/security\?from=email#security-settings$/u,
  );
  // The legacy location is replaced, not kept in history: Back leaves it.
  await page.goBack({ waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/how-it-works$/u);
  // Without the settings fragment, the manage page keeps its own URL.
  await page.goto("/projects/eliza/manage?from=email", {
    waitUntil: "networkidle",
  });
  await expect(page).toHaveURL(/\/projects\/eliza\/manage\?from=email$/u);
});
