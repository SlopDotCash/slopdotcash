/** The canonical authenticated payout response restores every network together. */
import { join } from "node:path";
import { deploymentOrigins, deploymentTier } from "../../src/lib/deployment";
import { escapeRegExp, expect, expectAccessible, test } from "./fixtures";

test.beforeEach(({ diagnostics }) => diagnostics.allowPreviewApiMisses());

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
  let authorized = false;
  await page.route("**/api/v1/payments/**", async (route) => {
    if (route.request().method() !== "GET") writes.push(route.request().url());
    await route.fulfill({
      json: {
        ...account,
        wallets: account.wallets.map((wallet) => ({ ...wallet, authorized })),
      },
    });
  });
  await page.goto("/account#wallets", { waitUntil: "networkidle" });
  for (let visit = 0; visit < 2; visit++) {
    // Solana has its own card; Base, Robinhood Chain and Ethereum share the
    // EVM card, which lists each saved address while they differ.
    for (const [family, addresses] of [
      ["Solana", [wallets[0][2]]],
      ["EVM", wallets.slice(1).map(([, , address]) => address)],
    ] as const) {
      const card = page.getByRole("article", { name: `${family} wallet` });
      for (const address of addresses)
        await expect(card).toContainText(address);
      await expect(
        card.getByRole("img", { name: "Not confirmed", exact: true }),
      ).toHaveCount(addresses.length);
    }
    await expect(
      page.getByRole("link", { name: "View public record" }),
    ).toHaveCount(0);
    if (visit === 0) await page.reload({ waitUntil: "networkidle" });
  }
  // Each network can legitimately retain a different confirmed address.
  authorized = true;
  await page.reload({ waitUntil: "networkidle" });
  for (const [, network] of wallets)
    await expect(
      page.getByRole("img", { name: `${network}, confirmed`, exact: true }),
    ).toHaveCount(1);
  await expect(page.getByRole("img", { name: /not confirmed$/u })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("article", { name: "EVM wallet", exact: true }),
  ).toHaveAttribute("data-state", "attention");
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
    page.getByRole("button", { name: "Connect EVM wallet", exact: true }),
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
  const { site } = deploymentOrigins(
    deploymentTier(process.env.VITE_SLOP_ENVIRONMENT),
  );
  diagnostics.allow(
    new RegExp(
      `^(?:console Failed to load resource: the server responded with a status of 401 \\(Unauthorized\\) at |401 GET )${escapeRegExp(site)}/api/v1/payments/me$`,
      "u",
    ),
  );
  // The parent still has a valid membership observation when the wallet read
  // discovers the expired session. Serve the actual build at a product origin
  // so the Points provider performs that independent membership read.
  await page.route(`${site}/**`, async (route) => {
    const { pathname } = new URL(route.request().url());
    if (/\/(?:fixture-)?project-registry\.json$/u.test(pathname))
      return route.fulfill({ json: { schemaVersion: "1", projects: [] } });
    if (pathname === "/api/v1/points/me")
      return route.fulfill({
        json: {
          actor: { id: "U_wallet_readback", login: "wallet-readback" },
          joinedAt: "2026-10-01T00:00:00.000Z",
          public: true,
          welcome: 0,
          socialPoints: 0,
        },
      });
    if (pathname === "/api/v1/payments/me")
      return route.fulfill({ status: 401, json: { error: "not_signed_in" } });
    if (pathname === "/api/v1/points/x/me")
      return route.fulfill({
        json: { configured: false, account: null, award: null },
      });
    if (pathname === "/api/v1/points/sessions")
      return route.fulfill({ json: { sessions: [] } });
    if (pathname === "/api/v1/project-session")
      return route.fulfill({ json: { session: null } });
    if (pathname === "/api/v1/notifications/email")
      return route.fulfill({
        json: {
          enabled: false,
          securityEnabled: false,
          enrollmentAvailable: false,
          pending: null,
          availability: "unverified",
        },
      });
    if (pathname.startsWith("/api/"))
      return route.fulfill({ status: 404, json: {} });
    return route.fulfill({
      path: join(
        process.cwd(),
        "dist",
        route.request().resourceType() === "document" ? "index.html" : pathname,
      ),
    });
  });
  await page.route("https://avatars.githubusercontent.com/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36"/>',
    }),
  );
  await page.goto(`${site}/account#wallets`, { waitUntil: "networkidle" });
  await expect(
    page.getByRole("button", { name: "Your account", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator("#wallets").getByRole("link", { name: "Sign in with GitHub" }),
  ).toHaveAttribute("href", "/login?next=%2Faccount%23wallets");
  await expect(page.locator("#wallets").getByRole("article")).toHaveCount(0);
});
