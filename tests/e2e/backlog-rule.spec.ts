/**
 * The backlog rule (operator decision, 23 November 2026; PRD section 5).
 * From 1 December 2026 an active monthly-pool project with 50 outside pull
 * requests waiting a week for a maintainer, or with work waiting and no merge
 * in 14 days, is left out of the home page and /sponsors, and its page says
 * why in one line. The owner can mark the project as catching up on reviews
 * from the manage page.
 */

import type { Page } from "@playwright/test";
import { PROJECT_SKILL_TEMPLATES } from "../../src/lib/project-schema.mjs";
import { PROJECTS } from "../../src/lib/projects.mjs";
import { CONTRIBUTION } from "../project-application-manifest";
import { projectImageApiFixture } from "../project-image-api-fixture.mjs";
import { stagingPaymentProject } from "../staging-payment-fixture.mjs";
import { expect, expectAccessibleReflow, test } from "./fixtures";

const NOW = "2026-12-10T12:00:00.000Z";
const OBSERVED_AT = "2026-12-10T11:17:00.000Z";

test.use({ video: "on" });

const BACKLOG_LINE =
  "This project is out of rotation: 60 outside pull requests have waited a week or more for a maintainer. Accepted work still records points.";
const DORMANT_LINE =
  "This project is out of rotation: no pull request has been merged in 14 days while outside pull requests wait. It returns once a maintainer merges.";

/** The frozen registry with a funded Eliza and its stored merge activity. */
async function serveEliza(
  page: Page,
  activity: { waitingOutside: number; lastMergedAt: string | null },
) {
  const eliza = stagingPaymentProject("base-mainnet");
  const vault = eliza.escrow?.deployments[0];
  if (!vault) throw new Error("The Eliza vault fixture is missing");
  await page.route(
    /\/(?:api\/v1\/projects|data\/fixture-project-registry\.json)$/,
    (route) =>
      route.fulfill({
        json: {
          schemaVersion: "1",
          projects: PROJECTS.map((entry) =>
            entry.id === eliza.id ? eliza : entry,
          ),
        },
      }),
  );
  await page.route("**/.well-known/slop/projects.json", (route) =>
    route.fulfill({ json: { schemaVersion: "1", projects: [] } }),
  );
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({ json: { session: null } }),
  );
  await page.route("**/api/v1/pool-funding", (route) =>
    route.fulfill({
      json: {
        schema: "slop-pool-funding-v1",
        projects: [
          {
            projectId: eliza.id,
            vaults: [
              {
                network: vault.network,
                vault: vault.vault,
                freeBalance: eliza.reward.monthlyCapMinor,
                blockTime: OBSERVED_AT,
                observedAt: OBSERVED_AT,
              },
            ],
          },
        ],
      },
    }),
  );
  await page.route("**/api/v1/merge-activity", (route) =>
    route.fulfill({
      json: {
        schema: "slop-merge-activity-v1",
        projects: [
          {
            projectId: eliza.id,
            repositories: [
              {
                repository: eliza.repositories[0].id,
                observedAt: OBSERVED_AT,
                lastAttemptFailed: false,
                lastMergedAt: activity.lastMergedAt,
                waitingOutside: activity.waitingOutside,
                waitingCapped: false,
                mergedOutsideLast30Days: 4,
                medianHoursToMerge: 30,
                openOutside: activity.waitingOutside,
                openOutsideCapped: false,
              },
            ],
          },
        ],
      },
    }),
  );
}

test("a project over the backlog limit leaves the home page and sponsors, and its page says why", async ({
  page,
}, info) => {
  await page.clock.setFixedTime(new Date(NOW));
  await serveEliza(page, { waitingOutside: 60, lastMergedAt: OBSERVED_AT });
  await page.goto("/", { waitUntil: "networkidle" });
  const projects = page.locator("#projects");
  await expect(projects.locator('a[href="/projects/eliza"]')).toHaveCount(0);
  await expect(
    projects.locator('a[href="/projects/delta-star"]'),
  ).toBeVisible();

  await page.goto("/sponsors", { waitUntil: "networkidle" });
  const pools = page.getByRole("list", { name: "Project funding pools" });
  await expect(pools.locator("li").first()).toBeVisible();
  await expect(
    pools.getByRole("link", { name: "Eliza", exact: true }),
  ).toHaveCount(0);

  await page.goto("/projects/eliza", { waitUntil: "networkidle" });
  await expect(page.getByText(BACKLOG_LINE, { exact: true })).toBeVisible();
  await expect(page.locator("#start")).toContainText(
    "This project is out of rotation.",
  );
  await page.screenshot({
    path: info.outputPath("project-backlog-out.png"),
    fullPage: true,
  });
  await expectAccessibleReflow(page, "project-backlog-out");
});

test("a dormant project says it returns once a maintainer merges; a recent merge keeps it listed", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date(NOW));
  await serveEliza(page, {
    waitingOutside: 2,
    lastMergedAt: "2026-11-20T12:00:00.000Z",
  });
  await page.goto("/projects/eliza", { waitUntil: "networkidle" });
  await expect(page.getByText(DORMANT_LINE, { exact: true })).toBeVisible();
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.locator('#projects a[href="/projects/eliza"]')).toHaveCount(
    0,
  );

  await page.unroute("**/api/v1/merge-activity");
  await serveEliza(page, {
    waitingOutside: 2,
    lastMergedAt: "2026-12-08T12:00:00.000Z",
  });
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(
    page.locator('#projects a[href="/projects/eliza"]'),
  ).toBeVisible();
  await page.goto("/projects/eliza", { waitUntil: "networkidle" });
  await expect(page.getByText(DORMANT_LINE, { exact: true })).toHaveCount(0);
});

test("before 1 December the rule shows nothing publicly", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-25T12:00:00.000Z"));
  await serveEliza(page, { waitingOutside: 60, lastMergedAt: null });
  await page.goto("/projects/eliza", { waitUntil: "networkidle" });
  await expect(page.getByText(/out of rotation/u)).toHaveCount(0);
});

test("the owner sees the backlog state and catches up on reviews from the manage page", async ({
  page,
}, info) => {
  // The API fixture's clock is 29 October 2026.
  await page.clock.setFixedTime(new Date("2026-10-29T00:00:00.000Z"));
  const registered = PROJECTS.find((project) => project.id === "eliza");
  if (!registered) throw new Error("Missing project fixture");
  const api = await projectImageApiFixture({
    ...registered,
    contribution: { ...CONTRIBUTION },
    skill: {
      ...registered.skill,
      sourcePath: PROJECT_SKILL_TEMPLATES.contributor,
      publishAtRoot: false,
    },
    reviewSkill: {
      ...registered.reviewSkill,
      sourcePath: PROJECT_SKILL_TEMPLATES.reviewer,
    },
  });
  await page.route("**/api/v1/merge-activity", (route) =>
    route.fulfill({
      json: {
        schema: "slop-merge-activity-v1",
        projects: [
          {
            projectId: "eliza",
            repositories: [
              {
                repository: registered.repositories[0].id,
                observedAt: "2026-10-28T23:00:00.000Z",
                lastAttemptFailed: false,
                lastMergedAt: "2026-10-26T12:00:00.000Z",
                waitingOutside: 60,
                waitingCapped: false,
                mergedOutsideLast30Days: 4,
                medianHoursToMerge: 30,
                openOutside: 70,
                openOutsideCapped: false,
              },
            ],
          },
        ],
      },
    }),
  );
  await page.route(
    /\/api\/v1\/(?:projects\/eliza(?:\?.*)?|project-setup\/eliza(?:\/check)?|project-session)$/u,
    async (route) => {
      const request = route.request();
      const response = await api.fetch(
        new Request(request.url(), {
          method: request.method(),
          headers: request.headers(),
          ...(request.method() === "GET" ? {} : { body: request.postData() }),
        }),
      );
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: await response.text(),
      });
    },
  );
  const publish = page.getByRole("button", {
    name: "Publish changes",
    exact: true,
  });
  const published = (revision: number) =>
    expect(
      page.getByRole("status").getByText(`Rev ${revision}`, { exact: true }),
    ).toBeVisible();
  try {
    await page.goto("/projects/eliza/manage", { waitUntil: "networkidle" });
    await page
      .getByText("Contribution rules", { exact: true })
      .locator("xpath=self::summary")
      .click();
    await expect(
      page.getByText(
        "Review backlog: 60 outside pull requests waiting a week or more, last merge 2 days ago. From 1 December 2026 this takes the project off the home page, /sponsors and agent discovery.",
        { exact: true },
      ),
    ).toBeVisible();
    const box = page.getByLabel(
      "Catching up on reviews until 12 November 2026",
      { exact: true },
    );
    await expect(box).not.toBeChecked();
    await box.check();
    await expect(
      page
        .getByRole("region", { name: "Changes", exact: true })
        .locator("dd")
        .filter({ hasText: "Until 12 November 2026" }),
    ).toHaveText("Until 12 November 2026 Live now");
    await page.screenshot({
      path: info.outputPath("manage-catch-up.png"),
      fullPage: true,
    });
    await box.focus();
    await expect(box).toBeFocused();
    await expectAccessibleReflow(page, "manage-catch-up");
    await publish.click();
    await published(2);
    const started = await api.stored();
    expect(started.project.slopbot).toEqual({
      automaticClosure: false,
      catchUpUntil: "2026-11-12T00:00:00.000Z",
      catchUpHistory: [{ startedAt: "2026-10-29T00:00:00.000Z" }],
    });
    await expect(
      page.getByText(
        "Review backlog: 60 outside pull requests waiting a week or more, last merge 2 days ago. Catching up on reviews until 12 November 2026, so the project stays listed.",
        { exact: true },
      ),
    ).toBeVisible();

    // Ending it early is allowed; it cannot start again this month.
    await box.uncheck();
    await publish.click();
    await published(3);
    expect((await api.stored()).project.slopbot).toEqual({
      automaticClosure: false,
      catchUpHistory: [{ startedAt: "2026-10-29T00:00:00.000Z" }],
    });
    await expect(
      page.getByLabel("Catching up on reviews (already used this month)", {
        exact: true,
      }),
    ).toBeDisabled();
  } finally {
    await api.dispose();
  }
});
