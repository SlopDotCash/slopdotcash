/**
 * A live cycle's projected principal is the funding-backed amount. That amount
 * is zero until a record is frozen, but it is still the project's asset.
 * A native pool must not be labeled as USDC (PRD section 6).
 */

import { PROJECTS } from "../../src/lib/projects.mjs";
import { REWARD_ASSET_NETWORKS } from "../../src/lib/reward-asset.mjs";
import { cycleIndexFixture, snapshotFixture } from "../fixtures";
import { expect, expectAccessible, test } from "./fixtures";

const ONE_ETH = "1000000000000000000";

function nativeEliza() {
  const original = PROJECTS.find((entry) => entry.id === "eliza");
  if (original?.reward.kind !== "monthly-pool")
    throw new Error("The monthly project fixture is missing");
  const network = REWARD_ASSET_NETWORKS.ethereum;
  return {
    ...original,
    reward: {
      ...original.reward,
      chain: "ethereum" as const,
      currency: "ETH",
      monthlyCapMinor: ONE_ETH,
      monthlyCapDisplay: "1 ETH",
      committedMinor: "0",
      fundingState: "pledged" as const,
    },
    rewardAsset: {
      network: "ethereum" as const,
      kind: "native" as const,
      address: network.native.address,
      symbol: network.native.symbol,
      decimals: network.native.decimals,
      chainId: network.chainId,
      cluster: network.cluster,
      verifiedAt: "2026-10-25T00:00:00.000Z",
    },
  };
}

test("a native cycle labels its zero principal in ETH", async ({
  page,
}, info) => {
  const project = nativeEliza();
  const snapshot = snapshotFixture();
  await page.route(
    /\/(?:api\/v1\/projects|data\/fixture-project-registry\.json)$/u,
    (route) =>
      route.fulfill({
        json: {
          schemaVersion: "1",
          restrictions: [],
          projects: PROJECTS.map((entry) =>
            entry.id === project.id ? project : entry,
          ),
        },
      }),
  );
  await page.route(/\/data\/leaderboard\.json(?:\?.*)?$/u, (route) =>
    route.fulfill({ json: snapshot }),
  );
  await page.route(/\/data\/cycles\/index\.json(?:\?.*)?$/u, (route) =>
    route.fulfill({ json: cycleIndexFixture() }),
  );
  await page.route("https://avatars.githubusercontent.com/**", async (route) =>
    route.fulfill({ response: await page.request.get("/slop-mark.svg") }),
  );
  await page.goto("/cycles/eliza/2026-07", { waitUntil: "networkidle" });
  await expect(page.locator(".cycle-number strong")).toHaveText("0 ETH");
  await expect(page.getByText("Not funded yet.")).toBeVisible();
  await expect(
    page.getByRole("row", { name: snapshot.leaders[0].actor.login }),
  ).toContainText("of payment weight");
  await expect(page.getByText("$0", { exact: true })).toHaveCount(0);
  await expect(page.getByText("$1,000,000,000,000")).toHaveCount(0);
  await expectAccessible(page);
  await page.screenshot({
    path: info.outputPath("native-cycle-amount.png"),
    fullPage: true,
  });
});

test("a stablecoin cycle keeps a zero principal in dollars", async ({
  page,
}) => {
  if (!PROJECTS.some((entry) => entry.id === "eliza"))
    throw new Error("The monthly project fixture is missing");
  await page.route(/\/data\/leaderboard\.json(?:\?.*)?$/u, (route) =>
    route.fulfill({ json: snapshotFixture() }),
  );
  await page.route(/\/data\/cycles\/index\.json(?:\?.*)?$/u, (route) =>
    route.fulfill({ json: cycleIndexFixture() }),
  );
  await page.route("https://avatars.githubusercontent.com/**", async (route) =>
    route.fulfill({ response: await page.request.get("/slop-mark.svg") }),
  );
  await page.goto("/cycles/eliza/2026-07", { waitUntil: "networkidle" });
  await expect(page.locator(".cycle-number strong")).toHaveText("$0");
});
