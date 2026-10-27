/** Browser coverage of private monthly allocations; the API rules are tested in backend/payments/monthly.test.ts. */

import type { Page } from "@playwright/test";
import { PROJECTS } from "../../src/lib/projects.mjs";
import { enlargeText } from "../text-size";
import { expect, expectAccessible, test } from "./fixtures";

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

test("owner edits monthly allocations privately, finalizes them and keeps sign-in context", async ({
  diagnostics,
  page,
}, info) => {
  // The signed-out and the refused allocation reads below.
  diagnostics.allow(
    /^(?:console Failed to load resource: the server responded with a status of 401 \(Unauthorized\) at |401 GET )http:\/\/[^ ]+\/api\/v1\/payments\/projects\/eliza\/monthly\/2026-11$/u,
    /^(?:console Failed to load resource: the server responded with a status of 403 \(Forbidden\) at |403 GET )http:\/\/[^ ]+\/api\/v1\/payments\/projects\/eliza\/monthly\/2026-11$/u,
  );
  const project = projectWithVault();
  await page.route(
    /\/(?:api\/v1\/projects|data\/fixture-project-registry\.json)$/,
    (route) =>
      route.fulfill({ json: { schemaVersion: "1", projects: [project] } }),
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
  // Decision D1: the 2026-11 cutoff is 72 hours after the month ends.
  let cutoffAt = "2026-12-04T00:00:00.000Z";
  await page.clock.setFixedTime(new Date("2026-12-02T12:00:00.000Z"));
  const allocations = [
    { githubUserId: "1", login: "first-contributor", grossBase: "1234567890" },
    { githubUserId: "2", login: "second-contributor", grossBase: "2000000000" },
  ];
  const body = () => ({
    projectId: "eliza",
    period: "2026-11",
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
          frozenAt: "2026-12-02T00:00:00.000Z",
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
    "**/api/v1/payments/projects/eliza/monthly/2026-11",
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
    "**/api/v1/payments/projects/eliza/monthly/2026-11/allocations",
    (route) => {
      const change = route.request().postDataJSON();
      changes.push(change);
      allocations[1].grossBase = change.grossBase;
      sequence += 1;
      return route.fulfill({ json: body() });
    },
  );
  await page.route(
    "**/api/v1/payments/projects/eliza/monthly/2026-11/finalize",
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
  await page.goto("/projects/eliza");
  await page.evaluate(() => {
    history.pushState({}, "", "/projects/eliza/awards?keep=1");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page).toHaveURL(
    /\/projects\/eliza\/funding\?keep=1#monthly-awards$/u,
  );
  await expect(page.locator("#monthly-awards")).toBeInViewport();
  await page.getByRole("button", { name: "Review monthly awards" }).click();
  await expect(
    page.getByRole("heading", { name: "Monthly awards", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Contribution month").fill("2026-11");
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
  cutoffAt = "2026-12-01T00:00:00.000Z";
  await load.click();
  await expect(awards).toContainText("Cutoff passed");
  await expect(
    awards.getByLabel("Award for second-contributor"),
  ).toBeDisabled();
  cutoffAt = "2026-12-04T00:00:00.000Z";
  await load.click();
  await expect(awards).toContainText("You can finalize earlier");
  // The cutoff is a calendar UTC instant, shown in UTC for every viewer.
  await expect(awards).toContainText("Finalizes Dec 4, 2026, 00:00 UTC.");
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
  // Keep the exact saved amount together at enlarged text sizes; wrapping
  // the asset onto another line is fine, splitting the number is not.
  expect(
    await awards
      .locator(".owner-award-breakdown")
      .first()
      .locator("dd")
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
  ).toEqual([1, 1, 1]);
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
  await restoreAllocationText();
  await awards.getByRole("button", { name: "Finalize awards" }).click();
  await expect(awards).toContainText("Finalized by you");
  await expect(awards).toContainText("Dec 2, 2026, 00:00 UTC");
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
  await page.getByLabel("Contribution month").focus();
  // Tab through the native control's month/year segments before the button.
  for (
    let remaining = 4;
    remaining > 0 &&
    !(await load.evaluate((button) => button === document.activeElement));
    remaining--
  )
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
  await page.clock.setFixedTime(new Date("2026-12-02T12:00:00Z"));
  await page.route(
    /\/(?:api\/v1\/projects|data\/fixture-project-registry\.json)$/,
    (route) =>
      route.fulfill({ json: { schemaVersion: "1", projects: [project] } }),
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
    "**/api/v1/payments/projects/eliza/monthly/2026-11",
    (route) =>
      route.fulfill({
        json: {
          projectId: "eliza",
          period: "2026-11",
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
    "**/api/v1/payments/projects/eliza/monthly/2026-11/reserve-release",
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
      "slop:monthly-release:v1:eliza:2026-11:base-sepolia",
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
        "slop:monthly-release:v1:eliza:2026-11:base-sepolia",
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
