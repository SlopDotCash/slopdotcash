import type { Page } from "@playwright/test";
import { PROJECTS } from "../../src/lib/projects.mjs";
import { enlargeText } from "../text-size";
import { expect, expectAccessible, test } from "./fixtures";
import {
  adminProjectRecord,
  serveProjectMaintainer,
} from "./project-maintainer-fixture";

function privateProjectRecord() {
  const project = PROJECTS.find((entry) => entry.id === "asi");
  if (!project) throw new Error("Missing fixture project");
  return {
    id: project.id,
    status: project.status,
    revision: 1,
    manifest: project,
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
      records: [],
    },
  };
}

async function serveAdminVetting(page: Page) {
  await page.route("**/api/v1/admin/vetting?**", (route) =>
    route.fulfill({
      json: {
        service: { state: "available", queueRegistrationAvailable: true },
        projects: [],
        assessments: [],
      },
    }),
  );
}

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
    const record = () =>
      adminProjectRecord(project, { manifest, revision: afterSave ? 2 : 1 });
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
    const restoreEnlargedText1 = await enlargeText(page.locator("body"));
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
    await restoreEnlargedText1();
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

for (const resource of ["projects", "fee-conversions"] as const) {
  test(`a late admin ${resource} reply cannot publish under a changed account`, async ({
    page,
    diagnostics,
  }) => {
    diagnostics.allowCanceledBackgroundReads();
    await serveAdminVetting(page);
    let changed = false;
    let requested = false;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/v1/project-session", (route) =>
      route.fulfill({
        json: {
          session: {
            githubId: changed ? "4243" : "4242",
            githubLogin: changed ? "other-reader" : "operator",
            admin: !changed,
          },
        },
      }),
    );
    await page.route(`**/api/v1/admin/${resource}`, async (route) => {
      expect(route.request().headers()["x-slop-expected-github-id"]).toBe(
        "4242",
      );
      requested = true;
      await held;
      await route.fulfill({
        json:
          resource === "projects"
            ? { projects: [privateProjectRecord()] }
            : {
                schemaVersion: "1",
                routes: [
                  { network: "base", status: "usdc", targetToken: "fixture" },
                ],
                totals: [
                  {
                    network: "base",
                    token: "fixture",
                    targetToken: "fixture",
                    conversions: 1,
                    amountIn: "77",
                    amountOut: "77000000",
                  },
                ],
                recent: [],
                last24Hours: [],
              },
      });
    });
    try {
      await page.goto(
        resource === "projects" ? "/admin" : "/admin?section=fees",
        { waitUntil: "domcontentloaded" },
      );
      await expect.poll(() => requested).toBe(true);
      changed = true;
      release();
      await expect(page.getByRole("alert")).toContainText(
        "Your admin account or access changed.",
      );
      if (resource === "projects") {
        await expect(
          page.getByRole("heading", {
            name: privateProjectRecord().manifest.name,
            exact: true,
          }),
        ).toHaveCount(0);
      } else {
        await expect(
          page.locator(
            'section[aria-labelledby="admin-fee-conversions"] > article',
          ),
        ).toHaveCount(0);
      }
    } finally {
      release();
    }
  });
}

test("an admin read deadline is terminal even when its HTTP response arrives later", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowCanceledBackgroundReads();
  await page.clock.install({ time: Date.now() });
  await serveAdminVetting(page);
  let requested = false;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({
      json: {
        session: { githubId: "4242", githubLogin: "operator", admin: true },
      },
    }),
  );
  await page.route("**/api/v1/admin/projects", async (route) => {
    requested = true;
    await held;
    await route.fulfill({ json: { projects: [privateProjectRecord()] } });
  });
  try {
    await page.goto("/admin", { waitUntil: "domcontentloaded" });
    await expect.poll(() => requested).toBe(true);
    await page.clock.fastForward(12_001);
    await expect(page.getByRole("alert")).toContainText("Request timed out");
    release();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("alert")).toContainText("Request timed out");
    await expect(
      page.getByRole("heading", {
        name: privateProjectRecord().manifest.name,
        exact: true,
      }),
    ).toHaveCount(0);
  } finally {
    release();
  }
});

test("an admin refresh timeout cannot retain private data while its identity recheck is pending", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowCanceledBackgroundReads();
  diagnostics.allowResponse(503, "GET", "/api/v1/admin/projects");
  await page.clock.install({ time: Date.now() });
  await serveAdminVetting(page);
  let record = privateProjectRecord();
  let saved = false;
  let failureReturned = false;
  let identityPending = false;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/project-session", async (route) => {
    if (failureReturned) {
      identityPending = true;
      await held;
    }
    await route.fulfill({
      json: {
        session: { githubId: "4242", githubLogin: "operator", admin: true },
      },
    });
  });
  await page.route("**/api/v1/admin/projects", (route) => {
    if (saved) {
      failureReturned = true;
      return route.fulfill({
        status: 503,
        json: {
          error: "unavailable",
          message: "Project list temporarily unavailable.",
        },
      });
    }
    return route.fulfill({ json: { projects: [record] } });
  });
  await page.route(
    `**/api/v1/admin/projects/${record.id}/manifest`,
    (route) => {
      const body = route.request().postDataJSON();
      record = { ...record, revision: 2, manifest: body.manifest };
      saved = true;
      return route.fulfill({ json: { project: record } });
    },
  );
  try {
    await page.goto(`/admin?project=${record.id}&section=settings`, {
      waitUntil: "networkidle",
    });
    await page
      .getByRole("textbox", { name: "Short description", exact: true })
      .fill("Saved before the private refresh timed out");
    await page
      .getByRole("textbox", {
        name: "Reason for revision (public)",
        exact: true,
      })
      .fill("Update the description to match accepted scope.");
    await page
      .getByRole("button", { name: "Save revision 2", exact: true })
      .click();
    await expect.poll(() => identityPending).toBe(true);
    await expect(
      page.getByRole("heading", { name: record.manifest.name, exact: true }),
    ).toBeVisible();
    await page.clock.fastForward(12_001);
    await expect(page.getByRole("alert")).toContainText("Request timed out");
    await expect(
      page.getByRole("heading", { name: record.manifest.name, exact: true }),
    ).toHaveCount(0);
    release();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("alert")).toContainText("Request timed out");
    await expect(
      page.getByRole("heading", { name: record.manifest.name, exact: true }),
    ).toHaveCount(0);
    expect(record.revision).toBe(2);
    expect(record.manifest.headline).toBe(
      "Saved before the private refresh timed out",
    );
  } finally {
    release();
  }
});
