import type { Page, Request } from "@playwright/test";
import type { EnforcementPreview } from "../../src/lib/project-contracts";
import { PROJECTS, type ProjectDefinition } from "../../src/lib/projects.mjs";
import { expect, expectAccessible, test } from "./fixtures";
import { adminProjectRecord } from "./project-maintainer-fixture";

/**
 * Admin list search, the delist confirmation and the enforcement preview
 * (PRD ADM-06): each cancel leaves the project unchanged and sends no write.
 */

function fixtureProject(id: string): ProjectDefinition {
  const project = PROJECTS.find((entry) => entry.id === id);
  if (!project) throw new Error(`Missing fixture project ${id}`);
  return project;
}

function record(
  project: ProjectDefinition,
  revision: number,
  moderation: "moderator" | "unconfigured",
) {
  return adminProjectRecord(project, { revision, moderation });
}

/** Serves an admin session and a mutable admin project list. */
async function adminFixture(
  page: Page,
  projects: () => ProjectDefinition[],
  moderation: "moderator" | "unconfigured" = "unconfigured",
) {
  const revisions = new Map<string, number>();
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({
      json: {
        session: { githubId: "4242", githubLogin: "operator", admin: true },
      },
    }),
  );
  await page.route("**/api/v1/admin/vetting?**", (route) =>
    route.fulfill({
      json: {
        service: { state: "available", queueRegistrationAvailable: true },
        projects: projects().map((project) => ({
          id: project.id,
          name: project.name,
          status: project.status,
          revision: revisions.get(project.id) ?? 1,
          clearance: { state: "cleared", assessment: null },
        })),
        assessments: [],
      },
    }),
  );
  await page.route("**/api/v1/admin/projects", (route) =>
    route.fulfill({
      json: {
        projects: projects().map((project) =>
          record(project, revisions.get(project.id) ?? 1, moderation),
        ),
      },
    }),
  );
  return revisions;
}

const writes = (page: Page) => {
  const sent: Request[] = [];
  page.on("request", (request) => {
    if (
      request.method() !== "GET" &&
      new URL(request.url()).pathname.startsWith("/api/v1/admin/")
    )
      sent.push(request);
  });
  return sent;
};

test("admin search finds a project by name or repository and Keep listed leaves it listed", async ({
  page,
}, info) => {
  const first = fixtureProject("asi");
  let second = fixtureProject("eliza");
  const revisions = await adminFixture(page, () => [first, second]);
  const sent = writes(page);
  const delists: Record<string, unknown>[] = [];
  const delistMethods: string[] = [];
  await page.route(
    `**/api/v1/admin/projects/${second.id}/manifest`,
    (route) => {
      delistMethods.push(route.request().method());
      const body = route.request().postDataJSON();
      delists.push(body);
      second = body.manifest;
      revisions.set(second.id, 2);
      return route.fulfill({
        json: { project: record(second, 2, "unconfigured") },
      });
    },
  );
  await page.goto("/admin", { waitUntil: "networkidle" });
  const search = page.getByRole("searchbox", {
    name: "Find a project",
    exact: true,
  });
  const openFirst = page.getByRole("link", {
    name: `Open ${first.name}`,
    exact: true,
  });
  const openSecond = page.getByRole("link", {
    name: `Open ${second.name}`,
    exact: true,
  });
  await expect(openFirst).toBeVisible();
  await expect(openSecond).toBeVisible();

  // A repository path matches only its own project, ignoring case.
  const repository = second.repositories[0].id;
  expect(first.repositories.some((repo) => repo.id === repository)).toBe(false);
  await search.fill(`  ${repository.toUpperCase()} `);
  await expect(openSecond).toBeVisible();
  await expect(openFirst).toHaveCount(0);
  // The project name matches too.
  await search.fill(first.name);
  await expect(openFirst).toBeVisible();
  await expect(openSecond).toHaveCount(0);
  await search.fill("no-project-has-this-name");
  await expect(
    page.getByText("No matching projects.", { exact: true }),
  ).toBeVisible();
  await expect(openFirst).toHaveCount(0);
  await expectAccessible(page);
  await search.fill("");
  await expect(openFirst).toBeVisible();
  await expect(openSecond).toBeVisible();

  await search.fill(repository);
  await openSecond.click();
  await expect(page).toHaveURL(`/admin?project=${second.id}`);
  const delist = page.getByRole("button", { name: "Delist", exact: true });
  await delist.click();
  const question = page.getByText("Hide this project everywhere?", {
    exact: true,
  });
  await expect(question).toBeVisible();
  await page.screenshot({
    path: info.outputPath("delist-confirmation.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Keep listed", exact: true }).click();
  await expect(question).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Delist project", exact: true }),
  ).toHaveCount(0);
  await expect(delist).toBeVisible();
  expect(sent).toHaveLength(0);
  expect(delistMethods).toHaveLength(0);

  // Confirming afterwards still sends exactly one retiring revision.
  await delist.click();
  await page
    .getByRole("button", { name: "Delist project", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Saved.");
  expect(delistMethods).toEqual(["PUT"]);
  expect(delists[0]).toMatchObject({
    expectedRevision: 1,
    reason: "Delisted by an admin",
    manifest: { id: second.id, status: "paused", listingTier: "retired" },
  });
  // A retired project offers no further delist.
  await expect(delist).toHaveCount(0);
  await expectAccessible(page);
});

test("canceling an enforcement preview returns to an editable form without recording", async ({
  page,
}, info) => {
  const project = fixtureProject("asi");
  await adminFixture(page, () => [project], "moderator");
  const sent = writes(page);
  const previews: Record<string, unknown>[] = [];
  let applied = 0;
  await page.route(
    `**/api/v1/admin/projects/${project.id}/enforcement-preview`,
    (route) => {
      const body = route.request().postDataJSON();
      previews.push(body);
      const preview: EnforcementPreview = {
        projectId: project.id,
        projectName: project.name,
        action: body.action,
        sequence: 1,
        stateBefore: "clear",
        stateAfter: "quarantined",
        appealBefore: "none",
        appealAfter: "none",
        result: "revision_appended",
        pendingReason: null,
        maintainerBans: [],
        revision: {
          before: 1,
          after: 2,
          statusBefore: project.status,
          statusAfter: "paused",
          listingTierBefore: project.listingTier,
          listingTierAfter: project.listingTier,
        },
      };
      return route.fulfill({ json: { preview } });
    },
  );
  await page.route(
    `**/api/v1/admin/projects/${project.id}/enforcement`,
    (route) => {
      applied += 1;
      return route.fulfill({ status: 500, json: { error: "unexpected" } });
    },
  );
  await page.goto(`/admin?project=${project.id}`, {
    waitUntil: "networkidle",
  });
  const panel = page.locator("section.admin-enforcement");
  const reason = panel.getByRole("textbox", { name: "Reason", exact: true });
  const evidence = panel.getByRole("textbox", {
    name: "Evidence link or case ID",
    exact: true,
  });
  const action = panel.getByRole("combobox", { name: "Action", exact: true });
  await action.selectOption({ label: "Quarantine" });
  await reason.fill("Synthetic flagged release under review.");
  await evidence.fill("case-e2e-preview-cancel");
  await panel
    .getByRole("button", { name: "Preview action", exact: true })
    .click();
  const preview = panel.getByRole("group", { name: "Preview", exact: true });
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("No restriction → Quarantined");
  await expect(preview).toContainText("1 → 2");
  await expect(
    preview.getByRole("button", { name: "Confirm: Quarantine", exact: true }),
  ).toBeVisible();
  await expect(reason).toHaveAttribute("readonly", "");
  await expect(action).toBeDisabled();
  expect(previews).toEqual([
    expect.objectContaining({
      action: "quarantine",
      reason: "Synthetic flagged release under review.",
      evidenceReference: "case-e2e-preview-cancel",
      expectedRevision: 1,
      expectedSequence: 1,
    }),
  ]);
  await page.screenshot({
    path: info.outputPath("enforcement-preview.png"),
    fullPage: true,
  });

  await preview.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(preview).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "Preview action", exact: true }),
  ).toBeVisible();
  // The entered reason and evidence stay, and the form is editable again.
  await expect(reason).toHaveValue("Synthetic flagged release under review.");
  await expect(reason).not.toHaveAttribute("readonly", "");
  await expect(action).toBeEnabled();
  await reason.fill("Synthetic flagged release, revised reason.");
  await expect(reason).toHaveValue(
    "Synthetic flagged release, revised reason.",
  );
  expect(applied).toBe(0);
  expect(
    sent.filter((request) =>
      new URL(request.url()).pathname.endsWith("/enforcement"),
    ),
  ).toHaveLength(0);
  await expectAccessible(page);
});

for (const malformed of ["rows", "amount"] as const) {
  test(`invalid fee conversion ${malformed} stays in the report error state and can retry`, async ({
    page,
  }) => {
    await adminFixture(page, () => []);
    let invalid = true;
    await page.route("**/api/v1/admin/fee-conversions", (route) =>
      route.fulfill({
        json: invalid
          ? malformed === "rows"
            ? { routes: null, totals: [] }
            : {
                routes: [
                  { network: "base", targetToken: "token", status: "usdc" },
                ],
                totals: [
                  {
                    network: "base",
                    token: "token",
                    targetToken: "token",
                    conversions: 1,
                    amountIn: "1",
                    amountOut: "not-an-amount",
                  },
                ],
              }
          : { routes: [], totals: [], extraServerMetadata: true },
      }),
    );
    await page.goto("/admin?section=fees", { waitUntil: "networkidle" });
    const report = page.getByRole("region", {
      name: "Fee conversions",
      exact: true,
    });
    await expect(report.getByRole("alert")).toContainText(
      "The fee conversion report is invalid.",
    );
    await expect(
      page.getByRole("link", { name: "Projects", exact: true }),
    ).toBeVisible();
    invalid = false;
    await report.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(report.getByRole("alert")).toHaveCount(0);
    await expect(
      report.getByRole("button", { name: "Retry", exact: true }),
    ).toHaveCount(0);
  });
}
