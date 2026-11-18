/**
 * Home discovery keeps active community projects visible as funding loads
 * and after it resolves. The owner can publish a monthly promise independently
 * of vault funding, but that promise never qualifies for the sponsor list.
 */

import type { Locator, Page } from "@playwright/test";
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

async function expectFundingTag(
  reward: Locator,
  name: "Vaulted" | "Promised" | "Configured",
  tone: "success" | "warning" | "neutral",
) {
  const tag = reward.locator(`.project-funding-tag.route-badge--${tone}`);
  await expect(tag).toBeVisible();
  await expect(tag).toHaveText(name);
}

async function expectFundingWarning(
  reward: Locator,
  text: "Not vaulted" | "Vault funding unverified",
) {
  const warning = reward.locator(".project-funding-warning");
  await expect(warning).toBeVisible();
  await expect(warning).toHaveText(text);
}

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
  const promiseAmount = promise.locator(".project-row-amount");
  const fundedAmount = funded.locator(".project-bounty");
  const configuredAmount = configured.locator(".project-bounty");
  try {
    for (const id of ["eliza", "slopdotcash"])
      await expect(featured.locator(`a[href="/projects/${id}"]`)).toBeVisible();
    for (const id of ["asi", "thenetwork"])
      await expect(
        community.locator(`a[href="/projects/${id}"]`),
      ).toBeVisible();
    await expect(promiseAmount.locator("strong")).toHaveText("$1,250");
    await expectFundingTag(promiseAmount, "Promised", "warning");
    await expectFundingWarning(promiseAmount, "Not vaulted");
    await expectFundingTag(fundedAmount, "Promised", "warning");
    await expectFundingWarning(fundedAmount, "Vault funding unverified");
  } finally {
    releaseFunding();
  }
  // A successful funding read updates amounts without removing community work.
  await expectFundingTag(fundedAmount, "Vaulted", "success");
  await expect(fundedAmount.locator("strong")).toHaveText("$1k");
  await expect(fundedAmount.locator(".project-funding-warning")).toHaveCount(0);
  await expectFundingTag(promiseAmount, "Promised", "warning");
  await expectFundingWarning(promiseAmount, "Not vaulted");
  await expect(configuredAmount.locator("strong")).toHaveText("$1,000");
  await expectFundingTag(configuredAmount, "Configured", "neutral");
  await expectFundingWarning(configuredAmount, "Not vaulted");
  const points = community.locator(
    'a.project-row[href="/projects/thenetwork"] .project-row-amount',
  );
  await expect(points).toHaveText("Points only");
  await expect(points.locator(".project-funding-tag")).toHaveCount(0);
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
  const reward = projects.locator('a[href="/projects/eliza"] .project-bounty');
  await expect(reward.locator("strong")).toHaveText("$1,000");
  await expectFundingTag(reward, "Promised", "warning");
  await expectFundingWarning(reward, "Vault funding unverified");
  await page.goto("/projects/eliza", { waitUntil: "networkidle" });
  await expect(page.locator(".project-state-summary")).toContainText(
    "Promised · Vault funding unverified",
  );
  await expect(page.getByText(NOT_LISTED_NOTICE, { exact: true })).toHaveCount(
    0,
  );
});
