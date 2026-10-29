/** Browser regressions for retained routes and fragment navigation (PRD 7). */
import { join } from "node:path";
import { deploymentOrigins, deploymentTier } from "../../src/lib/deployment";
import { PROJECTS } from "../../src/lib/projects.mjs";
import { expect, expectAccessible, test } from "./fixtures";

const { site } = deploymentOrigins(
  deploymentTier(process.env.VITE_SLOP_ENVIRONMENT),
);

test.use({ video: "on" });

test.beforeEach(async ({ page }) => {
  await page.route("**/.well-known/slop/projects.json", (route) =>
    route.fulfill({ json: { schemaVersion: "1", projects: [] } }),
  );
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({ json: { session: null } }),
  );
  await page.route("**/api/v1/points/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = path.endsWith("/sessions")
      ? { sessions: [] }
      : path.endsWith("/x/me")
        ? { configured: false, account: null, award: null }
        : path.endsWith("/me")
          ? {
              actor: { id: "U_navigation", login: "navigation-test" },
              joinedAt: "2026-10-01T00:00:00Z",
              public: true,
              welcome: 0,
            }
          : null;
    return route.fulfill({ json });
  });
  await page.route("**/api/v1/payments/me", (route) =>
    route.fulfill({
      json: {
        githubUserId: "123",
        wallets: [],
        payments: [],
        monthlyAwards: [],
        balances: [],
        directTransfers: [],
        walletObservations: [],
      },
    }),
  );
  await page.route("**/api/v1/notifications/email", (route) =>
    route.fulfill({ json: { enabled: false, availability: "unverified" } }),
  );
});

test("retained awards URLs resolve during client navigation with query and fragment intact", async ({
  page,
}, info) => {
  const project = PROJECTS.find((entry) => entry.id === "eliza");
  if (!project) throw new Error("Missing project fixture");
  await page.route("**/api/v1/projects/eliza", (route) =>
    route.fulfill({ json: { revision: 1, project } }),
  );
  await page.goto("/how-it-works", { waitUntil: "networkidle" });
  for (const [suffix, expected] of [
    ["?period=2026-10", "?period=2026-10#monthly-awards"],
    ["/?period=2026-09#retained-receipt", "?period=2026-09#retained-receipt"],
  ]) {
    // Link dispatches this same event after pushState. A network navigation
    // would exercise only the Pages redirect and miss the client router.
    await page.evaluate((path) => {
      history.pushState({}, "", path);
      dispatchEvent(new PopStateEvent("popstate"));
    }, `/projects/eliza/awards${suffix}`);
    // The embedded standings load after the route. Wait for their effects
    // before checking that they did not overwrite the retained URL.
    await expect(
      page.getByRole("region", { name: "Contributor standings", exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(`/projects/eliza${expected}`);
    await expect(
      page.getByRole("heading", { name: "Eliza", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Funds and awards" }),
    ).toBeAttached();
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(`/projects/eliza${expected}`);
  }
  await expectAccessible(page);
  await page.screenshot({ path: info.outputPath("retained-awards-route.png") });
});

test("removed security fragments retain usable Settings without hidden forms", async ({
  page,
}, info) => {
  // The membership service is intentionally inactive on loopback origins.
  // Serve the built application at its product origin, as account-sessions does.
  await page.route(`${site}/**`, (route) => {
    if (new URL(route.request().url()).pathname.startsWith("/api/"))
      return route.fallback();
    return route.fulfill({
      path: join(
        process.cwd(),
        "dist",
        route.request().resourceType() === "document"
          ? "index.html"
          : new URL(route.request().url()).pathname,
      ),
    });
  });
  await page.goto(`${site}/account`, { waitUntil: "networkidle" });
  await page.screenshot({
    path: info.outputPath("settings-without-security.png"),
  });
  for (const fragment of ["close-account", "recovery", "security"]) {
    await page.evaluate((hash) => {
      history.pushState({}, "", `/account#${hash}`);
      dispatchEvent(new PopStateEvent("popstate"));
    }, fragment);
    await expect(page).toHaveURL(`${site}/account#${fragment}`);
    await expect(
      page.getByRole("heading", { name: "Settings", exact: true }),
    ).toBeVisible();
    await expect(
      page.locator("#security, #recovery, #close-account"),
    ).toHaveCount(0);
    await expect(
      page.getByRole("form", { name: "Close account", exact: true }),
    ).toHaveCount(0);
    await expect(
      page
        .getByRole("region", { name: "Wallets", exact: true })
        .getByRole("link", { name: "Sign in with GitHub", exact: true }),
    ).toHaveAttribute("href", "/login?next=%2Faccount%23wallets");
    await expect(
      page.getByRole("switch", { name: "Activity email", exact: true }),
    ).toBeVisible();
  }
  await expectAccessible(page);
  await page.screenshot({
    path: info.outputPath("removed-security-fragments.png"),
  });
});

test("a walletless award leads to wallet setup without changing the award", async ({
  page,
}, info) => {
  const writes: string[] = [];
  // The signed-out default above never reaches the payouts read.
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({
      json: { session: { githubId: "123", githubLogin: "walletless" } },
    }),
  );
  await page.route("**/api/v1/project-appeals", (route) =>
    route.fulfill({ json: { appeals: [] } }),
  );
  await page.route("**/api/v1/payments/me", (route) => {
    if (route.request().method() !== "GET")
      writes.push(route.request().method());
    return route.fulfill({
      json: {
        githubUserId: "123",
        wallets: [],
        payments: [
          {
            id: "a".repeat(64),
            vault: `0x${"2".repeat(40)}`,
            projectId: "eliza",
            network: "base-mainnet",
            chain: "base",
            assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            assetDecimals: 6,
            grossBase: "1000000",
            netBase: "980000",
            feeBase: "20000",
            state: "reserved",
            deliveryState: "needs_wallet",
            transactionId: null,
            submittedTransactionId: null,
          },
        ],
        monthlyAwards: [],
        balances: [],
        directTransfers: [],
        walletObservations: [],
      },
    });
  });
  await page.route("**/api/v1/referrals/me", (route) =>
    route.fulfill({ json: { enabled: false } }),
  );
  await page.route(`${site}/**`, (route) => {
    if (new URL(route.request().url()).pathname.startsWith("/api/"))
      return route.fallback();
    return route.fulfill({
      path: join(
        process.cwd(),
        "dist",
        route.request().resourceType() === "document"
          ? "index.html"
          : new URL(route.request().url()).pathname,
      ),
    });
  });
  await page.goto(`${site}/earnings`, { waitUntil: "networkidle" });
  await expect(
    page.getByRole("navigation", { name: "Account navigation" }),
  ).toHaveCount(0);
  await expect(page.locator("#wallets")).toHaveCount(0);
  const award = page
    .getByRole("list", { name: "Awards and payments", exact: true })
    .getByRole("listitem")
    .filter({ hasText: "Awaiting wallet" });
  await expect(award).toContainText("0.98");
  await expect(award).not.toContainText("Paid");
  await page.screenshot({ path: info.outputPath("walletless-award.png") });
  await award
    .getByRole("link", { name: "Add or confirm your Base wallet", exact: true })
    .click();
  await expect(page).toHaveURL(`${site}/account#wallets`);
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Account navigation" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Connect EVM wallet", exact: true }),
  ).toBeVisible();
  expect(writes).toEqual([]);
  await expectAccessible(page);
});

test("signed-out account history navigation reveals wallet setup without a disclosure", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowResponse(401, "GET", "/api/v1/payments/me");
  await page.route("**/api/v1/payments/me", (route) =>
    route.fulfill({ status: 401, json: { error: "unauthorized" } }),
  );
  await page.route("**/api/v1/points/me", (route) =>
    route.fulfill({ json: null }),
  );
  await page.goto("/account", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#wallets")).toHaveCount(0);
  await page.evaluate(() => {
    history.pushState({}, "", "/account#wallets");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(
    page.getByRole("region", { name: "Wallets", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#wallets > summary")).toHaveCount(0);
  await expect(
    page.locator("#wallets").getByRole("link", { name: "Sign in with GitHub" }),
  ).toBeVisible();
  await expectAccessible(page);
});
