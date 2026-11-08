/** Shared session consumers must remove stale authority while rechecking. */
import { PROJECTS } from "../../src/lib/projects.mjs";
import { expect, test } from "./fixtures";
import { serveProjectMaintainer } from "./project-maintainer-fixture";

test.use({ video: "on" });
for (const surface of ["admin", "owner"] as const) {
  test(`${surface} controls close while focus revalidates a signed-out account`, async ({
    page,
    diagnostics,
  }, info) => {
    diagnostics.allowPreviewApiMisses();
    const project = PROJECTS.find((entry) => entry.id === "eliza");
    if (!project) throw new Error("Missing project fixture");
    await serveProjectMaintainer(page, () => project);
    await page.route("**/api/v1/admin/projects", (route) =>
      route.fulfill({ json: { projects: [] } }),
    );
    await page.route("**/api/v1/admin/vetting?**", (route) =>
      route.fulfill({
        json: {
          service: { state: "available", queueRegistrationAvailable: true },
          projects: [],
          assessments: [],
        },
      }),
    );
    let signedIn = true;
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/v1/project-session", async (route) => {
      const answer = signedIn;
      if (!answer) await held;
      await route.fulfill({
        json: {
          session: answer
            ? { githubId: "42", githubLogin: "operator", admin: true }
            : null,
        },
      });
    });
    await page.goto(surface === "admin" ? "/admin" : "/projects/eliza/manage", {
      waitUntil: "networkidle",
    });
    const controls =
      surface === "admin"
        ? page.getByRole("navigation", { name: "Administration", exact: true })
        : page.getByLabel("Short description", { exact: true });
    await expect(controls).toBeVisible();
    signedIn = false;
    const requested = page.waitForRequest(
      (request) =>
        new URL(request.url()).pathname === "/api/v1/project-session",
      { timeout: 10_000 },
    );
    try {
      // A synthetic focus signal is deterministic in headless Chromium. The
      // separate cross-tab test changes the real shared browser cookie.
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await requested;
      await expect(controls).toHaveCount(0);
      release();
      await expect(
        page
          .getByRole("link", { name: "Sign in with GitHub", exact: true })
          .first(),
      ).toBeVisible();
    } finally {
      release();
      await page.screenshot({
        path: info.outputPath(`${surface}-focus-session.png`),
        fullPage: true,
      });
    }
  });
}

test("an old focus response cannot reopen administration after a newer sign-out", async ({
  page,
  diagnostics,
}, info) => {
  diagnostics.allowPreviewApiMisses();
  await page.route("**/api/v1/admin/projects", (route) =>
    route.fulfill({ json: { projects: [] } }),
  );
  await page.route("**/api/v1/admin/vetting?**", (route) =>
    route.fulfill({
      json: {
        service: { state: "available", queueRegistrationAvailable: true },
        projects: [],
        assessments: [],
      },
    }),
  );
  let checking = false;
  let checks = 0;
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/project-session", async (route) => {
    const current = checking ? ++checks : 0;
    if (current === 1) await held;
    await route.fulfill({
      json: {
        session:
          current < 2
            ? { githubId: "42", githubLogin: "operator", admin: true }
            : null,
      },
    });
  });
  await page.goto("/admin", { waitUntil: "networkidle" });
  const controls = page.getByRole("navigation", {
    name: "Administration",
    exact: true,
  });
  await expect(controls).toBeVisible();
  checking = true;
  try {
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(() => checks, { timeout: 10_000 }).toBe(1);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      page
        .getByRole("link", { name: "Sign in with GitHub", exact: true })
        .first(),
    ).toBeVisible();
    release();
    await page.waitForLoadState("networkidle");
    await expect(controls).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath("obsolete-session-response.png"),
      fullPage: true,
    });
  } finally {
    release();
  }
});
