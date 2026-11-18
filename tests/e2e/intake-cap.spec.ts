/**
 * A maintainer's intake cap (operator decision, 17 November 2026; PRD
 * section 5). A project at its owner's number of open outside pull requests
 * is left out of the home page and /sponsors and its page says so; below the
 * number, and when the count cannot be read, it is listed. The owner sets
 * the number on the manage page.
 */

import type { Page } from "@playwright/test";
import { INTAKE_PAUSED_NOTICE } from "../../src/lib/intake-cap.mjs";
import { PROJECT_SKILL_TEMPLATES } from "../../src/lib/project-schema.mjs";
import { PROJECTS } from "../../src/lib/projects.mjs";
import { CONTRIBUTION } from "../project-application-manifest";
import { projectImageApiFixture } from "../project-image-api-fixture.mjs";
import { stagingPaymentProject } from "../staging-payment-fixture.mjs";
import { expect, expectAccessibleReflow, test } from "./fixtures";

const OBSERVED_AT = "2026-11-17T11:17:00.000Z";
const NOW = "2026-11-17T12:00:00.000Z";

test.use({ video: "on" });

/** The frozen registry with a funded Eliza whose owner set an intake cap of 20. */
async function serveCappedEliza(
  page: Page,
  activity: { openOutside: number } | "failed",
) {
  const eliza = {
    ...stagingPaymentProject("base-mainnet"),
    slopbot: { automaticClosure: false, intakeCap: 20 },
  };
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
    activity === "failed"
      ? route.fulfill({ status: 503, json: { error: "unavailable" } })
      : route.fulfill({
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
                    lastMergedAt: OBSERVED_AT,
                    waitingOutside: 3,
                    waitingCapped: false,
                    mergedOutsideLast30Days: 4,
                    medianHoursToMerge: 30,
                    openOutside: activity.openOutside,
                    openOutsideCapped: false,
                  },
                ],
              },
            ],
          },
        }),
  );
}

test("a project at its intake cap is left out of the home page and sponsors, and its page says so", async ({
  page,
}, info) => {
  await page.clock.setFixedTime(new Date(NOW));
  await serveCappedEliza(page, { openOutside: 20 });
  await page.goto("/", { waitUntil: "networkidle" });
  const projects = page.locator("#projects");
  await expect(projects.locator('a[href="/projects/eliza"]')).toHaveCount(0);
  // Every other project keeps its card.
  for (const id of ["asi", "slopdotcash", "thenetwork", "delta-star"])
    await expect(projects.locator(`a[href="/projects/${id}"]`)).toBeVisible();
  await page.screenshot({
    path: info.outputPath("home-intake-paused.png"),
    fullPage: true,
  });

  await page.goto("/sponsors", { waitUntil: "networkidle" });
  const pools = page.getByRole("list", { name: "Project funding pools" });
  await expect(pools.locator("li").first()).toBeVisible();
  await expect(
    pools.getByRole("link", { name: "Eliza", exact: true }),
  ).toHaveCount(0);

  // The page still opens by direct link and says why, in one line.
  await page.goto("/projects/eliza", { waitUntil: "networkidle" });
  await expect(
    page.getByText(INTAKE_PAUSED_NOTICE, { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".project-merge-activity")).toContainText(
    "Merging: last merge today",
  );
  await expect(page.locator("#start")).toContainText(
    "This project has paused new contributors.",
  );
  await expect(
    page
      .locator("#start")
      .getByRole("link", { name: "Owner setup", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("project-intake-paused.png"),
    fullPage: true,
  });
  await expectAccessibleReflow(page, "project-intake-paused");
});

test("below its intake cap the project is listed as before", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date(NOW));
  await serveCappedEliza(page, { openOutside: 19 });
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(
    page.locator('#projects a[href="/projects/eliza"]'),
  ).toBeVisible();
  await page.goto("/sponsors", { waitUntil: "networkidle" });
  await expect(
    page
      .getByRole("list", { name: "Project funding pools" })
      .getByRole("link", { name: "Eliza", exact: true }),
  ).toBeVisible();
  await page.goto("/projects/eliza", { waitUntil: "networkidle" });
  await expect(page.locator(".project-merge-activity")).toContainText(
    "Merging: last merge today",
  );
  await expect(
    page.getByText(INTAKE_PAUSED_NOTICE, { exact: true }),
  ).toHaveCount(0);
});

test("a count that cannot be read pauses nothing", async ({
  diagnostics,
  page,
}) => {
  diagnostics.allow(
    /^503 GET [^ ]+\/api\/v1\/merge-activity$/u,
    /^console Failed to load resource: the server responded with a status of 503 \(Service Unavailable\) at [^ ]+\/api\/v1\/merge-activity$/u,
  );
  await page.clock.setFixedTime(new Date(NOW));
  await serveCappedEliza(page, "failed");
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(
    page.locator('#projects a[href="/projects/eliza"]'),
  ).toBeVisible();
  await page.goto("/sponsors", { waitUntil: "networkidle" });
  await expect(
    page
      .getByRole("list", { name: "Project funding pools" })
      .getByRole("link", { name: "Eliza", exact: true }),
  ).toBeVisible();
  await page.goto("/projects/eliza", { waitUntil: "networkidle" });
  await expect(
    page.getByText(INTAKE_PAUSED_NOTICE, { exact: true }),
  ).toHaveCount(0);
});

test("the owner sets, changes and clears the intake cap on the manage page", async ({
  page,
}, info) => {
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
    const field = page.getByLabel(
      "Pause new contributors when this many outside pull requests are open (optional)",
      { exact: true },
    );
    // Off until the owner enters a number.
    await expect(field).toHaveValue("");
    expect((await api.stored()).project.slopbot?.intakeCap).toBeUndefined();

    // A number outside the range is refused and nothing is published.
    await field.fill("0");
    await publish.click();
    await expect(
      page.getByText("Enter a whole number from 1 to 500, or leave it empty.", {
        exact: true,
      }),
    ).toBeVisible();
    expect((await api.stored()).revision).toBe(1);
    await page.screenshot({
      path: info.outputPath("manage-intake-cap-error.png"),
      fullPage: true,
    });

    await field.fill("20");
    const proposedCap = page
      .getByRole("region", { name: "Changes", exact: true })
      .locator("dd")
      .filter({ hasText: "At 20 open outside pull requests" });
    await expect(proposedCap).toBeVisible();
    await expect(proposedCap).toHaveText(
      "At 20 open outside pull requests Live now",
    );
    await page.screenshot({
      path: info.outputPath("manage-intake-cap.png"),
      fullPage: true,
    });
    await field.focus();
    await expect(field).toBeFocused();
    await expectAccessibleReflow(page, "manage-intake-cap");
    await publish.click();
    await published(2);
    const set = await api.stored();
    expect(set.revision).toBe(2);
    expect(set.project.slopbot).toEqual({
      automaticClosure: false,
      intakeCap: 20,
    });
    // Only the setting changed: it is not a material term.
    expect({ ...set.project, slopbot: undefined }).toEqual({
      ...registered,
      contribution: { ...CONTRIBUTION },
      skill: set.project.skill,
      reviewSkill: set.project.reviewSkill,
      slopbot: undefined,
    });

    await field.fill("");
    await publish.click();
    await published(3);
    expect((await api.stored()).project.slopbot).toEqual({
      automaticClosure: false,
    });
  } finally {
    await api.dispose();
  }
});
