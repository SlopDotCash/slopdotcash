/** Browser contract checks use synthetic sessions; the API suite uses real SQLite. */
import { join } from "node:path";
import { deploymentOrigins, deploymentTier } from "../../src/lib/deployment";
import { enlargeText } from "../text-size";
import { expect, expectAccessible, test } from "./fixtures";

const { site, identity: identityOrigin } = deploymentOrigins(
  deploymentTier(process.env.VITE_SLOP_ENVIRONMENT),
);

test("Settings waits for identity and keeps current sign-out without individual session controls", async ({
  page,
}, info) => {
  let signedIn = true;
  let releaseIdentity: () => void = () => {};
  const identity = new Promise<void>((resolve) => {
    releaseIdentity = resolve;
  });
  let signouts = 0;
  await page.route(`${site}/**`, (route) =>
    // Money received falls back to the shared empty aggregate (fixtures.ts).
    new URL(route.request().url()).pathname === "/api/v1/payments/received"
      ? route.fallback()
      : route.fulfill({
          path: join(
            process.cwd(),
            "dist",
            route.request().resourceType() === "document"
              ? "index.html"
              : new URL(route.request().url()).pathname,
          ),
        }),
  );
  await page.route(`${site}/api/v1/project-session`, (route) =>
    route.fulfill({
      json: {
        session: signedIn
          ? { githubId: "900000098", githubLogin: "session-test", admin: false }
          : null,
      },
    }),
  );
  await page.route(`${site}/api/v1/project-appeals`, (route) =>
    route.fulfill({ json: { appeals: [] } }),
  );
  await page.route(`${site}/api/v1/points/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown;
    if (path.endsWith("/signout")) {
      signouts++;
      signedIn = false;
      json = { signedOut: true };
    } else if (path === "/api/v1/points/me") {
      await identity;
      json = signedIn
        ? {
            actor: { id: "U_session_test", login: "session-test" },
            joinedAt: "2026-10-01T00:00:00Z",
            public: false,
            welcome: 5,
          }
        : null;
    } else throw new Error(`Unexpected account route: ${path}`);
    await route.fulfill({ json });
  });
  await page.route(`${site}/api/v1/payments/me`, (route) =>
    route.fulfill({
      json: {
        githubUserId: "900000098",
        wallets: [],
        payments: [],
        monthlyAwards: [],
        balances: [],
        directTransfers: [],
        walletObservations: [],
      },
    }),
  );
  await page.route(`${site}/api/v1/notifications/email`, (route) =>
    route.fulfill({ json: { enabled: false, availability: "unverified" } }),
  );
  await page.route(`${site}/api/v1/notifications`, (route) =>
    route.fulfill({
      json: {
        recipientGithubId: "900000098",
        notifications: [],
        unread: 0,
        nextCursor: null,
      },
    }),
  );
  await page.route(`${site}/api/v1/security-cases`, (route) =>
    route.fulfill({
      json: {
        viewer: { githubId: "900000098", githubLogin: "session-test" },
        programs: [],
        cases: [],
      },
    }),
  );
  await page.route(`${site}/api/v1/security-submissions`, (route) =>
    route.fulfill({
      json: {
        recipientGithubId: "900000098",
        automatic: false,
        submissions: [],
      },
    }),
  );
  await page.route(`${site}/api/v1/referrals/me`, (route) =>
    route.fulfill({ json: { enabled: false } }),
  );
  await page.goto(`${site}/account`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#wallets")).toContainText("Checking your account");
  releaseIdentity();
  await expect(
    page.getByRole("button", { name: "Connect EVM wallet", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  const wallets = page.getByRole("region", { name: "Wallets", exact: true });
  const email = page.getByRole("region", {
    name: "Email preferences",
    exact: true,
  });
  await expect(wallets).toHaveCount(1);
  await expect(email).toHaveCount(1);
  await expect(
    page.locator("#wallets > summary, #notifications > summary"),
  ).toHaveCount(0);
  await expect(
    email.getByRole("switch", { name: "Activity email", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".wallet-note")).toHaveCount(0);
  await expect(page.getByText(/Local preview only/u)).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath("settings-wallets.png") });
  await expect(
    page.getByRole("navigation", { name: "Account navigation", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Connections", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("#profile")).toHaveCount(0);
  await expect(
    page.locator("#security, #recovery, #close-account"),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", {
      name: "Request private account recovery",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("form", { name: "Close account", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("#sessions")).toHaveCount(0);
  await expect(
    page.getByRole("switch", { name: "Activity email", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expectAccessible(page);
  await page.screenshot({
    path: info.outputPath("account-without-navigation.png"),
  });
  await page.screenshot({
    path: info.outputPath("account-without-session-controls.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Your account", exact: true }).click();
  const menu = page.getByRole("region", {
    name: "Your account details",
    exact: true,
  });
  await expect(
    menu.getByRole("link", { name: "Payouts", exact: true }),
  ).toHaveAttribute("href", "/earnings");
  await expect(
    menu.getByRole("link", { name: "Inbox", exact: true }),
  ).toHaveAttribute("href", "/inbox");
  await expect(
    menu.getByRole("link", { name: "Wallets", exact: true }),
  ).toHaveCount(0);
  await expect(
    menu.getByRole("link", { name: "Settings", exact: true }),
  ).toHaveAttribute("href", "/account");
  await page.screenshot({
    path: info.outputPath("account-menu-distinct-pages.png"),
  });
  await menu.getByRole("link", { name: "Inbox", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`${site}/inbox`);
  await expect(
    page.getByText("You have no notifications.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Account navigation" }),
  ).toHaveCount(0);
  await expect(page.locator("#wallets")).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("inbox-distinct-page.png") });
  await page.getByRole("button", { name: "Your account", exact: true }).click();
  await menu.getByRole("link", { name: "Payouts", exact: true }).click();
  await expect(page).toHaveURL(`${site}/earnings`);
  await expect(
    page.getByRole("heading", { name: "Payouts", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Account navigation" }),
  ).toHaveCount(0);
  await expect(page.locator("#wallets")).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("payouts-distinct-page.png") });
  await page.getByRole("button", { name: "Your account", exact: true }).click();
  await menu.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(`${site}/account`);
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect EVM wallet", exact: true }),
  ).toBeVisible();
  await expect(
    email.getByRole("switch", { name: "Activity email", exact: true }),
  ).toBeVisible();
  const restore = await enlargeText(page.locator("main"));
  await expectAccessible(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("settings-wallets-text200.png"),
  });
  await restore();
  await page.getByRole("button", { name: "Your account", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Your account", exact: true }),
  ).toHaveCount(0);
  expect(signouts).toBe(1);
});

test("Settings keeps its remaining controls after in-page sign-in without recovery or appeal UI", async ({
  page,
}) => {
  let signedIn = false;
  let appealReads = 0;
  const me = {
    actor: { id: "U_appeal_test", login: "appeal-test" },
    joinedAt: "2026-10-01T00:00:00Z",
    public: false,
    welcome: 5,
  };
  await page.route(`${site}/**`, (route) =>
    // Money received falls back to the shared empty aggregate (fixtures.ts).
    new URL(route.request().url()).pathname === "/api/v1/payments/received"
      ? route.fallback()
      : route.fulfill({
          path: join(
            process.cwd(),
            "dist",
            route.request().resourceType() === "document"
              ? "index.html"
              : new URL(route.request().url()).pathname,
          ),
        }),
  );
  await page.route(`${site}/api/v1/project-session`, (route) =>
    route.fulfill({
      json: {
        session: signedIn
          ? { githubId: "900000099", githubLogin: "appeal-test", admin: false }
          : null,
      },
    }),
  );
  await page.route(`${site}/api/v1/project-appeals`, (route) => {
    appealReads++;
    expect(signedIn).toBe(true);
    return route.fulfill({
      json: {
        appeals: [{ projectId: "demo", state: "banned", appeal: "none" }],
      },
    });
  });
  await page.route(`${site}/api/v1/points/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown;
    if (path.endsWith("/join")) {
      signedIn = true;
      json = me;
    } else if (path.endsWith("/signout")) {
      signedIn = false;
      json = { signedOut: true };
    } else if (path.endsWith("/sessions"))
      json = {
        sessions: [
          {
            id: "a".repeat(24),
            current: true,
            expiresAt: "2099-01-01T00:00:00Z",
          },
        ],
      };
    else if (path === "/api/v1/points/me") json = signedIn ? me : null;
    else throw new Error(`Unexpected account route: ${path}`);
    await route.fulfill({ json });
  });
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
  await page.route(`${site}/api/v1/notifications/email`, (route) =>
    route.fulfill({ json: { enabled: false, availability: "unverified" } }),
  );
  // Explicit identity double, as in login.spec.ts.
  const expiresAt = new Date(
    Math.floor(Date.now() / 1000) * 1000 + 240_000,
  ).toISOString();
  const flowId = `flow_${"f".repeat(24)}`;
  await page.context().route(`${identityOrigin}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/v1/oauth/start")
      await route.fulfill({
        json: {
          flowId,
          pollCapability: "p".repeat(48),
          expiresAt,
          pollAfterSeconds: 1,
          authorizationUrl: `${identityOrigin}/v1/oauth/authorize?flow_id=${flowId}&state=${"s".repeat(48)}`,
        },
      });
    else if (path === "/v1/oauth/authorize")
      await route.fulfill({
        contentType: "text/html",
        body: "<title>Synthetic OAuth fixture</title>",
      });
    else
      await route.fulfill({
        json: {
          status: "complete",
          assertionType: "SlopIdentity",
          assertion: `slop_assert_v1_${"a".repeat(48)}`,
          expiresAt,
        },
      });
  });
  await page.goto(`${site}/account`, { waitUntil: "domcontentloaded" });
  const appeals = page.getByRole("heading", { name: "Appeals", exact: true });
  const profile = page.locator("#profile");
  const signIn = profile.getByRole("button", { name: "Continue with GitHub" });
  await expect(signIn).toBeEnabled();
  await expect(appeals).toHaveCount(0);
  const popup = page.waitForEvent("popup");
  await signIn.click();
  const authWindow = await popup;
  await expect(
    profile.getByRole("button", { name: /with GitHub$/u }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Connections", exact: true }),
  ).toHaveCount(0);
  await expect(profile).toHaveCount(0);
  await authWindow.close();
  await expect(
    page.locator("#security, #recovery, #close-account"),
  ).toHaveCount(0);
  await expect(appeals).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Wallets", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Email preferences", exact: true }),
  ).toBeVisible();
  expect(appealReads).toBe(0);
  await expectAccessible(page);
  await page.getByRole("button", { name: "Your account", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByText("You’re signed in.", { exact: true }),
  ).toHaveCount(0);
  await expect(appeals).toHaveCount(0);
  await expect(
    page.getByRole("form", { name: "Account appeal for demo" }),
  ).toHaveCount(0);
  await expect(signIn).toBeEnabled();
  await expect(
    page.getByRole("region", { name: "Wallets", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Email preferences", exact: true }),
  ).toHaveCount(0);
});
