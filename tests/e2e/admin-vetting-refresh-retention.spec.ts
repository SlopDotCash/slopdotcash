import { PROJECTS } from "../../src/lib/projects.mjs";
import { expect, expectAccessible, test } from "./fixtures";
import { serveProjectMaintainer } from "./project-maintainer-fixture";

const REASON = "Re-scan the current revision after the manifest change.";
const UNAVAILABLE = "Vetting records temporarily unavailable.";

/**
 * Queuing a scan reloads the security-vetting panel while it is on screen. A
 * transient failure of that reload keeps the loaded clearance, scan history
 * and admin controls visible; an authorization failure still replaces them
 * with the full error. Mirrors `admin-refresh-retention.spec.ts`, which covers
 * the project list.
 */
for (const retryStatus of [200, 403]) {
  test(`admin vetting retains a transiently unavailable record and handles retry ${retryStatus}`, async ({
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
    const record = () => ({
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
    });
    await page.route("**/api/v1/admin/projects", (route) =>
      route.fulfill({ json: { projects: [record()] } }),
    );
    // The queued scan the server reports once the request returns.
    const queuedScan = () => ({
      id: "assessment-1",
      projectId: project.id,
      revision: 1,
      state: "pending",
      requestedAt: "2026-10-22T00:00:00.000Z",
      requestedBy: { githubLogin: "operator" },
      requestReason: REASON,
      commitSha: "b".repeat(40),
      templateSha256: "c".repeat(64),
      policyVersion: "vetting-policy:1",
      modelRuns: [],
      completedAt: null,
      result: null,
    });
    let queued = false;
    let retried = false;
    const overview = () => ({
      service: { state: "available", queueRegistrationAvailable: true },
      projects: [
        {
          id: project.id,
          name: project.name,
          status: project.status,
          revision: 1,
          clearance: { state: "cleared", assessment: null },
        },
      ],
      assessments: queued ? [queuedScan()] : [],
      exemptions: [],
      flags: [],
    });
    await page.route(/\/api\/v1\/admin\/vetting(?:\?[^/]*)?$/u, (route) => {
      const status = queued ? (retried ? retryStatus : 503) : 200;
      return route.fulfill({
        status,
        json:
          status === 200
            ? overview()
            : {
                error: status === 503 ? "unavailable" : "forbidden",
                message: status === 503 ? UNAVAILABLE : "Vetting access ended.",
              },
      });
    });
    await page.route(/\/api\/v1\/admin\/vetting\/assessments$/u, (route) => {
      expect(route.request().method()).toBe("POST");
      expect(route.request().postDataJSON().reason).toBe(REASON);
      queued = true;
      return route.fulfill({ json: { assessment: queuedScan() } });
    });
    const denied = diagnostics.allowResponse(
      503,
      "GET",
      "/api/v1/admin/vetting",
    );
    if (retryStatus !== 200)
      diagnostics.allowResponse(retryStatus, "GET", "/api/v1/admin/vetting");
    await page.goto(`/admin?project=${project.id}&section=security`, {
      waitUntil: "networkidle",
    });
    const card = page.getByRole("article", {
      exact: true,
      name: `Security vetting for ${project.id}`,
    });
    const scan = page.getByRole("button", {
      exact: true,
      name: "Queue scan of revision 1",
    });
    await expect(card).toBeVisible();
    await expect(scan).toBeVisible();
    await page
      .getByRole("textbox", { exact: true, name: "Reason for the scan" })
      .fill(REASON);
    await scan.click();
    await expect(page.getByRole("alert")).toContainText(UNAVAILABLE);
    // The loaded clearance and the record it governs stay on screen.
    await expect(card).toBeVisible();
    await expect(card).toContainText("Existing-project exemption");
    await expect(card).toContainText("asi · revision 1 · active");
    expect(diagnostics.count(denied)).toBe(1);
    await expectAccessible(page);
    await page.screenshot({
      path: info.outputPath(`retained-${retryStatus}.png`),
      fullPage: true,
    });
    retried = true;
    const retry = page
      .getByRole("alert")
      .getByRole("button", { exact: true, name: "Retry" });
    await retry.focus();
    await page.keyboard.press("Enter");
    if (retryStatus === 200) {
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(card).toBeVisible();
      // The read that now succeeds reports the queued scan, so the scan form
      // gives way to it instead of staying on screen.
      await expect(scan).toHaveCount(0);
      await expect(card).toContainText("Scan history");
      await expect(card).toContainText("Queued");
    } else {
      await expect(page.getByRole("alert")).toContainText(
        "Vetting access ended.",
      );
      await expect(card).toHaveCount(0);
    }
    await expectAccessible(page);
    await page.screenshot({
      path: info.outputPath(`retried-${retryStatus}.png`),
      fullPage: true,
    });
  });
}
