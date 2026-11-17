/**
 * Home discovery keeps active community projects visible as funding loads
 * and after it resolves. The owner can publish a monthly promise independently
 * of vault funding, but that promise never qualifies for the sponsor list.
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

/** Registry fixtures distinguish a vault, a promise, and an unfunded budget. */
async function serveRegistry(page: Page) {
  const eliza = stagingPaymentProject("base-mainnet");
  eliza.reward.honorSystem = true;
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
                ? {
                    ...entry,
                    listingTier: "community",
                    reward: {
                      ...entry.reward,
                      honorSystem: true,
                      cycleCaps: [
                        ...(entry.reward.cycleCaps ?? []),
                        { cycleId: "2026-11", monthlyCapMinor: "1250000000" },
                      ],
                    },
                  }
                : entry.id === "thenetwork"
                  ? {
                      ...entry,
                      reward: {
                        ...entry.reward,
                        honorSystem: true,
                        monthlyCapMinor: "500000000",
                        monthlyCapDisplay: "$500",
                        cycleCaps: [
                          { cycleId: "2026-11", monthlyCapMinor: "0" },
                        ],
                      },
                    }
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

test("home keeps unfunded community projects and labels promises while sponsors list funded pools", async ({
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
  const featured = projects.getByRole("region", {
    name: "Featured",
    exact: true,
  });
  const community = projects.getByRole("region", {
    name: "Community",
    exact: true,
  });
  const promise = community.locator('a.project-row[href="/projects/asi"]');
  const funded = featured.locator('a[href="/projects/eliza"]');
  const configured = featured.locator('a[href="/projects/slopdotcash"]');
  try {
    for (const id of ["eliza", "slopdotcash"])
      await expect(featured.locator(`a[href="/projects/${id}"]`)).toBeVisible();
    for (const id of ["asi", "thenetwork"])
      await expect(
        community.locator(`a[href="/projects/${id}"]`),
      ).toBeVisible();
    await expect(promise.locator(".project-row-amount")).toContainText(
      "$1,250",
    );
    await expect(promise.locator(".project-row-amount")).toContainText(
      "Promised · Not vaulted",
    );
    await expect(funded.locator(".project-bounty")).toContainText(
      "Promised · Vault funding unverified",
    );
  } finally {
    releaseFunding();
  }
  // A successful funding read updates amounts without removing community work.
  await expect(funded).not.toContainText("Promised");
  await expect(funded.locator(".project-bounty strong")).toHaveText("$1k");
  await expect(promise.locator(".project-row-amount")).toContainText(
    "Promised · Not vaulted",
  );
  await expect(configured.locator(".project-bounty strong")).toHaveText(
    "$1,000",
  );
  await expect(configured.locator(".project-bounty")).toContainText(
    "Configured · Not vaulted",
  );
  await expect(configured.locator(".project-bounty")).not.toContainText(
    "Promised",
  );
  await expect(
    community.locator(
      'a.project-row[href="/projects/thenetwork"] .project-row-amount',
    ),
  ).toHaveText("Points only");
  // Funding changes amounts, while registry placement and ordering remain intact.
  expect(
    await featured
      .locator("a.project-card")
      .evaluateAll((cards) => cards.map((card) => card.getAttribute("href"))),
  ).toEqual(["/projects/eliza", "/projects/slopdotcash"]);
  expect(
    await community
      .locator("a.project-row")
      .evaluateAll((cards) => cards.map((card) => card.getAttribute("href"))),
  ).toEqual(["/projects/asi", "/projects/delta-star", "/projects/thenetwork"]);
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
  await promise.focus();
  await expect(promise).toBeFocused();
  await expectAccessibleReflow(page, "home-funded-and-community");

  await page.goto("/sponsors", { waitUntil: "networkidle" });
  const pools = page.getByRole("list", { name: "Project funding pools" });
  await expect(
    pools.getByRole("link", { name: "Eliza", exact: true }),
  ).toBeVisible();
  for (const name of ["ASI", "Slop", "The Network"])
    await expect(pools.getByRole("link", { name, exact: true })).toHaveCount(0);
  // Paused projects keep their listing.
  await expect(
    pools.locator('a[href="/projects/canonry/funding"]'),
  ).toBeVisible();

  // The project page retains the current-month promise and its warning.
  await page.goto("/projects/asi", { waitUntil: "networkidle" });
  const overview = page.locator(".project-state-summary");
  await expect(overview).toContainText("$1,250");
  await expect(overview).toContainText("Promised · Not vaulted");
  await expect(overview).not.toContainText("Points only · no cash rewards");
  await page.screenshot({
    path: info.outputPath("project-honor-system.png"),
    fullPage: true,
  });
  // Without opt-in, a budget does not display as a promise.
  await page.goto("/projects/slopdotcash", { waitUntil: "networkidle" });
  await expect(
    page.getByText(NOT_LISTED_NOTICE, { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("project-not-listed.png"),
    fullPage: true,
  });
  await page.goto("/projects/eliza", { waitUntil: "networkidle" });
  await expect(overview).not.toContainText("Promised");
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
  for (const [name, format, ids] of [
    ["Featured", ".project-card", ["eliza", "slopdotcash"]],
    ["Community", ".project-row", ["asi", "thenetwork", "delta-star"]],
  ] as const) {
    const section = projects.getByRole("region", { name, exact: true });
    await expect(section.locator(format)).toHaveCount(ids.length);
    for (const id of ids)
      await expect(section.locator(`a[href="/projects/${id}"]`)).toBeVisible();
  }
  const eliza = projects.locator('a[href="/projects/eliza"]');
  await expect(eliza.locator(".project-bounty strong")).toHaveText("$1,000");
  await expect(eliza.locator(".project-bounty")).toContainText(
    "Promised · Vault funding unverified",
  );
  await expect(eliza).not.toContainText("Not vaulted");
  await page.goto("/projects/eliza", { waitUntil: "networkidle" });
  await expect(page.locator(".project-state-summary")).toContainText(
    "Promised · Vault funding unverified",
  );
  await expect(page.getByText(NOT_LISTED_NOTICE, { exact: true })).toHaveCount(
    0,
  );
});
