import { PROJECTS } from "../../src/lib/projects.mjs";
import { expect, expectAccessibleReflow, test } from "./fixtures";
import { serveProjectMaintainer } from "./project-maintainer-fixture";

test.use({ video: "on" });

test("a resumed setup check restarts after vault setup suspends and reveals the editor", async ({
  page,
}, info) => {
  const project = PROJECTS.find((candidate) => candidate.id === "eliza");
  if (!project) throw new Error("Missing project fixture");
  await serveProjectMaintainer(page, () => project);
  let checkStarted: () => void = () => {};
  const firstCheck = new Promise<void>((resolve) => {
    checkStarted = resolve;
  });
  let finishCheck: () => void = () => {};
  const finishFirstCheck = new Promise<void>((resolve) => {
    finishCheck = resolve;
  });
  let chunkRequested: () => void = () => {};
  const suspended = new Promise<void>((resolve) => {
    chunkRequested = resolve;
  });
  let reveal: () => void = () => {};
  const revealEditor = new Promise<void>((resolve) => {
    reveal = resolve;
  });
  await page.route(/\/api\/v1\/projects\/eliza(?:\?.*)?$/u, async (route) => {
    await firstCheck;
    await route.fulfill({
      json: {
        project: { ...project, escrow: { chain: "base", deployments: [] } },
        revision: 1,
      },
    });
  });
  let checks = 0;
  await page.route("**/api/v1/project-setup/eliza/check", async (route) => {
    checks += 1;
    if (checks === 1) {
      checkStarted();
      await finishFirstCheck;
    }
    await route.fulfill({
      json: {
        setup: {
          projectId: project.id,
          name: project.name,
          slug: project.slug,
          revision: 1,
          status: "paused",
          state: "waiting",
          nextAction: {
            kind: "wait_for_scan",
            message: "The security scan is queued. Nothing is needed from you.",
            href: null,
          },
          checks: {
            authority: { state: "verified", message: "Verified." },
            installation: { state: "installed", message: "Installed." },
            scan: {
              state: "queued",
              message:
                "The security scan is queued. Nothing is needed from you.",
            },
          },
          funding: { mode: "none" },
          activatedRevision: null,
          checkedAt: new Date().toISOString(),
        },
      },
    });
  });
  await page.route("**/api/v1/project-vaults/eliza?**", (route) =>
    route.fulfill({ json: { revision: 1, networks: [] } }),
  );
  await page.route("**/api/v1/payments/me", (route) =>
    route.fulfill({ json: { wallets: [] } }),
  );
  await page.route("**/assets/OwnerVaultSetup-*.js", async (route) => {
    chunkRequested();
    await revealEditor;
    await route.continue();
  });
  try {
    await page.goto("/projects/eliza/manage", {
      waitUntil: "domcontentloaded",
    });
    await suspended;
    await expect(
      page.getByText("Loading page…", { exact: true }),
    ).toBeVisible();
    const firstResponse = page.waitForResponse((response) =>
      response.url().includes("project-setup/eliza/check"),
    );
    finishCheck();
    await (await firstResponse).finished();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    reveal();
    await expect(page.locator(".project-setup-status h2")).toHaveText(
      /^Setup\s*Scanning$/u,
    );
    expect(checks).toBe(2);
    await expect(
      page.getByRole("button", { name: "Check again", exact: true }),
    ).toBeEnabled();
    await expectAccessibleReflow(page, "resumed-setup-after-suspense");
    await page.screenshot({
      path: info.outputPath("setup-resumed.png"),
      fullPage: true,
    });
  } finally {
    finishCheck();
    reveal();
  }
});

test("removing the parent retires an unfinished setup check before its response arrives", async ({
  page,
}, info) => {
  const project = PROJECTS.find((candidate) => candidate.id === "eliza");
  if (!project) throw new Error("Missing project fixture");
  await serveProjectMaintainer(page, () => project);
  let sessionReads = 0;
  await page.route("**/api/v1/project-session", (route) => {
    sessionReads += 1;
    return route.fulfill({
      json: {
        session: { githubId: "1", githubLogin: "local-owner", admin: false },
      },
    });
  });
  let started: () => void = () => {};
  const checkStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  let finish: () => void = () => {};
  const finishCheck = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route("**/api/v1/project-setup/eliza/check", async (route) => {
    started();
    await finishCheck;
    await route.fulfill({
      json: {
        setup: {
          projectId: project.id,
          name: project.name,
          slug: project.slug,
          revision: 1,
          status: "active",
          state: "ready",
          nextAction: { kind: "none", message: "Project active.", href: null },
          checks: {
            authority: { state: "verified", message: "Verified." },
            installation: { state: "installed", message: "Installed." },
            scan: { state: "cleared", message: "Cleared." },
          },
          funding: { mode: "none" },
          activatedRevision: null,
          checkedAt: new Date().toISOString(),
        },
      },
    });
  });
  await page.route("**/api/v1/projects/eliza/remove", (route) =>
    route.fulfill({
      json: {
        project: {
          id: project.id,
          revision: 2,
          status: "paused",
          manifest: { ...project, status: "paused", listingTier: "retired" },
        },
      },
    }),
  );
  try {
    await page.goto("/projects/eliza/manage", {
      waitUntil: "domcontentloaded",
    });
    await checkStarted;
    const remove = page.getByRole("button", {
      name: "Remove project",
      exact: true,
    });
    await expect(remove).toBeEnabled();
    page.once("dialog", (dialog) => dialog.accept());
    await remove.click();
    await expect(
      page.getByRole("heading", { name: "Project removed", exact: true }),
    ).toBeVisible();
    const readsAfterRemoval = sessionReads;
    const response = page.waitForResponse((value) =>
      value.url().includes("project-setup/eliza/check"),
    );
    finish();
    await (await response).finished();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(page.locator(".project-setup-status")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Project removed", exact: true }),
    ).toBeVisible();
    expect(sessionReads).toBe(readsAfterRemoval);
    await expectAccessibleReflow(page, "removed-parent-retires-setup");
    await page.screenshot({
      path: info.outputPath("setup-removed-after-late-response.png"),
      fullPage: true,
    });
  } finally {
    finish();
  }
});
