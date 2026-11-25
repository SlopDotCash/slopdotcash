/**
 * The Solana way to pay on the contributor pay page (operator decision,
 * 25 November 2026; PRD section 6, "Submission fee deposits", "Solana, off
 * chain"). No deployed bundle offers it: the program id is not published and
 * Solana is switched off. The tests set both through the browser-test
 * build's seam and pay with a wallet whose one request the test reads and
 * signs with a fixture key. The API that prepares the transaction is served
 * here from the same message builder the page checks it against.
 */
import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import type { Page } from "@playwright/test";
import { solanaBase58 } from "../../contracts/solana/adapter";
import { encodeBase64 } from "../../src/lib/byte-encoding";
import { solanaFeeMessage } from "../../src/lib/solana-fee-deposit";
import {
  SUBMISSION_FEE_CONTRACTS,
  SUBMISSION_FEE_KEPT_TO,
  SUBMISSION_FEE_SOLANA_RENT_LAMPORTS,
  SUBMISSION_FEE_SOLANA_SWITCHED_ON,
  SUBMISSION_FEE_TOKENS,
  type SubmissionFeeTerms,
} from "../../src/lib/submission-fee.mjs";
import { publishedSolanaWay } from "../../src/lib/submission-fee-page";
import { expect, expectAccessibleReflow, test } from "./fixtures";
import {
  feeRecord,
  serveFeeRecord,
  switchFeeOn,
} from "./submission-fee-pay-fixture";

// The frozen fixture registry records elizaOS/eliza under this GitHub id.
const REPOSITORY = 826170402;
const PAGE = "/fee/elizaOS/eliza/7";
const NETWORK = "solana-mainnet";
// A valid address that stands for the program; nothing is deployed there.
const PROGRAM = "HgkeEAe63g7pDbvKsXXh8rSStM8Nw5z4eiYapVMKCt9t";
const seed = createHash("sha256").update("slop-fee-solana-browser").digest();
const WALLET = solanaBase58(ed25519.getPublicKey(seed));
const BLOCKHASH = solanaBase58(new Uint8Array(32).fill(7));
const TABLES = {
  contracts: { ...SUBMISSION_FEE_CONTRACTS, [NETWORK]: PROGRAM },
  solanaOn: true,
} satisfies SubmissionFeeTerms;
const way = (() => {
  const offered = publishedSolanaWay("2000000", {
    tokens: SUBMISSION_FEE_TOKENS,
    keptTo: SUBMISSION_FEE_KEPT_TO,
    burn: "",
    chainIds: {},
    ...TABLES,
  });
  if (!offered) throw new Error("The fixture tables offer no Solana way");
  return offered;
})();

type Request = { step: string; wallet: string; nonce?: string };

/**
 * Serves `POST /api/v1/submission-fee/solana` and a wallet that signs what
 * it is handed. `tamper` changes the prepared deposit's kept wallet, as a
 * dishonest or broken API would.
 */
async function serveSolana(page: Page, options: { tamper?: boolean } = {}) {
  const state = {
    requests: [] as Request[],
    signed: [] as Uint8Array[],
    status: "pending" as "pending" | "finalized" | "failed",
  };
  await page.route("**/api/v1/submission-fee/solana", async (route) => {
    const body = route.request().postDataJSON() as Request;
    state.requests.push(body);
    if (body.step === "check")
      return route.fulfill({ json: { status: state.status } });
    if (body.step === "reclaim-review")
      return route.fulfill({
        status: 422,
        json: {
          error: "no_open_deposit",
          message:
            "No deposit from this wallet for this pull request is still held by the deposit program.",
        },
      });
    const item = feeRecord(REPOSITORY, 7).item;
    const message = solanaFeeMessage(
      options.tamper ? { ...way, keptTo: WALLET } : way,
      {
        wallet: body.wallet,
        item,
        nonce: BigInt(body.nonce as string),
        blockhash: BLOCKHASH,
      },
    );
    return route.fulfill({
      json: {
        plan: {
          wallet: body.wallet,
          nonce: body.nonce,
          amount: "2000000",
          rentLamports: SUBMISSION_FEE_SOLANA_RENT_LAMPORTS,
          blockhash: BLOCKHASH,
          lastValidBlockHeight: 1000,
          transaction: encodeBase64(
            Uint8Array.from([1, ...new Uint8Array(64), ...message]),
          ),
          networkFeeLamports: "5000",
        },
      },
    });
  });
  await page.exposeFunction("feeSolanaSend", (wire: number[]) => {
    const bytes = Uint8Array.from(wire);
    state.signed.push(bytes);
    return [...ed25519.sign(bytes.slice(65), seed)];
  });
  await page.addInitScript(
    ({ address, publicKey }) => {
      const account = {
        address,
        publicKey: Uint8Array.from(publicKey),
        chains: ["solana:mainnet"],
        features: ["solana:signMessage", "solana:signAndSendTransaction"],
      };
      let accounts: (typeof account)[] = [];
      const wallet = {
        name: "Fixture Solana wallet",
        version: "1.0.0",
        icon: "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E",
        chains: ["solana:mainnet"],
        get accounts() {
          return accounts;
        },
        features: {
          "standard:connect": {
            version: "1.0.0",
            connect: async () => {
              accounts = [account];
              return { accounts };
            },
          },
          "solana:signMessage": {
            version: "1.0.0",
            signMessage: async () => {
              throw new Error("Paying must not ask for a message signature");
            },
          },
          "solana:signAndSendTransaction": {
            version: "1.0.0",
            supportedTransactionVersions: ["legacy"],
            signAndSendTransaction: async (input: {
              transaction: Uint8Array;
              chain: string;
            }) => {
              if (input.chain !== "solana:mainnet")
                throw new Error("Unexpected chain");
              const signature = await (
                window as unknown as {
                  feeSolanaSend(wire: number[]): Promise<number[]>;
                }
              ).feeSolanaSend([...input.transaction]);
              return [{ signature: Uint8Array.from(signature) }];
            },
          },
        },
      };
      window.addEventListener("wallet-standard:app-ready", (event) =>
        (event as CustomEvent).detail.register(wallet),
      );
    },
    { address: WALLET, publicKey: [...ed25519.getPublicKey(seed)] },
  );
  return state;
}

test.beforeEach(({ diagnostics }) => {
  diagnostics.allowPreviewApiMisses();
});

test("no deployed bundle offers Solana, and the page then says nothing of it", async ({
  page,
}) => {
  // The deployed tables themselves; a change to them must change this test.
  expect(SUBMISSION_FEE_CONTRACTS[NETWORK]).toBeNull();
  expect(SUBMISSION_FEE_SOLANA_SWITCHED_ON).toBe(false);
  await switchFeeOn(page);
  await serveFeeRecord(page, REPOSITORY, 7, () => feeRecord(REPOSITORY, 7));
  await page.goto(PAGE, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Fee due" })).toBeVisible();
  await expect(page.getByText("Solana", { exact: false })).toHaveCount(0);
  await page.getByRole("button", { name: "Pay from a wallet" }).click();
  await expect(
    page.getByRole("heading", { name: "Pay from a wallet" }),
  ).toBeVisible();
  await expect(page.getByText("Solana", { exact: false })).toHaveCount(0);
});

test("a contributor pays 2 USDC on Solana with one wallet request the page built itself", async ({
  page,
}) => {
  await switchFeeOn(page, TABLES);
  const solana = await serveSolana(page);
  const record = { current: feeRecord(REPOSITORY, 7, TABLES) };
  expect(record.current.due.map((entry) => entry.network)).toContain(NETWORK);
  const reads = await serveFeeRecord(page, REPOSITORY, 7, () => record.current);
  await page.goto(PAGE, { waitUntil: "networkidle" });
  await expect(
    page.getByRole("listitem").filter({ hasText: "2 USDC on Solana" }),
  ).toBeVisible();
  // The terms name the one valid Solana program before any wallet is chosen.
  await expect(
    page.getByRole("region", { name: "What happens to a deposit" }),
  ).toContainText(PROGRAM);
  await page.getByRole("button", { name: "Pay from a wallet" }).click();
  const form = page.getByRole("region", { name: "Pay the fee on Solana" });
  await form.getByRole("button", { name: /Fixture Solana wallet/u }).click();
  // What the payer is told before signing.
  await expect(form).toContainText("about 0.002 SOL of rent");
  await expect(form).toContainText("whatever the outcome");
  await expect(form).toContainText("That account must still exist");
  await expect(form).toContainText("30 days after the");
  await form.getByRole("button", { name: "Review deposit" }).click();
  const review = form.getByRole("region", { name: "Review Solana deposit" });
  await expect(review).toContainText("2 USDC");
  await expect(review).toContainText(PROGRAM);
  await expect(review).toContainText(way.token);
  await expect(review).toContainText(SUBMISSION_FEE_KEPT_TO[NETWORK]);
  await expect(review).toContainText(WALLET);
  await expect(review).toContainText("0.00206712 SOL");
  await expectAccessibleReflow(page, "fee-solana-review");
  expect(solana.signed).toHaveLength(0);
  await review
    .getByRole("button", { name: "Confirm deposit in wallet" })
    .click();
  await expect(form).toContainText("Deposit awaiting verification");
  // One request, and exactly the message of the published tables.
  expect(solana.signed).toHaveLength(1);
  const asked = solana.requests.find((entry) => entry.step === "review");
  expect(asked?.wallet).toBe(WALLET);
  expect(Object.keys(asked ?? {}).sort()).toEqual([
    "nonce",
    "pullNumber",
    "repositoryId",
    "step",
    "wallet",
  ]);
  const expected = solanaFeeMessage(way, {
    wallet: WALLET,
    item: record.current.item,
    nonce: BigInt(asked?.nonce as string),
    blockhash: BLOCKHASH,
  });
  expect([...solana.signed[0].slice(65)]).toEqual([...expected]);
  // Final on Solana, then recorded by Slop.
  solana.status = "finalized";
  const before = reads();
  await form.getByRole("button", { name: "Check transaction" }).click();
  await expect(form).toContainText(
    "Deposit verified on the finalized Solana chain.",
  );
  await expect(form).toContainText("Do not pay again");
  await expect.poll(reads).toBeGreaterThan(before);
  expect(solana.signed).toHaveLength(1);
});

test("a prepared transaction that is not the page's own message is never handed to the wallet", async ({
  page,
}) => {
  await switchFeeOn(page, TABLES);
  const solana = await serveSolana(page, { tamper: true });
  await serveFeeRecord(page, REPOSITORY, 7, () =>
    feeRecord(REPOSITORY, 7, TABLES),
  );
  await page.goto(PAGE, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Pay from a wallet" }).click();
  const form = page.getByRole("region", { name: "Pay the fee on Solana" });
  await form.getByRole("button", { name: /Fixture Solana wallet/u }).click();
  await form.getByRole("button", { name: "Review deposit" }).click();
  await expect(form.getByRole("alert")).toContainText(
    "The prepared transaction differs from the reviewed deposit.",
  );
  await expect(
    form.getByRole("button", { name: "Confirm deposit in wallet" }),
  ).toHaveCount(0);
  expect(solana.signed).toHaveLength(0);
});

test("a wallet can ask to take a Solana deposit back whatever Slop recorded", async ({
  page,
  diagnostics,
}) => {
  // The route refuses with a reason, which the page shows.
  diagnostics.allowResponse(422, "POST", "/api/v1/submission-fee/solana");
  await switchFeeOn(page, TABLES);
  const solana = await serveSolana(page);
  await serveFeeRecord(page, REPOSITORY, 7, () =>
    feeRecord(REPOSITORY, 7, TABLES),
  );
  await page.goto(PAGE, { waitUntil: "networkidle" });
  // Nothing is recorded as paid: the reclaim is still one press away.
  await page
    .getByRole("button", { name: "Take back a Solana deposit" })
    .click();
  const form = page.getByRole("region", { name: "Pay the fee on Solana" });
  await expect(
    form.getByRole("heading", { name: "Take a Solana deposit back" }),
  ).toBeVisible();
  await form.getByRole("button", { name: /Fixture Solana wallet/u }).click();
  await expect(form).toContainText("30 days after it was made");
  await expectAccessibleReflow(page, "fee-solana-reclaim");
  await form
    .getByRole("button", { name: "Review taking the deposit back" })
    .click();
  // The wallet's deposits are looked for on chain, by the wallet alone.
  await expect(form.getByRole("alert")).toContainText(
    "No deposit from this wallet for this pull request is still held",
  );
  const asked = solana.requests.find(
    (entry) => entry.step === "reclaim-review",
  );
  expect(asked?.wallet).toBe(WALLET);
  expect(solana.signed).toHaveLength(0);
});
