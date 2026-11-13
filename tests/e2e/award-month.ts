import { expect, type Page } from "@playwright/test";
import type { EscrowDeployment } from "../../src/lib/escrow-policy.mjs";

/** Select retained fixture data through the same calendar controls as an owner. */
export async function selectAwardMonth(page: Page, period: string) {
  const [year, month] = period.split("-").map(Number);
  const target = year * 12 + month - 1;
  const months = Array.from({ length: 12 }, (_, index) =>
    new Intl.DateTimeFormat("en-US", {
      month: "long",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(2000, index, 1))),
  );
  const expected = `${months[month - 1]} ${year}`;
  const navigation = page.getByRole("navigation", {
    name: "Contribution month",
    exact: true,
  });
  const label = navigation.locator('[aria-live="polite"]');
  // Ten years is ample for these retained fixtures; an unreachable month
  // must fail instead of looping or changing the browser/chain clocks.
  for (let attempt = 0; attempt < 120; attempt++) {
    const shown = await label.innerText();
    if (shown === expected) return;
    const [name, displayedYear] = shown.split(" ");
    const index = months.indexOf(name);
    if (index < 0 || !/^\d{4}$/.test(displayedYear))
      throw new Error(`Cannot read the award month: ${shown}`);
    const current = Number(displayedYear) * 12 + index;
    await navigation
      .getByRole("button", {
        name: current > target ? "Previous award month" : "Next award month",
        exact: true,
      })
      .click();
    await expect(label).not.toHaveText(shown);
  }
  throw new Error(`Could not select retained award month ${period}`);
}

/**
 * Serves the finalized September 2026 monthly award review of the eliza
 * fixture for `deployment`, and the award commitment the owner requests from
 * it. Set `review.available` to false to answer the review with 503;
 * `review.reads` counts review reads.
 */
export async function routeMonthlyAwardReview(
  page: Page,
  deployment: EscrowDeployment,
) {
  const commitment = {
    schemaVersion: "2",
    projectId: "eliza",
    cycleId: "2026-09",
    manifestSha256: "a".repeat(64),
    snapshotSha256: "b".repeat(64),
    deployment,
    award: {
      githubUserId: "1234",
      login: "local-contributor",
      sourceDigest: "d".repeat(64),
      gross: "2000000",
      fee: "40000",
      net: "1960000",
    },
  };
  const review = { available: true, reads: 0 };
  await page.route(
    "**/api/v1/payments/projects/eliza/monthly/2026-09",
    (route) => {
      review.reads++;
      return route.fulfill({
        status: review.available ? 200 : 503,
        json: review.available
          ? {
              projectId: "eliza",
              period: "2026-09",
              manifestSha256: commitment.manifestSha256,
              automatic: true,
              canManage: true,
              cutoffAt: null,
              deployment,
              asset: null,
              proposal: {
                capBase: "2000000",
                allocationSequence: 0,
                allocations: [
                  {
                    githubUserId: "1234",
                    login: "local-contributor",
                    grossBase: "2000000",
                    proposedGrossBase: "2000000",
                    sourceDigest: commitment.award.sourceDigest,
                  },
                ],
              },
              run: {
                trigger: "automatic",
                frozenAt: "2026-10-03T00:00:00.000Z",
                snapshotSha256: commitment.snapshotSha256,
                totalGrossBase: "2000000",
                network: deployment.network,
                vault: deployment.vault,
                funded: true,
                awards: [
                  {
                    githubUserId: "1234",
                    login: "local-contributor",
                    grossBase: "2000000",
                    feeBase: "40000",
                    netBase: "1960000",
                    state: "awaiting-reservation",
                  },
                ],
              },
            }
          : { message: "Review temporarily unavailable" },
      });
    },
  );
  await page.route(
    "**/api/v1/payments/projects/eliza/monthly/2026-09/commitment",
    (route) => {
      expect(route.request().postDataJSON()).toEqual({
        network: deployment.network,
        githubUserId: "1234",
        manifestSha256: commitment.manifestSha256,
        snapshotSha256: commitment.snapshotSha256,
      });
      return route.fulfill({ json: commitment });
    },
  );
  return { commitment, review };
}
