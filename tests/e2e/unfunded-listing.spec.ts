/**
 * An unfunded monthly pool is not listed this month (operator decision,
 * 16 November 2026): the home page and /sponsors leave it out, its page
 * still opens by direct link and says why, and a failed funding read lists
 * every project as before.
 */

import type { Page } from "@playwright/test";
import { NOT_LISTED_NOTICE } from "../../src/lib/pool-funding";
import { PROJECTS } from "../../src/lib/projects.mjs";
import { stagingPaymentProject } from "../staging-payment-fixture.mjs";
import {
  expect,
  failPoolFundingRead,
  servePublicProjectReads,
  test,
} from "./fixtures";

const OBSERVED_AT = "2026-11-16T12:00:00.000Z";

/** The frozen registry with Eliza's pool given a Base vault. */
async function serveRegistry(page: Page) {
  const eliza = stagingPaymentProject("base-mainnet");
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
  return eliza;
}

test("only funded monthly pools are listed this month", async ({
  page,
}, info) => {
  await page.clock.setFixedTime(new Date(OBSERVED_AT));
  await servePublicProjectReads(page);
  const eliza = await serveRegistry(page);
  const vault = eliza.escrow?.deployments[0];
  if (!vault) throw new Error("The Eliza vault fixture is missing");
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
  await page.goto("/", { waitUntil: "networkidle" });
  const projects = page.locator("#projects");
  await expect(projects.locator('a[href="/projects/eliza"]')).toBeVisible();
  // Unfunded monthly pools, including a points-only pool, are not listed.
  for (const id of ["asi", "slopdotcash", "thenetwork"])
    await expect(projects.locator(`a[href="/projects/${id}"]`)).toHaveCount(0);
  // An external prize share stays listed.
  await expect(
    projects.locator('a[href="/projects/delta-star"]'),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("home-funded-only.png"),
    fullPage: true,
  });

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
