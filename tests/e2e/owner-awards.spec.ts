/** Browser coverage of private monthly allocations; the API rules are tested in backend/payments/monthly.test.ts. */

import type { Page } from "@playwright/test";
import { deriveAllocationFundingBasis } from "../../src/lib/allocation-funding";
import type { CycleIndex } from "../../src/lib/cycle-index";
import { PROJECTS } from "../../src/lib/projects.mjs";
import { archivedPaidCycleIndex } from "../fixtures";
import { stagingPaymentProject } from "../staging-payment-fixture.mjs";
import { enlargeText } from "../text-size";
import { escapeRegExp, expect, expectAccessible, test } from "./fixtures";
import {
  holdProjectSessionUntilUnmount,
  leaveEditorWithHeldSession,
  releaseHeldEditorSession,
} from "./project-draft-fixture";

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
  await page.route("**/api/v1/points/session", (route) =>
    route.fulfill({ json: { session: null } }),
  );
  let status = 401;
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({
      json: {
        session:
          status === 401
            ? null
            : { githubId: "123", githubLogin: "owner", admin: false },
      },
    }),
  );
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
    canManage: true,
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
  await awards.getByLabel("Award for first-contributor").fill("1.8");
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
  // Saving another row keeps this unchanged row's unsaved draft.
  await expect(awards.getByLabel("Award for first-contributor")).toHaveValue(
    "1.8",
  );
  // An ended session must not lend its local edits to a later signed-in owner.
  for (const refusal of [401, 403]) {
    status = refusal;
    await load.click();
    if (refusal === 401)
      await expect(
        awards.getByRole("link", { name: "Sign in with GitHub" }),
      ).toBeVisible();
    else
      await expect(awards.getByRole("alert")).toContainText(
        "maintainer authority",
      );
    status = 200;
    await load.click();
    await expect(awards.getByLabel("Award for first-contributor")).toHaveValue(
      "1.23456789",
    );
    await expect(
      awards.getByRole("button", {
        name: "Save first-contributor",
        exact: true,
      }),
    ).toBeDisabled();
    await awards.getByLabel("Award for first-contributor").fill("1.8");
  }
  // Another maintainer changes the underlying value before this owner refreshes.
  // The refreshed sequence must not authorize an old draft over that new value.
  allocations[0].grossBase = "1600000000";
  sequence += 1;
  await load.click();
  await expect(awards.getByLabel("Award for first-contributor")).toHaveValue(
    "1.6",
  );
  await expect(
    awards.getByRole("button", { name: "Save first-contributor", exact: true }),
  ).toBeDisabled();
  allocations[0].grossBase = "1234567890";
  sequence += 1;
  await load.click();
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
    route.fulfill({
      json: {
        session: { githubId: "123", githubLogin: "owner", admin: false },
      },
    }),
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
          canManage: true,
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
  let holdCheck = false;
  let checkStarted = false;
  let finishCheck: (() => void) | undefined;
  const requests: Record<string, unknown>[] = [];
  await page.route(
    "**/api/v1/payments/projects/eliza/monthly/2026-09/reserve-release",
    async (route) => {
      const body = route.request().postDataJSON();
      requests.push(body);
      if (body.planId && holdCheck) {
        holdCheck = false;
        checkStarted = true;
        await new Promise<void>((resolve) => {
          finishCheck = resolve;
        });
      }
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
  // A pending readback from the departed component cannot replace the
  // newer transaction evidence accepted by its replacement component.
  holdCheck = true;
  await details
    .getByRole("button", { name: "Check transaction", exact: true })
    .click();
  await expect.poll(() => checkStarted).toBe(true);
  await page.getByRole("link", { name: "Slop home", exact: true }).click();
  await expect(details).toHaveCount(0);
  await page.goBack();
  await details.locator("summary").click();
  await details
    .getByLabel("Transaction hash or signature")
    .fill(`0x${"d".repeat(64)}`);
  await details
    .getByRole("button", { name: "Check transaction", exact: true })
    .click();
  await expect(details.getByRole("status")).toHaveText(
    "Waiting for the transaction to finalize.",
  );
  const releaseKey = "slop:monthly-release:v1:eliza:2026-09:base-sepolia";
  const newerEvidence = await page.evaluate(
    (key) => sessionStorage.getItem(key),
    releaseKey,
  );
  expect(JSON.parse(newerEvidence ?? "null").hash).toBe(`0x${"d".repeat(64)}`);
  finishCheck?.();
  await page.waitForLoadState("networkidle");
  expect(
    await page.evaluate((key) => sessionStorage.getItem(key), releaseKey),
  ).toBe(newerEvidence);
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

/** Routes for the December 2026 review window: a private November proposal. */
async function serveDecemberReview(
  page: Page,
  cycleIndex: CycleIndex,
  canManage = true,
): Promise<void> {
  const project = projectWithVault();
  await page.clock.setFixedTime(new Date("2026-12-02T12:00:00.000Z"));
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
    route.fulfill({
      json: {
        session: { githubId: "123", githubLogin: "owner", admin: false },
      },
    }),
  );
  await page.route("**/api/v1/points/session", (route) =>
    route.fulfill({ json: { session: null } }),
  );
  await page.route("**/data/cycles/index.json*", (route) =>
    route.fulfill({ json: cycleIndex }),
  );
  const view = (period: string, proposal: unknown) => ({
    projectId: "eliza",
    period,
    manifestSha256: "a".repeat(64),
    automatic: true,
    canManage,
    cutoffAt: "2026-12-04T00:00:00.000Z",
    // A served deployment would show the reserve repair to an owner.
    deployment: canManage
      ? null
      : {
          network: "base-sepolia",
          vault: `0x${"1".repeat(40)}`,
          owner: `0x${"2".repeat(40)}`,
        },
    asset: {
      network: "base-sepolia",
      assetAddress: `0x${"1".repeat(40)}`,
      assetDecimals: 9,
      symbol: "TEST",
    },
    proposal,
    run: null,
  });
  await page.route(
    "**/api/v1/payments/projects/eliza/monthly/2026-11",
    (route) =>
      route.fulfill({
        json: view("2026-11", {
          capBase: "5000000000",
          allocationSequence: 0,
          allocations: [
            {
              githubUserId: "1",
              login: "first-contributor",
              grossBase: "1234567890",
              proposedGrossBase: "1234567890",
              sourceDigest: "1".repeat(64),
            },
            {
              githubUserId: "2",
              login: "second-contributor",
              grossBase: "2000000000",
              proposedGrossBase: "2000000000",
              sourceDigest: "2".repeat(64),
            },
          ],
        }),
      }),
  );
  for (const period of ["2026-10", "2026-09"]) {
    await page.route(
      `**/api/v1/payments/projects/eliza/monthly/${period}`,
      (route) => route.fulfill({ json: view(period, null) }),
    );
  }
}

async function ownedNovember(page: Page) {
  await serveDecemberReview(page, {
    schemaVersion: "1",
    generatedAt: "2026-12-02T00:00:00.000Z",
    cycles: [],
  });
  let actor = "123";
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({
      json: {
        session: { githubId: actor, githubLogin: "owner", admin: false },
      },
    }),
  );
  const response = page.waitForResponse(
    (value) =>
      new URL(value.url()).pathname ===
      "/api/v1/payments/projects/eliza/monthly/2026-11",
  );
  await openMonthlyAwards(page);
  const value = await (await response).json();
  await expect(page.getByLabel("Award for first-contributor")).toBeVisible();
  return {
    value,
    changeActor: (next: string) => {
      actor = next;
    },
  };
}

for (const status of [200, 403]) {
  test(`an owner allocation ${status} response cannot retain the prior actor's private view`, async ({
    page,
    diagnostics,
  }) => {
    const fixture = await ownedNovember(page);
    let release = () => {},
      started = () => {};
    const waiting = new Promise<void>((resolve) => {
      started = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const path = "/api/v1/payments/projects/eliza/monthly/2026-11/allocations";
    if (status === 403) diagnostics.allowResponse(403, "POST", path);
    await page.route(`**${path}`, async (route) => {
      expect(route.request().headers()["x-slop-expected-github-id"]).toBe(
        "123",
      );
      started();
      await held;
      await route.fulfill({
        status,
        json:
          status === 200
            ? fixture.value
            : {
                message:
                  "Current GitHub maintainer authority could not be verified.",
              },
      });
    });
    await page.getByLabel("Award for first-contributor").fill("1.8");
    await page
      .getByRole("button", { name: "Save first-contributor", exact: true })
      .click();
    await waiting;
    try {
      fixture.changeActor("456");
    } finally {
      release();
    }
    const awards = page.getByRole("region", { name: "Monthly awards" });
    await expect(
      awards.getByRole("list", { name: "Allocations", exact: true }),
    ).toHaveCount(0);
    await expect(awards.getByLabel("Award for first-contributor")).toHaveCount(
      0,
    );
    await expect(awards.getByRole("alert")).toContainText("account changed");
    await expect(awards).not.toContainText("Allocation saved privately.");
  });
}

test("a same-actor allocation outage retains the unsaved draft", async ({
  page,
  diagnostics,
}) => {
  await ownedNovember(page);
  const path = "/api/v1/payments/projects/eliza/monthly/2026-11/allocations";
  diagnostics.allowResponse(503, "POST", path);
  await page.route(`**${path}`, (route) =>
    route.fulfill({
      status: 503,
      json: { message: "Allocation service unavailable." },
    }),
  );
  const input = page.getByLabel("Award for first-contributor");
  await input.fill("1.8");
  await page
    .getByRole("button", { name: "Save first-contributor", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Allocation service unavailable.",
  );
  await expect(input).toHaveValue("1.8");
  await expect(input).toBeEnabled();
});

test("a departed allocation save keeps server acceptance without changing the new route", async ({
  page,
  diagnostics,
}) => {
  const fixture = await ownedNovember(page);
  // The destination's background snapshot can be replaced during navigation.
  diagnostics.allow(
    new RegExp(
      `^(?:net::ERR_ABORTED|NS_BINDING_ABORTED) GET ${escapeRegExp(new URL(page.url()).origin)}/data/leaderboard\\.json(?:\\?[^ ]*)?$`,
      "u",
    ),
  );
  let accepted = 0;
  let release = () => {},
    started = () => {},
    delivered = () => {};
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const finished = new Promise<void>((resolve) => {
    delivered = resolve;
  });
  await page.route(
    "**/api/v1/payments/projects/eliza/monthly/2026-11/allocations",
    async (route) => {
      accepted += 1;
      started();
      await held;
      await route.fulfill({ json: fixture.value });
      delivered();
    },
  );
  await page.getByLabel("Award for first-contributor").fill("1.8");
  await page
    .getByRole("button", { name: "Save first-contributor", exact: true })
    .click();
  await waiting;
  try {
    await page.getByRole("link", { name: "Slop home", exact: true }).click();
    await expect(page).toHaveURL(/\/$/u);
  } finally {
    release();
  }
  await finished;
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  expect(accepted).toBe(1);
  await expect(page).toHaveURL(/\/$/u);
  await expect(
    page.getByText("Allocation saved privately.", { exact: true }),
  ).toHaveCount(0);
});

test("a monthly proposal with no public cycle is reachable", async ({
  page,
}) => {
  // Monthly proposals are private records: the public cycle index is empty,
  // yet the owner must still reach the November review before the cutoff.
  await serveDecemberReview(page, {
    schemaVersion: "1",
    generatedAt: "2026-12-02T00:00:00.000Z",
    cycles: [],
  });
  await page.goto("/projects/eliza/funding");
  await page.getByRole("button", { name: "Review monthly awards" }).click();
  const navigation = page.getByRole("navigation", {
    name: "Contribution month",
  });
  await expect(navigation).toContainText("November 2026");
  const awards = page.getByRole("region", { name: "Monthly awards" });
  await expect(awards).toContainText("first-contributor");
  await expect(awards).toContainText("second-contributor");
  await expect(
    page.getByRole("button", { name: "Previous award month" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Next award month" }),
  ).toBeDisabled();
});

test("a maintainer without owner authority sees monthly awards without owner controls", async ({
  page,
}) => {
  // Write and maintain collaborators may read awards, but the API refuses
  // every owner action, so the page must not offer those controls.
  await serveDecemberReview(
    page,
    { schemaVersion: "1", generatedAt: "2026-12-02T00:00:00.000Z", cycles: [] },
    false,
  );
  await openMonthlyAwards(page);
  const awards = page.getByRole("region", { name: "Monthly awards" });
  await expect(awards).toContainText("first-contributor");
  await expect(awards.getByText("View only")).toBeVisible();
  await expect(awards).toContainText("Finalizes");
  await expect(awards).not.toContainText("You can finalize earlier.");
  await expect(awards).not.toContainText(
    /finalize (this|each) month manually/i,
  );
  await expect(awards.getByRole("textbox")).toHaveCount(0);
  for (const name of [/automatic finalization/, /^Save /, /^Finalize awards/])
    await expect(awards.getByRole("button", { name })).toHaveCount(0);
  await expect(page.getByText("Repair a stuck monthly reserve")).toHaveCount(0);
});

test("a stale public cycle does not lock the review month or discard its draft", async ({
  page,
}, info) => {
  // The public index holds only a stale September cycle. The review must
  // open on the last closed month and walk calendar months in both
  // directions. The archived fixture supplies a valid published entry;
  // only its month and dates move to September.
  const published = archivedPaidCycleIndex();
  const september = published.cycles[0];
  september.cycleId = "2026-09";
  september.generatedAt = "2026-10-02T00:00:00.000Z";
  september.contributionWindow = {
    from: "2026-09-01T00:00:00.000Z",
    to: "2026-10-01T00:00:00.000Z",
  };
  september.reviewEndsAt = "2026-10-15T00:00:00.000Z";
  september.approvedAt = "2026-10-16T00:00:00.000Z";
  september.settledAt = "2026-10-16T00:00:00.000Z";
  for (const reference of Object.values(september.files)) {
    if (reference)
      reference.url = reference.url.replace("/2026-07/", "/2026-09/");
  }
  // The archived fixture predates the current funding and fee policy, and
  // the index validator checks both against the registry this spec serves
  // the page, so the funding basis and the fee follow that served policy
  // (projectWithVault). September sits past the final legacy cap cycle, so
  // the retained award carries its approved amount under a derived funding
  // basis instead of a public cap.
  const policy = projectWithVault();
  september.reward.fundingBasis = deriveAllocationFundingBasis(
    policy,
    "2026-09",
  );
  september.reward.capMinor = "0";
  september.reward.carriedMinor = september.reward.approvedMinor;
  september.reward.feeMinor = (
    (BigInt(september.reward.approvedMinor) *
      BigInt(policy.reward.feeBasisPoints)) /
    10_000n
  ).toString();
  await serveDecemberReview(page, published);
  await page.goto("/projects/eliza/funding");
  await page.getByRole("button", { name: "Review monthly awards" }).click();
  const navigation = page.getByRole("navigation", {
    name: "Contribution month",
  });
  await expect(navigation).toContainText("November 2026");
  const awards = page.getByRole("region", { name: "Monthly awards" });
  await expect(awards).toContainText("first-contributor");
  const previous = page.getByRole("button", {
    name: "Previous award month",
  });
  const next = page.getByRole("button", { name: "Next award month" });
  await awards.getByLabel("Award for first-contributor").fill("1.8");
  await expect(next).toBeDisabled();
  await previous.click();
  await expect(navigation).toContainText("October 2026");
  await expect(awards).toContainText(
    "No allocation is proposed for this month yet.",
  );
  await previous.click();
  await expect(navigation).toContainText("September 2026");
  await expect(previous).toBeDisabled();
  await next.click();
  await expect(navigation).toContainText("October 2026");
  await next.click();
  await expect(navigation).toContainText("November 2026");
  await expect(awards).toContainText("first-contributor");
  await expect(awards.getByLabel("Award for first-contributor")).toHaveValue(
    "1.8",
  );
  await expect(
    awards.getByRole("button", { name: "Save first-contributor", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: info.outputPath("retained-month-draft.png"),
    fullPage: true,
  });
});

for (const operation of ["read", "save"] as const) {
  test(`committed owner-awards departure refuses a resolved ${operation} preflight`, async ({
    page,
  }) => {
    const fixture = await ownedNovember(page);
    await page.waitForLoadState("networkidle");
    let reads = 0;
    let writes = 0;
    await page.route(
      "**/api/v1/payments/projects/eliza/monthly/2026-11",
      (route) => {
        reads++;
        return route.fallback();
      },
    );
    await page.route(
      "**/api/v1/payments/projects/eliza/monthly/2026-11/allocations",
      (route) => {
        writes++;
        return route.fulfill({ json: fixture.value });
      },
    );
    if (operation === "save")
      await page.getByLabel("Award for first-contributor").fill("1.8");
    await page.evaluate(() => {
      const current = window.location.href;
      window.history.replaceState(window.history.state, "", "/how-it-works");
      window.history.pushState({}, "", current);
    });
    await holdProjectSessionUntilUnmount(page, ".owner-awards");
    try {
      await page
        .getByRole("button", {
          name:
            operation === "read" ? "Refresh awards" : "Save first-contributor",
          exact: true,
        })
        .click();
      await leaveEditorWithHeldSession(page);
      expect(reads).toBe(0);
      expect(writes).toBe(0);
      await expect(page.locator(".owner-awards")).toHaveCount(0);
    } finally {
      await releaseHeldEditorSession(page);
    }
  });
}
