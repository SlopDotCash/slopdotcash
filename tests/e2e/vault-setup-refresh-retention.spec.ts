/** Real rendered flows with deterministic API failures; no wallet or money writes. */
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { deploymentOrigins, deploymentTier } from "../../src/lib/deployment";
import { PROJECTS } from "../../src/lib/projects.mjs";
import { escapeRegExp, expect, expectAccessible, test } from "./fixtures";
import { serveProjectMaintainer } from "./project-maintainer-fixture";

const site = deploymentOrigins(
  deploymentTier(process.env.VITE_SLOP_ENVIRONMENT),
).site;
const account = {
  githubUserId: "123",
  wallets: [],
  payments: [],
  monthlyAwards: [],
  balances: [],
  directTransfers: [],
  walletObservations: [],
};

async function serveSite(page: Page) {
  await page.route(`${site}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith("/api/")) {
      expect(path, "Unexpected API request in this fixture").toBe(
        "/api/v1/points/me",
      );
      return route.fulfill({ json: null });
    }
    return route.fulfill({
      path: join(
        process.cwd(),
        "dist",
        route.request().resourceType() === "document" ? "index.html" : path,
      ),
    });
  });
  await page.route("https://avatars.githubusercontent.com/**", (route) =>
    route.fulfill({ path: join(process.cwd(), "public/slop-mark.svg") }),
  );
  await page.route("**/api/v1/notifications/email", (route) =>
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
  await page.route("**/api/v1/referrals/me", (route) =>
    route.fulfill({ json: { enabled: false } }),
  );
  await page.route("**/api/v1/project-appeals", (route) =>
    route.fulfill({ json: { appeals: [] } }),
  );
}

test("vault setup keeps the loaded options when a reload fails temporarily", async ({
  page,
  diagnostics,
}) => {
  await serveSite(page);
  const template = PROJECTS.find((value) => value.id === "eliza");
  if (!template) throw new Error("Missing fixture project");
  const project = {
    ...template,
    reward: { ...template.reward, feeBasisPoints: 200 },
    escrow: {
      schemaVersion: "1",
      effectiveCycle: "2026-10",
      chain: "base",
      feeBasisPoints: 200,
      withdrawalFeeBasisPoints: 200,
      feeMode: "deduct-from-gross",
      deployments: [],
    },
  } as typeof template;
  await serveProjectMaintainer(page, () => project);
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({
      json: {
        session: { githubId: "123", githubLogin: "qa", admin: false },
      },
    }),
  );
  await page.route("**/api/v1/payments/me", (route) =>
    route.fulfill({ json: account }),
  );
  let unavailable = false;
  diagnostics.allowResponse(500, "GET", "/api/v1/project-vaults/eliza");
  // The fixture serves the build under the deployed site origin, so the
  // browser's console report of the same 500 names that origin instead.
  diagnostics.allow(
    new RegExp(
      `^console Failed to load resource: the server responded with a status of 500 \\(.+\\) at ${escapeRegExp(site)}/api/v1/project-vaults/eliza\\?purpose=ordinary$`,
      "u",
    ),
  );
  await page.route("**/api/v1/project-vaults/eliza?**", (route) =>
    unavailable
      ? route.fulfill({
          status: 500,
          json: {
            error: "unavailable",
            message: "Vault setup is temporarily unavailable.",
          },
        })
      : route.fulfill({ json: { revision: 1, networks: ["base-mainnet"] } }),
  );
  await page.goto(`${site}/projects/eliza/manage`, {
    waitUntil: "networkidle",
  });
  const setup = page.getByRole("region", {
    name: "Set up project vault",
    exact: true,
  });
  const automatic = setup.getByRole("combobox", {
    name: "Automatic monthly payment",
  });
  const walletEmpty = setup.getByText(
    "Open this page in your wallet app or install a compatible wallet.",
  );
  await expect(automatic).toBeVisible();
  await expect(walletEmpty).toBeVisible();
  unavailable = true;
  await setup
    .getByRole("button", { name: "Reload setup options", exact: true })
    .click();
  // The temporary failure is reported, but the loaded options, the wallet
  // connection prompt and the reload control itself stay on screen: only an
  // authoritative answer (the session ending) may clear the form.
  await expect(setup.getByRole("alert")).toContainText(
    "Vault setup is temporarily unavailable.",
  );
  await expect(automatic).toBeVisible();
  await expect(walletEmpty).toBeVisible();
  unavailable = false;
  await setup
    .getByRole("button", { name: "Reload setup options", exact: true })
    .click();
  await expect(setup.getByRole("alert")).toHaveCount(0);
  await expect(automatic).toBeVisible();
  await expectAccessible(page);
});
