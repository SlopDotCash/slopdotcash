/**
 * A pledged monthly pool never headlines its cap without its funding state
 * (Presentation: UNFUNDED_POOL_HEADLINE). The home projects list is the one
 * money surface that dropped the qualifier: featured cards rendered no
 * money-state line for a monthly pool, and community rows printed the bare
 * cap. These tests pin the disclosure on both list surfaces, and pin its
 * absence where the state does not apply (a $0 pool, an external prize).
 *
 * A funded registry pool cannot be constructed here: the project schema
 * rejects a committed reward outright ("committed funding is unsupported;
 * fund the project escrow"), so the funded arm of the shared
 * monthlyPoolUnfunded predicate is pinned by the direct-object tests in
 * scripts/reward-amount-display.test.ts instead.
 */

import type { Page } from "@playwright/test";
import { PROJECTS, type ProjectDefinition } from "../../src/lib/projects.mjs";
import { expect, expectAccessible, test } from "./fixtures";

async function serveRegistry(
  page: Page,
  projects: readonly ProjectDefinition[],
) {
  await page.route(
    /\/(?:api\/v1\/projects|data\/fixture-project-registry\.json)$/u,
    (route) =>
      route.fulfill({
        json: { schemaVersion: "1", restrictions: [], projects },
      }),
  );
  await page.route("https://avatars.githubusercontent.com/**", async (route) =>
    route.fulfill({ response: await page.request.get("/slop-mark.svg") }),
  );
}

function withReward(
  projects: readonly ProjectDefinition[],
  id: string,
  reward: Partial<ProjectDefinition["reward"]>,
): ProjectDefinition[] {
  return projects.map((entry) =>
    entry.id === id
      ? { ...entry, reward: { ...entry.reward, ...reward } }
      : entry,
  );
}

test("project list discloses an unfunded monthly pool on cards and rows", async ({
  page,
}) => {
  await serveRegistry(page, PROJECTS);
  await page.goto("/", { waitUntil: "networkidle" });
  // Every featured pool in the fixture registry is pledged with a cap and
  // nothing committed, so each card carries the funding headline.
  for (const id of ["asi", "eliza", "slopdotcash"]) {
    const card = page.locator(`a.project-card[href="/projects/${id}"]`);
    await expect(
      card.getByText("Not funded yet", { exact: true }),
    ).toBeVisible();
  }
  // The $0 community pool stays points-only, with no funding qualifier.
  const pointsRow = page.locator('a.project-row[href="/projects/thenetwork"]');
  await expect(pointsRow).toContainText("Points only");
  await expect(pointsRow).not.toContainText("not funded");
  // The external prize row keeps its own label and gains no qualifier.
  const prizeRow = page.locator('a.project-row[href="/projects/delta-star"]');
  await expect(prizeRow).toContainText("$1,000,000 + points");
  await expect(prizeRow).not.toContainText("not funded");
  await expectAccessible(page);
});

test("project list qualifies a pledged row and not a cap-less card", async ({
  page,
}) => {
  // Give the community pool a $500 cap (still pledged, nothing committed)
  // and take the featured asi pool's cap away entirely.
  const pledged = withReward(PROJECTS, "thenetwork", {
    monthlyCapMinor: "500000000",
    monthlyCapDisplay: "$500",
  });
  const projects = withReward(pledged, "asi", {
    monthlyCapMinor: "0",
    monthlyCapDisplay: "$0",
  });
  await serveRegistry(page, projects);
  await page.goto("/", { waitUntil: "networkidle" });

  const row = page.locator('a.project-row[href="/projects/thenetwork"]');
  await expect(row).toContainText("$500/mo · not funded");

  // A pool with no cap is points-only: it never carries the funding
  // headline, on either surface.
  const asiCard = page.locator('a.project-card[href="/projects/asi"]');
  await expect(asiCard.getByText("Points only", { exact: true })).toBeVisible();
  await expect(
    asiCard.getByText("Not funded yet", { exact: true }),
  ).toHaveCount(0);

  // The still-pledged, still-capped featured pools keep the headline.
  const elizaCard = page.locator('a.project-card[href="/projects/eliza"]');
  await expect(
    elizaCard.getByText("Not funded yet", { exact: true }),
  ).toBeVisible();
  await expectAccessible(page);
});
