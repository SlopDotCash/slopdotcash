/**
 * The public project page's funding parts (operator decision, 18 November
 * 2026): what the free funds cover, a deposit-only control for any wallet,
 * and the recorded deposits. Synthetic vault facts and a synthetic wallet;
 * nothing here signs or reaches a chain.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { PROJECTS, type ProjectDefinition } from "../../src/lib/projects.mjs";
import { expect, serveProjectCycleIndex, test } from "./fixtures";

const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const BASE_VAULT = "0x1000000000000000000000000000000000000001";
const OWNER = "0x2000000000000000000000000000000000000002";
const VISITOR = "0x7000000000000000000000000000000000000007";

/** Eliza with a registered Base vault and a 1,000 USDC monthly amount. */
function vaultProject(status: ProjectDefinition["status"]): ProjectDefinition {
  const original = PROJECTS.find((entry) => entry.id === "eliza");
  if (original?.reward.kind !== "monthly-pool")
    throw new Error("Missing monthly project fixture");
  return {
    ...original,
    status,
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
          owner: OWNER,
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

function snapshot(freeBalance: string) {
  const time = new Date(Date.now() - 60_000).toISOString();
  return {
    projectId: "eliza",
    network: "base-mainnet",
    chain: "base",
    vault: BASE_VAULT,
    assetAddress: BASE_USDC,
    assetDecimals: 6,
    totalDeposited: freeBalance,
    totalPaid: "0",
    totalPayoutFees: "0",
    totalGrossWithdrawn: "0",
    totalWithdrawalFees: "0",
    freeBalance,
    reservedPrincipal: "0",
    reservedFees: "0",
    accruedFees: "0",
    reserved: null,
    blockNumber: "37215118",
    blockTime: time,
    observedAt: time,
  };
}

const deposit = (
  n: number,
  depositor: string,
  githubLogin: string | null,
  amountBase: string,
) => ({
  id: `base-mainnet:0x${n.toString(16).padStart(64, "0")}:0`,
  projectId: "eliza",
  network: "base-mainnet",
  chain: "base",
  vault: BASE_VAULT,
  depositor,
  githubLogin,
  amountBase,
  assetAddress: BASE_USDC,
  assetDecimals: 6,
  transactionId: `0x${n.toString(16).padStart(64, "0")}`,
  depositedAt: `2026-11-${String(10 + n).padStart(2, "0")}T12:00:00.000Z`,
});

async function serve(
  page: Page,
  project: ProjectDefinition,
  freeBalance: string,
  deposits: ReturnType<typeof deposit>[] | { status: number },
) {
  await page.route(
    /\/(?:api\/v1\/projects|data\/fixture-project-registry\.json)$/,
    (route) =>
      route.fulfill({ json: { schemaVersion: "1", projects: [project] } }),
  );
  await serveProjectCycleIndex(page, [project.id]);
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({ json: { session: null } }),
  );
  await page.route("**/api/v1/payments/projects/eliza/vault", (route) =>
    route.fulfill({
      json: {
        projectId: "eliza",
        snapshots: [snapshot(freeBalance)],
        staleAfterMs: 1_800_000,
        servedAt: new Date().toISOString(),
      },
    }),
  );
  await page.route("**/api/v1/payments/projects/eliza/deposits", (route) =>
    Array.isArray(deposits)
      ? route.fulfill({
          json: {
            projectId: "eliza",
            deposits,
            total: deposits.length,
            servedAt: new Date().toISOString(),
          },
        })
      : route.fulfill({ status: deposits.status, json: { error: "down" } }),
  );
}

/** One announced EVM wallet whose connected account is `address`. */
async function announceWallet(page: Page, address: string) {
  await page.addInitScript((account) => {
    const provider = {
      isMetaMask: true,
      on() {},
      removeListener() {},
      async request({ method }: { method: string }) {
        if (method === "wallet_requestPermissions")
          return [{ parentCapability: "eth_accounts" }];
        if (method === "eth_requestAccounts" || method === "eth_accounts")
          return [account];
        if (method === "eth_chainId") return "0x2105";
        throw Object.assign(new Error("Unsupported in this fixture"), {
          code: 4200,
        });
      },
    };
    const announce = () =>
      window.dispatchEvent(
        new CustomEvent("eip6963:announceProvider", {
          detail: {
            provider,
            info: {
              uuid: "6f9e2d1c-8b7a-4e3d-a2c1-0f9e8d7c6b5a",
              name: "MetaMask",
              rdns: "io.metamask",
              icon: "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2224%22 height=%2224%22/%3E",
            },
          },
        }),
      );
    Object.assign(window, { ethereum: provider });
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
  }, address);
}

for (const [who, address] of [
  ["a visitor's wallet", VISITOR],
  ["the vault owner's wallet", OWNER],
] as const)
  test(`the public project page offers ${who} a deposit and never a withdrawal`, async ({
    diagnostics,
    page,
  }, info) => {
    diagnostics.allowPreviewApiMisses();
    await announceWallet(page, address);
    // 2,530 USDC free against 1,000 USDC a month.
    await serve(page, vaultProject("active"), "2530000000", [
      deposit(4, VISITOR, null, "1000000"),
      deposit(2, OWNER, "fixture-owner", "2529000000"),
    ]);
    await page.goto("/projects/eliza/funding", { waitUntil: "networkidle" });
    const section = page.getByRole("region", { name: "Project escrow" });
    await expect(section.locator(".vault-covers")).toHaveText(
      /^Covers 2 months at .*1,000.* a month$/u,
    );
    // The risk is stated before any wallet is chosen, and no wallet control
    // or owner control is on the page until the visitor asks to fund.
    await expect(section).toContainText("Depositors have no refund right.");
    await expect(section).toContainText(
      "The project owner can withdraw free funds, less a 2% fee.",
    );
    await expect(
      section.getByRole("region", {
        name: /^Fund (?:or withdraw|this project)/u,
      }),
    ).toHaveCount(0);
    await expect(
      section.getByRole("region", { name: /^Vault monthly authorization/u }),
    ).toHaveCount(0);
    const funders = section.getByRole("region", { name: "Funded by" });
    await expect(funders.getByRole("listitem")).toHaveCount(2);
    await expect(funders.getByRole("listitem").first()).toContainText(
      "0x7000…0007",
    );
    await expect(funders.getByRole("listitem").first()).toContainText(
      /1\s*USDC/u,
    );
    await expect(
      funders.getByRole("link", { name: "fixture-owner", exact: true }),
    ).toHaveAttribute("href", "/contributors/fixture-owner");
    await expect(funders.getByRole("listitem").nth(1)).toContainText(
      /2,529\s*USDC/u,
    );
    await expect(
      funders.getByRole("link", { name: "View deposit transaction" }).first(),
    ).toHaveAttribute(
      "href",
      `https://basescan.org/tx/0x${"4".padStart(64, "0")}`,
    );
    const accessibility = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(accessibility.violations).toEqual([]);

    await section.getByRole("button", { name: "Fund this project" }).click();
    const form = section.getByRole("region", {
      name: "Fund this project · Base",
    });
    await form
      .getByRole("button", { name: "Connect MetaMask", exact: true })
      .click();
    await expect(form.getByLabel("Deposit tokens")).toBeChecked();
    await expect(form.getByLabel("Withdraw free funds")).toHaveCount(0);
    await expect(
      form.getByRole("button", { name: "Review deposit" }),
    ).toBeVisible();
    await expect(form.getByRole("button", { name: /withdraw/iu })).toHaveCount(
      0,
    );
    await expect(form).toContainText("Direct transfers are not credited");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    const opened = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(opened.violations).toEqual([]);
    await info.attach("public-funding.png", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  });

test("a paused project shows its funders and no deposit control", async ({
  diagnostics,
  page,
}) => {
  diagnostics.allowPreviewApiMisses();
  await serve(page, vaultProject("paused"), "999999999", []);
  await page.goto("/projects/eliza/funding", { waitUntil: "networkidle" });
  const section = page.getByRole("region", { name: "Project escrow" });
  await expect(section.locator(".vault-covers")).toHaveText(
    /^Covers less than one month at /u,
  );
  await expect(
    section.getByRole("button", { name: "Fund this project" }),
  ).toHaveCount(0);
  await expect(section).not.toContainText("Depositors have no refund right.");
  await expect(
    section.getByRole("region", { name: "Funded by" }),
  ).toContainText("No deposits recorded yet");
});

test("a failed funders read is an error with a retry, never an empty list", async ({
  diagnostics,
  page,
}) => {
  diagnostics.allowPreviewApiMisses();
  diagnostics.allowResponse(
    503,
    "GET",
    "/api/v1/payments/projects/eliza/deposits",
  );
  let down = true;
  await serve(page, vaultProject("active"), "1000000000", { status: 503 });
  await page.route("**/api/v1/payments/projects/eliza/deposits", (route) =>
    down
      ? route.fulfill({ status: 503, json: { error: "down" } })
      : route.fulfill({
          json: {
            projectId: "eliza",
            deposits: [deposit(3, VISITOR, null, "5000000")],
            total: 1,
            servedAt: new Date().toISOString(),
          },
        }),
  );
  await page.goto("/projects/eliza/funding", { waitUntil: "networkidle" });
  const funders = page.getByRole("region", { name: "Funded by" });
  await expect(funders).toContainText("Funders unavailable");
  await expect(funders).not.toContainText("No deposits recorded yet");
  // The deposit control does not depend on the list.
  await expect(
    page.getByRole("button", { name: "Fund this project" }),
  ).toBeVisible();
  down = false;
  await funders.getByRole("button", { name: "Retry funders" }).click();
  await expect(funders.getByRole("listitem")).toHaveCount(1);
  await expect(funders).toContainText(/5\s*USDC/u);
});
