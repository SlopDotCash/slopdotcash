import { expect, expectAccessible, test } from "./fixtures";

test.use({ video: "on" });

test("private case refresh retains the view but clears revoked access", async ({
  page,
  diagnostics,
}, info) => {
  diagnostics.allowPreviewApiMisses();
  diagnostics.allowResponse(503, "GET", "/api/v1/security-cases");
  diagnostics.allowResponse(403, "GET", "/api/v1/security-cases");
  const session = { githubId: "42", githubLogin: "refresh-reviewer" };
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({ json: { session } }),
  );
  await page.route("**/api/v1/security-submissions", (route) =>
    route.fulfill({
      json: { recipientGithubId: "42", automatic: false, submissions: [] },
    }),
  );
  let status = 200;
  await page.route("**/api/v1/security-cases", (route) =>
    route.fulfill({
      status,
      json:
        status === 200
          ? {
              viewer: session,
              programs: [],
              cases: [],
              authorityUnavailable: true,
            }
          : { error: "unavailable", message: "Case refresh unavailable." },
    }),
  );
  await page.goto("/security");
  const heading = page.getByRole("heading", { name: "Cases", exact: true });
  await expect(heading).toBeVisible();
  status = 503;
  await page.getByRole("button", { name: "Retry access check" }).click();
  const stale = page.getByRole("alert").filter({ hasText: "Stale" });
  await expect(stale).toContainText("Case refresh unavailable.");
  await expect(heading).toBeVisible();
  await expectAccessible(page);
  await page.screenshot({
    path: info.outputPath("retained-cases.png"),
    fullPage: true,
  });
  status = 200;
  await stale.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(stale).toHaveCount(0);
  await expect(heading).toBeVisible();
  status = 403;
  await page.getByRole("button", { name: "Retry access check" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Access revoked." }),
  ).toBeVisible();
  await expect(heading).toHaveCount(0);
});
