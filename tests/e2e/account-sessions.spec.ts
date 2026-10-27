/** Browser contract checks use synthetic sessions; the API suite uses real SQLite. */
import { join } from "node:path";
import { deploymentOrigins, deploymentTier } from "../../src/lib/deployment";
import { expect, test } from "./fixtures";

const { site, identity: identityOrigin } = deploymentOrigins(
  deploymentTier(process.env.VITE_SLOP_ENVIRONMENT),
);

test("Account waits for identity, revokes another session and signs out the current session", async ({
  page,
}, info) => {
  let signedIn = true;
  let releaseIdentity: () => void = () => {};
  const identity = new Promise<void>((resolve) => {
    releaseIdentity = resolve;
  });
  let sessions = [
    { id: "a".repeat(24), current: true, expiresAt: "2099-01-01T00:00:00Z" },
    { id: "b".repeat(24), current: false, expiresAt: "2099-01-02T00:00:00Z" },
  ];
  const revoked: string[] = [];
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
    if (path.endsWith("/sessions/revoke")) {
      const { id } = route.request().postDataJSON();
      revoked.push(id);
      if (sessions.find((session) => session.id === id)?.current)
        signedIn = false;
      sessions = sessions.filter((session) => session.id !== id);
      json = { revoked: true };
    } else if (path.endsWith("/sessions")) json = { sessions };
    else if (path.endsWith("/x/me"))
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
  await page.goto(`${site}/account`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#wallets")).toContainText("Checking your account");
  releaseIdentity();
  await expect(
    page.getByRole("button", { name: "Connect Ethereum wallet", exact: true }),
  ).toBeVisible();
  const panel = page.locator("#sessions");
  await expect(panel).toContainText("This session");
  await expect(panel).toContainText("Other session");
  await page.screenshot({
    path: info.outputPath("account-sessions.png"),
    fullPage: true,
  });
  await panel
    .getByRole("button", { name: "Sign out this session", exact: true })
    .click();
  await expect(panel).not.toContainText("Other session");
  await panel
    .getByRole("button", { name: "Sign out here", exact: true })
    .click();
  await expect(page).toHaveURL(`${site}/login`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Log in");
  expect(revoked).toEqual(["b".repeat(24), "a".repeat(24)]);
});

// The closure succeeds but its response is lost; the integration spec proves
// the confirmed closure against the real handlers.
test("Account closes itself and explicitly reopens after a lost response", async ({
  diagnostics,
  page,
}, info) => {
  diagnostics.allow(
    /^console Failed to load resource: .* at https:\/\/[^ ]+\/api\/v1\/points\/(account\/close|join)$/u,
  );
  let closed = false;
  const joins: unknown[] = [];
  const closures: unknown[] = [];
  const me = {
    actor: { id: "U_closure_test", login: "closure-test" },
    joinedAt: "2026-10-01T00:00:00Z",
    public: true,
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
    route.fulfill({ json: { session: null } }),
  );
  await page.route(`${site}/api/v1/points/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/account/close")) {
      closures.push(route.request().postDataJSON());
      closed = true;
      await route.abort("failed");
      return;
    }
    if (path.endsWith("/join")) {
      const body = route.request().postDataJSON();
      joins.push(body);
      if (closed && body.reopen !== true) {
        await route.fulfill({
          status: 409,
          json: {
            error: "account_closed",
            closedAt: "2026-10-23T12:00:00.000Z",
          },
        });
        return;
      }
      closed = false;
      await route.fulfill({ json: { ...me, public: false } });
      return;
    }
    let json: unknown;
    if (path.endsWith("/sessions"))
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
    else if (path.endsWith("/me")) json = closed ? null : me;
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
  // Explicit identity double, as in login.spec.ts; this proves the closed
  // and reopen sign-in states, not live GitHub OAuth.
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
  await page.goto(`${site}/account#recovery`, {
    waitUntil: "domcontentloaded",
  });
  const recovery = page.locator("#recovery");
  await expect(recovery).toContainText("Request private account recovery");
  await expect(recovery.getByRole("link", { name: /closure/i })).toHaveCount(0);
  const close = recovery.getByRole("button", { name: "Close account" });
  await expect(close).toBeDisabled();
  await recovery
    .getByLabel("Type your GitHub username, closure-test, to confirm")
    .fill("someone-else");
  await expect(close).toBeDisabled();
  await recovery
    .getByLabel("Type your GitHub username, closure-test, to confirm")
    .fill("Closure-Test");
  await expect(close).toBeEnabled();
  await page.screenshot({
    path: info.outputPath("account-closure-confirm.png"),
    fullPage: true,
  });
  await close.click();
  await expect(recovery.getByRole("alert")).toContainText(
    "Could not confirm whether your account closed.",
  );
  await expect(recovery).not.toContainText("Nothing changed");
  expect(closed).toBe(true);
  await page.reload();
  await expect(
    page
      .locator("#profile")
      .getByRole("button", { name: "Continue with GitHub" }),
  ).toBeVisible();
  await expect(page.locator("#sessions")).toHaveCount(0);
  expect(closures).toEqual([{ login: "Closure-Test" }]);

  const profile = page.locator("#profile");
  const popup = page.waitForEvent("popup");
  await profile.getByRole("button", { name: "Continue with GitHub" }).click();
  await (await popup).close();
  await expect(profile).toContainText("You closed this account.");
  const reopenPopup = page.waitForEvent("popup");
  await profile
    .getByRole("button", { name: "Reopen account with GitHub" })
    .click();
  await (await reopenPopup).close();
  await expect(profile).toContainText("Your account is open again.");
  await expect(recovery).not.toContainText("Your account is closed");
  expect(joins).toEqual([
    { assertion: `slop_assert_v1_${"a".repeat(48)}`, public: false },
    {
      assertion: `slop_assert_v1_${"a".repeat(48)}`,
      public: false,
      reopen: true,
    },
  ]);
});
