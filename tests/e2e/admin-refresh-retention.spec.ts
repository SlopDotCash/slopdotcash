import { PROJECTS } from "../../src/lib/projects.mjs";
import { expect, expectAccessible, test } from "./fixtures";
import { serveProjectMaintainer } from "./project-maintainer-fixture";

for (const retryStatus of [200, 401, 403]) {
  test(`admin save retains a transiently unavailable list and handles retry ${retryStatus}`, async ({
    page,
    diagnostics,
  }, info) => {
    const project = PROJECTS.find((entry) => entry.id === "asi");
    if (!project) throw new Error("Missing fixture project");
    await serveProjectMaintainer(page, () => project);
    await page.route("**/api/v1/project-session", (route) =>
      route.fulfill({
        json: {
          session: { githubId: "4242", githubLogin: "operator", admin: true },
        },
      }),
    );
    let afterSave = false;
    let retried = false;
    let saves = 0;
    let manifest = project;
    const record = () => ({
      id: project.id,
      status: project.status,
      revision: afterSave ? 2 : 1,
      manifest,
      manifestSha256: "a".repeat(64),
      createdAt: "2026-10-22T00:00:00.000Z",
      updatedAt: "2026-10-22T00:00:00.000Z",
      sourceApplicationId: null,
      enforcement: {
        state: "clear",
        appeal: "none",
        projectAppeal: "none",
        since: null,
        restrictedBy: [],
        nextSequence: 1,
        revisionPending: false,
        moderation: "unconfigured",
        decisionRequired: false,
        bannedMaintainers: [],
        sourceProjectId: project.id,
        records: [],
      },
    });
    await page.route("**/api/v1/admin/vetting?**", (route) =>
      route.fulfill({
        json: {
          service: { state: "available", queueRegistrationAvailable: true },
          projects: [
            {
              id: project.id,
              name: project.name,
              status: project.status,
              revision: afterSave ? 2 : 1,
              clearance: { state: "cleared", assessment: null },
            },
          ],
          assessments: [],
        },
      }),
    );
    const denied = diagnostics.allowResponse(
      503,
      "GET",
      "/api/v1/admin/projects",
    );
    if (retryStatus !== 200)
      diagnostics.allowResponse(retryStatus, "GET", "/api/v1/admin/projects");
    await page.route("**/api/v1/admin/projects", (route) => {
      const status = afterSave ? (retried ? retryStatus : 503) : 200;
      return route.fulfill({
        status,
        json:
          status === 200
            ? { projects: [record()] }
            : {
                error: status === 503 ? "unavailable" : "forbidden",
                message:
                  status === 503
                    ? "Project list temporarily unavailable."
                    : "Project access ended.",
              },
      });
    });
    await page.route(
      `**/api/v1/admin/projects/${project.id}/manifest`,
      (route) => {
        expect(route.request().method()).toBe("PUT");
        const body = route.request().postDataJSON();
        expect(body.expectedRevision).toBe(1);
        manifest = body.manifest;
        saves++;
        afterSave = true;
        return route.fulfill({ json: { project: record() } });
      },
    );
    await page.goto(`/admin?project=${project.id}&section=settings`, {
      waitUntil: "networkidle",
    });
    await page
      .getByRole("textbox", { name: "Short description", exact: true })
      .fill("A saved description with a verified outcome");
    await page
      .getByRole("textbox", {
        name: "Reason for revision (public)",
        exact: true,
      })
      .fill("Update the description to match the accepted project scope.");
    await expect(
      page.getByRole("button", { name: "Save revision 2", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Save revision 2", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "Project list temporarily unavailable.",
    );
    await expect(
      page.getByRole("heading", { name: project.name, exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await expect(
      page.getByRole("link", { name: "Settings", exact: true }),
    ).toBeVisible();
    expect(saves).toBe(1);
    expect(diagnostics.count(denied)).toBe(1);
    await expectAccessible(page);
    await page.screenshot({
      path: info.outputPath(`retained-${retryStatus}.png`),
      fullPage: true,
    });
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    await expect(
      page
        .getByRole("alert")
        .getByRole("button", { name: "Retry", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await expectAccessible(page);
    await page.screenshot({
      path: info.outputPath(`retained-${retryStatus}-200.png`),
      fullPage: true,
    });
    await page.evaluate(() => {
      document.documentElement.style.zoom = "1";
    });
    retried = true;
    const retry = page
      .getByRole("alert")
      .getByRole("button", { name: "Retry", exact: true });
    await retry.focus();
    await page.keyboard.press("Enter");
    if (retryStatus === 200) {
      await expect(page.getByRole("alert")).toHaveCount(0);
      await page.getByRole("link", { name: "Settings", exact: true }).click();
      await expect(
        page.getByRole("textbox", { name: "Short description", exact: true }),
      ).toHaveValue("A saved description with a verified outcome");
    } else {
      await expect(page.getByRole("alert")).toContainText(
        "Project access ended.",
      );
      await expect(
        page.getByRole("heading", { name: project.name, exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("link", { name: "Settings", exact: true }),
      ).toHaveCount(0);
    }
    expect(saves).toBe(1);
    await expectAccessible(page);
    await page.screenshot({
      path: info.outputPath(`retried-${retryStatus}.png`),
      fullPage: true,
    });
  });
}
