import { PROJECTS } from "../../src/lib/projects.mjs";
import { expect, expectAccessibleReflow, test } from "./fixtures";
import {
  holdProjectSessionUntilUnmount,
  leaveEditorWithHeldSession,
  releaseHeldEditorSession,
} from "./project-draft-fixture";
import { serveProjectMaintainer } from "./project-maintainer-fixture";

test("a maintainer confirms removal, reloads a changed revision, and retires the editor", async ({
  diagnostics,
  page,
}, info) => {
  const project = PROJECTS.find((candidate) => candidate.id === "eliza");
  if (!project) throw new Error("Missing project fixture");
  await serveProjectMaintainer(page, () => project);
  let revision = 1;
  await page.route(/\/api\/v1\/projects\/eliza(?:\?.*)?$/u, (route) =>
    route.fulfill({ json: { project, revision } }),
  );
  const requests: unknown[] = [];
  diagnostics.allowResponse(409, "POST", "/api/v1/projects/eliza/remove");
  await page.route("**/api/v1/projects/eliza/remove", (route) => {
    expect(route.request().headers()["x-slop-expected-github-id"]).toBe("1");
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) {
      revision = 2;
      return route.fulfill({
        status: 409,
        json: {
          error: "stale_revision",
          message: "The project changed since you loaded it.",
        },
      });
    }
    return route.fulfill({
      json: {
        project: {
          id: project.id,
          revision: 3,
          status: "paused",
          manifest: { ...project, status: "paused", listingTier: "retired" },
        },
      },
    });
  });
  await page.goto("/projects/eliza/manage", { waitUntil: "networkidle" });
  const remove = page.getByRole("button", {
    name: "Remove project",
    exact: true,
  });
  await expect(remove).toBeEnabled();
  await expectAccessibleReflow(page, "remove-project-settings");
  await remove.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath("remove-before-confirmation.png"),
    fullPage: true,
  });
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("funded obligations remain");
    await dialog.dismiss();
  });
  await remove.click();
  expect(requests).toEqual([]);
  page.once("dialog", (dialog) => dialog.accept());
  // The action is reachable from the existing publication control by keyboard.
  await page
    .getByRole("button", { name: "Publish changes", exact: true })
    .focus();
  await page.keyboard.press("Tab");
  await expect(remove).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toContainText("The project changed");
  await Promise.all([
    page.waitForResponse((response) =>
      response.url().includes("projects/eliza?reload=1"),
    ),
    page.getByRole("button", { name: "Reload", exact: true }).click(),
  ]);
  page.once("dialog", (dialog) => dialog.accept());
  await remove.click();
  await expect(
    page.getByRole("heading", { name: "Project removed", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "is removed from Slop" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Publish changes", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Check setup", exact: true }),
  ).toHaveCount(0);
  expect(requests).toEqual([{ expectedRevision: 1 }, { expectedRevision: 2 }]);
  await expectAccessibleReflow(page, "removed-project");
});

test("an applicant cancels a stale review application and retries an unavailable cancellation", async ({
  diagnostics,
  page,
}, info) => {
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({
      json: {
        session: { githubId: "1", githubLogin: "local-owner", admin: false },
      },
    }),
  );
  await page.route("**/api/v1/project-github/owned-repositories", (route) =>
    route.fulfill({ json: { repositories: [] } }),
  );
  const application = {
    id: "app-open-protein",
    projectId: "open-protein",
    manifest: { name: "Open Protein" },
    status: "pending",
    expectedRevision: 1,
    publishable: false,
  };
  await page.route("**/api/v1/project-setup", (route) =>
    route.fulfill({
      json: {
        projects: [],
        applications: [
          application,
          {
            ...application,
            id: "app-new-lab",
            projectId: "new-lab",
            manifest: { name: "New Lab" },
            expectedRevision: undefined,
            publishable: true,
          },
        ],
      },
    }),
  );
  let cancellations = 0;
  let publications = 0;
  await page.route("**/api/v1/project-applications/*/publish", (route) => {
    publications += 1;
    return route.fulfill({ status: 500, json: {} });
  });
  diagnostics.allowResponse(
    503,
    "POST",
    "/api/v1/project-applications/app-open-protein/cancel",
  );
  await page.route("**/api/v1/project-applications/*/cancel", (route) => {
    cancellations += 1;
    expect(route.request().headers()["x-slop-expected-github-id"]).toBe("1");
    expect(route.request().postDataJSON()).toEqual({});
    return route.fulfill(
      cancellations === 1
        ? {
            status: 503,
            json: {
              error: "unavailable",
              message: "Cancellation unavailable. Try again.",
            },
          }
        : {
            json: { application: { ...application, status: "cancelled" } },
          },
    );
  });
  await page.goto("/projects/new", { waitUntil: "networkidle" });
  const pending = page.getByRole("article", {
    name: "Pending application: Open Protein",
    exact: true,
  });
  await expect(
    pending.getByRole("button", { name: "Publish this change", exact: true }),
  ).toHaveCount(0);
  const cancel = pending.getByRole("button", {
    name: "Cancel application",
    exact: true,
  });
  await expect(cancel).toBeEnabled();
  await expectAccessibleReflow(page, "cancel-review-application");
  await page.screenshot({
    path: info.outputPath("cancel-before-confirmation.png"),
    fullPage: true,
  });
  page.once("dialog", (dialog) => dialog.accept());
  await cancel.focus();
  await page.keyboard.press("Enter");
  await expect(pending.getByRole("alert")).toHaveText(
    "Cancellation unavailable. Try again.",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await cancel.click();
  await expect(pending.getByRole("status")).toHaveText(
    "Application cancelled.",
  );
  await expect(pending.getByRole("button")).toHaveCount(0);
  expect(cancellations).toBe(2);
  expect(publications).toBe(0);
  await expectAccessibleReflow(page, "cancelled-review-application");
});

test("a changed account cannot dispatch removal from a retained editor", async ({
  page,
}) => {
  const project = PROJECTS.find((candidate) => candidate.id === "eliza");
  if (!project) throw new Error("Missing project fixture");
  await serveProjectMaintainer(page, () => project);
  let actorId = "1";
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({
      json: {
        session: {
          githubId: actorId,
          githubLogin: "local-owner",
          admin: false,
        },
      },
    }),
  );
  let removals = 0;
  await page.route("**/api/v1/projects/eliza/remove", (route) => {
    removals += 1;
    return route.fulfill({ status: 500, json: {} });
  });
  await page.goto("/projects/eliza/manage", { waitUntil: "networkidle" });
  const remove = page.getByRole("button", {
    name: "Remove project",
    exact: true,
  });
  await expect(remove).toBeEnabled();
  actorId = "2";
  page.once("dialog", (dialog) => dialog.accept());
  await remove.click();
  await expect(remove).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Project removed", exact: true }),
  ).toHaveCount(0);
  expect(removals).toBe(0);
});

test("leaving a pending application retires its cancellation before dispatch", async ({
  page,
}) => {
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({
      json: {
        session: { githubId: "1", githubLogin: "local-owner", admin: false },
      },
    }),
  );
  await page.route("**/api/v1/project-github/owned-repositories", (route) =>
    route.fulfill({ json: { repositories: [] } }),
  );
  await page.route("**/api/v1/project-setup", (route) =>
    route.fulfill({
      json: {
        projects: [],
        applications: [
          {
            id: "app-open-protein",
            projectId: "open-protein",
            manifest: { name: "Open Protein" },
            status: "pending",
          },
        ],
      },
    }),
  );
  let cancellations = 0;
  await page.route("**/api/v1/project-applications/*/cancel", (route) => {
    cancellations += 1;
    return route.fulfill({ status: 500, json: {} });
  });
  await page.goto("/projects/new", { waitUntil: "networkidle" });
  const pending = page.getByRole("article", {
    name: "Pending application: Open Protein",
    exact: true,
  });
  await expect(pending).toBeVisible();
  await holdProjectSessionUntilUnmount(
    page,
    '[data-testid="pending-application-app-open-protein"]',
  );
  await page.evaluate(() => {
    window.history.replaceState(window.history.state, "", "/how-it-works");
    window.history.pushState({}, "", "/projects/new");
  });
  try {
    page.once("dialog", (dialog) => dialog.accept());
    await pending
      .getByRole("button", { name: "Cancel application", exact: true })
      .click();
    await leaveEditorWithHeldSession(page);
    expect(cancellations).toBe(0);
  } finally {
    await releaseHeldEditorSession(page);
  }
});
