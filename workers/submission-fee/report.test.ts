// The two pure rules for a private report's deposit: whether a deposit pays
// the report, and what the resolver may send for it.
import { describe, expect, test } from "bun:test";
import {
  REPORT_DEPOSIT_NETWORK,
  reportDepositItem,
} from "../../src/lib/security-report-deposit.mjs";
import {
  SUBMISSION_FEE_BURN,
  SUBMISSION_FEE_KEPT_TO,
  SUBMISSION_FEE_TOKENS,
} from "../../src/lib/submission-fee.mjs";
import {
  type ReportRow,
  reportDepositCounts,
  reportResolveAction,
} from "./report";

const RC = REPORT_DEPOSIT_NETWORK;
const SLOP = SUBMISSION_FEE_TOKENS[RC].slop as string;
const USDG = SUBMISSION_FEE_TOKENS[RC].usdg as string;
const USDC = SUBMISSION_FEE_TOKENS["base-mainnet"].usdc as string;
const FEE_WALLET = SUBMISSION_FEE_KEPT_TO[RC];
const OTHER = `0x${"9".repeat(40)}`;
const DUE = `395${"0".repeat(18)}`;
const CASE = "sc_0123456789abcdef";

const report = (fields: Partial<ReportRow> = {}): ReportRow => ({
  caseId: CASE,
  item: reportDepositItem(CASE),
  slopAmount: DUE,
  paidNetwork: null,
  paidDepositId: null,
  outcome: null,
  ...fields,
});
const deposit = (
  fields: Partial<{
    depositId: number;
    token: string;
    amount: string;
    keptTo: string;
  }> = {},
) => ({
  depositId: 7,
  token: SLOP,
  amount: DUE,
  keptTo: SUBMISSION_FEE_BURN,
  ...fields,
});

describe("whether a deposit pays a report", () => {
  test("SLOP on Robinhood Chain, kept to the burn address, at least the amount asked", () => {
    expect(reportDepositCounts(RC, deposit(), report())).toEqual({
      accepted: true,
      due: DUE,
    });
    // More than the amount asked counts; addresses compare without case.
    expect(
      reportDepositCounts(
        RC,
        deposit({
          amount: `396${"0".repeat(18)}`,
          token: SLOP.toLowerCase(),
          keptTo: SUBMISSION_FEE_BURN.toLowerCase(),
        }),
        report(),
      ),
    ).toMatchObject({ accepted: true });
  });

  test("one base unit short is refused", () => {
    expect(
      reportDepositCounts(
        RC,
        deposit({ amount: (BigInt(DUE) - 1n).toString() }),
        report(),
      ),
    ).toEqual({ accepted: false, reason: "amount_below_due" });
  });

  test("a stablecoin is refused, whichever address it would be kept to", () => {
    for (const keptTo of [FEE_WALLET, SUBMISSION_FEE_BURN])
      expect(
        reportDepositCounts(
          RC,
          deposit({ token: USDG, amount: "5000000", keptTo }),
          report(),
        ),
      ).toEqual({ accepted: false, reason: "report_token_not_slop" });
  });

  test("SLOP that would be kept to the fee wallet, or anywhere but the burn address, is refused", () => {
    for (const keptTo of [FEE_WALLET, OTHER])
      expect(reportDepositCounts(RC, deposit({ keptTo }), report())).toEqual({
        accepted: false,
        reason: "wrong_kept_to",
      });
  });

  test("on Base nothing pays a report", () => {
    expect(
      reportDepositCounts(
        "base-mainnet",
        deposit({ token: USDC, amount: "5000000", keptTo: FEE_WALLET }),
        report(),
      ),
    ).toEqual({ accepted: false, reason: "report_wrong_network" });
    // A local table that lists SLOP on Base changes nothing.
    expect(
      reportDepositCounts("base-mainnet", deposit(), report(), {
        tokens: { "base-mainnet": { usdc: USDC, slop: SLOP } },
      }),
    ).toEqual({ accepted: false, reason: "report_wrong_network" });
  });

  test("a token outside the table keeps the reason that leaves it unresolved", () => {
    for (const network of [RC, "base-mainnet"])
      expect(
        reportDepositCounts(network, deposit({ token: OTHER }), report()),
      ).toEqual({ accepted: false, reason: "token_not_accepted" });
  });

  test("a row without a usable amount accepts nothing", () => {
    for (const slopAmount of ["0", "", "1.5", "-1", "abc"])
      expect(
        reportDepositCounts(RC, deposit(), report({ slopAmount })),
      ).toEqual({ accepted: false, reason: "report_amount_invalid" });
  });

  test("a report already paid by another deposit, or already decided, is not paid again", () => {
    expect(
      reportDepositCounts(
        RC,
        deposit(),
        report({ paidNetwork: RC, paidDepositId: 3 }),
      ),
    ).toEqual({ accepted: false, reason: "item_already_paid" });
    expect(
      reportDepositCounts(RC, deposit(), report({ outcome: "refund_due" })),
    ).toEqual({ accepted: false, reason: "item_already_decided" });
    // The deposit that paid stays accepted when it is judged again.
    expect(
      reportDepositCounts(
        RC,
        deposit(),
        report({ paidNetwork: RC, paidDepositId: 7, outcome: "kept_due" }),
      ),
    ).toMatchObject({ accepted: true });
  });

  test("no row accepts nothing", () => {
    expect(reportDepositCounts(RC, deposit(), null)).toEqual({
      accepted: false,
      reason: "unknown_item",
    });
  });
});

describe("what may be sent for a report's deposit", () => {
  const final = (
    fields: Partial<{
      depositId: number;
      token: string;
      keptTo: string;
      finalizedAt: string | null;
      state: string;
      accepted: number | null;
    }> = {},
  ) => ({
    depositId: 7,
    token: SLOP,
    keptTo: SUBMISSION_FEE_BURN,
    finalizedAt: "2026-12-01T00:20:00.000Z",
    state: "open",
    accepted: 1,
    ...fields,
  });
  const paid = (outcome: string | null) =>
    report({ paidNetwork: RC, paidDepositId: 7, outcome });

  test("refund when the row says refund_due, keep only when it says kept_due", () => {
    expect(reportResolveAction(RC, final(), paid("refund_due"))).toBe("refund");
    expect(reportResolveAction(RC, final(), paid("kept_due"))).toBe("keep");
    expect(
      reportResolveAction(RC, final({ state: "kept_due" }), paid("kept_due")),
    ).toBe("keep");
  });

  test("nothing while undecided, or once the row holds a final outcome", () => {
    for (const outcome of [null, "refunded", "kept", "kept_due "])
      expect(reportResolveAction(RC, final(), paid(outcome))).toBe(null);
  });

  test("nothing before the deposit is finalized or judged, or after it left the open states", () => {
    expect(
      reportResolveAction(RC, final({ finalizedAt: null }), paid("kept_due")),
    ).toBe(null);
    expect(
      reportResolveAction(RC, final({ accepted: null }), paid("kept_due")),
    ).toBe(null);
    for (const state of ["refunded", "kept", "reclaimed"])
      expect(reportResolveAction(RC, final({ state }), paid("kept_due"))).toBe(
        null,
      );
  });

  test("kept_due on a row that names another deposit keeps nothing", () => {
    expect(
      reportResolveAction(
        RC,
        final(),
        report({ paidNetwork: RC, paidDepositId: 8, outcome: "kept_due" }),
      ),
    ).toBe(null);
    expect(
      reportResolveAction(
        RC,
        final(),
        report({
          paidNetwork: "base-mainnet",
          paidDepositId: 7,
          outcome: "kept_due",
        }),
      ),
    ).toBe(null);
    expect(reportResolveAction(RC, final(), null)).toBe(null);
  });

  test("a refused deposit is refunded whatever the row says", () => {
    for (const outcome of [null, "refund_due", "kept_due"])
      expect(
        reportResolveAction(RC, final({ accepted: 0 }), paid(outcome)),
      ).toBe("refund");
  });

  test("a token outside the table is never resolved", () => {
    expect(
      reportResolveAction(
        RC,
        final({ token: OTHER, accepted: 0 }),
        paid("refund_due"),
      ),
    ).toBe(null);
  });

  test("keep needs the deposit's own terms: SLOP, the burn address, Robinhood Chain", () => {
    // Rows that the judgement can never produce; they still keep nothing.
    expect(
      reportResolveAction(RC, final({ keptTo: FEE_WALLET }), paid("kept_due")),
    ).toBe(null);
    expect(
      reportResolveAction(RC, final({ token: USDG }), paid("kept_due")),
    ).toBe(null);
    expect(
      reportResolveAction(
        "base-mainnet",
        final({ token: USDC }),
        report({
          paidNetwork: "base-mainnet",
          paidDepositId: 7,
          outcome: "kept_due",
        }),
      ),
    ).toBe(null);
  });
});
