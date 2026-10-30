/** Browser coverage of private monthly allocations; the API rules are tested in backend/payments/monthly.test.ts. */

import type { Page } from "@playwright/test";
import { PROJECTS } from "../../src/lib/projects.mjs";
import { stagingPaymentProject } from "../staging-payment-fixture.mjs";
import { enlargeText } from "../text-size";
import { expect, expectAccessible, test } from "./fixtures";

test.beforeEach(async ({ diagnostics }) => {
  diagnostics.allowPreviewApiMisses();
});

/** Monthly awards are on the funding page of a project that has a vault policy. */
function projectWithVault() {
  const project = PROJECTS.find((item) => item.id === "eliza");
  if (project?.reward.kind !== "monthly-pool")
    throw new Error("Missing project fixture");
  return {
    ...project,
    reward: { ...project.reward, feeBasisPoints: 200 },
    escrow: {
      schemaVersion: "1",
      effectiveCycle: "2026-10",
      chain: "solana",
      feeBasisPoints: 200,
      withdrawalFeeBasisPoints: 200,
      feeMode: "deduct-from-gross",
      deployments: [],
    },
  } as typeof project;
}

async function openMonthlyAwards(page: Page) {
  await page.goto("/projects/eliza/funding");
  await page.getByRole("button", { name: "Review monthly awards" }).click();
}

test(
  "saved awards links retain their destination",
  { tag: ["@pages"] },
  async ({ page }, info) => {
    const project = {
      ...projectWithVault(),
      escrow: stagingPaymentProject("solana-devnet").escrow,
    };
    if (!project.escrow) throw new Error("Missing deployment fixture");
    const deployment = project.escrow.deployments[0];
    const observedAt = new Date().toISOString();
    await page.route("**/api/v1/payments/projects/eliza/vault", (route) =>
      route.fulfill({
        json: {
          projectId: project.id,
          staleAfterMs: 300_000,
          servedAt: observedAt,
          snapshots: [
            {
              projectId: project.id,
              network: deployment.network,
              chain: "solana",
              vault: deployment.vault,
              assetAddress: deployment.asset,
              assetDecimals: 6,
              totalDeposited: "1000000000",
              totalPaid: "0",
              totalPayoutFees: "0",
              totalGrossWithdrawn: "0",
              totalWithdrawalFees: "0",
              freeBalance: "0",
              reservedPrincipal: "980000000",
              reservedFees: "20000000",
              accruedFees: "0",
              reserved: null,
              blockNumber: "1",
              blockTime: observedAt,
              observedAt,
            },
          ],
        },
      }),
    );
    await page.route("**/.well-known/slop/projects.json", (route) =>
      route.fulfill({ json: { schemaVersion: "1", projects: [] } }),
    );
    await page.route(
      /\/(?:api\/v1\/projects|data\/fixture-project-registry\.json)$/,
      (route) =>
        route.fulfill({
          json: {
            schemaVersion: "1",
            projects: PROJECTS.map((entry) =>
              entry.id === project.id ? project : entry,
            ),
          },
        }),
    );
    await page.route("**/api/v1/project-session", (route) =>
      route.fulfill({ json: { session: null } }),
    );
    await page.route("**/api/v1/points/session", (route) =>
      route.fulfill({ json: { session: null } }),
    );
    for (const [suffix, fragment] of [
      ["?keep=1", "monthly-awards"],
      ["/?keep=1", "monthly-awards"],
      ["?keep=1#funding", "funding"],
      ["/?keep=1#funding", "funding"],
    ]) {
      // Use a document navigation: the preview server skips Pages redirects.
      await page.goto(`/projects/eliza/awards${suffix}`, {
        waitUntil: "networkidle",
      });
      await expect(page).toHaveURL(`/projects/eliza?keep=1#${fragment}`);
      await expect(page.locator(`#${fragment}`)).toBeInViewport();
      if (fragment === "monthly-awards") {
        await expect
          .poll(() =>
            page.locator("#monthly-awards-heading").evaluate((heading) => {
              const header = document.querySelector(".site-header");
              if (!header) throw new Error("Missing site header");
              return (
                heading.getBoundingClientRect().top -
                header.getBoundingClientRect().bottom
              );
            }),
          )
          .toBeGreaterThanOrEqual(0);
      }
      await expect(
        page.getByRole("button", { name: "Review monthly awards" }),
      ).toBeVisible();
      await page.screenshot({
        path: info.outputPath(
          `saved-awards-${suffix.startsWith("/") ? "trailing" : "plain"}-${fragment}.png`,
        ),
      });
    }
    await expectAccessible(page);
  },
);

test("owner edits monthly allocations privately, finalizes them and keeps sign-in context", async ({
  diagnostics,
  page,
}, info) => {
  // The signed-out and the refused allocation reads below.
  diagnostics.allow(
    /^(?:console Failed to load resource: the server responded with a status of 401 \(Unauthorized\) at |401 GET )http:\/\/[^ ]+\/api\/v1\/payments\/projects\/eliza\/monthly\/2026-09$/u,
    /^(?:console Failed to load resource: the server responded with a status of 403 \(Forbidden\) at |403 GET )http:\/\/[^ ]+\/api\/v1\/payments\/projects\/eliza\/monthly\/2026-09$/u,
  );
  const project = projectWithVault();
  await page.route(
    /\/(?:api\/v1\/projects|data\/fixture-project-registry\.json)$/,
    (route) =>
      route.fulfill({
        json: {
          schemaVersion: "1",
          projects: PROJECTS.map((entry) =>
            entry.id === project.id ? project : entry,
          ),
        },
      }),
  );
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({ json: { session: null } }),
  );
  await page.route("**/api/v1/points/session", (route) =>
    route.fulfill({ json: { session: null } }),
  );
  let status = 401;
  let empty = false;
  let sequence = 0;
  let frozen = false;
  let automatic = true;
  // Decision D1: the 2026-09 cutoff is 72 hours after the month ends.
  let cutoffAt = "2026-10-04T00:00:00.000Z";
  await page.clock.setFixedTime(new Date("2026-10-02T12:00:00.000Z"));
  const allocations = [
    { githubUserId: "1", login: "first-contributor", grossBase: "1234567890" },
    { githubUserId: "2", login: "second-contributor", grossBase: "2000000000" },
  ];
  const body = () => ({
    projectId: "eliza",
    period: "2026-09",
    manifestSha256: "a".repeat(64),
    automatic,
    cutoffAt,
    deployment: null,
    asset: {
      network: "base-sepolia",
      assetAddress: `0x${"1".repeat(40)}`,
      assetDecimals: 9,
      symbol: "TEST",
    },
    proposal: empty
      ? null
      : {
          capBase: "5000000000",
          allocationSequence: sequence,
          allocations: allocations.map((row) => ({
            ...row,
            proposedGrossBase:
              row.githubUserId === "1" ? "1234567890" : "2000000000",
            sourceDigest: row.githubUserId.repeat(64),
          })),
        },
    run: frozen
      ? {
          trigger: "owner",
          frozenAt: "2026-10-02T00:00:00.000Z",
          snapshotSha256: "c".repeat(64),
          totalGrossBase: "3234567890",
          network: "base-sepolia",
          vault: `0x${"2".repeat(40)}`,
          funded: false,
          awards: allocations.map((row) => ({
            githubUserId: row.githubUserId,
            login: row.login,
            grossBase: row.grossBase,
            feeBase: ((BigInt(row.grossBase) + 49n) / 50n).toString(),
            netBase: (
              BigInt(row.grossBase) -
              (BigInt(row.grossBase) + 49n) / 50n
            ).toString(),
            state: "underfunded",
          })),
        }
      : null,
  });
  await page.route(
    "**/api/v1/payments/projects/eliza/monthly/2026-09",
    (route) =>
      route.fulfill({
        status,
        json:
          status !== 200
            ? {
                message:
                  "Current GitHub maintainer authority could not be verified.",
              }
            : body(),
      }),
  );
  const changes: unknown[] = [];
  await page.route(
    "**/api/v1/payments/projects/eliza/monthly/2026-09/allocations",
    (route) => {
      const change = route.request().postDataJSON();
      changes.push(change);
      allocations[1].grossBase = change.grossBase;
      sequence += 1;
      return route.fulfill({ json: body() });
    },
  );
  await page.route(
    "**/api/v1/payments/projects/eliza/monthly/2026-09/finalize",
    (route) => {
      expect(route.request().postDataJSON()).toEqual({
        expectedSequence: sequence,
      });
      frozen = true;
      return route.fulfill({ json: body() });
    },
  );
  await page.route(
    "**/api/v1/payments/projects/eliza/monthly-settings",
    (route) => {
      automatic = route.request().postDataJSON().automatic;
      return route.fulfill({ json: { automatic } });
    },
  );
  // Navigate as a user opening a legacy link. Dispatching popstate before
  // React installs its listener can miss the route transition entirely.
  await page.goto("/projects/eliza/awards?keep=1");
  await expect(page).toHaveURL(/\/projects\/eliza\?keep=1#monthly-awards$/u);
  await expect(page.locator("#monthly-awards")).toBeInViewport();
  await page.getByRole("button", { name: "Review monthly awards" }).click();
  await expect(
    page.getByRole("heading", { name: "Monthly awards", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Contribution month" }),
  ).toContainText("September 2026");
  const load = page.getByRole("button", {
    name: "Refresh awards",
    exact: true,
  });
  await expect(
    page
      .getByRole("region", { name: "Monthly awards" })
      .getByRole("link", { name: "Sign in with GitHub" }),
  ).toHaveAttribute("href", /next=.*funding%23monthly-awards/);
  status = 403;
  await load.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toContainText("maintainer authority");
  status = 200;
  await load.click();
  const awards = page.getByRole("region", { name: "Monthly awards" });
  await expect(awards).toContainText("1.23456789 TEST");
  await expect(awards).not.toContainText("reason");
  const firstBreakdown = awards
    .getByRole("list", { name: "Allocations", exact: true })
    .locator("li")
    .filter({
      has: page.getByRole("heading", {
        name: "first-contributor",
        exact: true,
      }),
    });
  await expect(firstBreakdown).toContainText("1.209876532 TEST");
  await expect(firstBreakdown).toContainText("0.024691358 TEST");
  const basis = firstBreakdown.locator("details");
  await expect(
    basis.getByText("Proposed gross", { exact: true }),
  ).not.toBeVisible();
  await basis.getByText("Allocation basis", { exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(
    basis.getByText("Proposed gross", { exact: true }),
  ).toBeVisible();
  await expect(basis).toContainText("1.23456789 TEST");
  await basis.getByText("Allocation basis", { exact: true }).focus();
  await page.keyboard.press("Enter");
  const secondBreakdown = awards
    .getByRole("list", { name: "Allocations", exact: true })
    .locator("li")
    .filter({
      has: page.getByRole("heading", {
        name: "second-contributor",
        exact: true,
      }),
    });
  await expect(secondBreakdown).toContainText("1.96 TEST");
  await expect(secondBreakdown).toContainText("0.04 TEST");
  await awards.getByLabel("Award for second-contributor").fill("1.5");
  await awards
    .getByRole("button", { name: "Save second-contributor", exact: true })
    .click();
  await expect(page.getByText("Allocation saved privately.")).toBeVisible();
  await expect(secondBreakdown).toContainText("1.47 TEST");
  await expect(secondBreakdown).toContainText("0.03 TEST");
  expect(changes).toEqual([
    { githubUserId: "2", grossBase: "1500000000", expectedSequence: 0 },
  ]);
  // After the cutoff, with the automatic default on, allocations are fixed.
  cutoffAt = "2026-10-01T00:00:00.000Z";
  await load.click();
  await expect(awards).toContainText("Cutoff passed");
  await expect(
    awards.getByLabel("Award for second-contributor"),
  ).toBeDisabled();
  cutoffAt = "2026-10-04T00:00:00.000Z";
  await load.click();
  await expect(awards).toContainText("You can finalize earlier");
  // The cutoff is a calendar UTC instant, shown in UTC for every viewer.
  await expect(awards).toContainText("Finalizes Oct 4, 2026, 00:00 UTC.");
  await expect(awards.getByLabel("Award for second-contributor")).toBeEnabled();
  await awards
    .getByRole("button", { name: "Turn off automatic finalization" })
    .click();
  await expect(awards).toContainText("Finalize each month manually.");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: info.outputPath("owner-monthly-allocations.png"),
    fullPage: true,
  });
  await expectAccessible(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const restoreAllocationText = await enlargeText(page.locator("body"));
  // Keep aggregate and saved amounts together at enlarged text sizes; wrapping
  // the asset onto another line is fine, splitting the number is not.
  await expect(awards.locator(".route-metric--info > dd")).toHaveText(
    "2.73456789 TEST",
  );
  expect(
    await awards
      .locator(".route-metric--info > dd, .owner-award-breakdown dd")
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const text = node.firstChild;
          if (!text) return 0;
          const range = document.createRange();
          range.setStart(text, 0);
          const value = text.textContent ?? "";
          range.setEnd(
            text,
            value.indexOf(" ") < 0 ? value.length : value.indexOf(" "),
          );
          return new Set(
            [...range.getClientRects()].map((rect) => Math.round(rect.top)),
          ).size;
        }),
      ),
  ).toEqual([1, 1, 1, 1, 1, 1, 1]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: info.outputPath("owner-monthly-allocations-zoom.png"),
    fullPage: true,
  });
  await awards.locator(".route-metric--info").screenshot({
    path: info.outputPath("allocated-total-200.png"),
  });
  await restoreAllocationText();
  await awards.getByRole("button", { name: "Finalize awards" }).click();
  await expect(awards).toContainText("Finalized by you");
  await expect(awards).toContainText("Oct 2, 2026, 00:00 UTC");
  await expect(awards).toContainText("Underfunded");
  await expect(awards.getByLabel("Award for second-contributor")).toHaveCount(
    0,
  );
  empty = true;
  frozen = false;
  await load.click();
  await expect(awards).toContainText(
    "No allocation is proposed for this month yet.",
  );
  // Native month controls must shrink within the form at 200% text size.
  await enlargeText(page.locator("body"));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Previous award month" }).focus();
  await page.keyboard.press("Tab");
  await expect(load).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(awards).toContainText(
    "No allocation is proposed for this month yet.",
  );
  await expectAccessible(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: info.outputPath("owner-monthly-awards-zoom.png"),
    fullPage: true,
  });
});

test("owner reserve repair keeps healthy and unknown states held and restores a submitted transaction after reload", async ({
  page,
}, info) => {
  const project = projectWithVault();
  await page.clock.setFixedTime(new Date("2026-10-02T12:00:00Z"));
  await page.route(
    /\/(?:api\/v1\/projects|data\/fixture-project-registry\.json)$/,
    (route) =>
      route.fulfill({
        json: {
          schemaVersion: "1",
          projects: PROJECTS.map((entry) =>
            entry.id === project.id ? project : entry,
          ),
        },
      }),
  );
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({ json: { session: null } }),
  );
  await page.route("**/api/v1/points/session", (route) =>
    route.fulfill({ json: { session: null } }),
  );
  const deployment = {
    network: "base-sepolia",
    vault: `0x${"1".repeat(40)}`,
    owner: `0x${"2".repeat(40)}`,
  };
  await page.route(
    "**/api/v1/payments/projects/eliza/monthly/2026-09",
    (route) =>
      route.fulfill({
        json: {
          projectId: "eliza",
          period: "2026-09",
          manifestSha256: "a".repeat(64),
          automatic: false,
          cutoffAt: null,
          deployment,
          asset: null,
          proposal: null,
          run: null,
        },
      }),
  );
  let reason = "no-wrong-sum-fault",
    finalized = false;
  const requests: Record<string, unknown>[] = [];
  await page.route(
    "**/api/v1/payments/projects/eliza/monthly/2026-09/reserve-release",
    (route) => {
      const body = route.request().postDataJSON();
      requests.push(body);
      return route.fulfill({
        json: body.planId
          ? { status: finalized ? "finalized" : "pending" }
          : { status: "held", reason },
      });
    },
  );
  await openMonthlyAwards(page);
  const details = page.locator(".owner-reserve-release");
  await details.locator("summary").focus();
  await page.keyboard.press("Enter");
  await details
    .getByRole("button", { name: "Check reserve", exact: true })
    .click();
  await expect(details.getByRole("status")).toHaveText(
    "The reserve total is correct. No release is needed.",
  );
  await expect(
    details.getByRole("button", { name: "Review and sign release" }),
  ).toHaveCount(0);
  reason = "allocation-unavailable";
  await details
    .getByRole("button", { name: "Check reserve", exact: true })
    .click();
  await expect(details.getByRole("status")).toContainText(
    "complete original allocation is unavailable",
  );
  expect(requests).toEqual(
    Array.from({ length: 2 }, () => ({
      network: "base-sepolia",
      manifestSha256: "a".repeat(64),
    })),
  );
  await page.evaluate(() =>
    sessionStorage.setItem(
      "slop:monthly-release:v1:eliza:2026-09:base-sepolia",
      JSON.stringify({ planId: "b".repeat(64), hash: `0x${"c".repeat(64)}` }),
    ),
  );
  await page.reload();
  await details.locator("summary").click();
  await expect(
    details.getByRole("button", { name: "Check reserve", exact: true }),
  ).toHaveCount(0);
  await expect(details.getByLabel("Transaction hash or signature")).toHaveValue(
    `0x${"c".repeat(64)}`,
  );
  await details
    .getByRole("button", { name: "Check transaction", exact: true })
    .click();
  await expect(details.getByRole("status")).toHaveText(
    "Waiting for the transaction to finalize.",
  );
  await expect(
    details.getByText("Release verified.", { exact: false }),
  ).toHaveCount(0);
  finalized = true;
  await details
    .getByRole("button", { name: "Check transaction", exact: true })
    .click();
  await expect(details.getByRole("status")).toHaveText(
    "Release verified. The reserve returned to the vault's free balance.",
  );
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem(
        "slop:monthly-release:v1:eliza:2026-09:base-sepolia",
      ),
    ),
  ).toBeNull();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: info.outputPath("owner-reserve-release.png"),
    fullPage: true,
  });
  await expectAccessible(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
