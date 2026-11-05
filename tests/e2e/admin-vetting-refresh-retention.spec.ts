import { PROJECTS } from "../../src/lib/projects.mjs";
import { expect, expectAccessible, test } from "./fixtures";
import { serveProjectMaintainer } from "./project-maintainer-fixture";

const REASON = "Re-scan the current revision after the manifest change.";
const UNAVAILABLE = "Vetting records temporarily unavailable.";

function fixtureProject(id: string) {
  const project = PROJECTS.find((entry) => entry.id === id);
  if (!project) throw new Error(`Missing fixture project ${id}`);
  return project;
}

/** One admin project record, as `GET /api/v1/admin/projects` returns it. */
function adminProjectRecord(project: ReturnType<typeof fixtureProject>) {
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

function assessment(
  projectId: string,
  state: "pending" | "clean",
): Record<string, unknown> {
  return {
    id: `assessment-${state}`,
    projectId,
    revision: 1,
    state,
    requestedAt: "2026-10-22T00:00:00.000Z",
    requestedBy: { githubLogin: "operator" },
    requestReason: REASON,
    commitSha: "b".repeat(40),
    templateSha256: "c".repeat(64),
    policyVersion: "vetting-policy:1",
    modelRuns: [],
    completedAt: state === "clean" ? "2026-10-22T00:05:00.000Z" : null,
    result: null,
  };
}

/** The vetting overview `GET /api/v1/admin/vetting` answers with. */
function vettingOverview(
  projectIds: string[],
  assessments: Record<string, unknown>[] = [],
) {
  return {
    service: { state: "available", queueRegistrationAvailable: true },
    projects: projectIds.map((id) => {
      const project = fixtureProject(id);
      return {
        id: project.id,
        name: project.name,
        status: project.status,
        revision: 1,
        clearance: { state: "cleared", assessment: null },
      };
    }),
    assessments,
    exemptions: [],
    flags: [],
  };
}

async function serveAdmin(
  page: import("@playwright/test").Page,
  ids: string[],
) {
  const project = fixtureProject(ids[0]);
  await serveProjectMaintainer(page, () => project);
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({
      json: {
        session: { githubId: "4242", githubLogin: "operator", admin: true },
      },
    }),
  );
  await page.route("**/api/v1/admin/projects", (route) =>
    route.fulfill({
      json: {
        projects: ids.map((id) => adminProjectRecord(fixtureProject(id))),
      },
    }),
  );
}

/**
 * Queuing a scan reloads the security-vetting panel while it is on screen. A
 * transient failure of that reload keeps the loaded clearance, scan history
 * and admin controls visible and usable; an authorization failure still
 * replaces them with the full error. Mirrors `admin-refresh-retention.spec.ts`,
 * which covers the project list.
 */
for (const retryStatus of [200, 403]) {
  test(`admin vetting retains a transiently unavailable record and handles retry ${retryStatus}`, async ({
    page,
    diagnostics,
  }, info) => {
    const project = fixtureProject("asi");
    await serveAdmin(page, ["asi"]);
    let queued = false;
    let retried = false;
    await page.route(/\/api\/v1\/admin\/vetting(?:\?[^/]*)?$/u, (route) => {
      const status = queued ? (retried ? retryStatus : 503) : 200;
      return route.fulfill({
        status,
        json:
          status === 200
            ? // The retry finds the scan the worker has already finished, so
              // the queued form is not hidden by a pending assessment.
              vettingOverview(
                ["asi"],
                queued ? [assessment("asi", "clean")] : [],
              )
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
      return route.fulfill({
        json: { assessment: assessment("asi", "pending") },
      });
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
    const reason = page.getByRole("textbox", {
      exact: true,
      name: "Reason for the scan",
    });
    await expect(card).toBeVisible();
    await expect(scan).toBeVisible();
    await reason.fill(REASON);
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
    // 200% zoom keeps the recovery control of the retained record usable. The
    // horizontal-width assertion #2073's spec makes at this zoom is not
    // duplicated here: it fails intermittently on unmodified base at mobile
    // width (2 of 18 repeated runs), so it would import that flake.
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    await expect(
      page
        .getByRole("alert")
        .getByRole("button", { exact: true, name: "Retry" }),
    ).toBeVisible();
    await expectAccessible(page);
    await page.evaluate(() => {
      document.documentElement.style.zoom = "1";
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
      await expect(card).toContainText("Scan history");
      // The scan the read now reports is finished, so the form is on screen
      // again: it must have left its in-flight state and its input behind.
      await expect(scan).toBeEnabled();
      await expect(reason).toHaveValue("");
    } else {
      await expect(page.getByRole("alert")).toContainText(
        "Vetting access ended.",
      );
      await expect(card).toHaveCount(0);
      await expect(
        page.getByText(`Queued a scan of ${project.id} revision 1.`),
      ).toHaveCount(0);
    }
    await expectAccessible(page);
    await page.screenshot({
      path: info.outputPath(`retried-${retryStatus}.png`),
      fullPage: true,
    });
  });
}
