/**
 * Your payouts shows an approved monthly award from the freeze until the
 * vault reserves it, then its PRD payment state (PRD sections 3 and 6). The
 * response has the shape that backend/payments/monthly.test.ts reads from the
 * real handler after the real monthly workflow.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const asset = {
  network: "base-sepolia",
  chain: "base",
  assetAddress: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  assetDecimals: 6,
};
const account = {
  githubUserId: "101",
  wallets: [],
  payments: [
    {
      ...asset,
      id: `0x${"8".repeat(64)}`,
      projectId: "eliza",
      vault: `0x${"1".repeat(40)}`,
      grossBase: "25000000",
      feeBase: "500000",
      netBase: "24500000",
      state: "reserved",
      deliveryState: "ready",
      submittedTransactionId: null,
      transactionId: null,
    },
  ],
  monthlyAwards: [
    {
      ...asset,
      projectId: "eliza",
      period: "2026-11",
      grossBase: "600000000",
      feeBase: "12000000",
      netBase: "588000000",
      state: "underfunded",
    },
    {
      ...asset,
      projectId: "eliza",
      period: "2026-10",
      grossBase: "300000000",
      feeBase: "6000000",
      netBase: "294000000",
      state: "awaiting-reservation",
    },
  ],
  balances: [{ ...asset, netBase: "24500000" }],
  directTransfers: [],
  walletObservations: [],
};

test("Your payouts lists approved monthly awards with their payment state", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.route("**/api/v1/payments/**", (route) =>
    route.fulfill({ json: account }),
  );
  await page.route("**/api/v1/referrals/me", (route) =>
    route.fulfill({ json: { enabled: false } }),
  );
  await page.goto("/earnings", { waitUntil: "networkidle" });
  const table = page.getByRole("table", {
    name: "Approved awards and verified payments",
  });
  const rows = table.locator("tbody tr");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("eliza (November 2026)");
  await expect(rows.nth(0)).toContainText("600 USDC");
  await expect(rows.nth(0)).toContainText("588 USDC");
  await expect(rows.nth(0)).toContainText(
    "Approved, underfunded: waiting for the project to add funds",
  );
  await expect(rows.nth(1)).toContainText("eliza (October 2026)");
  await expect(rows.nth(1)).toContainText(
    "Approved, funded: the project vault reserves it next",
  );
  await expect(rows.nth(2)).toContainText("Payment queued");
  await expect(
    rows.nth(0).getByRole("link", { name: "eliza" }),
  ).toHaveAttribute("href", "/projects/eliza");
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(violations).toEqual([]);
  await page.screenshot({
    path: info.outputPath("earnings-monthly-awards.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
