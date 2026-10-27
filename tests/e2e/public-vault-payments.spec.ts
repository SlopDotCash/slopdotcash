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
const token = `0x${"4".repeat(40)}`;

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
      assetAddress: token,
      assetDecimals: 9,
      netBase: "2500000000",
      transactionId: tokenTransaction,
      indexedAt: now,
    },
  ];
  for (let index = 0; index < 4; index++) {
    payments.push({
      ...payments[0],
      id: `ordinary-more-${index}`,
      transactionId: `0x${String(index + 5).repeat(64)}`,
    });
  }
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
        payments: second ? payments.slice(1) : payments.slice(0, 1),
        through: payments.length,
        total: payments.length,
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
  await expect(history.getByRole("listitem")).toHaveCount(5);
  await history.getByRole("button", { name: "Show all 6 payments" }).focus();
  await page.keyboard.press("Enter");
  await expect(history.getByRole("listitem")).toHaveCount(6);
  await expect(history).toContainText(/98\s*USDC/u);
  await page.screenshot({
    path: info.outputPath("cycle-vault-payments.png"),
    fullPage: true,
  });
  await expect(history.locator("code")).toHaveText(token);
  await expect(history).toContainText(/2\.5\s*Token/u);
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
  await page.keyboard.press("Control+Home");
  // Reach the actual transaction anchor using the keyboard, rather than
  // substituting programmatic focus for keyboard navigation.
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  let reachedTransaction = false;
  for (let step = 0; step < 40; step++) {
    await page.keyboard.press("Tab");
    if (
      await transactionLink.evaluate(
        (element) => element === document.activeElement,
      )
    ) {
      reachedTransaction = true;
      break;
    }
  }
  expect(reachedTransaction).toBe(true);
  const width = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(width.page).toBeLessThanOrEqual(width.viewport);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: info.outputPath("cycle-vault-payments.png"),
    fullPage: true,
  });
  await page.goto(`${site}/contributors/${actor.login}`, {
    waitUntil: "networkidle",
  });
  const profileHistory = page.getByRole("region", {
    name: "Awards and payments",
    exact: true,
  });
  await expect(
    profileHistory
      .getByRole("listitem")
      .filter({ hasText: "Finalized vault payment" }),
  ).toHaveCount(5);
  await profileHistory
    .getByRole("button", { name: /Show all .* records/u })
    .click();
  await expect(
    profileHistory
      .getByRole("listitem")
      .filter({ hasText: "Finalized vault payment" }),
  ).toHaveCount(6);
  await expect(profileHistory).toContainText(/98\s*USDC/u);
  await expect(profileHistory).not.toContainText("100 USDC");
  await expect(profileHistory.locator("code")).toHaveText(token);
  // The established text-enlargement fixture checks 200% text at both
  // viewport widths; it does not claim to set native browser zoom.
  await profileHistory.evaluate((element) => {
    const sizes = [element, ...element.querySelectorAll<HTMLElement>("*")].map(
      (child) => ({
        child,
        size: Number.parseFloat(getComputedStyle(child).fontSize),
      }),
    );
    for (const { child, size } of sizes) child.style.fontSize = `${size * 2}px`;
  });
  await expect(profileHistory.locator("code")).toBeVisible();
  // A short paid amount must remain readable, rather than squeezing each
  // digit onto a separate line beside the transaction action.
  expect(
    await profileHistory
      .locator(".payout-value strong")
      .first()
      .evaluate((node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        return new Set(
          [...range.getClientRects()].map((rect) => Math.round(rect.top)),
        ).size;
      }),
  ).toBe(1);
  const record = profileHistory.locator(".payment-record").first();
  const amountBox = await record
    .locator(".payment-record-amount")
    .boundingBox();
  const actionBox = await record
    .locator(".payment-record-action")
    .boundingBox();
  expect(amountBox).not.toBeNull();
  expect(actionBox).not.toBeNull();
  expect(
    amountBox &&
      actionBox &&
      amountBox.x < actionBox.x + actionBox.width &&
      actionBox.x < amountBox.x + amountBox.width &&
      amountBox.y < actionBox.y + actionBox.height &&
      actionBox.y < amountBox.y + amountBox.height,
  ).toBe(false);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expectAccessible(page);
  await page.screenshot({
    path: info.outputPath("profile-vault-payments.png"),
    fullPage: true,
  });
});
