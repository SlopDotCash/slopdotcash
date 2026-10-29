/** Browser-only synthetic identity responses never register a real wallet. */
import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import { PROJECTS, type ProjectDefinition } from "../../src/lib/projects.mjs";
import { enlargeText } from "../text-size";
import { expect, serveProjectCycleIndex, test } from "./fixtures";
import { serveProjectMaintainer } from "./project-maintainer-fixture";

test("legacy wallet links open Account Wallets on direct navigation and reload", {
  tag: ["@pages"],
}, async ({ diagnostics, page }) => {
  diagnostics.allowPreviewApiMisses();
  diagnostics.allow(
    /^console Failed to load resource: the server responded with a status of 401 .* at http:\/\/[^ ]+\/api\/v1\/payments\/me$/u,
    /^401 GET http:\/\/[^ ]+\/api\/v1\/payments\/me$/u,
  );
  await page.route("**/api/v1/payments/me", (route) =>
    route.fulfill({ status: 401, json: { error: "not_signed_in" } }),
  );
  for (const path of ["/wallet", "/wallet/"]) {
    const response = await page.goto(path, { waitUntil: "networkidle" });
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/account#wallets$/u);
    await expect(
      page.getByRole("region", { name: "Wallets", exact: true }),
    ).toHaveCount(1);
    await expect(page.locator("#wallets > summary")).toHaveCount(0);
    await expect(page.locator(".wallet-note")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Wallets", exact: true }),
    ).toBeInViewport();
    const reloaded = await page.reload({ waitUntil: "networkidle" });
    expect(reloaded?.status()).toBe(200);
    await expect(
      page
        .locator("#wallets")
        .getByRole("link", { name: "Sign in with GitHub" }),
    ).toHaveAttribute("href", "/login?next=%2Faccount%23wallets");
  }
});

/** Records every same-origin response for the attached network evidence. */
function observe(page: Page) {
  const network: { path: string; status: number }[] = [];
  page.on("response", (response) => {
    if (new URL(response.url()).origin === new URL(page.url()).origin)
      network.push({
        path: new URL(response.url()).pathname,
        status: response.status(),
      });
  });
  return { network };
}

async function audit(page: Page, info: TestInfo, label: string) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  await info.attach(`${label}-axe.json`, {
    body: JSON.stringify(
      { violations: result.violations, passes: result.passes.map((p) => p.id) },
      null,
      2,
    ),
    contentType: "application/json",
  });
  const screenshotPath = info.outputPath(`${label}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await info.attach(`${label}.png`, {
    path: screenshotPath,
    contentType: "image/png",
  });
  expect(result.violations, label).toEqual([]);
  const splitWords = await page.evaluate(() => {
    const failures: string[] = [];
    for (const element of document.querySelectorAll(
      ".site-header a, .wordmark, .payout-steps button",
    )) {
      if (!(element as HTMLElement).offsetWidth) continue;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (const match of (node.textContent ?? "").matchAll(/\S+/g)) {
          const range = document.createRange();
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);
          const lines = new Set(
            [...range.getClientRects()].map((rect) => Math.round(rect.top)),
          );
          if (lines.size > 1) failures.push(match[0]);
        }
      }
    }
    return failures;
  });
  expect(splitWords, `${label} keeps navigation words intact`).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
    `${label} page overflow`,
  ).toBeLessThanOrEqual(1);
}

async function keyboardTo(
  page: Page,
  target: ReturnType<Page["getByRole"]>,
  reverse = false,
) {
  for (let count = 0; count < 80; count++) {
    if (await target.evaluate((element) => element === document.activeElement))
      return;
    await page.keyboard.press(reverse ? "Shift+Tab" : "Tab");
  }
  await expect(target).toBeFocused();
}

/** Doubles every computed font size and line height (WCAG 1.4.4 text resize). */
async function doubleTextSize(page: Page) {
  await enlargeText(page.locator("body"));
}

test("funding and wallet keyboard flows remain accessible at 200 percent text size", async ({
  page,
}, info) => {
  await page.route("**/.well-known/slop/projects.json", (route) =>
    route.fulfill({ json: { schemaVersion: "1", projects: [] } }),
  );
  await page.route("**/api/v1/notifications/email", (route) =>
    route.fulfill({ json: { enabled: false, availability: "unverified" } }),
  );
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
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({
      json: { session: { githubId: "123", githubLogin: "qa", admin: false } },
    }),
  );
  await page.route("**/api/v1/project-appeals", (route) =>
    route.fulfill({ json: { appeals: [] } }),
  );
  const evidence = observe(page);
  for (const path of ["/wallet", "/projects/eliza/funding"]) {
    await page.goto(path, { waitUntil: "networkidle" });
    await doubleTextSize(page);
    if (path === "/wallet") {
      const connect = page.getByRole("button", {
        name: "Connect Solana wallet",
        exact: true,
      });
      await keyboardTo(page, connect);
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("dialog", { name: "Connect a Solana wallet" }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(connect).toBeFocused();
      await audit(page, info, "wallet-200-percent-text");
    } else {
      await expect(
        page.getByRole("heading", { exact: true, name: "Eliza" }),
      ).toBeVisible();
      const copy = page.getByRole("button", { name: "Copy agent prompt" });
      await keyboardTo(page, copy);
      await expect(copy).toBeFocused();
      await audit(page, info, "funding-200-percent-text");
    }
  }
  await info.attach("network.json", {
    body: JSON.stringify(evidence, null, 2),
    contentType: "application/json",
  });
});

const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const BASE_VAULT = "0x1000000000000000000000000000000000000001";

/** Eliza with a registered Base vault: deployment facts only, no chain or wallet. */
function baseVaultProject(): ProjectDefinition {
  const original = PROJECTS.find((entry) => entry.id === "eliza");
  if (original?.reward.kind !== "monthly-pool")
    throw new Error("Missing monthly project fixture");
  return {
    ...original,
    reward: {
      ...original.reward,
      chain: "base",
      currency: "USDC",
      feeBasisPoints: 200,
      paymentMode: "disabled",
      committedMinor: "0",
      fundingState: "pledged",
    },
    rewardAsset: {
      network: "base",
      kind: "stablecoin",
      address: BASE_USDC,
      symbol: "USDC",
      decimals: 6,
      chainId: "8453",
      cluster: null,
      verifiedAt: "2026-10-22T00:00:00.000Z",
    },
    escrow: {
      schemaVersion: "1",
      effectiveCycle: "2026-10",
      chain: "base",
      feeBasisPoints: 200,
      withdrawalFeeBasisPoints: 200,
      feeMode: "deduct-from-gross",
      deployments: [
        {
          network: "base-mainnet",
          vault: BASE_VAULT,
          asset: BASE_USDC,
          owner: "0x2000000000000000000000000000000000000002",
          identityAuthority: "0x3000000000000000000000000000000000000003",
          feeRecipient: "0x4000000000000000000000000000000000000004",
          factory: "0x5000000000000000000000000000000000000005",
          registrar: "0x6000000000000000000000000000000000000006",
          factoryCodeSha256: "cd".repeat(32),
          codeSha256: "ab".repeat(32),
          deploymentTransaction: `0x${"ab".repeat(32)}`,
          sourceCommit: "a".repeat(40),
          bindingDelaySeconds: "0",
          rotationDelaySeconds: null,
          programId: null,
          projectPda: null,
          networkDomain: null,
          upgradeAuthority: null,
        },
      ],
    },
  };
}

/** One finalized vault read: 1,000 USDC deposited, 196 + 4 paid, 196 + 4 reserved. */
function vaultSnapshot(freeBalance: string, observedAt: number) {
  const time = new Date(observedAt).toISOString();
  return {
    projectId: "eliza",
    network: "base-mainnet",
    chain: "base",
    vault: BASE_VAULT,
    assetAddress: BASE_USDC,
    assetDecimals: 6,
    totalDeposited: (BigInt(freeBalance) + 400_000_000n).toString(),
    totalPaid: "196000000",
    totalPayoutFees: "4000000",
    totalGrossWithdrawn: "0",
    totalWithdrawalFees: "0",
    freeBalance,
    reservedPrincipal: "196000000",
    reservedFees: "4000000",
    accruedFees: "0",
    reserved: null,
    blockNumber: "37215118",
    blockTime: time,
    observedAt: time,
  };
}

test("vault totals stay current without a refresh button and keep each state distinct", async ({
  diagnostics,
  page,
}, info) => {
  diagnostics.allowPreviewApiMisses();
  const unavailable = diagnostics.allowResponse(
    503,
    "GET",
    "/api/v1/payments/projects/eliza/vault",
  );
  let project = baseVaultProject();
  const start = Date.now();
  await page.clock.install({ time: start });
  await page.route(
    /\/(?:api\/v1\/projects|data\/fixture-project-registry\.json)$/,
    (route) =>
      route.fulfill({ json: { schemaVersion: "1", projects: [project] } }),
  );
  await serveProjectCycleIndex(page, [project.id]);
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({ json: { session: null } }),
  );
  // The vault read the page receives; `held` keeps the first read loading.
  let read: { status: number; snapshots: unknown[] } = {
    status: 200,
    snapshots: [vaultSnapshot("600000000", start - 120_000)],
  };
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reads = 0;
  await page.route("**/api/v1/payments/projects/eliza/vault", async (route) => {
    reads += 1;
    if (reads === 1) await held;
    await route.fulfill(
      read.status === 200
        ? {
            json: {
              projectId: "eliza",
              snapshots: read.snapshots,
              staleAfterMs: 1_800_000,
              servedAt: new Date(start).toISOString(),
            },
          }
        : { status: read.status, json: { error: "unavailable" } },
    );
  });
  await page.goto("/projects/eliza/funding");
  const section = page.getByRole("region", { name: "Project escrow" });
  // Loading shows placeholder tiles and a status chip, never zero.
  await expect(section.getByRole("status")).toHaveText("Loading vault totals…");
  await expect(section.getByText("USDC")).toHaveCount(0);
  release();
  const heading = section.getByRole("heading", {
    level: 2,
    name: "Project vault Base",
  });
  await expect(heading.locator('svg[data-network="base"]')).toBeVisible();
  await expect(
    section.getByRole("list", { name: "Fees" }).getByRole("listitem"),
  ).toHaveCount(0);
  const available = section
    .locator(".vault-stat")
    .filter({ hasText: "Available" });
  await expect(available).toContainText("600 USDC");
  await expect(section.getByText("Reserved for awards")).toHaveCount(0);
  const paid = section.locator(".vault-stat").filter({ hasText: "Paid out" });
  await expect(paid.getByRole("definition")).toHaveText([
    "196 USDC",
    "+ 4 USDC fees",
  ]);
  await expect(section.getByRole("alert")).toHaveCount(0);
  await expect(
    section.getByRole("region", { name: /^Fund or withdraw/u }),
  ).toHaveCount(0);
  await expect(
    section.getByRole("region", { name: /^Vault monthly authorization/u }),
  ).toHaveCount(0);
  await expect(section.getByText("No wallet found")).toHaveCount(0);
  await expect(section.getByRole("button", { name: /refresh/i })).toHaveCount(
    0,
  );
  await expect(section.locator(".vault-ledger-details")).toHaveCount(0);
  await expect(
    section.getByText("Ledger details", { exact: true }),
  ).toHaveCount(0);
  await audit(page, info, "vault-totals-ready");

  // Returning to the page after the cache window reads the totals again.
  read = {
    status: 200,
    snapshots: [vaultSnapshot("700000000", start + 30_000)],
  };
  await page.waitForLoadState("networkidle");
  await page.clock.fastForward(61_000);
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(available).toContainText("700 USDC");
  expect(reads).toBe(2);

  // An older snapshot refreshes automatically without a timestamp badge.
  await page.waitForLoadState("networkidle");
  await page.clock.fastForward(31 * 60_000);
  await expect(section.getByText(/^Outdated · read/u)).toHaveCount(0);
  await expect(section.getByRole("alert")).toHaveCount(0);
  expect(reads).toBe(3);
  await expect(available).toContainText("700 USDC");

  // A failed refresh keeps the last totals and explains the failed read.
  read = { status: 503, snapshots: [] };
  await page.waitForLoadState("networkidle");
  await page.clock.fastForward(61_000);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    section.getByRole("alert").filter({ hasText: "unavailable" }),
  ).toContainText("Vault totals are unavailable.");
  await expect(available).toContainText("700 USDC");
  await expect(section.getByText(/^Outdated · read/u)).toHaveCount(0);
  expect(diagnostics.count(unavailable)).toBe(1);
  read = {
    status: 200,
    snapshots: [
      vaultSnapshot("700000000", await page.evaluate(() => Date.now())),
    ],
  };
  await section.getByRole("button", { name: "Retry" }).click();
  await expect(section.getByRole("alert")).toHaveCount(0);
  await expect(available).toContainText("700 USDC");

  // A vault without a finalized read and a failed first read stay distinct.
  read = { status: 200, snapshots: [] };
  await page.reload();
  await expect(section.getByRole("status")).toHaveText("Totals not read yet");
  await expect(section.getByText("USDC")).toHaveCount(0);
  // An empty successful read must not hide a later refresh failure.
  read = { status: 503, snapshots: [] };
  await page.waitForLoadState("networkidle");
  await page.clock.fastForward(61_000);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(section.getByRole("alert")).toContainText(
    "Vault totals are unavailable.",
  );
  await expect(section.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(section.getByText("USDC")).toHaveCount(0);
  read = { status: 200, snapshots: [] };
  await section.getByRole("button", { name: "Retry" }).click();
  await expect(section.getByRole("alert")).toHaveCount(0);
  await expect(section.getByRole("status")).toHaveText("Totals not read yet");
  read = { status: 503, snapshots: [] };
  await page.reload();
  await expect(section.getByRole("alert")).toContainText(
    "Vault totals are unavailable.",
  );
  await expect(section.locator(".vault-stat")).toHaveCount(0);

  read = {
    status: 200,
    snapshots: [
      vaultSnapshot("600000000", await page.evaluate(() => Date.now())),
    ],
  };
  await page.reload();
  await expect(available).toContainText("600 USDC");
  await doubleTextSize(page);
  await audit(page, info, "vault-totals-200-percent-text");

  // Verified maintainers retain wallet actions in project settings.
  await serveProjectMaintainer(page, () => project);
  await page.goto("/projects/eliza/manage", { waitUntil: "networkidle" });
  const funding = page.getByRole("region", {
    name: "Fund or withdraw · Base",
    exact: true,
  });
  await expect(
    funding.getByRole("heading").locator('svg[data-network="base"]'),
  ).toBeVisible();
  await expect(funding).toContainText("Direct transfers are not credited");
  await expect(funding.getByText("No wallet found")).toHaveCount(1);
  await expect(
    page.getByRole("region", { name: "Vault monthly authorization · Base" }),
  ).toBeVisible();
  await audit(page, info, "owner-vault-settings");

  // An unset vault has no public section; its maintainer can still set it up.
  if (!project.escrow) throw new Error("Missing escrow fixture");
  project = {
    ...project,
    escrow: { ...project.escrow, deployments: [] },
  };
  await page.goto("/projects/eliza", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("region", { name: "Project escrow", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("The project vault is not set up.")).toHaveCount(
    0,
  );
  await audit(page, info, "unconfigured-public-vault-hidden");
  await page.goto("/projects/eliza/manage", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("region", { name: "Set up project vault", exact: true }),
  ).toBeVisible();
});

test("project navigation never reuses another project's vault balance", async ({
  diagnostics,
  page,
}) => {
  diagnostics.allowPreviewApiMisses();
  diagnostics.allowCanceledBackgroundReads();
  const first = baseVaultProject();
  const other = PROJECTS.find(
    (entry) => entry.id !== first.id && entry.reward.kind === "monthly-pool",
  );
  if (!other) throw new Error("Missing second project fixture");
  const second = {
    ...other,
    reward: first.reward,
    rewardAsset: first.rewardAsset,
    escrow: first.escrow,
  };
  diagnostics.allowResponse(
    503,
    "GET",
    `/api/v1/payments/projects/${second.id}/vault`,
  );
  await page.route(
    /\/(?:api\/v1\/projects|data\/fixture-project-registry\.json)$/,
    (route) =>
      route.fulfill({
        json: { schemaVersion: "1", projects: [first, second] },
      }),
  );
  await serveProjectCycleIndex(page, [first.id, second.id]);
  await page.route("**/api/v1/payments/projects/eliza/vault", (route) =>
    route.fulfill({
      json: {
        projectId: first.id,
        snapshots: [vaultSnapshot("123000000", Date.now())],
        staleAfterMs: 1_800_000,
        servedAt: new Date().toISOString(),
      },
    }),
  );
  await page.route(`**/api/v1/payments/projects/${second.id}/vault`, (route) =>
    route.fulfill({ status: 503, json: { error: "unavailable" } }),
  );
  await page.goto(`/projects/${first.slug}`);
  const funding = page.locator("#funding:visible").getByRole("region", {
    name: "Project escrow",
    exact: true,
  });
  await expect(funding).toContainText("123 USDC");
  // Exercise the router without remounting the application, as Link does.
  await page.evaluate((slug) => {
    history.pushState({}, "", `/projects/${slug}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, second.slug);
  await expect(funding.getByRole("alert")).toContainText(
    "Vault totals are unavailable.",
  );
  await expect(funding).not.toContainText("123 USDC");
});
