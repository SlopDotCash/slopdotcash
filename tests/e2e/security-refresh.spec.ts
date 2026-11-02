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
  const heading = page.getByRole("heading", { name: "Decisions and payments" });
  await expect(heading).toBeVisible();
  status = 503;
  await page.getByRole("button", { name: "Retry access check" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Showing the last loaded cases.",
  );
  await expect(heading).toBeVisible();
  await expectAccessible(page);
  await page.screenshot({
    path: info.outputPath("retained-cases.png"),
    fullPage: true,
  });
  status = 200;
  await page
    .getByRole("alert")
    .getByRole("button", { name: "Retry", exact: true })
    .click();
  await expect(
    page.getByText("Showing the last loaded cases.", { exact: false }),
  ).toHaveCount(0);
  await expect(heading).toBeVisible();
  status = 403;
  await page.getByRole("button", { name: "Retry access check" }).click();
  await expect(
    page.getByText(
      "Private report access changed. Reload your private reports.",
    ),
  ).toBeVisible();
  await expect(heading).toHaveCount(0);
});
