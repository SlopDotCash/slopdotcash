/** The canonical authenticated payout response restores every network together. */
import { expect, expectAccessible, test } from "./fixtures";

const wallets = [
  ["solana", "Solana", "11111111111111111111111111111111"],
  ["base", "Base", "0x1111111111111111111111111111111111111111"],
  [
    "robinhood",
    "Robinhood Chain",
    "0x2222222222222222222222222222222222222222",
  ],
  ["ethereum", "Ethereum", "0x3333333333333333333333333333333333333333"],
];
const account = {
  githubUserId: "123",
  wallets: wallets.map(([chain, , address]) => ({
    chain,
    address,
    claimId: `readback_${chain}`,
    authorized: false,
  })),
  payments: [],
  monthlyAwards: [],
  balances: [],
  directTransfers: [],
  walletObservations: [],
};

test("Account Wallets restores all saved networks and public records after reload", async ({
  page,
}, info) => {
  const writes: string[] = [];
  await page.route("**/api/v1/payments/**", async (route) => {
    if (route.request().method() !== "GET") writes.push(route.request().url());
    await route.fulfill({ json: account });
  });
  await page.goto("/account#wallets", { waitUntil: "networkidle" });
  for (let visit = 0; visit < 2; visit++) {
    for (const [chain, name, address] of wallets) {
      const card = page
        .getByRole("article")
        .filter({ has: page.getByRole("heading", { name, exact: true }) });
      await expect(card).toContainText(address);
      await expect(card).toContainText(
        "Confirm this wallet to enable automatic payments",
      );
      await expect(
        card.getByRole("link", { name: "View public record" }),
      ).toHaveAttribute(
        "href",
        new RegExp(`/api/v1/wallet-claims/readback_${chain}$`),
      );
    }
    if (visit === 0) await page.reload({ waitUntil: "networkidle" });
  }
  expect(writes).toEqual([]);
  await expectAccessible(page);
  await page.screenshot({
    path: info.outputPath("all-wallet-networks.png"),
    fullPage: true,
  });
});

test("unavailable wallet readback retries without inventing an empty account", async ({
  diagnostics,
  page,
}) => {
  diagnostics.allow(
    /^(?:console Failed to load resource: the server responded with a status of 503 \(Service Unavailable\) at |503 GET )http:\/\/[^ ]+\/api\/v1\/payments\/me$/u,
  );
  let available = false;
  await page.route("**/api/v1/payments/me", (route) =>
    available
      ? route.fulfill({ json: account })
      : route.fulfill({
          status: 503,
          json: { error: "Account temporarily unavailable" },
        }),
  );
  await page.goto("/account#wallets", { waitUntil: "networkidle" });
  await expect(page.locator("#wallets").getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect Base wallet", exact: true }),
  ).toHaveCount(0);
  available = true;
  await page
    .locator("#wallets")
    .getByRole("button", { name: "Retry", exact: true })
    .click();
  await expect(page.locator("#wallets")).toContainText(wallets[1][2]);
  await expect(page.locator("#wallets").getByRole("alert")).toHaveCount(0);
});

test("expired wallet sessions require sign-in with an Account return path", async ({
  diagnostics,
  page,
}) => {
  diagnostics.allow(
    /^(?:console Failed to load resource: the server responded with a status of 401 \(Unauthorized\) at |401 GET )http:\/\/[^ ]+\/api\/v1\/payments\/me$/u,
  );
  await page.route("**/api/v1/payments/me", (route) =>
    route.fulfill({ status: 401, json: { error: "not_signed_in" } }),
  );
  await page.goto("/account#wallets", { waitUntil: "networkidle" });
  await expect(
    page.locator("#wallets").getByRole("link", { name: "Sign in with GitHub" }),
  ).toHaveAttribute("href", "/login?next=%2Faccount%23wallets");
  await expect(page.locator("#wallets").getByRole("article")).toHaveCount(0);
});
