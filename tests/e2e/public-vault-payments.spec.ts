import { join } from "node:path";
import { deploymentOrigins, deploymentTier } from "../../src/lib/deployment";
import { transactionUrl } from "../../src/lib/payments/contracts";
import { TARGET_REPOSITORIES } from "../../src/lib/repositories.mjs";
import { archivedPaidCycleIndex, snapshotFixture } from "../fixtures";
import { escapeRegExp, expect, expectAccessible, test } from "./fixtures";

const { site } = deploymentOrigins(
  deploymentTier(process.env.VITE_SLOP_ENVIRONMENT),
);
const transaction = `0x${"1".repeat(64)}`;
const tokenTransaction = `0x${"2".repeat(64)}`;

test("finalized project payments show net assets and source months on cycles and profiles, and recover a failed read", async ({
  page,
  diagnostics,
}, info) => {
  diagnostics.allowCanceledBackgroundReads();
  const refusedUrl = escapeRegExp(`${site}/api/v1/payments/vault-payments`);
  diagnostics.allow(
    new RegExp(`^503 GET ${refusedUrl}$`, "u"),
    new RegExp(
      String.raw`^console Failed to load resource: the server responded with a status of 503 \(.+\) at ${refusedUrl}$`,
      "u",
    ),
  );
  const snapshot = snapshotFixture();
  const actor = snapshot.leaders[0].actor;
  actor.id = "MDQ6VXNlcjE=";
  const now = new Date().toISOString();
  await page.route(`${site}/**`, (route) =>
    route.fulfill({
      path: join(
        process.cwd(),
        "dist",
        route.request().resourceType() === "document"
          ? "index.html"
          : new URL(route.request().url()).pathname,
      ),
    }),
  );
  await page.route("**/data/leaderboard.json?**", (route) =>
    route.fulfill({ json: snapshot }),
  );
  await page.route("**/data/profiles.json", (route) =>
    route.fulfill({
      json: {
        schemaVersion: "1",
        startedAt: now,
        generatedAt: now,
        repositories: TARGET_REPOSITORIES.map((repository) => ({
          repository: repository.id,
          count: 0,
          excluded: 0,
        })),
        people: [
          {
            id: actor.id,
            login: actor.login,
            avatarUrl: actor.avatarUrl,
            repositories: [],
          },
        ],
      },
    }),
  );
  await page.route("**/data/cycles/index.json*", (route) =>
    route.fulfill({ json: archivedPaidCycleIndex() }),
  );
  await page.route(`${site}/api/v1/project-session`, (route) =>
    route.fulfill({ json: { session: null } }),
  );
  await page.route(`${site}/api/v1/points/**`, (route) =>
    route.fulfill({ json: null }),
  );
  await page.route("**/api/v1/wallet-claims/actors/*/current", (route) =>
    route.fulfill({ json: null }),
  );
  await page.route("**/api/v1/payments/**/direct-transfers", (route) =>
    route.fulfill({ json: { transfers: [], totalMicro: "0" } }),
  );
  await page.route("https://avatars.githubusercontent.com/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"/>',
    }),
  );
  const payments = [
    {
      id: "ordinary-usdc",
      projectId: "eliza",
      network: "base-mainnet",
      chain: "base",
      contributionMonth: "2026-11",
      assetAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      assetDecimals: 6,
      netBase: "98000000",
      transactionId: transaction,
      indexedAt: now,
    },
    {
      id: "ordinary-token",
      projectId: "eliza",
      network: "base-mainnet",
      chain: "base",
      contributionMonth: null,
      assetAddress: `0x${"4".repeat(40)}`,
      assetDecimals: 9,
      netBase: "2500000000",
      transactionId: tokenTransaction,
      indexedAt: now,
    },
  ];
  let fail = true;
  await page.route("**/api/v1/payments/**vault-payments*", (route) => {
    if (fail) {
      fail = false;
      return route.fulfill({
        status: 503,
        json: { error: "payments_unavailable" },
      });
    }
    const second = new URL(route.request().url()).searchParams.has("after");
    return route.fulfill({
      json: {
        payments: [payments[second ? 1 : 0]],
        through: 2,
        total: 2,
        next: second ? null : 1,
      },
    });
  });
  await page.goto(`${site}/cycles`, { waitUntil: "networkidle" });
  const history = page.getByRole("region", {
    name: "Finalized project payments",
    exact: true,
  });
  await expect(history).toContainText("Project payment records unavailable.");
  await expect(history).not.toContainText("No finalized");
  await history.getByRole("button", { name: "Retry project payments" }).click();
  await expect(history.getByRole("article")).toHaveCount(2);
  await expect(history).toContainText("98 USDC");
  await expect(history).toContainText("2.5 token");
  await expect(history).toContainText("November 2026");
  await expect(history).toContainText("Not recorded");
  await expect(
    history.getByRole("link", { name: "View transaction" }).last(),
  ).toHaveAttribute(
    "href",
    transactionUrl("base-mainnet", transaction) as string,
  );
  await expectAccessible(page);
  const transactionLink = history
    .getByRole("link", { name: "View transaction" })
    .last();
  await transactionLink.focus();
  await expect(transactionLink).toBeFocused();
  const width = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(width.page).toBeLessThanOrEqual(width.viewport);
  await page.screenshot({
    path: info.outputPath("cycle-vault-payments.png"),
    fullPage: true,
  });
  await page.goto(`${site}/contributors/${actor.login}`, {
    waitUntil: "networkidle",
  });
  await expect(history.getByRole("article")).toHaveCount(2);
  await expect(history).toContainText("98 USDC");
  await expect(history).not.toContainText("100 USDC");
  await expectAccessible(page);
  await page.screenshot({
    path: info.outputPath("profile-vault-payments.png"),
    fullPage: true,
  });
});
