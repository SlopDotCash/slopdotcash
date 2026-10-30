import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { REWARD_ASSET_NETWORKS } from "../../src/lib/reward-asset.mjs";
import { expect, expectAccessible, projectSuffix, test } from "./fixtures";

// PRD section 6: the admin page reads the private fee-conversion route of the
// real local Pages/D1 fixture. Robinhood Chain keeps received fees and shows
// them as "not converted"; other route labels describe policy, not live
// activation, while the totals show only finalized USDC output.
test("an admin sees Robinhood Chain fees as not converted beside finalized USDC conversions @registry", async ({
  diagnostics,
  page,
}, info) => {
  diagnostics.allowCanceledBackgroundReads();
  const persist = process.env.SLOP_E2E_PERSIST_TO;
  const session = process.env.SLOP_E2E_ADMIN_TOKEN;
  if (!persist || !session)
    throw new Error("Missing isolated registry fixture");
  const hex = (label: string, length: number) =>
    createHash("sha256")
      .update(`${info.project.name}:${label}`)
      .digest("hex")
      .slice(0, length);
  // Each browser project converts its own token, so the shared D1 keeps
  // separate totals for the desktop and mobile runs.
  const token = `0x${hex("token", 40)}`;
  const at = new Date().toISOString();
  const usdc = REWARD_ASSET_NETWORKS.base.stablecoin.address;
  execFileSync(
    "node",
    [
      "node_modules/wrangler/bin/wrangler.js",
      "d1",
      "execute",
      "slop-private",
      "--local",
      "--persist-to",
      persist,
      "--command",
      `INSERT INTO fee_conversions (kind, id, run_id, network, mode, fee_wallet, token, target_token,
         amount_in, route, quote_amount_out, min_amount_out, tx_id, raw_tx, evm_nonce, expires_at,
         amount_out, state, created_at, updated_at, submitted_at, finalized_at)
       VALUES ('conversion', 'fee-e2e-${projectSuffix()}', 'fee-e2e-run-${projectSuffix()}', 'base',
         'live', '0x${hex("wallet", 40)}', '${token}', '${usdc}', '2500000000000000000',
         'kyberswap', '12600000', '12474000', '0x${hex("tx", 64)}', '0x02', 0, 4102444800,
         '12500000', 'finalized', '${at}', '${at}', '${at}', '${at}')`,
    ],
    { stdio: "pipe" },
  );

  await page.goto("/how-it-works", { waitUntil: "networkidle" });
  await page.evaluate((value) => {
    document.cookie = `__Host-slop_points=${value}; Path=/; Secure; SameSite=Strict`;
  }, session);

  // A failed read shows its reason and a retry, never an empty report.
  const failure = diagnostics.allowResponse(
    503,
    "GET",
    "/api/v1/admin/fee-conversions",
  );
  let failRead = true;
  await page.route("**/api/v1/admin/fee-conversions", (route) =>
    failRead
      ? route.fulfill({
          status: 503,
          json: {
            error: "unavailable",
            message: "Fee conversion records are unavailable.",
          },
        })
      : route.continue(),
  );
  await page.goto("/admin", { waitUntil: "networkidle" });
  const section = page.getByRole("region", { name: "Fee conversions" });
  await expect(section).toHaveCount(0);
  await page
    .getByRole("link", { name: "Fee conversions", exact: true })
    .click();
  await expect(page).toHaveURL(/\/admin\?section=fees$/u);
  await expect(section.getByRole("alert")).toBeVisible();
  expect(diagnostics.count(failure)).toBe(1);
  failRead = false;
  await section.getByRole("button", { name: "Retry" }).focus();
  await page.keyboard.press("Enter");

  const network = (name: string) =>
    section.locator(".admin-facts > div", {
      has: page.getByRole("term").filter({ hasText: new RegExp(`^${name}$`) }),
    });
  await expect(network("Robinhood Chain")).toContainText("Not converted");
  await expect(network("Robinhood Chain")).not.toContainText(/pending/iu);
  await expect(network("Ethereum")).toContainText("USDC");
  await expect(network("Solana")).toContainText("USDC");
  await expect(network("Base")).toContainText("USDC");
  await expect(network("Base")).toContainText(
    `1 conversion: 2500000000000000000 base units of token ${token} to 12.5 USDC`,
  );
  await expect(page.locator("main details")).toHaveCount(0);
  await expectAccessible(page, {
    include: "section[aria-labelledby='admin-fee-conversions']",
  });
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath("admin-fee-conversions.png"),
    fullPage: true,
  });
  // 200% zoom keeps every network inside the viewport; 320 px is the mobile limit.
  if ((page.viewportSize()?.width ?? 0) >= 640) {
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      )
      .toBe(true);
    await section.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath("admin-fee-conversions-zoom.png"),
    });
  }
});
