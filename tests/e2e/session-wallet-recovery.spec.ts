/** Real rendered flows with deterministic API failures; no wallet or money writes. */
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { deploymentOrigins, deploymentTier } from "../../src/lib/deployment";
import { PROJECTS } from "../../src/lib/projects.mjs";
import { expect, expectAccessible, test } from "./fixtures";
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
    if (path.startsWith("/api/")) return route.fulfill({ json: null });
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

test("vault setup removes owner controls after the session ends", async ({
  page,
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
  let signedIn = true;
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({
      json: {
        session: signedIn
          ? { githubId: "123", githubLogin: "qa", admin: false }
          : null,
      },
    }),
  );
  await page.route("**/api/v1/payments/me", (route) =>
    route.fulfill({ json: account }),
  );
  await page.route("**/api/v1/project-vaults/eliza?**", (route) =>
    route.fulfill({ json: { revision: 1, networks: ["base-mainnet"] } }),
  );
  await page.goto(`${site}/projects/eliza/manage`, {
    waitUntil: "networkidle",
  });
  const setup = page.getByRole("region", {
    name: "Set up project vault",
    exact: true,
  });
  await expect(
    setup.getByRole("combobox", { name: "Automatic monthly payment" }),
  ).toBeVisible();
  await setup.screenshot({
    path: test.info().outputPath("1935-active-setup.png"),
  });
  signedIn = false;
  const reload = setup.getByRole("button", {
    name: "Reload setup options",
    exact: true,
  });
  await reload.focus();
  await page.keyboard.press("Enter");
  await expect(
    setup.getByRole("link", { name: "Sign in with GitHub" }),
  ).toBeVisible();
  await expect(
    setup.getByRole("combobox", { name: "Automatic monthly payment" }),
  ).toHaveCount(0);
  await expect(
    setup.getByRole("group", { name: "Connect your confirmed owner wallet" }),
  ).toHaveCount(0);
  await expectAccessible(page);
  await setup.screenshot({
    path: test.info().outputPath("1935-session-ended.png"),
  });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await expect(
    setup.getByRole("link", { name: "Sign in with GitHub" }),
  ).toBeVisible();
  await setup.screenshot({
    path: test.info().outputPath("1935-session-ended-200percent.png"),
  });
});

test("Settings wallet cards survive direct-payment history failure", async ({
  page,
  diagnostics,
}) => {
  await serveSite(page);
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({
      json: {
        session: { githubId: "123", githubLogin: "qa", admin: false },
      },
    }),
  );
  await page.route("**/api/v1/payments/me", (route) =>
    route.fulfill({ json: { ...account, directTransfersPaged: true } }),
  );
  let historyReads = 0;
  await page.route(
    "**/api/v1/payments/actors/123/direct-transfers*",
    (route) => {
      historyReads++;
      return route.fulfill({
        status: 503,
        json: { error: "fixture_history_unavailable" },
      });
    },
  );
  diagnostics.allow(
    /^console Failed to load resource: the server responded with a status of 503 .*\/api\/v1\/payments\/actors\/123\/direct-transfers$/u,
  );
  await page.goto(`${site}/account#wallets`, { waitUntil: "networkidle" });
  const wallets = page.getByRole("region", {
    name: "Payout wallets",
    exact: true,
  });
  await expect(wallets).toBeVisible();
  expect(historyReads).toBe(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expectAccessible(page);
  await wallets.screenshot({
    path: test.info().outputPath("1913-settings-wallets.png"),
  });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await wallets.screenshot({
    path: test.info().outputPath("1913-settings-wallets-200percent.png"),
  });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "1";
  });
  const connect = wallets.getByRole("button").first();
  await connect.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto(`${site}/earnings`, { waitUntil: "networkidle" });
  await expect(page.getByRole("alert")).toContainText(
    "Direct payment records unavailable",
  );
  expect(historyReads).toBeGreaterThan(0);
  await page.screenshot({
    path: test.info().outputPath("1913-payouts-history-error.png"),
    fullPage: true,
  });
});
