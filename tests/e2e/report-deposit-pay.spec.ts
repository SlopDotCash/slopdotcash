/**
 * The pay page of the refundable SLOP deposit on a private security report,
 * `/fee/report/<caseId>` (operator decision, 21 November 2026; PRD section 8).
 * The deposit is switched off in every deployed bundle until Slop asks for
 * it. The tests set the switch through the browser-test build's seam, serve
 * the read route's record in the shape of the shared interface, and pay with
 * a wallet whose every request the test reads.
 */
import { reportDepositPayPath } from "../../src/lib/report-deposit-page";
import {
  REPORT_DEPOSIT_SWITCHED_ON,
  reportDepositItem,
} from "../../src/lib/security-report-deposit.mjs";
import {
  SUBMISSION_FEE_BURN,
  SUBMISSION_FEE_CONTRACTS,
  SUBMISSION_FEE_KEPT_TO,
  SUBMISSION_FEE_TOKENS,
} from "../../src/lib/submission-fee.mjs";
import { expect, expectAccessibleReflow, test } from "./fixtures";
import {
  expectedCalls,
  installWallet,
  type ReportDepositRecord,
  reportDepositRecord,
  scriptedWallet,
  serveReportDeposit,
  switchReportDeposit,
} from "./submission-fee-pay-fixture";

const CASE = "sc_0123456789abcdef";
const PAGE = reportDepositPayPath(CASE);
const PAYER = "0x00000000000000000000000000000000000000aa";
const CONTRACT = SUBMISSION_FEE_CONTRACTS["robinhood-mainnet"] as string;
const SLOP = SUBMISSION_FEE_TOKENS["robinhood-mainnet"].slop as string;

test.beforeEach(async ({ diagnostics }) => {
  diagnostics.allowPreviewApiMisses();
});

test("a bundle with the deposit switched off says so and offers no way to pay", async ({
  page,
}) => {
  // The deployed switch itself; a change to it must change this test.
  expect(REPORT_DEPOSIT_SWITCHED_ON).toBe(true);
  await switchReportDeposit(page, false);
  await serveReportDeposit(page, CASE, () => reportDepositRecord(CASE));
  await installWallet(page, scriptedWallet(PAYER).answer);
  await page.goto(PAGE, { waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", { level: 1, name: "Report deposit" }),
  ).toBeVisible();
  await expect(page).toHaveTitle("Report deposit · Slop");
  await expect(
    page.getByText("The report deposit is not switched on.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("the deposit is not switched on, so nothing is asked", {
      exact: false,
    }),
  ).toBeVisible();
  // Nothing to pay with: no amount, no contract, no wallet control.
  await expect(page.getByRole("button", { name: /pay|connect/iu })).toHaveCount(
    0,
  );
  await expect(page.getByRole("heading", { name: "Deposit due" })).toHaveCount(
    0,
  );
  await expect(page.getByText(CONTRACT, { exact: false })).toHaveCount(0);
  await expect(page.getByRole("main")).not.toContainText("395 SLOP");
  await expectAccessibleReflow(page, "report-deposit-switched-off");
});

test("Pages rewrites the report pay address to the app", {
  tag: ["@pages", "@pages-only"],
}, async ({ diagnostics, page }) => {
  // The local Pages backend has asked no deposit for anything, so the page's
  // one read answers 404.
  diagnostics.allowResponse(
    404,
    "GET",
    `/api/v1/submission-fee/reports/${CASE}`,
  );
  for (const address of [PAGE, `${PAGE}/`]) {
    const response = await page.goto(address, { waitUntil: "networkidle" });
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: "Report deposit" }),
    ).toBeVisible();
    // As deployed: switched off, and nothing was asked for this report.
    await expect(
      page.getByText("The report deposit is not switched on.", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Slop has not asked a deposit for this report. No deposit is due.",
        { exact: true },
      ),
    ).toBeVisible();
  }
});

test("a report with no deposit asked and a bad address each say so", async ({
  diagnostics,
  page,
}) => {
  await switchReportDeposit(page, true);
  diagnostics.allowResponse(
    404,
    "GET",
    `/api/v1/submission-fee/reports/${CASE}`,
  );
  const reads = await serveReportDeposit(page, CASE, () => null);
  await page.goto(PAGE, { waitUntil: "networkidle" });
  await expect(
    page.getByText(
      "Slop has not asked a deposit for this report. No deposit is due.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(reads()).toBe(1);
  await expect(page.getByRole("button", { name: /pay|connect/iu })).toHaveCount(
    0,
  );

  let looked = 0;
  await page.route("**/api/v1/submission-fee/**", (route) => {
    looked += 1;
    return route.abort();
  });
  for (const address of ["/fee/report/ss_0123456789abcdef", "/fee/report/x"]) {
    await page.goto(address, { waitUntil: "networkidle" });
    await expect(
      page.getByText("This address does not name a report.", { exact: true }),
    ).toBeVisible();
  }
  // Not a case id, so nothing is looked up.
  expect(looked).toBe(0);
});

test("a deposit due shows the exact SLOP amount, the terms and the one contract before any wallet is chosen, and names no project or report", async ({
  page,
}) => {
  await switchReportDeposit(page, true);
  await serveReportDeposit(page, CASE, () => reportDepositRecord(CASE));
  await installWallet(page, scriptedWallet(PAYER).answer);
  await page.goto(PAGE, { waitUntil: "networkidle" });
  await expect(
    page.getByText("The report deposit is not switched on.", { exact: false }),
  ).toHaveCount(0);
  const due = page.getByRole("region", { name: "Deposit due" });
  await expect(due).toContainText("395 SLOP on Robinhood Chain.");
  await expect(due).toContainText(
    "The report is already stored. It is screened once this deposit is recorded.",
  );
  const terms = page.getByRole("region", {
    name: "What happens to the deposit",
  });
  await expect(terms.getByRole("listitem")).toHaveCount(7);
  // When it is sent back, and when it is kept.
  await expect(terms.getByRole("listitem").nth(0)).toHaveText(
    "It is sent back to the wallet that paid it when the report gets its first response that is not one of the closes named next, or if 14 days pass after the deposit with no response, or if the project turns the deposit off.",
  );
  await expect(terms.getByRole("listitem").nth(1)).toHaveText(
    "It is kept only if the report is closed as spam, as a duplicate or as out of scope and that close stands for 7 days with no open appeal: the SLOP is then sent to the burn address, so neither Slop nor the project receives it.",
  );
  // It is public on chain, and what that shows.
  await expect(terms.getByRole("listitem").nth(2)).toHaveText(
    "The deposit is public on Robinhood Chain: it shows the wallet that paid, the amount and that it is a Slop deposit. It does not show the project or the report.",
  );
  for (const sentence of [
    "can take it back from the deposit contract 30 days after the deposit",
    "A deposit of another token, or of less than the amount shown here, does not count.",
    "The only valid deposit contract is the address shown on this page",
    "An AI agent does not move money.",
  ])
    await expect(terms.getByText(sentence, { exact: false })).toBeVisible();
  await expect(terms.getByText(CONTRACT, { exact: true })).toBeVisible();
  // The page names no project and no report: nothing links anywhere else.
  const main = page.getByRole("main");
  await expect(main.getByRole("link")).toHaveCount(0);
  await expect(main).not.toContainText(CASE);
  await expect(main).not.toContainText(/eliza/iu);
  // The terms come first: no wallet is asked for until the visitor chooses to pay.
  await expect(page.getByRole("button", { name: /connect/iu })).toHaveCount(0);
  await expectAccessibleReflow(page, "report-deposit-due");
  await page
    .getByRole("button", { name: "Pay from a wallet", exact: true })
    .click();
  const pay = page.getByRole("region", { name: "Pay the deposit" });
  await pay
    .getByRole("button", { name: "Connect MetaMask", exact: true })
    .click();
  // One way to pay.
  await expect(pay.getByRole("radio")).toHaveCount(1);
  await expect(
    pay.getByRole("radio", {
      name: "395 SLOP on Robinhood Chain",
      exact: true,
    }),
  ).toBeChecked();
  await pay
    .getByRole("button", { name: "Review deposit", exact: true })
    .click();
  const review = pay.getByRole("region", { name: "Review deposit" });
  for (const text of ["395 SLOP", CONTRACT, SLOP, SUBMISSION_FEE_BURN, PAYER])
    await expect(review.getByText(text, { exact: false })).toBeVisible();
  await expect(review).toContainText("the burn address");
  await expectAccessibleReflow(page, "report-deposit-review");
});

test("a record that names another contract, token, destination, network, case or a stablecoin is refused and nothing can be paid", async ({
  page,
}) => {
  await switchReportDeposit(page, true);
  const attacker = "0x000000000000000000000000000000000000bEEF";
  let record = reportDepositRecord(CASE);
  await serveReportDeposit(page, CASE, () => record);
  await installWallet(page, scriptedWallet(PAYER).answer);
  for (const change of [
    { contract: attacker },
    { keptTo: attacker },
    // Slop's fee wallet never receives a report deposit.
    { keptTo: SUBMISSION_FEE_KEPT_TO["robinhood-mainnet"] },
    { token: attacker },
    {
      token: SUBMISSION_FEE_TOKENS["robinhood-mainnet"].usdg as string,
      symbol: "USDG",
      decimals: 6,
      amount: "5000000",
      keptTo: SUBMISSION_FEE_KEPT_TO["robinhood-mainnet"],
    },
    { network: "base-mainnet", chainId: 8453 },
    { amount: "395000000000000000001" },
  ]) {
    record = reportDepositRecord(CASE);
    record.due[0] = { ...record.due[0], ...change };
    await page.goto(PAGE, { waitUntil: "networkidle" });
    await expect(page.getByRole("alert")).toContainText(
      "The deposit record for this report could not be checked against Slop's published addresses. Do not pay from this page.",
    );
    await expect(page.getByText(attacker, { exact: false })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /pay|connect/iu }),
    ).toHaveCount(0);
  }
  // The record of another report is not shown for this one.
  record = {
    ...reportDepositRecord("sc_another_case_id"),
  };
  await page.goto(PAGE, { waitUntil: "networkidle" });
  await expect(page.getByRole("alert")).toContainText("could not be checked");
  // Nor is this report's record with another report's item.
  record = {
    ...reportDepositRecord(CASE),
    item: reportDepositItem("sc_another_case_id"),
  };
  await page.goto(PAGE, { waitUntil: "networkidle" });
  await expect(page.getByRole("alert")).toContainText("could not be checked");
});

test("a wallet on another network approves, then deposits exactly the published call for this report, and the page follows it to final", async ({
  page,
}) => {
  await switchReportDeposit(page, true);
  let record = reportDepositRecord(CASE);
  const [slop] = record.due;
  const item = reportDepositItem(CASE);
  expect(record.item).toBe(item);
  const calls = expectedCalls(slop, item);
  await serveReportDeposit(page, CASE, () => record);
  const wallet = scriptedWallet(PAYER);
  await installWallet(page, wallet.answer);
  await page.goto(PAGE, { waitUntil: "networkidle" });
  await page
    .getByRole("button", { name: "Pay from a wallet", exact: true })
    .click();
  const pay = page.getByRole("region", { name: "Pay the deposit" });
  await pay
    .getByRole("button", { name: "Connect MetaMask", exact: true })
    .click();
  // The wallet starts on Ethereum; reviewing asks it to move to Robinhood Chain.
  await pay
    .getByRole("button", { name: "Review deposit", exact: true })
    .click();
  const review = pay.getByRole("region", { name: "Review deposit" });
  await expect(review).toBeVisible();
  expect(wallet.state.switches).toEqual(["0x1237"]);

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
  wallet.state.allowance = BigInt(slop.amount);
  wallet.mine(approval);
  const confirm = pay.getByRole("button", {
    name: "Confirm deposit in wallet",
    exact: true,
  });
  await expect(confirm).toBeVisible();

  await confirm.click();
  await expect(
    pay.getByText("Deposit awaiting verification. Do not send it again.", {
      exact: true,
    }),
  ).toBeVisible();
  // Exactly the published contract, this report's item, SLOP, the amount and the burn address.
  expect(wallet.state.sends[1]).toEqual({ from: PAYER, ...calls.deposit });
  expect(wallet.state.sends).toHaveLength(2);
  const deposit = [...wallet.state.transactions.keys()][1];

  // In a block, not final: the page says it arrived and what still waits.
  wallet.mine(deposit, { way: slop, item });
  await expect(pay.getByRole("status")).toContainText(
    "Deposit received in a Robinhood Chain block. Slop records the deposit once that block is 1200 blocks deep",
  );
  await expect(pay.getByRole("status")).toContainText(
    "A refund or a kept deposit is sent only after Robinhood Chain finalizes the block.",
  );
  // Slop records it; the page reads the record again without a reload.
  record = {
    ...record,
    due: [],
    paid: {
      at: "2026-12-05T12:01:00.000Z",
      network: "robinhood-mainnet",
      depositId: 3,
      token: slop.token,
      amount: slop.amount,
      transaction: deposit,
      finalized: false,
    },
  };
  const paid = page.getByRole("region", { name: "Payment recorded" });
  await expect(paid).toContainText("395 SLOP on Robinhood Chain", {
    timeout: 30_000,
  });
  await expect(paid).toContainText("Its block is not final yet.");
  await expect(paid).toContainText(
    "The deposit is held by the deposit contract until the report gets a response.",
  );
  await expect(page.getByRole("heading", { name: "Deposit due" })).toHaveCount(
    0,
  );

  // Final on chain: the saved request is finished.
  wallet.state.finalized = wallet.state.head;
  record = {
    ...record,
    paid: record.paid && { ...record.paid, finalized: true },
  };
  await expect(pay.getByRole("status")).toContainText(
    "Deposit verified on the finalized Robinhood Chain chain.",
  );
  await expect(paid).toContainText("Its block is final.");
  await expect(
    paid.getByRole("link", { name: "Deposit transaction" }),
  ).toHaveAttribute("href", new RegExp(`/tx/${deposit}$`, "u"));
  expect(wallet.state.sends).toHaveLength(2);
});

test("a batching wallet pays in one request, and a deposit someone else already made stops a second one", async ({
  page,
}) => {
  await switchReportDeposit(page, true);
  let record = reportDepositRecord(CASE);
  const [slop] = record.due;
  const item = reportDepositItem(CASE);
  const calls = expectedCalls(slop, item);
  await serveReportDeposit(page, CASE, () => record);
  const wallet = scriptedWallet(PAYER);
  wallet.state.atomic = true;
  wallet.state.chainId = 4663;
  await installWallet(page, wallet.answer);
  await page.goto(PAGE, { waitUntil: "networkidle" });
  await page
    .getByRole("button", { name: "Pay from a wallet", exact: true })
    .click();
  const pay = page.getByRole("region", { name: "Pay the deposit" });
  await pay
    .getByRole("button", { name: "Connect MetaMask", exact: true })
    .click();
  await pay
    .getByRole("button", { name: "Review deposit", exact: true })
    .click();
  const review = pay.getByRole("region", { name: "Review deposit" });
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
      network: "robinhood-mainnet",
      depositId: 4,
      token: slop.token,
      amount: slop.amount,
      transaction: `0x${"c".repeat(64)}`,
      finalized: true,
    },
  };
  await both.click();
  await expect(pay.getByRole("alert")).toHaveText(
    "The deposit for this report is already recorded. Nothing was sent.",
  );
  expect(wallet.state.batches).toEqual([]);
  expect(wallet.state.sends).toEqual([]);
  await expect(
    page.getByRole("region", { name: "Payment recorded" }),
  ).toContainText("395 SLOP on Robinhood Chain");

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
    "Deposit received in a Robinhood Chain block.",
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
  await expect(
    pay.getByRole("button", { name: /review|connect/iu }),
  ).toHaveCount(0);
  await page.reload({ waitUntil: "networkidle" });
  await page
    .getByRole("button", { name: "Pay from a wallet", exact: true })
    .click();
  await expect(waiting).toBeVisible();
  expect(wallet.state.batches).toHaveLength(1);
});

test("a recorded deposit and how it ended are shown, also while the deposit is switched off", async ({
  page,
}) => {
  const base = reportDepositRecord(CASE);
  const deposit = `0x${"d".repeat(64)}`;
  const resolve = `0x${"e".repeat(64)}`;
  let record: ReportDepositRecord = {
    ...base,
    due: [],
    paid: {
      at: "2026-12-01T11:00:00.000Z",
      network: "robinhood-mainnet",
      depositId: 12,
      token: base.due[0].token,
      amount: base.due[0].amount,
      transaction: deposit,
      finalized: true,
    },
    outcome: "kept",
    outcomeReason: "spam",
    outcomeAt: "2026-12-09T11:00:00.000Z",
    resolveTransaction: resolve,
  };
  await serveReportDeposit(page, CASE, () => record);
  // Switched off: the record of a deposit already made still reads.
  await switchReportDeposit(page, false);
  await page.goto(PAGE, { waitUntil: "networkidle" });
  await expect(
    page.getByText("The report deposit is not switched on.", { exact: false }),
  ).toBeVisible();
  const paid = page.getByRole("region", { name: "Payment recorded" });
  await expect(paid).toContainText(
    "395 SLOP on Robinhood Chain, recorded Dec 1, 2026 as deposit 12. Its block is final.",
  );
  await expect(paid).toContainText(
    "The deposit was kept: the SLOP was sent to the burn address.",
  );
  await expect(
    paid.getByRole("link", { name: "Kept transaction" }),
  ).toHaveAttribute("href", new RegExp(`/tx/${resolve}$`, "u"));
  // The reason a report was closed is never shown on the public page.
  await expect(page.getByRole("main")).not.toContainText("spam");
  await expect(page.getByRole("button", { name: /pay|connect/iu })).toHaveCount(
    0,
  );
  await expectAccessibleReflow(page, "report-deposit-paid");

  record = { ...record, outcome: "refunded", outcomeReason: "responded" };
  await page.reload({ waitUntil: "networkidle" });
  await expect(paid).toContainText(
    "The deposit was sent back to the wallet that paid it.",
  );
  await expect(
    paid.getByRole("link", { name: "Refund transaction" }),
  ).toHaveAttribute("href", new RegExp(`/tx/${resolve}$`, "u"));
  record = {
    ...record,
    outcome: "refund_due",
    outcomeReason: "silent",
    resolveTransaction: null,
  };
  await page.reload({ waitUntil: "networkidle" });
  await expect(paid).toContainText(
    "The deposit is due back to the wallet that paid it.",
  );
});
