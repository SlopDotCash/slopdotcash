/**
 * Home discovery keeps active community projects visible as funding loads
 * and after it resolves. Funding still controls displayed amounts and the
 * sponsor list; a failed read never invents a funded reward.
 */

import type { Page } from "@playwright/test";
import { NOT_LISTED_NOTICE } from "../../src/lib/pool-funding";
import { PROJECTS } from "../../src/lib/projects.mjs";
import { stagingPaymentProject } from "../staging-payment-fixture.mjs";
import {
  expect,
  expectAccessibleReflow,
  failPoolFundingRead,
  servePublicProjectReads,
  test,
} from "./fixtures";

const OBSERVED_AT = "2026-11-16T12:00:00.000Z";

test.use({ video: "on" });

/** The frozen registry with a funded Eliza and an unfunded community ASI. */
async function serveRegistry(page: Page) {
  const eliza = stagingPaymentProject("base-mainnet");
  await page.route(
    /\/(?:api\/v1\/projects|data\/fixture-project-registry\.json)$/,
    (route) =>
      route.fulfill({
        json: {
          schemaVersion: "1",
          projects: PROJECTS.map((entry) =>
            entry.id === eliza.id
              ? eliza
              : entry.id === "asi"
                ? { ...entry, listingTier: "community" }
                : entry,
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
  return eliza;
}

test("home keeps unfunded community projects while sponsors list funded pools", async ({
  page,
}, info) => {
  await page.clock.setFixedTime(new Date(OBSERVED_AT));
  await servePublicProjectReads(page);
  const eliza = await serveRegistry(page);
  const vault = eliza.escrow?.deployments[0];
  if (!vault) throw new Error("The Eliza vault fixture is missing");
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
                lastMergedAt: OBSERVED_AT,
                waitingOutside: 0,
                waitingCapped: false,
                mergedOutsideLast30Days: 1,
                medianHoursToMerge: 312,
              },
            ],
          },
        ],
      },
    }),
  );
  let releaseFunding = () => {};
  const fundingHeld = new Promise<void>((resolve) => {
    releaseFunding = resolve;
  });
  await page.route("**/api/v1/pool-funding", async (route) => {
    await fundingHeld;
    await route.fulfill({
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
    });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const projects = page.locator("#projects");
  try {
    for (const id of ["eliza", "asi", "slopdotcash", "thenetwork"])
      await expect(projects.locator(`a[href="/projects/${id}"]`)).toBeVisible();
    await expect(projects.locator('a[href="/projects/asi"]')).toContainText(
      "Points only",
    );
  } finally {
    releaseFunding();
  }
  // A successful funding read updates amounts without removing community work.
  await expect(projects.locator('a[href="/projects/eliza"] strong')).toHaveText(
    "$1k",
  );
  for (const id of ["asi", "slopdotcash", "thenetwork"])
    await expect(projects.locator(`a[href="/projects/${id}"]`)).toContainText(
      "Points only",
    );
  await expect(projects).not.toContainText("Last merge");
  await expect(projects).not.toContainText("outside PRs waiting");
  await expect(projects).not.toContainText("median merge");
  await expect(page.locator("main")).not.toContainText("Pledged");
  // An external prize share stays listed.
  await expect(
    projects.locator('a[href="/projects/delta-star"]'),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("home-funded-and-community.png"),
    fullPage: true,
  });
  const communityLink = projects.locator('a[href="/projects/asi"]');
  await communityLink.focus();
  await expect(communityLink).toBeFocused();
  await expectAccessibleReflow(page, "home-funded-and-community");

  await page.goto("/sponsors", { waitUntil: "networkidle" });
  const pools = page.getByRole("list", { name: "Project funding pools" });
  await expect(
    pools.getByRole("link", { name: "Eliza", exact: true }),
  ).toBeVisible();
  for (const name of ["ASI", "The Network"])
    await expect(pools.getByRole("link", { name, exact: true })).toHaveCount(0);
  // Paused projects keep their listing.
  await expect(
    pools.locator('a[href="/projects/canonry/funding"]'),
  ).toBeVisible();

  // The page of a project that is not listed still opens and says why.
  await page.goto("/projects/asi", { waitUntil: "networkidle" });
  await expect(
    page.getByText(NOT_LISTED_NOTICE, { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("project-not-listed.png"),
    fullPage: true,
  });
  await page.goto("/projects/eliza", { waitUntil: "networkidle" });
  await expect(page.getByText(NOT_LISTED_NOTICE, { exact: true })).toHaveCount(
    0,
  );
  // Merge evidence remains available on the project page.
  await expect(page.locator(".project-merge-activity")).toContainText(
    "Merging: last merge today",
  );
});

test("a failed funding read lists every project as before", async ({
  diagnostics,
  page,
}) => {
  await page.clock.setFixedTime(new Date(OBSERVED_AT));
  await servePublicProjectReads(page);
  await serveRegistry(page);
  await failPoolFundingRead(page, diagnostics);
  await page.goto("/", { waitUntil: "networkidle" });
  const projects = page.locator("#projects");
  for (const id of ["eliza", "asi", "slopdotcash", "thenetwork", "delta-star"])
    await expect(projects.locator(`a[href="/projects/${id}"]`)).toBeVisible();
  await page.goto("/projects/asi", { waitUntil: "networkidle" });
  await expect(page.getByText(NOT_LISTED_NOTICE, { exact: true })).toHaveCount(
    0,
  );
});
