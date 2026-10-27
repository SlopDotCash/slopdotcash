/** Browser contract checks use synthetic sessions; the API suite uses real SQLite. */
import { join } from "node:path";
import { deploymentOrigins, deploymentTier } from "../../src/lib/deployment";
import { expect, expectAccessible, test } from "./fixtures";

const { site, identity: identityOrigin } = deploymentOrigins(
  deploymentTier(process.env.VITE_SLOP_ENVIRONMENT),
);

test("Account waits for identity and keeps current sign-out without individual session controls", async ({
  page,
}, info) => {
  let signedIn = true;
  let releaseIdentity: () => void = () => {};
  const identity = new Promise<void>((resolve) => {
    releaseIdentity = resolve;
  });
  let signouts = 0;
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
  await page.route(`${site}/api/v1/project-session`, (route) =>
    route.fulfill({ json: { session: null } }),
  );
  await page.route(`${site}/api/v1/points/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown;
    if (path.endsWith("/signout")) {
      signouts++;
      signedIn = false;
      json = { signedOut: true };
    } else if (path.endsWith("/x/me"))
      json = { configured: false, account: null, award: null };
    else if (path.endsWith("/me")) {
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
  await page.goto(`${site}/account#wallets`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#wallets")).toContainText("Checking your account");
  releaseIdentity();
  await expect(
    page.getByRole("button", { name: "Connect EVM wallet", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#sessions")).toHaveCount(0);
  await expect(page.locator("#close-account > summary")).toBeVisible();
  await page.screenshot({
    path: info.outputPath("account-without-session-controls.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Your account", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Your account", exact: true }),
  ).toHaveCount(0);
  expect(signouts).toBe(1);
});

// A member with a project ban signs in on the Account page itself. Appeals
// follow the site session, which also changes at sign-in and at closure.
test("Account shows appeals after an in-page sign-in and hides them after closure", async ({
  page,
}) => {
  let signedIn = false;
  const me = {
    actor: { id: "U_appeal_test", login: "appeal-test" },
    joinedAt: "2026-10-01T00:00:00Z",
    public: false,
    welcome: 5,
  };
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
    } else if (path.endsWith("/account/close")) {
      signedIn = false;
      json = { closed: true, closedAt: "2026-10-26T12:00:00.000Z" };
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
    else if (path.endsWith("/x/me"))
      json = { configured: false, account: null, award: null };
    else if (path.endsWith("/me")) json = signedIn ? me : null;
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
  const security = page.locator("#security");
  const appeals = page.getByRole("heading", { name: "Appeals", exact: true });
  const profile = page.locator("#profile");
  const signIn = profile.getByRole("button", { name: "Continue with GitHub" });
  await expect(signIn).toBeEnabled();
  await expect(appeals).toHaveCount(0);
  const popup = page.waitForEvent("popup");
  await signIn.click();
  const authWindow = await popup;
  await expect(profile).toHaveCount(0);
  await authWindow.close();
  await expect(security).toBeVisible();
  await expect(appeals).toBeVisible();
  await expect(
    security.getByRole("form", { name: "Account appeal for demo" }),
  ).toBeVisible();
  await expectAccessible(page);
  const recovery = page.locator("#recovery");
  await recovery
    .locator("summary")
    .filter({ hasText: /^Close account$/u })
    .click();
  await recovery
    .getByLabel("Type your GitHub username, appeal-test, to confirm")
    .fill("appeal-test");
  await recovery.getByRole("button", { name: "Close account" }).click();
  await expect(recovery).toContainText("Your account is closed");
  await expect(
    page.getByText("You’re signed in.", { exact: true }),
  ).toHaveCount(0);
  await expect(appeals).toHaveCount(0);
  await expect(
    page.getByRole("form", { name: "Account appeal for demo" }),
  ).toHaveCount(0);
  await expect(signIn).toBeEnabled();
});
