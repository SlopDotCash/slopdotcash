import { join } from "node:path";
import { deploymentOrigins, deploymentTier } from "../../src/lib/deployment";
import { expectHeaderRow } from "../header-row";
import { expect, expectAccessible, test } from "./fixtures";

const { site } = deploymentOrigins(
  deploymentTier(process.env.VITE_SLOP_ENVIRONMENT),
);

test("social membership preserves past points and discloses public connections without new awards", async ({
  page,
}, info) => {
  const me = {
    actor: { id: "U_social_member", login: "social-member" },
    joinedAt: "2026-09-21T12:00:00.000Z",
    public: true,
    welcome: 5,
    socialPoints: 10,
  };
  const account = {
    id: "123456789",
    username: "social_member",
    verifiedAt: me.joinedAt,
    public: 1,
  };
  const privateXRequests: string[] = [];
  // Serve the built bytes at the product origin without a second HTTP proxy.
  // Proxy requests can outlive navigation and reset reused localhost sockets.
  // Provider and membership responses below remain explicit doubles.
  await page.route(`${site}/**`, async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    // Money received falls back to the shared empty aggregate (fixtures.ts).
    if (pathname === "/api/v1/payments/received") return route.fallback();
    await route.fulfill({
      path: join(
        process.cwd(),
        "dist",
        route.request().resourceType() === "document" ? "index.html" : pathname,
      ),
    });
  });
  await page.route(`${site}/api/v1/project-appeals`, (route) =>
    route.fulfill({ json: { appeals: [] } }),
  );
  await page.route(`${site}/api/v1/notifications/email`, (route) =>
    route.fulfill({
      json: {
        enabled: false,
        securityEnabled: false,
        enrollmentAvailable: false,
        pending: null,
        availability: "unverified",
      },
    }),
  );
  await page.route(`${site}/api/v1/project-session`, (route) =>
    route.fulfill({
      json: {
        session: { githubId: "123", githubLogin: me.actor.login, admin: false },
      },
    }),
  );
  await page.route(`${site}/api/v1/payments/me`, (route) =>
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
  await page.route(`${site}/api/v1/payments/**/direct-transfers`, (route) =>
    route.fulfill({ json: { transfers: [], totalMicro: "0" } }),
  );
  await page.route(`${site}/api/v1/points/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (
      [
        "/api/v1/points/x/me",
        "/api/v1/points/x/start",
        "/api/v1/points/x/disconnect",
      ].includes(path)
    ) {
      privateXRequests.push(path);
      await route.abort("blockedbyclient");
      return;
    }
    let value: unknown;
    if (path.endsWith("/sessions")) value = { sessions: [] };
    else if (path.endsWith("/x/profile")) value = account;
    else if (path.endsWith("/people"))
      value = {
        people: [
          {
            ...me,
            x: account,
          },
        ],
        next: null,
      };
    else if (path.endsWith("/me") || path.endsWith("/member")) value = me;
    else throw new Error(`Unexpected social request ${path}`);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(value),
    });
  });
  await page.route(
    "https://avatars.githubusercontent.com/**",
    async (route) => {
      await route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#4f4a41"/></svg>',
      });
    },
  );
  await page.goto(`${site}/points`);
  const accountButton = page.getByRole("button", {
    name: "Your account",
    exact: true,
  });
  await expect(accountButton).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Your account details" }),
  ).toHaveCount(0);
  await expectHeaderRow(page, accountButton);
  const header = page.getByRole("banner");
  await accountButton.click();
  const accountPanel = page.getByRole("region", {
    name: "Your account details",
  });
  await expect(
    accountPanel.getByText("@social-member", { exact: true }),
  ).toBeVisible();
  await expect(accountButton).toContainText("15 pts");
  await expect(accountPanel.getByText("15 pts", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    accountPanel.getByRole("link", { name: "View profile" }),
  ).toHaveAttribute("href", "/contributors/social-member");
  const panelBounds = await accountPanel.boundingBox();
  const viewportWidth = await page.evaluate(() => window.innerWidth);
  await info.attach("account-menu-bounds", {
    body: JSON.stringify({ panelBounds, viewportWidth }),
    contentType: "application/json",
  });
  if (!panelBounds) throw new Error("Account menu has no layout box");
  expect(panelBounds.x).toBeGreaterThanOrEqual(0);
  expect(panelBounds.x + panelBounds.width).toBeLessThanOrEqual(viewportWidth);
  await page.keyboard.press("Tab");
  await expect(
    accountPanel.getByRole("link", { name: "View profile" }),
  ).toBeFocused();
  await expectAccessible(page);
  await page.screenshot({ path: info.outputPath("account-menu.png") });
  await page.keyboard.press("Escape");
  await expect(accountButton).toBeFocused();
  await expect(accountPanel).toHaveCount(0);
  await accountButton.click();
  // The dropdown overlays the page heading on narrow screens; use the
  // uncovered header edge to exercise a real outside pointer interaction.
  await header.click({ position: { x: 1, y: 1 } });
  await expect(accountPanel).toHaveCount(0);
  await accountButton.click();
  await expect(
    accountPanel.getByRole("link", { name: "Wallets", exact: true }),
  ).toHaveCount(0);
  await accountPanel
    .getByRole("link", { name: "Settings", exact: true })
    .click();
  await expect(page).toHaveURL(`${site}/account`);
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Account navigation" }),
  ).toHaveCount(0);
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "People", exact: true }),
  ).toHaveCount(0);
  const social = page.getByRole("region", {
    name: "Connections",
    exact: true,
  });
  await expect(social).toHaveCount(0);
  await expect(page.locator("#profile")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Wallets", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Email preferences", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Telegram/i)).toHaveCount(0);
  await expect(page.getByRole("main")).not.toContainText("+10 points");
  await page.screenshot({
    path: info.outputPath("account-settings.png"),
    fullPage: true,
  });
  const community = page.getByRole("region", { name: "People", exact: true });
  await page.goto(`${site}/points?q=social-member#people`);
  await expect(
    community.getByRole("link", { name: "X · @social_member" }),
  ).toBeVisible();
  await page.goto(`${site}/account`);
  await expect(social).toHaveCount(0);
  await expectAccessible(page);
  await page.screenshot({
    path: info.outputPath("social-points.png"),
    fullPage: true,
  });
  await page.goto(`${site}/points?q=social-member#people`);
  await expect(
    community.getByRole("link", { name: "X · @social_member" }),
  ).toBeVisible();
  await expect(community.getByText("15 pts", { exact: true })).toBeVisible();
  await community
    .getByRole("link", { name: "social-member", exact: true })
    .click();
  await expect(
    page
      .getByText("total points", { exact: true })
      .locator("..")
      .locator("strong"),
  ).toHaveText("15");
  await expect(
    page.getByRole("link", { name: "X · @social_member", exact: true }),
  ).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.goto(`${site}/account`);
  await expect(social).toHaveCount(0);
  await expect(page.locator("#profile")).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  expect(privateXRequests).toEqual([]);
});
