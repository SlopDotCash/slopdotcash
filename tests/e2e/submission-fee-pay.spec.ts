/**
 * The contributor pay page of the refundable submission fee,
 * `/fee/<owner>/<repo>/<number>` (operator decision, 19 November 2026; PRD
 * section 5). The fee is switched off in every deployed bundle, so the first
 * test runs the page exactly as it ships. The others switch it on through the
 * browser-test build's seam and pay with a wallet whose every request the
 * test reads. `submission-fee-pay-chain.spec.ts` pays the real contract on a
 * local chain.
 */
import {
  SUBMISSION_FEE_BURN,
  SUBMISSION_FEE_CONTRACTS,
  SUBMISSION_FEE_KEPT_TO,
  SUBMISSION_FEE_SWITCHED_ON,
  SUBMISSION_FEE_TOKENS,
} from "../../src/lib/submission-fee.mjs";
import { expect, expectAccessibleReflow, test } from "./fixtures";
import {
  expectedCalls,
  FEE_RATE_REPLY,
  type FeeRecord,
  feeRecord,
  installWallet,
  scriptedWallet,
  serveFeeRecord,
  switchFeeOn,
} from "./submission-fee-pay-fixture";

// The frozen fixture registry records elizaOS/eliza under this GitHub id.
const REPOSITORY = 826170402;
const PAGE = "/fee/elizaOS/eliza/7";
const PAYER = "0x00000000000000000000000000000000000000aa";
const CONTRACT = SUBMISSION_FEE_CONTRACTS["base-mainnet"] as string;

test.beforeEach(async ({ diagnostics }) => {
  diagnostics.allowPreviewApiMisses();
});

test("the page as it ships says the fee is not switched on and offers no way to pay", async ({
  page,
}) => {
  // The deployed switch itself; a change to it must change this test.
  expect(SUBMISSION_FEE_SWITCHED_ON).toBe(false);
  await serveFeeRecord(page, REPOSITORY, 7, () => feeRecord(REPOSITORY, 7));
  await installWallet(page, scriptedWallet(PAYER).answer);
  await page.goto(PAGE, { waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", { level: 1, name: "Submission fee" }),
  ).toBeVisible();
  await expect(page).toHaveTitle("Submission fee · Slop");
  await expect(
    page.getByText("The submission fee is not switched on.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("the fee is not switched on, so nothing is asked", {
      exact: false,
    }),
  ).toBeVisible();
  // Nothing to pay with: no amount, no contract, no wallet control.
  await expect(page.getByRole("button", { name: /pay|connect/iu })).toHaveCount(
    0,
  );
  await expect(page.getByRole("heading", { name: "Fee due" })).toHaveCount(0);
  await expect(page.getByText(CONTRACT, { exact: false })).toHaveCount(0);
  await expectAccessibleReflow(page, "fee-switched-off");
});

test("Pages rewrites the pay address to the app and serves the stored fee read", {
  tag: ["@pages", "@pages-only"],
}, async ({ diagnostics, page, request }) => {
  // The real route on the local Pages database: no fee was asked for anything.
  const path = `/api/v1/submission-fee/items/${REPOSITORY}/7`;
  const read = await request.get(path);
  expect(read.status()).toBe(404);
  expect(await read.json()).toEqual({ error: "not_found" });
  diagnostics.allowResponse(404, "GET", path);
  for (const address of [PAGE, `${PAGE}/`]) {
    const response = await page.goto(address, { waitUntil: "networkidle" });
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: "Submission fee" }),
    ).toBeVisible();
    await expect(
      page.getByText("The submission fee is not switched on.", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Slop has not asked a submission fee for this pull request. No fee is due.",
        { exact: true },
      ),
    ).toBeVisible();
  }
});

test("a pull request with no fee, an unlisted repository and a bad address each say so", async ({
  diagnostics,
  page,
}) => {
  await switchFeeOn(page);
  diagnostics.allowResponse(
    404,
    "GET",
    `/api/v1/submission-fee/items/${REPOSITORY}/9`,
  );
  const reads = await serveFeeRecord(page, REPOSITORY, 9, () => null);
  await page.goto("/fee/elizaos/ELIZA/9", { waitUntil: "networkidle" });
  // The registry's own spelling names the pull request and links it.
  await expect(
    page.getByRole("link", { name: "elizaOS/eliza #9", exact: true }),
  ).toHaveAttribute("href", "https://github.com/elizaOS/eliza/pull/9");
  await expect(
    page.getByText(
      "Slop has not asked a submission fee for this pull request. No fee is due.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(reads()).toBe(1);
  await expect(page.getByRole("button", { name: /pay|connect/iu })).toHaveCount(
    0,
  );

  let unlisted = 0;
  await page.route("**/api/v1/submission-fee/**", (route) => {
    unlisted += 1;
    return route.abort();
  });
  await page.goto("/fee/someone/unlisted/3", { waitUntil: "networkidle" });
  await expect(
    page.getByText(
      "someone/unlisted is not a repository of a project on Slop, so no submission fee is due for this pull request.",
      { exact: true },
    ),
  ).toBeVisible();
  // No repository id, so nothing is looked up.
  expect(unlisted).toBe(0);

  await page.goto("/fee/elizaOS/eliza/0", { waitUntil: "networkidle" });
  await expect(
    page.getByText("This address does not name a pull request.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(unlisted).toBe(0);
});

test("a fee due lists each way to pay, the terms and the one contract before any wallet is chosen", async ({
  page,
}) => {
  await switchFeeOn(page);
  await serveFeeRecord(page, REPOSITORY, 7, () => feeRecord(REPOSITORY, 7));
  await installWallet(page, scriptedWallet(PAYER).answer);
  await page.goto(PAGE, { waitUntil: "networkidle" });
  await expect(
    page.getByText("The submission fee is not switched on.", { exact: false }),
  ).toHaveCount(0);
  const due = page.getByRole("region", { name: "Fee due" });
  await expect(due.getByRole("listitem")).toHaveText([
    "2 USDC on Base",
    "2 USDG on Robinhood Chain",
    /^75 SLOP on Robinhood Chain\. The SLOP amount follows/u,
  ]);
  const terms = page.getByRole("region", { name: "What happens to a deposit" });
  for (const sentence of [
    "no maintainer has merged or closed it 14 days after the deposit",
    "stays closed for 7 days: USDC or USDG goes to Slop's fee wallet, and SLOP is sent to the burn address",
    "can take it back from the deposit contract 30 days after the deposit",
    "The only valid deposit contract is the address shown on this page and in Slopbot's comment",
    "An AI agent does not move money.",
  ])
    await expect(terms.getByText(sentence, { exact: false })).toBeVisible();
  await expect(terms.getByText(CONTRACT, { exact: true })).toBeVisible();
  // The terms come first: no wallet is asked for until the visitor chooses to pay.
  await expect(page.getByRole("button", { name: /connect/iu })).toHaveCount(0);
  await expectAccessibleReflow(page, "fee-due");
  await page
    .getByRole("button", { name: "Pay from a wallet", exact: true })
    .click();
  const pay = page.getByRole("region", { name: "Pay the fee" });
  await pay
    .getByRole("button", { name: "Connect MetaMask", exact: true })
    .click();
  await pay
    .getByRole("button", { name: "Review deposit", exact: true })
    .click();
  await expect(
    pay.getByRole("region", { name: "Review deposit" }),
  ).toContainText(CONTRACT);
  await expectAccessibleReflow(page, "fee-review");
});

test("a record that names another contract, token or destination is refused and nothing can be paid", async ({
  page,
}) => {
  await switchFeeOn(page);
  const attacker = "0x000000000000000000000000000000000000bEEF";
  let record = feeRecord(REPOSITORY, 7);
  await serveFeeRecord(page, REPOSITORY, 7, () => record);
  await installWallet(page, scriptedWallet(PAYER).answer);
  for (const change of [
    { contract: attacker },
    { keptTo: attacker },
    { token: attacker },
    { amount: "9000000" },
  ]) {
    record = feeRecord(REPOSITORY, 7);
    record.due[0] = { ...record.due[0], ...change };
    await page.goto(PAGE, { waitUntil: "networkidle" });
    await expect(page.getByRole("alert")).toContainText(
      "could not be checked against Slop's published addresses. Do not pay from this page.",
    );
    await expect(page.getByText(attacker, { exact: false })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /pay|connect/iu }),
    ).toHaveCount(0);
  }
  // The record of another pull request is not shown for this one.
  record = feeRecord(REPOSITORY, 8);
  await page.goto(PAGE, { waitUntil: "networkidle" });
  await expect(page.getByRole("alert")).toContainText("could not be checked");
});

test("a SLOP amount that is not the fee at Slop's published rate is refused, and without the rate SLOP is not offered", async ({
  diagnostics,
  page,
}) => {
  await switchFeeOn(page);
  let record = feeRecord(REPOSITORY, 7);
  let rate: unknown = FEE_RATE_REPLY;
  await serveFeeRecord(
    page,
    REPOSITORY,
    7,
    () => record,
    () => rate,
  );
  await installWallet(page, scriptedWallet(PAYER).answer);
  // Ten times the published amount, with or without a matching least amount.
  for (const change of [
    { amount: "750000000000000000000" },
    {
      amount: "750000000000000000000",
      minimumAccepted: "750000000000000000000",
    },
  ]) {
    record = feeRecord(REPOSITORY, 7);
    expect(record.due[2].symbol).toBe("SLOP");
    record.due[2] = { ...record.due[2], ...change };
    await page.goto(PAGE, { waitUntil: "networkidle" });
    await expect(page.getByRole("alert")).toContainText(
      "could not be checked against Slop's published addresses. Do not pay from this page.",
    );
    await expect(page.getByText("750 SLOP", { exact: false })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /pay|connect/iu }),
    ).toHaveCount(0);
  }
  // The rate changed between the two reads: the record names the previous
  // rate's amount, which is still published for its 48 hours.
  record = feeRecord(REPOSITORY, 7);
  rate = {
    ...FEE_RATE_REPLY,
    rate: { effectiveAt: "2026-12-05T12:00:00.000Z", slopPerUsd: "100" },
    previous: {
      ...FEE_RATE_REPLY.rate,
      acceptedUntil: "2026-12-07T12:00:00.000Z",
    },
  };
  await page.goto(PAGE, { waitUntil: "networkidle" });
  const due = page.getByRole("region", { name: "Fee due" });
  await expect(due.getByRole("listitem")).toHaveCount(3);
  await expect(due).toContainText("75 SLOP on Robinhood Chain");
  // After those 48 hours the same record is refused.
  rate = { ...(rate as typeof FEE_RATE_REPLY), previous: null };
  await page.goto(PAGE, { waitUntil: "networkidle" });
  await expect(page.getByRole("alert")).toContainText("could not be checked");

  // The rate route cannot be read: the stablecoin ways only, and a sentence why.
  rate = null;
  diagnostics.allowResponse(503, "GET", "/api/v1/submission-fee/rate");
  record = feeRecord(REPOSITORY, 7);
  record.due[2] = { ...record.due[2], amount: "750000000000000000000" };
  await page.goto(PAGE, { waitUntil: "networkidle" });
  await expect(due.getByRole("listitem")).toHaveText([
    "2 USDC on Base",
    "2 USDG on Robinhood Chain",
  ]);
  await expect(
    due.getByText("SLOP is not offered right now", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Pay from a wallet", exact: true })
    .click();
  const pay = page.getByRole("region", { name: "Pay the fee" });
  await pay
    .getByRole("button", { name: "Connect MetaMask", exact: true })
    .click();
  await expect(pay.getByRole("radio")).toHaveCount(2);
  await expect(pay.getByText("SLOP", { exact: false })).toHaveCount(0);
});

test("a wallet on another network approves, then deposits exactly the published call, and the page follows it to final", async ({
  page,
}) => {
  await switchFeeOn(page);
  let record = feeRecord(REPOSITORY, 7);
  const [usdc] = record.due;
  const { item } = record;
  const calls = expectedCalls(usdc, item);
  await serveFeeRecord(page, REPOSITORY, 7, () => record);
  const wallet = scriptedWallet(PAYER);
  await installWallet(page, wallet.answer);
  await page.goto(PAGE, { waitUntil: "networkidle" });
  await page
    .getByRole("button", { name: "Pay from a wallet", exact: true })
    .click();
  const pay = page.getByRole("region", { name: "Pay the fee" });
  await pay
    .getByRole("button", { name: "Connect MetaMask", exact: true })
    .click();
  await expect(pay.getByRole("radio")).toHaveCount(3);
  await expect(
    pay.getByRole("radio", { name: "2 USDC on Base", exact: true }),
  ).toBeChecked();
  // The wallet starts on Ethereum; reviewing asks it to move to Base.
  await pay
    .getByRole("button", { name: "Review deposit", exact: true })
    .click();
  const review = pay.getByRole("region", { name: "Review deposit" });
  await expect(review).toBeVisible();
  expect(wallet.state.switches).toEqual(["0x2105"]);
  for (const text of [
    "2 USDC",
    usdc.contract as string,
    usdc.token,
    SUBMISSION_FEE_KEPT_TO["base-mainnet"],
    PAYER,
  ])
    await expect(review.getByText(text, { exact: false })).toBeVisible();

  // A declined prompt sends nothing and leaves nothing saved.
  wallet.state.refuseNext = 4001;
  const approve = review.getByRole("button", {
    name: "Approve exact token amount in wallet",
    exact: true,
  });
  await approve.click();
  await expect(pay.getByRole("alert")).toHaveText(
    "You declined the wallet request. Nothing was sent.",
  );
  expect(wallet.state.sends).toEqual([]);

  // The approval is for the exact amount, to the published contract.
  await approve.click();
  await expect(
    pay.getByText("Token approval awaiting verification.", { exact: false }),
  ).toBeVisible();
  expect(wallet.state.sends).toEqual([{ from: PAYER, ...calls.approve }]);
  const approval = [...wallet.state.transactions.keys()][0];
  wallet.state.allowance = BigInt(usdc.amount);
  wallet.mine(approval);
  // It is checked without a click, and the deposit review opens by itself.
  const confirm = pay.getByRole("button", {
    name: "Confirm deposit in wallet",
    exact: true,
  });
  await expect(confirm).toBeVisible();
  await expect(
    pay.getByText("Token approval confirmed.", { exact: false }),
  ).toBeVisible();

  await confirm.click();
  await expect(
    pay.getByText("Deposit awaiting verification. Do not send it again.", {
      exact: true,
    }),
  ).toBeVisible();
  // Exactly the published contract, item, token, amount and kept-to address.
  expect(wallet.state.sends[1]).toEqual({ from: PAYER, ...calls.deposit });
  expect(wallet.state.sends).toHaveLength(2);
  const deposit = [...wallet.state.transactions.keys()][1];

  // In a block, not final: the page says it arrived and what still waits.
  wallet.mine(deposit, { way: usdc, item });
  await expect(pay.getByRole("status")).toContainText(
    "Deposit received in a Base block. Slop records the pull request as paid once that block is 30 blocks deep",
  );
  await expect(pay.getByRole("status")).toContainText(
    "A refund or a kept fee is sent only after Base finalizes the block.",
  );
  // Slop records it; the page reads the record again without a reload.
  record = {
    ...record,
    due: [],
    paid: {
      at: "2026-12-05T12:01:00.000Z",
      network: "base-mainnet",
      depositId: 1,
      token: usdc.token,
      amount: usdc.amount,
      transaction: deposit,
      finalized: false,
    },
  };
  const paid = page.getByRole("region", { name: "Payment recorded" });
  await expect(paid).toContainText("2 USDC on Base", { timeout: 30_000 });
  await expect(paid).toContainText("Its block is not final yet.");
  await expect(paid).toContainText(
    "held by the deposit contract until this pull request is decided",
  );
  await expect(page.getByRole("heading", { name: "Fee due" })).toHaveCount(0);

  // Final on chain: the saved request is finished.
  wallet.state.finalized = wallet.state.head;
  record = {
    ...record,
    paid: record.paid && { ...record.paid, finalized: true },
  };
  await expect(pay.getByRole("status")).toContainText(
    "Deposit verified on the finalized Base chain.",
  );
  await expect(paid).toContainText("Its block is final.");
  await expect(
    paid.getByRole("link", { name: "Deposit transaction" }),
  ).toHaveAttribute("href", `https://basescan.org/tx/${deposit}`);
  expect(wallet.state.sends).toHaveLength(2);
});

test("a batching wallet pays SLOP in one request, and a deposit someone else already made stops a second one", async ({
  page,
}) => {
  await switchFeeOn(page);
  let record = feeRecord(REPOSITORY, 7);
  const slop = record.due[2];
  const { item } = record;
  const calls = expectedCalls(slop, item);
  expect(slop.keptTo).toBe(SUBMISSION_FEE_BURN);
  expect(slop.token).toBe(SUBMISSION_FEE_TOKENS["robinhood-mainnet"].slop);
  await serveFeeRecord(page, REPOSITORY, 7, () => record);
  const wallet = scriptedWallet(PAYER);
  wallet.state.atomic = true;
  wallet.state.chainId = 4663;
  await installWallet(page, wallet.answer);
  await page.goto(PAGE, { waitUntil: "networkidle" });
  await page
    .getByRole("button", { name: "Pay from a wallet", exact: true })
    .click();
  const pay = page.getByRole("region", { name: "Pay the fee" });
  await pay
    .getByRole("button", { name: "Connect MetaMask", exact: true })
    .click();
  await pay
    .getByRole("radio", { name: "75 SLOP on Robinhood Chain", exact: true })
    .check();
  await pay
    .getByRole("button", { name: "Review deposit", exact: true })
    .click();
  const review = pay.getByRole("region", { name: "Review deposit" });
  await expect(review).toContainText("the burn address");
  await expect(review).toContainText(SUBMISSION_FEE_BURN);
  expect(wallet.state.switches).toEqual([]);
  const both = review.getByRole("button", {
    name: "Approve and deposit in wallet",
    exact: true,
  });

  // The record is read again before the wallet is asked. Someone else paid.
  const unpaid = record;
  record = {
    ...record,
    due: [],
    paid: {
      at: "2026-12-05T12:01:00.000Z",
      network: "base-mainnet",
      depositId: 4,
      token: unpaid.due[0].token,
      amount: unpaid.due[0].amount,
      transaction: `0x${"c".repeat(64)}`,
      finalized: true,
    },
  };
  await both.click();
  await expect(pay.getByRole("alert")).toHaveText(
    "This pull request is already recorded as paid. Nothing was sent.",
  );
  expect(wallet.state.batches).toEqual([]);
  expect(wallet.state.sends).toEqual([]);
  await expect(
    page.getByRole("region", { name: "Payment recorded" }),
  ).toContainText("2 USDC on Base");

  // Unpaid again: one atomic request carries the approval and the deposit.
  record = unpaid;
  await page.reload({ waitUntil: "networkidle" });
  await page
    .getByRole("button", { name: "Pay from a wallet", exact: true })
    .click();
  await pay
    .getByRole("button", { name: "Connect MetaMask", exact: true })
    .click();
  await pay
    .getByRole("radio", { name: "75 SLOP on Robinhood Chain", exact: true })
    .check();
  await pay
    .getByRole("button", { name: "Review deposit", exact: true })
    .click();
  await both.click();
  await expect(
    pay.getByText("Deposit awaiting verification. Do not send it again.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(wallet.state.sends).toEqual([]);
  expect(wallet.state.batches).toEqual([
    {
      version: "2.0.0",
      from: PAYER,
      chainId: "0x1237",
      atomicRequired: true,
      calls: [calls.approve, calls.deposit],
    },
  ]);
  // The wallet's "confirmed" names the transaction; the event proves it.
  const transaction = wallet.nextHash();
  wallet.mine(transaction, { way: slop, item });
  wallet.state.batchStatus = {
    status: 200,
    receipts: [{ transactionHash: transaction }],
  };
  await expect(pay.getByRole("status")).toContainText(
    "Deposit received in a Robinhood Chain block. Slop records the pull request as paid once that block is 1200 blocks deep",
  );
  wallet.state.finalized = wallet.state.head;
  await expect(pay.getByRole("status")).toContainText(
    "Deposit verified on the finalized Robinhood Chain chain.",
  );
  expect(wallet.state.batches).toHaveLength(1);
  // Final on chain, not recorded by Slop yet: no second payment is offered,
  // also after a reload.
  const waiting = pay.getByText(
    "The deposit from this browser tab is final on chain, and Slop has not recorded it yet.",
    { exact: false },
  );
  await expect(waiting).toBeVisible();
  await expect(waiting).toContainText("Do not pay again.");
  await expect(
    pay.getByRole("button", { name: /review|connect/iu }),
  ).toHaveCount(0);
  await page.reload({ waitUntil: "networkidle" });
  await page
    .getByRole("button", { name: "Pay from a wallet", exact: true })
    .click();
  await expect(waiting).toBeVisible();
  await expect(
    pay.getByRole("button", { name: /review|connect/iu }),
  ).toHaveCount(0);
  expect(wallet.state.batches).toHaveLength(1);
});

test("a recorded payment and its outcome are shown, also while the fee is switched off", async ({
  page,
}) => {
  const base = feeRecord(REPOSITORY, 7);
  const deposit = `0x${"d".repeat(64)}`;
  const resolve = `0x${"e".repeat(64)}`;
  let record: FeeRecord = {
    ...base,
    due: [],
    paid: {
      at: "2026-12-01T11:00:00.000Z",
      network: "robinhood-mainnet",
      depositId: 12,
      token: base.due[2].token,
      amount: base.due[2].amount,
      transaction: deposit,
      finalized: true,
    },
    outcome: "kept",
    outcomeAt: "2026-12-09T11:00:00.000Z",
    resolveTransaction: resolve,
  };
  await serveFeeRecord(page, REPOSITORY, 7, () => record);
  // As deployed: switched off. The record of a payment already made still reads.
  await page.goto(PAGE, { waitUntil: "networkidle" });
  await expect(
    page.getByText("The submission fee is not switched on.", { exact: false }),
  ).toBeVisible();
  const paid = page.getByRole("region", { name: "Payment recorded" });
  await expect(paid).toContainText(
    "75 SLOP on Robinhood Chain, recorded Dec 1, 2026 as deposit 12. Its block is final.",
  );
  await expect(paid).toContainText(
    "The deposit was kept: the SLOP was sent to the burn address.",
  );
  await expect(
    paid.getByRole("link", { name: "Kept transaction" }),
  ).toHaveAttribute("href", new RegExp(`/tx/${resolve}$`, "u"));
  await expect(page.getByRole("button", { name: /pay|connect/iu })).toHaveCount(
    0,
  );
  await expectAccessibleReflow(page, "fee-paid");

  record = {
    ...record,
    paid: record.paid && {
      ...record.paid,
      network: "base-mainnet",
      token: base.due[0].token,
      amount: base.due[0].amount,
    },
    outcome: "refunded",
  };
  await page.reload({ waitUntil: "networkidle" });
  await expect(paid).toContainText("2 USDC on Base");
  await expect(paid).toContainText(
    "The deposit was sent back to the wallet that paid it.",
  );
  await expect(
    paid.getByRole("link", { name: "Refund transaction" }),
  ).toHaveAttribute("href", `https://basescan.org/tx/${resolve}`);
  record = { ...record, outcome: "refund_due", resolveTransaction: null };
  await page.reload({ waitUntil: "networkidle" });
  await expect(paid).toContainText(
    "The deposit is due back to the wallet that paid it.",
  );
});
