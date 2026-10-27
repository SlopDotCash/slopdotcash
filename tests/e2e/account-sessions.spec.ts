/** Browser contract checks use synthetic sessions; the API suite uses real SQLite. */
import { join } from "node:path";
import { deploymentOrigins, deploymentTier } from "../../src/lib/deployment";
import { expect, test } from "./fixtures";

const { site } = deploymentOrigins(
  deploymentTier(process.env.VITE_SLOP_ENVIRONMENT),
);

test("Account waits for identity before it offers wallets", async ({
  page,
}, info) => {
  let releaseIdentity: () => void = () => {};
  const identity = new Promise<void>((resolve) => {
    releaseIdentity = resolve;
  });
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
    if (path.endsWith("/x/me"))
      json = { configured: false, account: null, award: null };
    else if (path.endsWith("/me")) {
      await identity;
      json = {
        actor: { id: "U_session_test", login: "session-test" },
        joinedAt: "2026-10-01T00:00:00Z",
        public: false,
        welcome: 5,
      };
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
    page.getByRole("button", { name: "Connect EVM wallet", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#sessions")).toHaveCount(0);
  await expect(page.locator("#recovery")).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("account-wallets.png"),
    fullPage: true,
  });
});
