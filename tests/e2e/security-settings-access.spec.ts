import { PROJECTS } from "../../src/lib/projects.mjs";
import { expect, expectAccessible, test } from "./fixtures";

/**
 * The owner security settings check current management access before they
 * show the bounty editor. A failed or refused check offers a retry and never
 * reads the editable revision.
 */
test("security settings retry a failed management access check", async ({
  page,
  diagnostics,
}, info) => {
  const project = PROJECTS.find((entry) => entry.id === "eliza");
  if (!project) throw new Error("Missing fixture project");
  diagnostics.allowPreviewApiMisses();
  diagnostics.allowCanceledBackgroundReads();
  const unavailable = diagnostics.allowResponse(
    503,
    "GET",
    `/api/v1/project-setup/${project.id}?attempt=0`,
  );
  await page.route("**/api/v1/projects", (route) =>
    route.fulfill({ json: { schemaVersion: "1", projects: [project] } }),
  );
  await page.route("**/.well-known/slop/projects.json", (route) =>
    route.fulfill({ json: { schemaVersion: "1", projects: [] } }),
  );
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({
      json: {
        session: {
          githubId: "4242",
          githubLogin: "example-owner",
          admin: false,
        },
      },
    }),
  );
  const attempts: string[] = [];
  await page.route(
    `**/api/v1/project-setup/${project.id}?attempt=*`,
    (route) => {
      const attempt = new URL(route.request().url()).searchParams.get(
        "attempt",
      );
      attempts.push(attempt ?? "");
      if (attempt === "0")
        return route.fulfill({
          status: 503,
          json: {
            error: "github_unavailable",
            message: "GitHub could not be checked. Try again.",
          },
        });
      return route.fulfill({
        json: {
          viewer: { githubId: "4242" },
          // The second answer refuses, the third grants current access.
          canManageBounty: attempt === "2",
        },
      });
    },
  );
  const revisionReads: string[] = [];
  await page.route(`**/api/v1/projects/${project.id}?reload=*`, (route) => {
    revisionReads.push(route.request().url());
    return route.fulfill({
      json: { project: { ...project, securityBounty: undefined }, revision: 7 },
    });
  });
  await page.goto(`/projects/${project.id}/security#security-settings`, {
    waitUntil: "networkidle",
  });
  const settings = page.locator("details#security-settings");
  await expect(settings).toHaveAttribute("open", "");
  const retry = settings.getByRole("button", {
    name: "Retry management access",
    exact: true,
  });
  await expect(settings.getByRole("alert")).toContainText(
    "GitHub could not be checked. Try again.",
  );
  expect(diagnostics.count(unavailable)).toBe(1);
  await expectAccessible(page);
  await page.screenshot({
    path: info.outputPath("access-unavailable.png"),
    fullPage: true,
  });

  await retry.click();
  await expect(settings.getByRole("alert")).toContainText(
    "Only the current project steward or a repository administrator can manage this bounty.",
  );
  expect(revisionReads).toHaveLength(0);

  await retry.click();
  await expect(retry).toHaveCount(0);
  await expect(
    settings.getByRole("button", { name: "Review bounty terms", exact: true }),
  ).toBeVisible();
  expect(attempts).toEqual(["0", "1", "2"]);
  expect(revisionReads).toHaveLength(1);
  await expectAccessible(page);
});
