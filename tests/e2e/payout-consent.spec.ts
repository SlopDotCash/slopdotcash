/** Real page + deterministic wallet/API fixtures. Live chain acceptance is recorded separately. */
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { privateKeyToAccount } from "viem/accounts";
import { verifyEvmBindingSignature } from "../../backend/payments/possession";
import { evmBindingTypedData } from "../../contracts/evm/adapter";
import { deploymentOrigins, deploymentTier } from "../../src/lib/deployment";
import { enlargeText } from "../text-size";
import { expect, expectAccessible, test } from "./fixtures";

const recipient = privateKeyToAccount(`0x${"0".repeat(63)}1`);
const vault = `0x${"2".repeat(40)}`;
const binding = {
  githubUserId: "123",
  destination: recipient.address,
  expectedVersion: "7",
  claimDigest: `0x${"c".repeat(64)}`,
  expiresAt: "2000000000",
};
const typed = evmBindingTypedData(8453n, vault, binding);

test("payouts publish direct history only after every page verifies", async ({
  page,
}) => {
  const { site } = deploymentOrigins(
    deploymentTier(process.env.VITE_SLOP_ENVIRONMENT),
  );
  await page.route(`${site}/**`, (route) =>
    new URL(route.request().url()).pathname.startsWith("/api/")
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
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({
      json: { session: { githubId: "123", githubLogin: "qa", admin: false } },
    }),
  );
  await page.route("**/api/v1/project-appeals", (route) =>
    route.fulfill({ json: { appeals: [] } }),
  );
  await page.route("**/api/v1/referrals/me", (route) =>
    route.fulfill({ json: { enabled: false } }),
  );
  const transfers = [1, 2].map((id) => ({
    projectId: "eliza",
    contributionMonth: "2026-08",
    githubUserId: "123",
    login: "qa",
    network: "base-mainnet",
    chain: "base",
    recipient: recipient.address,
    amountMicro: "1000000",
    transactionId: `0x${id.toString(16).padStart(64, "0")}`,
    blockTime: "2026-09-17T12:00:00.000Z",
  }));
  let incomplete = true;
  await page.route("**/api/v1/payments/**", (route) => {
    const request = route.request();
    expect(request.method()).toBe("GET");
    expect(request.headers()["x-slop-direct-history"]).toBe("paged");
    const url = new URL(request.url());
    if (url.pathname.endsWith("/me"))
      return route.fulfill({
        json: {
          githubUserId: "123",
          wallets: [],
          payments: [],
          balances: [],
          monthlyAwards: [],
          directTransfers: [],
          directTransfersPaged: true,
          walletObservations: [],
        },
      });
    expect(url.pathname).toBe("/api/v1/payments/actors/123/direct-transfers");
    const second = url.searchParams.has("after");
    if (second) expect(url.searchParams.get("through")).toBe("2");
    const rows = second && incomplete ? [] : [transfers[second ? 1 : 0]];
    return route.fulfill({
      json: {
        transfers: rows,
        totalMicro: String(rows.length * 1_000_000),
        through: 2,
        total: 2,
        next: second ? null : 1,
      },
    });
  });
  await page.goto(`${site}/earnings`, { waitUntil: "networkidle" });
  await expect(page.getByRole("alert")).toContainText(
    "Incomplete direct payment history",
  );
  await expect(
    page.getByRole("heading", { name: "Direct transfers", exact: true }),
  ).toHaveCount(0);
  incomplete = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Direct transfers", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("list", { name: "Direct transfers", exact: true })
      .getByRole("listitem"),
  ).toHaveCount(2);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

async function setup(
  page: Page,
  fault: "none" | "account" | "domain" | "reject" = "none",
) {
  const { EIP712Domain: _domain, ...types } = typed.types;
  const signature = await recipient.signTypedData({
    ...typed,
    domain: {
      ...typed.domain,
      chainId: 8453,
      verifyingContract: vault as `0x${string}`,
    },
    types,
  });
  await page.addInitScript(
    ({ address, signature, fault }) => {
      const state = { signatures: 0 };
      Object.assign(window, {
        payoutConsentFixture: state,
        ethereum: {
          request: async ({ method }: { method: string }) => {
            if (method === "eth_requestAccounts") return [address];
            if (method === "eth_accounts")
              return [fault === "account" ? `0x${"9".repeat(40)}` : address];
            if (method === "eth_chainId") return "0x2105";
            if (method === "eth_signTypedData_v4") {
              state.signatures++;
              if (fault === "reject")
                throw new Error("Wallet request rejected by user.");
              return signature;
            }
            throw new Error(`Unexpected wallet request ${method}`);
          },
        },
      });
    },
    { address: recipient.address, signature, fault },
  );
  let authorized = 0;
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({
      json: { session: { githubId: "123", githubLogin: "qa", admin: false } },
    }),
  );
  await page.route("**/api/v1/project-appeals", (route) =>
    route.fulfill({ json: { appeals: [] } }),
  );
  await page.route("**/api/v1/payments/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/me"))
      return route.fulfill({
        json: {
          githubUserId: "123",
          wallets: [
            {
              chain: "base",
              claimId: "claim",
              address: recipient.address,
              authorized: true,
            },
          ],
          payments: [
            {
              id: "a".repeat(64),
              vault,
              projectId: "eliza",
              network: "base-mainnet",
              chain: "base",
              assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
              assetDecimals: 6,
              grossBase: "1000000",
              netBase: "980000",
              feeBase: "20000",
              state: "reserved",
              deliveryState: "held",
              transactionId: null,
              submittedTransactionId: null,
            },
          ],
          balances: [],
          monthlyAwards: [],
          directTransfers: [],
          walletObservations: [],
        },
      });
    const body = route.request().postDataJSON();
    expect(body.claimId).toBe("claim");
    expect(body.vault).toBe(vault);
    expect(body.network).toBe("base-mainnet");
    if (path.endsWith("/bind-challenge"))
      return route.fulfill({
        json: {
          claimId: "claim",
          typedData:
            fault === "domain"
              ? {
                  ...typed,
                  domain: {
                    ...typed.domain,
                    verifyingContract: `0x${"3".repeat(40)}`,
                  },
                }
              : typed,
        },
      });
    expect(path.endsWith("/bind-authorize")).toBe(true);
    expect(body.expectedVersion).toBe("7");
    expect(
      verifyEvmBindingSignature(8453n, vault, binding, body.signature),
    ).toBe(true);
    authorized++;
    return route.fulfill({
      json: { authorized: true, expiresAt: binding.expiresAt },
    });
  });
  await page.route("**/api/v1/referrals/me", (route) =>
    route.fulfill({ json: { enabled: false } }),
  );
  await page.goto("/earnings", { waitUntil: "networkidle" });
  return () => authorized;
}

test("payout rows distinguish test networks and retain exact award details at 200% text", async ({
  page,
}, info) => {
  const token = `0x${"7".repeat(40)}`;
  const amount = "120,987,653,232,098,764.560987653232098764";
  const netBase = "120987653232098764560987653232098764";
  const payment = {
    vault,
    projectId: "eliza",
    chain: "base",
    assetAddress: token,
    assetDecimals: 18,
    grossBase: "123456789012345678123456789012345678",
    netBase,
    feeBase: "2469135780246913562469135780246914",
    state: "reserved",
    transactionId: null,
    submittedTransactionId: null,
  };
  const writes: string[] = [];
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({
      json: { session: { githubId: "123", githubLogin: "qa", admin: false } },
    }),
  );
  await page.route("**/api/v1/project-appeals", (route) =>
    route.fulfill({ json: { appeals: [] } }),
  );
  await page.route("**/api/v1/payments/**", (route) => {
    if (route.request().method() !== "GET")
      writes.push(route.request().method());
    return route.fulfill({
      json: {
        githubUserId: "123",
        wallets: [],
        payments: [
          {
            ...payment,
            id: "a".repeat(64),
            network: "base-mainnet",
            deliveryState: "needs_wallet",
          },
          {
            ...payment,
            id: "b".repeat(64),
            network: "base-sepolia",
            deliveryState: "held",
          },
        ],
        monthlyAwards: [],
        balances: [],
        directTransfers: [],
        walletObservations: [],
      },
    });
  });
  await page.route("**/api/v1/referrals/me", (route) =>
    route.fulfill({ json: { enabled: false } }),
  );
  await page.goto("/earnings", { waitUntil: "networkidle" });
  const rows = page.locator(".payout-row");
  await expect(rows).toHaveCount(2);
  for (const [index, network, state] of [
    [0, "Base", "Awaiting wallet"],
    [1, "Base Sepolia (test)", "Held"],
  ] as const) {
    const row = rows.nth(index);
    await expect(row.locator(".payout-main")).toContainText(network);
    await expect(
      row
        .locator(".payout-main")
        .getByRole("link", { name: "eliza", exact: true }),
    ).toHaveAttribute("href", "/projects/eliza");
    await expect(row.getByText(amount, { exact: true })).toBeVisible();
    await expect(row.getByText(token, { exact: true })).toBeVisible();
    await expect(row.locator(".payout-pill")).toHaveText(state);
    await expect(row.locator(".payout-amount small")).toContainText("Gross");
    await expect(row.locator(".payout-amount small")).toContainText(
      "fee 2,469,135,780,246,913.562469135780246914",
    );
  }
  await enlargeText(page.locator(".earnings-page"));
  for (const row of await rows.all()) {
    for (const label of ["Exact amount", "Gross amount", "Fee amount"]) {
      const region = row.getByRole("region", { name: label, exact: true });
      expect(
        await region.evaluate((node) => {
          const range = document.createRange();
          range.selectNodeContents(node);
          return new Set(
            [...range.getClientRects()].map((rect) => Math.round(rect.top)),
          ).size;
        }),
      ).toBe(1);
      await region.focus();
      await expect(region).toBeFocused();
      if (
        await region.evaluate((node) => node.scrollWidth > node.clientWidth)
      ) {
        await page.keyboard.press("ArrowRight");
        await expect
          .poll(() => region.evaluate((node) => node.scrollLeft))
          .toBeGreaterThan(0);
      }
    }
    expect(
      await row.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await expectAccessible(page);
  expect(writes).toEqual([]);
  await page.screenshot({
    path: info.outputPath("payout-network-and-amounts-200.png"),
    fullPage: true,
  });
});

test("a recipient reviews the exact vault and signs consent without claiming payment", async ({
  page,
}, info) => {
  const authorized = await setup(page);
  await expect(
    page
      .locator(".payout-row")
      .getByRole("link", { name: "eliza", exact: true }),
  ).toHaveAttribute("href", "/projects/eliza");
  const gross = page.getByRole("region", { name: "Gross amount", exact: true });
  const fee = page.getByRole("region", { name: "Fee amount", exact: true });
  await expect(gross).toBeVisible();
  await expect(gross).toHaveText("Gross 1 USDC");
  await expect(fee).toBeVisible();
  await expect(fee).toHaveText("fee 0.02 USDC");
  await page.getByRole("button", { name: "Authorize payout wallet" }).click();
  const review = page.getByRole("dialog", {
    name: "Authorize payout wallet",
  });
  await expect(review.getByText(vault, { exact: true })).toBeVisible();
  await expect(
    review.getByText(recipient.address, { exact: true }),
  ).toBeVisible();
  await expect(review).toContainText("Base");
  await expect(page.getByText("Paid", { exact: true })).toHaveCount(0);
  const restoreText = await enlargeText(review);
  await expect(review.getByText(vault, { exact: true })).toBeVisible();
  await expect(
    review.getByText(recipient.address, { exact: true }),
  ).toBeVisible();
  expect(
    await review.evaluate(
      (element) => element.scrollWidth - element.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await expectAccessible(page);
  await page.screenshot({
    path: info.outputPath("payout-consent-review.png"),
    fullPage: true,
  });
  await restoreText();
  await expect(
    review.getByRole("heading", { name: "Authorize payout wallet" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Sign with Browser wallet" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("status").filter({ hasText: "Wallet consent saved" }),
  ).toBeVisible();
  expect(authorized()).toBe(1);
  await expect(page.getByText("Paid", { exact: true })).toHaveCount(0);
  await expect(page.locator(".payout-pill", { hasText: "Held" })).toBeVisible();
});

for (const fault of ["account", "domain", "reject"] as const) {
  test(`payout consent preserves the award after ${fault} failure`, async ({
    page,
  }) => {
    const authorized = await setup(page, fault);
    await page.getByRole("button", { name: "Authorize payout wallet" }).click();
    await page
      .getByRole("button", { name: "Sign with Browser wallet" })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      fault === "account"
        ? "account changed"
        : fault === "domain"
          ? "different account"
          : "rejected",
    );
    expect(authorized()).toBe(0);
    await expect(
      page.locator(".payout-pill", { hasText: "Held" }),
    ).toBeVisible();
  });
}

// Solana Wallet Standard co-signing preserves the attester's immutable wire message.
test("Solana recipient co-signs only the prepared binding and waits for payment finality", async ({
  page,
}) => {
  const { ed25519 } = await import("@noble/curves/ed25519.js");
  const { solanaBase58 } = await import("../../contracts/solana/adapter");
  const { bytes, encoder, instructionData, le, message, pda, SYSTEM } =
    await import("../../contracts/solana/transactions");
  const key = (n: number) =>
    solanaBase58(ed25519.getPublicKey(new Uint8Array(32).fill(n)));
  const context = {
    vault: key(8),
    programId: key(3),
    projectPda: key(4),
    networkDomain: "a".repeat(64),
    githubUserId: "123",
    destination: key(2),
    claimDigest: "c".repeat(64),
  };
  const attester = key(1);
  const msg = message(
    attester,
    key(7),
    [
      {
        program: context.programId,
        accounts: [
          { key: attester, write: true },
          { key: attester, write: false },
          { key: context.destination, write: false },
          { key: context.projectPda, write: false },
          {
            key: pda(context.programId, [
              encoder.encode("wallet"),
              bytes(context.projectPda),
              le(123n),
            ]),
            write: true,
          },
          { key: SYSTEM, write: false },
        ],
        data: instructionData(
          "bind_wallet",
          le(123n),
          new Uint8Array(32).fill(0xaa),
          le(0n),
          new Uint8Array(32).fill(0xcc),
          le(2000000000n),
        ),
      },
    ],
    [context.destination],
  );
  const prepared = new Uint8Array([
    2,
    ...ed25519.sign(msg, new Uint8Array(32).fill(1)),
    ...new Uint8Array(64),
    ...msg,
  ]);
  const signed = prepared.slice();
  signed.set(ed25519.sign(msg, new Uint8Array(32).fill(2)), 65);
  await page.addInitScript(
    ({ address, pub, prepared, signed }) => {
      const account = {
        address,
        publicKey: Uint8Array.from(pub),
        chains: ["solana:mainnet"],
        features: ["solana:signMessage", "solana:signTransaction"],
      };
      const wallet = {
        name: "Binding test wallet",
        version: "1.0.0",
        icon: "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E",
        chains: ["solana:mainnet"],
        accounts: [account],
        features: {
          "standard:connect": {
            version: "1.0.0",
            connect: async () => ({ accounts: [account] }),
          },
          "solana:signMessage": {
            version: "1.0.0",
            signMessage: async () => {
              throw new Error("Unexpected personal signature");
            },
          },
          "solana:signTransaction": {
            version: "1.0.0",
            supportedTransactionVersions: ["legacy"],
            signTransaction: async ({
              transaction,
            }: {
              transaction: Uint8Array;
            }) => {
              if (
                transaction.length !== prepared.length ||
                transaction.some((b, i) => b !== prepared[i])
              )
                throw new Error("Wrong transaction");
              return [{ signedTransaction: Uint8Array.from(signed) }];
            },
          },
        },
      };
      window.addEventListener("wallet-standard:app-ready", (event) =>
        (event as CustomEvent).detail.register(wallet),
      );
    },
    {
      address: context.destination,
      pub: Array.from(bytes(context.destination)),
      prepared: Array.from(prepared),
      signed: Array.from(signed),
    },
  );
  let completed = 0;
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({
      json: { session: { githubId: "123", githubLogin: "qa", admin: false } },
    }),
  );
  await page.route("**/api/v1/project-appeals", (route) =>
    route.fulfill({ json: { appeals: [] } }),
  );
  await page.route("**/api/v1/payments/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/me"))
      return route.fulfill({
        json: {
          githubUserId: "123",
          wallets: [
            {
              chain: "solana",
              claimId: "claim",
              address: context.destination,
              authorized: true,
            },
          ],
          payments: [
            {
              id: "a".repeat(64),
              vault: context.vault,
              projectId: "eliza",
              network: "solana-mainnet",
              chain: "solana",
              assetAddress: key(9),
              assetDecimals: 6,
              grossBase: "1000000",
              netBase: "980000",
              feeBase: "20000",
              state: "reserved",
              deliveryState: "held",
              transactionId: null,
              submittedTransactionId: null,
            },
          ],
          balances: [],
          monthlyAwards: [],
          directTransfers: [],
          walletObservations: [],
        },
      });
    expect(route.request().postDataJSON().obligationId).toBe("a".repeat(64));
    if (path.endsWith("/prepare"))
      return route.fulfill({
        json: {
          transactionId: solanaBase58(prepared.slice(1, 65)),
          transaction: Buffer.from(prepared).toString("base64"),
          bindingContext: context,
        },
      });
    expect(route.request().postDataJSON().transaction).toBe(
      Buffer.from(signed).toString("base64"),
    );
    completed++;
    return route.fulfill({
      json: { transactionId: solanaBase58(prepared.slice(1, 65)) },
    });
  });
  await page.route("**/api/v1/referrals/me", (route) =>
    route.fulfill({ json: { enabled: false } }),
  );
  await page.goto("/earnings", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Authorize payout wallet" }).click();
  await page
    .getByRole("button", { name: "Sign with Binding test wallet" })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Binding submitted" }),
  ).toBeVisible();
  expect(completed).toBe(1);
  await expect(page.getByText("Paid", { exact: true })).toHaveCount(0);
});

test("payout consent remains readable with enlarged text and Escape restores the initiating control", async ({
  page,
}) => {
  await setup(page);
  await page.addStyleTag({ content: "html { font-size: 200%; }" });
  const action = page.getByRole("button", { name: "Authorize payout wallet" });
  await action.click();
  const dialog = page.getByRole("dialog", {
    name: "Authorize payout wallet",
  });
  const bounds = await dialog.boundingBox();
  const viewport = page.viewportSize();
  if (!bounds || !viewport)
    throw new Error("Consent dialog geometry is unavailable.");
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(action).toBeFocused();
});
