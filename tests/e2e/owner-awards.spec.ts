/** Browser coverage of private monthly allocations; the API rules are tested in backend/payments/monthly.test.ts. */
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { PROJECTS } from "../../src/lib/projects.mjs";

test("owner edits monthly allocations privately, finalizes them and keeps sign-in context", async ({
  page,
}, info) => {
  const project = PROJECTS.find((item) => item.id === "eliza");
  if (!project) throw new Error("Missing project fixture");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
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
  await page.goto("/projects/eliza/awards");
  await expect(
    page.getByRole("heading", { name: "Monthly awards", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Contribution month").fill("2026-11");
  const load = page.getByRole("button", { name: "Load awards", exact: true });
  await load.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("link", {
      name: "Sign in with GitHub to manage this project’s awards",
    }),
  ).toHaveAttribute("href", /next=.*awards/);
  status = 403;
  await load.click();
  await expect(page.getByRole("alert")).toContainText("maintainer authority");
  status = 200;
  await load.click();
  const awards = page.getByRole("region", { name: "Monthly awards" });
  await expect(awards).toContainText("1.23456789 TEST");
  await expect(awards).toContainText("never the changes");
  await expect(awards).not.toContainText("reason");
  await awards.getByLabel("Award for second-contributor").fill("1.5");
  await awards
    .getByRole("button", { name: "Save second-contributor", exact: true })
    .click();
  await expect(page.getByText("Allocation saved privately.")).toBeVisible();
  expect(changes).toEqual([
    { githubUserId: "2", grossBase: "1500000000", expectedSequence: 0 },
  ]);
  // After the cutoff, with the automatic default on, allocations are fixed.
  cutoffAt = "2026-12-01T00:00:00.000Z";
  await load.click();
  await expect(awards).toContainText("The cutoff has passed");
  await expect(
    awards.getByLabel("Award for second-contributor"),
  ).toBeDisabled();
  cutoffAt = "2026-12-04T00:00:00.000Z";
  await load.click();
  await expect(awards).toContainText("Unless you finalize earlier");
  // The cutoff is a calendar UTC instant, shown in UTC for every viewer.
  await expect(awards).toContainText("finalized at Dec 4, 2026, 00:00 UTC.");
  await expect(awards.getByLabel("Award for second-contributor")).toBeEnabled();
  await awards
    .getByRole("button", { name: "Turn off automatic payment" })
    .click();
  await expect(awards).toContainText("Automatic monthly payment is off");
  await page.screenshot({
    path: info.outputPath("owner-monthly-allocations.png"),
    fullPage: true,
  });
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await awards
    .getByRole("button", { name: "Finalize these awards now" })
    .click();
  await expect(awards).toContainText("Finalized by you");
  await expect(awards).toContainText("Dec 2, 2026, 00:00 UTC");
  await expect(awards).toContainText(
    "Underfunded: waiting for free vault funds",
  );
  await expect(awards.getByLabel("Award for second-contributor")).toHaveCount(
    0,
  );
  empty = true;
  frozen = false;
  await load.click();
  await expect(awards).toContainText(
    "No allocation is proposed for this month yet.",
  );
  expect(errors).toEqual([]);
});
