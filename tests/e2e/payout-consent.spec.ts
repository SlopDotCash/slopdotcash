/** Real page + deterministic wallet/API fixtures. Live chain acceptance is recorded separately. */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { privateKeyToAccount } from "viem/accounts";
import { verifyEvmBindingSignature } from "../../backend/payments/possession";
import { evmBindingTypedData } from "../../contracts/evm/adapter";

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
  await page.goto("/earnings", { waitUntil: "networkidle" });
  return () => authorized;
}

test("a recipient reviews the exact vault and signs consent without claiming payment", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const authorized = await setup(page);
  await page.getByRole("button", { name: "Authorize payout wallet" }).click();
  const review = page.getByRole("region", {
    name: "Review payout wallet consent",
  });
  await expect(review).toContainText(vault);
  await expect(review).toContainText(recipient.address);
  await expect(review).toContainText("Base");
  await expect(
    page.getByText("Paid, verified on chain", { exact: true }),
  ).toHaveCount(0);
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(violations).toEqual([]);
  await page.screenshot({
    path: info.outputPath("payout-consent-review.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Sign with Browser wallet" }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("status").filter({ hasText: "Wallet consent saved" }),
  ).toBeVisible();
  expect(authorized()).toBe(1);
  await expect(
    page.getByText("Paid, verified on chain", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("cell", { name: /^Held, funds remain reserved/ }),
  ).toBeVisible();
  expect(errors).toEqual([]);
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
      page.getByRole("cell", { name: /^Held, funds remain reserved/ }),
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
  await page.goto("/earnings", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Authorize payout wallet" }).click();
  await page
    .getByRole("button", { name: "Sign with Binding test wallet" })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Binding submitted" }),
  ).toBeVisible();
  expect(completed).toBe(1);
  await expect(
    page.getByText("Paid, verified on chain", { exact: true }),
  ).toHaveCount(0);
});
