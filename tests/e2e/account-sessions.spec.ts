/** Browser contract checks use synthetic sessions; the API suite uses real SQLite. */
import { join } from "node:path";
import { deploymentOrigins, deploymentTier } from "../../src/lib/deployment";
import { expect, test } from "./fixtures";

const { site } = deploymentOrigins(
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
  await page.goto(`${site}/account#wallets`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#wallets")).toContainText("Checking your account");
  releaseIdentity();
  await expect(
    page.getByRole("button", { name: "Connect EVM wallet", exact: true }),
  ).toBeVisible();
  const panel = page.locator("#sessions");
  await panel.locator("summary").click();
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
