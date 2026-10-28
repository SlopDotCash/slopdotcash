import { PROJECTS } from "../../src/lib/projects.mjs";
import { enlargeText } from "../text-size";
import { expect, expectAccessible, test } from "./fixtures";

test("admin distinguishes retained admission from the current revision and can request an investigation", async ({
  page,
  diagnostics,
}, info) => {
  diagnostics.allowCanceledBackgroundReads();
  const project = PROJECTS[0];
  const now = "2026-10-27T09:00:00.000Z";
  const assessment = {
    id: "admission-1",
    revision: 1,
    state: "clean",
    commitSha: "a".repeat(40),
    templateSha256: "b".repeat(64),
    policyVersion: "test-policy",
    requestedAt: now,
    completedAt: now,
    modelRuns: [],
    artifacts: 1,
    heldArtifacts: 0,
  };
  let queued = false;
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({
      json: {
        session: { githubId: "4242", githubLogin: "example", admin: true },
      },
    }),
  );
  await page.route("**/api/v1/admin/projects", (route) =>
    route.fulfill({
      json: {
        projects: [
          {
            id: project.id,
            status: "active",
            revision: 4,
            manifest: project,
            manifestSha256: "c".repeat(64),
            createdAt: now,
            updatedAt: now,
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
          },
        ],
      },
    }),
  );
  await page.route("**/api/v1/admin/fee-conversions", (route) =>
    route.fulfill({
      json: {
        schemaVersion: "1",
        recent: [],
        routes: [],
        totals: [],
        last24Hours: [],
      },
    }),
  );
  await page.route("**/api/v1/admin/vetting", (route) =>
    route.fulfill({
      json: {
        service: { state: "available", queueRegistrationAvailable: true },
        projects: [
          {
            id: project.id,
            name: project.name,
            status: "active",
            revision: 4,
            clearance: queued
              ? {
                  state: "queued",
                  assessment: {
                    ...assessment,
                    id: "investigation-4",
                    revision: 4,
                    state: "pending",
                  },
                }
              : { state: "cleared", basis: "admission", assessment },
          },
        ],
        assessments: queued
          ? [
              {
                ...assessment,
                id: "investigation-4",
                revision: 4,
                state: "pending",
                projectId: project.id,
                requestedBy: { githubLogin: "example" },
                requestReason: "Investigate a reported dependency",
                result: null,
              },
            ]
          : [],
      },
    }),
  );
  await page.route("**/api/v1/admin/vetting/assessments", (route) => {
    expect(route.request().postDataJSON()).toEqual({
      projectId: project.id,
      revision: 4,
      reason: "Investigate a reported dependency",
    });
    queued = true;
    return route.fulfill({ json: {} });
  });
  await page.goto(`/admin?project=${project.id}`, { waitUntil: "networkidle" });
  const card = page.getByRole("article", {
    name: `Security vetting for ${project.id}`,
  });
  await expect(card.locator(".admin-badge")).toHaveText("Admitted");
  await expect(card).toContainText("revision 4 · active");
  await expect(card).toContainText("Admission scan of revision 1 · Clean");
  await expect(card).not.toContainText("Scan of revision 4 · Clean");
  await expectAccessible(page);
  await enlargeText(page.locator("body"));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("retained-admission.png"),
    fullPage: true,
  });
  await card
    .getByText("Queue scan of revision 4", { exact: true })
    .locator("xpath=self::summary")
    .focus();
  await page.keyboard.press("Enter");
  await card
    .getByLabel("Reason for the scan")
    .fill("Investigate a reported dependency");
  await card.getByRole("button", { name: "Queue scan of revision 4" }).focus();
  await page.keyboard.press("Enter");
  await expect(card.locator(".admin-badge")).toHaveText("Queued");
  await expect(
    card.getByRole("button", { name: "Queue scan of revision 4" }),
  ).toHaveCount(0);
  await expectAccessible(page);
  await page.screenshot({
    path: info.outputPath("explicit-investigation.png"),
    fullPage: true,
  });
  await page.route("**/api/v1/operator/vetting-evidence?**", (route) =>
    route.fulfill({
      json: {
        runs: [
          {
            assessmentId: "admission-1",
            runId: "run-1",
            manifestSha256: "c".repeat(64),
            expiresAt: null,
            permanentAdmissionEvidence: true,
            policy: { version: "slop-scanner-evidence-2026-10-28" },
            objects: [],
          },
        ],
        retentionBoundary: "Private synthetic admission evidence.",
      },
    }),
  );
  await page.goto("/vetting-evidence?assessmentId=admission-1&runId=run-1");
  // A signed-in evidence deep link loads its exact inventory automatically.
  await page.getByText("Run details and retention", { exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByText("Admission evidence is retained permanently.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.getByText("Case open.", { exact: false })).toHaveCount(0);
  await expectAccessible(page);
  await page.screenshot({
    path: info.outputPath("permanent-admission-evidence.png"),
    fullPage: true,
  });
});
