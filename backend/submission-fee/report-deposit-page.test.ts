// The report deposit pay page's rules (src/lib/report-deposit-page.ts) and the
// constants they rest on. It lives here so the unit shards run it.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { keccak256, stringToHex } from "viem";
import {
  REPORT_DEPOSIT_NOTICE,
  REPORT_DEPOSIT_SETTING_HINT,
  ReportDepositRecordError,
  readReportDeposit,
  reportDepositCase,
  reportDepositPath,
  reportDepositPayPath,
  reportDepositStatus,
  reportDepositStatusText,
} from "../../src/lib/report-deposit-page";
import {
  REPORT_DEPOSIT_NETWORK,
  reportDepositAmount,
  reportDepositItem,
  reportDepositOn,
} from "../../src/lib/security-report-deposit.mjs";
import {
  SUBMISSION_FEE_BURN,
  SUBMISSION_FEE_CHAIN_IDS,
  SUBMISSION_FEE_CONTRACTS,
  SUBMISSION_FEE_TOKENS,
} from "../../src/lib/submission-fee.mjs";
import {
  FeeRecordError,
  feeAmountText,
  PUBLISHED_FEE_TABLES,
} from "../../src/lib/submission-fee-page";

const CASE = "sc_0123456789abcdef";
const SLOP = SUBMISSION_FEE_TOKENS[REPORT_DEPOSIT_NETWORK].slop as string;
const CONTRACT = SUBMISSION_FEE_CONTRACTS[REPORT_DEPOSIT_NETWORK] as string;
const DEPOSIT = `0x${"d".repeat(64)}`;
const RESOLVE = `0x${"e".repeat(64)}`;

/** The body the read route serves for an asked, unpaid report (interface section 7). */
function record() {
  return {
    schema: "slop-report-deposit-v1",
    caseId: CASE,
    item: reportDepositItem(CASE) as string,
    askedAt: "2026-12-01T10:00:00.000Z",
    due: [
      {
        network: REPORT_DEPOSIT_NETWORK as string,
        chainId: SUBMISSION_FEE_CHAIN_IDS[REPORT_DEPOSIT_NETWORK] as number,
        token: SLOP,
        symbol: "SLOP",
        decimals: 18,
        amount: "395000000000000000000",
        contract: CONTRACT,
        keptTo: SUBMISSION_FEE_BURN,
      },
    ],
    paid: null as null | Record<string, unknown>,
    outcome: null as string | null,
    outcomeReason: null as string | null,
    outcomeAt: null as string | null,
    resolveTransaction: null as string | null,
  };
}

const paid = () => ({
  at: "2026-12-01T11:00:00.000Z",
  network: REPORT_DEPOSIT_NETWORK,
  depositId: 12,
  token: SLOP,
  amount: "395000000000000000000",
  transaction: DEPOSIT,
  finalized: true,
});

test("the item is the contract's hash of the tag and the case id, and the amount is 5 US dollars of SLOP rounded up to a whole SLOP", () => {
  expect(reportDepositItem(CASE)).toBe(
    keccak256(stringToHex(`slop-report-v1${CASE}`)),
  );
  expect(reportDepositItem("sc_another_case")).not.toBe(
    reportDepositItem(CASE),
  );
  // 5 x 78.908929 is 394.54 SLOP, rounded up.
  expect(reportDepositAmount("78.908929")).toBe("395000000000000000000");
  expect(reportDepositAmount("79")).toBe("395000000000000000000");
  expect(reportDepositAmount("79.000001")).toBe("396000000000000000000");
  expect(reportDepositAmount(null)).toBeNull();
  expect(reportDepositOn({})).toBe(true);
  expect(reportDepositOn({ security: {} })).toBe(true);
  expect(reportDepositOn({ security: { reportDeposit: true } })).toBe(true);
  expect(reportDepositOn({ security: { reportDeposit: false } })).toBe(false);
});

test("only a Slop case id names a page, and the read path carries nothing else", () => {
  expect(reportDepositCase(CASE)).toBe(CASE);
  for (const address of [
    "",
    "sc_short",
    "ss_0123456789abcdef",
    "sc_0123456789abcdef/extra",
    "sc_0123456789abcdef?x=1",
    `sc_${"a".repeat(73)}`,
    "SC_0123456789abcdef",
  ])
    expect([address, reportDepositCase(address)]).toEqual([address, null]);
  expect(reportDepositPath(CASE)).toBe(
    `/api/v1/submission-fee/reports/${CASE}`,
  );
  expect(reportDepositPayPath(CASE)).toBe(`/fee/report/${CASE}`);
  const redirects = readFileSync("public/_redirects", "utf8").split("\n");
  expect(redirects).toContain("/fee/report/:case / 200");
  expect(redirects).toContain("/fee/report/:case/ / 200");
  // The report rule comes first: the pull request rule has a fourth segment.
  expect(redirects.indexOf("/fee/report/:case / 200")).toBeLessThan(
    redirects.indexOf("/fee/:owner/:repo/:number / 200"),
  );
});

test("an asked record offers exactly the published SLOP deposit on Robinhood Chain", () => {
  const deposit = readReportDeposit(record(), CASE);
  expect(deposit.caseId).toBe(CASE);
  expect(deposit.item).toBe(reportDepositItem(CASE));
  expect(deposit.paid).toBeNull();
  expect(deposit.due).toEqual([
    {
      network: "robinhood-mainnet",
      chainId: 4663,
      contract: CONTRACT,
      token: SLOP,
      symbol: "SLOP",
      decimals: 18,
      amount: "395000000000000000000",
      minimumAccepted: "395000000000000000000",
      keptTo: SUBMISSION_FEE_BURN,
      kind: "slop",
    },
  ]);
  expect(feeAmountText(deposit.due[0])).toBe("395 SLOP");
});

test("a record that names another case, contract, token, chain, destination or a part of a SLOP is refused whole", () => {
  const attacker = "0x000000000000000000000000000000000000bEEF";
  const usdg = SUBMISSION_FEE_TOKENS["robinhood-mainnet"].usdg as string;
  const changes: ((body: ReturnType<typeof record>) => void)[] = [
    (body) => {
      body.schema = "slop-submission-fee-item-v1";
    },
    (body) => {
      body.caseId = "sc_another_case_id";
    },
    (body) => {
      body.item = reportDepositItem("sc_another_case_id");
    },
    (body) => {
      body.due[0].contract = attacker;
    },
    (body) => {
      body.due[0].keptTo = attacker;
    },
    // Slop's fee wallet is the kept-to address of a stablecoin, never of SLOP.
    (body) => {
      body.due[0].keptTo = PUBLISHED_FEE_TABLES.keptTo["robinhood-mainnet"];
    },
    (body) => {
      body.due[0].token = attacker;
    },
    // A stablecoin is a published token, but it never pays a report deposit.
    (body) => {
      body.due[0] = {
        ...body.due[0],
        token: usdg,
        symbol: "USDG",
        decimals: 6,
        amount: "5000000",
        keptTo: PUBLISHED_FEE_TABLES.keptTo["robinhood-mainnet"],
      };
    },
    (body) => {
      body.due[0].network = "base-mainnet";
    },
    (body) => {
      body.due[0].chainId = 8453;
    },
    (body) => {
      body.due[0].decimals = 6;
    },
    (body) => {
      body.due[0].amount = "0";
    },
    (body) => {
      body.due[0].amount = "395000000000000000001";
    },
    (body) => {
      body.due[0].amount = (1n << 130n).toString();
    },
    (body) => {
      body.due.push({ ...body.due[0] });
    },
    // Nothing is due once a deposit is recorded, and nothing is decided before one.
    (body) => {
      body.paid = paid();
    },
    (body) => {
      body.outcome = "refund_due";
    },
    (body) => {
      body.due = [];
    },
    (body) => {
      body.due = [];
      body.paid = { ...paid(), network: "base-mainnet" };
    },
    (body) => {
      body.due = [];
      body.paid = { ...paid(), token: usdg };
    },
    (body) => {
      body.due = [];
      body.paid = paid();
      body.outcome = "forfeit";
    },
  ];
  for (const [index, change] of changes.entries()) {
    const body = record();
    change(body);
    let thrown: unknown;
    try {
      readReportDeposit(body, CASE);
    } catch (error) {
      thrown = error;
    }
    expect([index, thrown instanceof ReportDepositRecordError]).toEqual([
      index,
      true,
    ]);
  }
  // The page's retention rule drops every refused record, of either page.
  expect(new ReportDepositRecordError()).toBeInstanceOf(FeeRecordError);
  expect(new ReportDepositRecordError().message).toBe(
    "The deposit record for this report could not be checked against Slop's published addresses. Do not pay from this page.",
  );
  expect(new FeeRecordError().message).toContain("this pull request");
  for (const body of [null, [], "text", 7])
    expect(() => readReportDeposit(body, CASE)).toThrow(
      ReportDepositRecordError,
    );
});

test("a recorded deposit and its outcome read back, and private tables replace the published ones only when passed", () => {
  const body = {
    ...record(),
    due: [],
    paid: paid(),
    outcome: "kept",
    outcomeReason: "spam",
    outcomeAt: "2026-12-09T11:00:00.000Z",
    resolveTransaction: RESOLVE,
  };
  const deposit = readReportDeposit(body, CASE);
  expect(deposit.due).toEqual([]);
  expect(deposit.paid).toEqual({
    at: "2026-12-01T11:00:00.000Z",
    network: "robinhood-mainnet",
    depositId: 12,
    token: SLOP,
    symbol: "SLOP",
    decimals: 18,
    kind: "slop",
    amount: "395000000000000000000",
    transaction: DEPOSIT,
    finalized: true,
  });
  expect(deposit.outcome).toBe("kept");
  expect(deposit.resolveTransaction).toBe(RESOLVE);
  // The public record never carries the project, the reporter or report text.
  expect(Object.keys(deposit).sort()).toEqual([
    "askedAt",
    "caseId",
    "due",
    "item",
    "outcome",
    "outcomeAt",
    "paid",
    "resolveTransaction",
  ]);

  const local = "0x00000000000000000000000000000000000000c1";
  const tables = {
    ...PUBLISHED_FEE_TABLES,
    contracts: {
      ...PUBLISHED_FEE_TABLES.contracts,
      "robinhood-mainnet": local,
    },
  };
  const served = record();
  served.due[0].contract = local;
  expect(readReportDeposit(served, CASE, tables).due[0].contract).toBe(local);
  expect(() => readReportDeposit(served, CASE)).toThrow(
    ReportDepositRecordError,
  );
});

test("the reporter's own deposit state reads as one line, and anything else reads as no deposit", () => {
  const status = (state: string, extra: Record<string, unknown> = {}) =>
    reportDepositStatus({
      state,
      amount: "395000000000000000000",
      payPath: `/fee/report/${CASE}`,
      ...extra,
    });
  expect(status("needed")).toEqual({
    state: "needed",
    amountText: "395 SLOP",
    payPath: `/fee/report/${CASE}`,
  });
  const lines = Object.fromEntries(
    ["needed", "paid", "refund_due", "kept_due", "refunded", "kept"].map(
      (state) => {
        const read = status(state);
        return [state, read && reportDepositStatusText(read)];
      },
    ),
  );
  expect(lines).toEqual({
    needed: "Deposit needed: 395 SLOP",
    paid: "Deposit recorded",
    refund_due: "Deposit recorded, to be sent back",
    kept_due: "Deposit recorded, to be kept",
    refunded: "Deposit sent back",
    kept: "Deposit kept",
  });
  // An unreadable amount still says a deposit is needed; a path that is not
  // a report pay page is never linked.
  const partial = status("needed", {
    amount: "395.5",
    payPath: "https://example.com/fee/report/sc_0123456789abcdef",
  });
  expect(partial).toEqual({ state: "needed", amountText: null, payPath: null });
  expect(partial && reportDepositStatusText(partial)).toBe("Deposit needed");
  expect(status("needed", { payPath: "/fee/report/../admin" })?.payPath).toBe(
    null,
  );
  for (const value of [null, undefined, "needed", [], { state: "forfeit" }])
    expect(reportDepositStatus(value)).toBeNull();
});

test("the notices state the published figures and follow the wording rules", () => {
  expect(REPORT_DEPOSIT_NOTICE).toBe(
    "A refundable deposit of about 5 US dollars of SLOP on Robinhood Chain is needed before the report is screened; it is sent back unless the report is closed as spam, a duplicate or out of scope.",
  );
  expect(REPORT_DEPOSIT_SETTING_HINT).toBe(
    "A private report is screened once its reporter deposits about 5 US dollars of SLOP on Robinhood Chain, sent back unless the report is closed as spam, a duplicate or out of scope.",
  );
  for (const text of [REPORT_DEPOSIT_NOTICE, REPORT_DEPOSIT_SETTING_HINT])
    expect(text).not.toMatch(
      /\u2014|forfeit|penalty|airdrop|stake|invest|faster|award/iu,
    );
});
