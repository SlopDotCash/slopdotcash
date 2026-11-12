import type { Route } from "@playwright/test";
import { nextUtcMonthStart } from "../../src/lib/project-repositories.mjs";
import { PROJECTS } from "../../src/lib/projects.mjs";
import { CONTRIBUTION } from "../project-application-manifest";
import { expect, expectAccessibleReflow, test } from "./fixtures";
import { serveProjectMaintainer } from "./project-maintainer-fixture";

const ADDED = "acme-tools/extra";

/** Public GitHub facts as the site's repository lookup route returns them. */
function lookup(overrides: Record<string, unknown> = {}) {
  return {
    repository: ADDED,
    description: null,
    numericId: "555000111",
    nodeId: "R_extra",
    defaultBranch: "main",
    branches: ["main"],
    branchCommits: { main: "a".repeat(40) },
    fork: false,
    archived: false,
    owner: {
      login: "acme-tools",
      actorId: "777000111",
      nodeId: "O_acme",
      kind: "organization",
    },
    license: { state: "unknown", reason: "No LICENSE file." },
    ...overrides,
  };
}

/** The start date the page shows: the next UTC month, in the app's format. */
function startDate() {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(nextUtcMonthStart(new Date())));
}

function elizaProject() {
  const project = PROJECTS.find((candidate) => candidate.id === "eliza");
  if (!project) throw new Error("Missing project fixture");
  // Complete contribution rules, so the append is the only change to review.
  return { ...project, contribution: { ...CONTRIBUTION } };
}

test("a maintainer adds a repository, sees when it counts and publishes the append", async ({
  diagnostics,
  page,
}, info) => {
  const project = elizaProject();
  await serveProjectMaintainer(page, () => project);
  await page.route(
    `**/api/v1/project-github/repositories/${ADDED}`,
    (route: Route) => route.fulfill({ json: { repository: lookup() } }),
  );
  const published: Record<string, unknown>[] = [];
  await page.route(/\/api\/v1\/projects\/eliza(?:\?.*)?$/u, (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    const body = route.request().postDataJSON() as {
      manifest: typeof project;
    };
    published.push(body);
    // The first publication meets a month boundary on Slop's clock.
    if (published.length === 1)
      return route.fulfill({
        status: 422,
        json: {
          error: "invalid_repository_start",
          message: `${ADDED} must count from another month.`,
        },
      });
    return route.fulfill({
      json: {
        project: {
          id: project.id,
          revision: 2,
          status: "paused",
          manifest: { ...body.manifest, status: "paused" },
        },
        changes: {
          presentation: [],
          executable: ["repositories"],
          financial: [],
        },
        setup: {
          projectId: project.id,
          name: project.name,
          slug: project.slug,
          revision: 2,
          status: "paused",
          state: "waiting",
          nextAction: {
            kind: "wait_for_scan",
            message: "Wait for the security scan.",
            href: null,
          },
          checks: {
            authority: { state: "verified", message: "Verified." },
            installation: { state: "installed", message: "Installed." },
            scan: {
              state: "queued",
              message: `${ADDED}: The security scan is queued. Nothing is needed from you.`,
            },
          },
          funding: { mode: "none" },
          activatedRevision: null,
          checkedAt: new Date().toISOString(),
        },
      },
    });
  });
  await page.goto("/projects/eliza/manage", { waitUntil: "networkidle" });
  const summary = page.locator("summary", { hasText: /^Repositories$/u });
  await summary.click();
  const group = page.locator("details", { has: summary });
  await expect(group.getByText(project.repositories[0].id)).toBeVisible();
  await page
    .getByLabel("GitHub repository", { exact: true })
    .fill(`https://github.com/${ADDED}`);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    group.getByText(
      `Counts from ${startDate()}. A security scan runs before it counts; an active project pauses until the scan clears.`,
    ),
  ).toBeVisible();
  // GitHub gave no usable description, so the owner writes one.
  const description = page.getByLabel("Description", { exact: true });
  await expect(description).toBeVisible();
  await page
    .getByRole("button", { name: "Publish changes", exact: true })
    .click();
  await expect(page.getByText("Enter 12 to 500 characters.")).toBeVisible();
  expect(published).toEqual([]);
  await description.fill("Extra tooling the project ships beside its core.");
  await expect(
    page.getByText("Contribution changes need a new security scan."),
  ).toBeVisible();
  // The pending repository is part of the draft saved on this device.
  await expect(page.getByText("Draft saved on this device.")).toBeVisible();
  await page.reload({ waitUntil: "networkidle" });
  await summary.click();
  await expect(
    group.getByText(
      `Counts from ${startDate()}. A security scan runs before it counts; an active project pauses until the scan clears.`,
    ),
  ).toBeVisible();
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue(
    "Extra tooling the project ships beside its core.",
  );
  await expectAccessibleReflow(page, "project-add-repository");
  await page.screenshot({
    path: info.outputPath("add-repository-pending.png"),
    fullPage: true,
  });
  diagnostics.allowResponse(422, "PUT", "/api/v1/projects/eliza");
  const publish = page.getByRole("button", {
    name: "Publish changes",
    exact: true,
  });
  await publish.click();
  await expect(
    page.getByText(
      "The month an added repository counts from has changed. Check this device's date, then publish again.",
    ),
  ).toBeVisible();
  await publish.click();
  await expect(page.getByText("Published revision 2.")).toBeVisible();
  expect(published).toHaveLength(2);
  const sent = published[1] as {
    manifest: typeof project;
    expectedRevision: number;
  };
  expect(sent.expectedRevision).toBe(1);
  expect(sent.manifest.repositories).toEqual([
    ...project.repositories,
    {
      id: ADDED,
      displayName: ADDED,
      githubUrl: `https://github.com/${ADDED}`,
      description: "Extra tooling the project ships beside its core.",
      integrationBranch: "main",
      githubId: "555000111",
      nodeId: "R_extra",
      countsFrom: nextUtcMonthStart(new Date()),
    },
  ]);
  // The published repository now lists with its start date.
  await expect(
    group.getByText(`Counts from ${startDate()}`, { exact: true }),
  ).toBeVisible();
});

test("a refused repository shows why inline and is not added", async ({
  page,
}) => {
  const project = elizaProject();
  await serveProjectMaintainer(page, () => project);
  await page.route(`**/api/v1/project-github/repositories/${ADDED}`, (route) =>
    route.fulfill({ json: { repository: lookup({ fork: true }) } }),
  );
  await page.goto("/projects/eliza/manage", { waitUntil: "networkidle" });
  await page.locator("summary", { hasText: /^Repositories$/u }).click();
  const field = page.getByLabel("GitHub repository", { exact: true });
  await field.fill(ADDED);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    page.getByText(`${ADDED} is a fork. Add the original repository instead.`),
  ).toBeVisible();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText(/^Counts from /u)).toHaveCount(0);
  // The first repository is already listed.
  await field.fill(project.repositories[0].id);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    page.getByText(`${project.repositories[0].id} is already listed.`),
  ).toBeVisible();
});

test("a pending repository can be removed before publication", async ({
  page,
}) => {
  const project = elizaProject();
  await serveProjectMaintainer(page, () => project);
  await page.route(`**/api/v1/project-github/repositories/${ADDED}`, (route) =>
    route.fulfill({
      json: {
        repository: lookup({
          description: "Extra tooling the project ships beside its core.",
        }),
      },
    }),
  );
  let writes = 0;
  await page.route(/\/api\/v1\/projects\/eliza(?:\?.*)?$/u, (route) => {
    if (route.request().method() === "PUT") writes += 1;
    return route.fallback();
  });
  await page.goto("/projects/eliza/manage", { waitUntil: "networkidle" });
  await page.locator("summary", { hasText: /^Repositories$/u }).click();
  await page.getByLabel("GitHub repository", { exact: true }).fill(ADDED);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  // A usable GitHub description needs no owner text.
  await expect(page.getByLabel("Description", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Repositories", level: 3 }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: `Remove ${ADDED}`, exact: true })
    .click();
  await expect(page.getByText(/^Counts from /u)).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Repositories", level: 3 }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Publish changes", exact: true })
    .click();
  await expect(
    page.getByText("Change at least one field before you publish."),
  ).toBeVisible();
  expect(writes).toBe(0);
  // It can be added again.
  await page.getByLabel("GitHub repository", { exact: true }).fill(ADDED);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    page.getByRole("button", { name: `Remove ${ADDED}`, exact: true }),
  ).toBeVisible();
});
