/** Frontend state transitions run against the built UI; service responses are controlled. */

import { PROJECTS } from "../../src/lib/projects.mjs";
import { archivedPaidCycleIndex } from "../fixtures";
import { expect, test } from "./fixtures";
import { readLeaderboardResponse } from "./leaderboard-response";

test.use({ video: "on" });

test("malformed project-session responses show a recoverable error", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({ json: {} }),
  );
  await page.goto("/admin", { waitUntil: "networkidle" });
  await expect(
    page.getByText(
      "The server returned an invalid project session. Retry sign-in.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Sign in with GitHub" }),
  ).toBeVisible();
  await expect(
    page.getByText("Slop could not load.", { exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: test.info().outputPath("invalid-session-error.png"),
    fullPage: true,
  });
});

test("an unchanged open project page becomes stale at the freshness boundary", async ({
  page,
  request,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  const response = await request.get("/data/leaderboard.json");
  const snapshot = await readLeaderboardResponse(response, request);
  const before = new Date(
    Date.parse(snapshot.generatedAt) + 8 * 60 * 60 * 1000 - 60_000,
  );
  // Pause from an earlier epoch so time between the two protocol commands
  // cannot make pauseAt's target precede the running clock.
  await page.clock.install({ time: new Date(0) });
  await page.clock.pauseAt(before);
  await page.goto("/projects/eliza", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("region", { name: "Contributor standings", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Points may be outdated/u)).toHaveCount(0);
  await page.screenshot({
    path: test.info().outputPath("fresh-records.png"),
    fullPage: true,
  });
  await page.clock.fastForward(61_000);
  await expect(page.getByText(/Points may be outdated/u)).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("stale-records.png"),
    fullPage: true,
  });
});

test("an untouched allocation becomes unclaimed when wallet registration closes", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  const closesAt = "2026-11-07T12:00:00.000Z";
  await page.clock.install({
    time: new Date(Date.parse(closesAt) - 3_600_000),
  });
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({
      json: {
        session: { githubId: "900000200", githubLogin: "alloc", admin: false },
      },
    }),
  );
  await page.route("**/api/v1/payments/me", (route) =>
    route.fulfill({
      json: {
        githubUserId: "900000200",
        wallets: [],
        payments: [],
        balances: [],
        monthlyAwards: [],
        directTransfers: [],
        walletObservations: [],
      },
    }),
  );
  await page.route("**/api/v1/referrals/me", (route) =>
    route.fulfill({ json: { enabled: false } }),
  );
  await page.route("**/contributor-allocation.json", (route) =>
    route.fulfill({
      json: {
        distribution: {
          network: "robinhood-mainnet",
          token: {
            symbol: "SLOP",
            decimals: 18,
            address: `0x${"2".repeat(40)}`,
          },
          registrationClosesAt: closesAt,
          closed: false,
          recipients: [
            {
              githubId: "900000200",
              amountBase: "1000000000000000000",
              transactionId: null,
            },
          ],
        },
      },
    }),
  );
  await page.goto("/earnings", { waitUntil: "networkidle" });
  const allocation = page.getByRole("region", {
    name: "Contributor allocation",
    exact: true,
  });
  await expect(allocation).toContainText("Awaiting wallet");
  // Let the lazy Payouts component mount before pausing React's timers.
  await page.clock.pauseAt(new Date(Date.parse(closesAt) - 1_000));
  await page.screenshot({
    path: test.info().outputPath("registration-open.png"),
    fullPage: true,
  });
  await page.clock.fastForward(1_000);
  await expect(allocation).toContainText("Unclaimed");
  await expect(
    allocation.getByRole("link", { name: /Add or confirm/ }),
  ).toHaveCount(0);
  await page.screenshot({
    path: test.info().outputPath("registration-closed.png"),
    fullPage: true,
  });
});

test("a planned cycle with settlement evidence is rejected before rendering paid state", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  // Rejecting the cycle index cancels the concurrent snapshot read on both
  // loader attempts. These are the expected cancellations under test.
  diagnostics.allow(
    /^(?:net::ERR_ABORTED|NS_BINDING_ABORTED) GET http:\/\/127\.0\.0\.1:[0-9]+\/data\/leaderboard\.json\?[^ ]+$/u,
  );
  const index = archivedPaidCycleIndex();
  const cycle = index.cycles[0];
  cycle.state = "settlement-planned";
  await page.route("**/data/cycles/index.json?**", (route) =>
    route.fulfill({ json: index }),
  );
  await page.goto(`/cycles/${cycle.projectId}/${cycle.cycleId}`, {
    waitUntil: "networkidle",
  });
  await expect(page.getByRole("alert")).toContainText("Data could not load.");
  await expect(
    page.getByText("Approved, payment ready", { exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: test.info().outputPath("contradictory-cycle-error.png"),
    fullPage: true,
  });
});

test("automatic owner allocations stop accepting edits at the cutoff without refresh", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  const existing = PROJECTS.find((entry) => entry.id === "eliza");
  if (!existing) throw new Error("Missing Eliza fixture");
  const project = {
    ...existing,
    reward: { ...existing.reward, feeBasisPoints: 200 },
    escrow: {
      schemaVersion: "1",
      effectiveCycle: "2026-10",
      chain: "solana",
      feeBasisPoints: 200,
      withdrawalFeeBasisPoints: 200,
      feeMode: "deduct-from-gross",
      deployments: [],
    },
  };
  const cutoffAt = "2026-12-04T00:00:00.000Z";
  await page.clock.install({
    time: new Date(Date.parse(cutoffAt) - 30_000),
  });
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
  await page.route(
    "**/api/v1/payments/projects/eliza/monthly/2026-11",
    (route) =>
      route.fulfill({
        json: {
          projectId: "eliza",
          period: "2026-11",
          manifestSha256: "a".repeat(64),
          automatic: true,
          canManage: true,
          cutoffAt,
          deployment: null,
          asset: {
            network: "base-sepolia",
            assetAddress: `0x${"1".repeat(40)}`,
            assetDecimals: 9,
            symbol: "TEST",
          },
          proposal: {
            capBase: "5000000000",
            allocationSequence: 0,
            allocations: [
              {
                githubUserId: "1",
                login: "first-contributor",
                grossBase: "1000000000",
                proposedGrossBase: "1000000000",
                sourceDigest: "1".repeat(64),
              },
            ],
          },
          run: null,
        },
      }),
  );
  await page.goto("/projects/eliza/funding", { waitUntil: "networkidle" });
  await page
    .getByRole("button", { name: "Review monthly awards", exact: true })
    .click();
  const awards = page.getByRole("region", {
    name: "Monthly awards",
    exact: true,
  });
  const input = awards.getByLabel("Award for first-contributor");
  await expect(input).toBeEnabled();
  await input.fill("1.5");
  await page.clock.pauseAt(new Date(Date.parse(cutoffAt) - 1000));
  await page.screenshot({
    path: test.info().outputPath("owner-cutoff-before.png"),
    fullPage: true,
  });
  await page.clock.fastForward(1000);
  await expect(input).toBeDisabled();
  await expect(awards).toContainText("Cutoff passed");
  await expect(
    awards.getByRole("button", { name: "Save first-contributor", exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    path: test.info().outputPath("owner-cutoff-after.png"),
    fullPage: true,
  });
});

test("a deadline crossed between DOM commit and passive effect still refreshes the UI", async ({
  page,
  request,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  const response = await request.get("/data/leaderboard.json");
  const snapshot = await readLeaderboardResponse(response, request);
  const boundary = Date.parse(snapshot.generatedAt) + 8 * 60 * 60 * 1000 + 1;
  // Real timers run normally. The clock crosses as the ready DOM commits, so
  // the render saw the pre-deadline time but the passive effect sees expiry.
  await page.addInitScript(
    ({ before, after }) => {
      Date.now = () => {
        const panel = document.querySelector(
          'section[aria-label="Contributor standings"]',
        );
        return panel && !panel.textContent?.includes("Loading records")
          ? after
          : before;
      };
    },
    { before: boundary - 60_000, after: boundary + 1 },
  );
  await page.goto("/projects/eliza", { waitUntil: "networkidle" });
  await expect(page.getByText(/Points may be outdated/u)).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("passive-effect-deadline.png"),
    fullPage: true,
  });
});
