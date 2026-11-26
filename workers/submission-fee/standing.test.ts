// The two pure rules for a standing deposit: whether a deposit pays the
// account's standing row, and what the resolver may send for it.
import { describe, expect, test } from "bun:test";
import {
  STANDING_DEPOSIT_LEDGER,
  STANDING_DEPOSIT_NETWORK,
  standingDepositItem,
} from "../../src/lib/standing-deposit.mjs";
import {
  SUBMISSION_FEE_BURN,
  SUBMISSION_FEE_KEPT_TO,
  SUBMISSION_FEE_TOKENS,
} from "../../src/lib/submission-fee.mjs";
import {
  type StandingRow,
  standingDepositCounts,
  standingResolveAction,
} from "./standing";

const LEDGER = STANDING_DEPOSIT_LEDGER;
const RC = STANDING_DEPOSIT_NETWORK;
const SLOP = SUBMISSION_FEE_TOKENS[RC].slop as string;
const USDG = SUBMISSION_FEE_TOKENS[RC].usdg as string;
const FEE_WALLET = SUBMISSION_FEE_KEPT_TO[RC];
const OTHER = `0x${"9".repeat(40)}`;
const DUE = `790${"0".repeat(18)}`;

const row = (fields: Partial<StandingRow> = {}): StandingRow => ({
  id: "sd_000000000001",
  item: standingDepositItem(4242, 1),
  slopAmount: DUE,
  cancelledAt: null,
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

describe("whether a deposit pays a standing row", () => {
  test("SLOP on the standing ledger, kept to the burn address, at least the amount asked", () => {
    expect(standingDepositCounts(LEDGER, deposit(), row())).toEqual({
      accepted: true,
      due: DUE,
    });
    expect(
      standingDepositCounts(
        LEDGER,
        deposit({
          amount: `791${"0".repeat(18)}`,
          token: SLOP.toLowerCase(),
          keptTo: SUBMISSION_FEE_BURN.toLowerCase(),
        }),
        row(),
      ),
    ).toMatchObject({ accepted: true });
  });

  test("one base unit short is refused", () => {
    expect(
      standingDepositCounts(
        LEDGER,
        deposit({ amount: (BigInt(DUE) - 1n).toString() }),
        row(),
      ),
    ).toEqual({ accepted: false, reason: "amount_below_due" });
  });

  test("a stablecoin is refused, whichever address it would be kept to", () => {
    for (const keptTo of [FEE_WALLET, SUBMISSION_FEE_BURN])
      expect(
        standingDepositCounts(
          LEDGER,
          deposit({ token: USDG, amount: "10000000", keptTo }),
          row(),
        ),
      ).toEqual({ accepted: false, reason: "standing_token_not_slop" });
  });

  test("SLOP kept anywhere but the burn address is refused", () => {
    for (const keptTo of [FEE_WALLET, OTHER])
      expect(standingDepositCounts(LEDGER, deposit({ keptTo }), row())).toEqual(
        { accepted: false, reason: "wrong_kept_to" },
      );
  });

  test("the per pull request ledgers never pay a standing row", () => {
    for (const network of [RC, "base-mainnet"])
      expect(standingDepositCounts(network, deposit(), row())).toMatchObject({
        accepted: false,
      });
    expect(standingDepositCounts(RC, deposit(), row())).toEqual({
      accepted: false,
      reason: "standing_wrong_ledger",
    });
  });

  test("a token outside the table keeps the reason that leaves it unresolved", () => {
    expect(
      standingDepositCounts(LEDGER, deposit({ token: OTHER }), row()),
    ).toEqual({ accepted: false, reason: "token_not_accepted" });
  });

  test("a withdrawn row, a missing row or an unusable amount accepts nothing", () => {
    expect(
      standingDepositCounts(
        LEDGER,
        deposit(),
        row({ cancelledAt: "2026-12-01T00:00:00.000Z" }),
      ),
    ).toEqual({ accepted: false, reason: "standing_cancelled" });
    expect(standingDepositCounts(LEDGER, deposit(), null)).toEqual({
      accepted: false,
      reason: "unknown_item",
    });
    for (const slopAmount of ["0", "", "1.5", "-1"])
      expect(
        standingDepositCounts(LEDGER, deposit(), row({ slopAmount })),
      ).toEqual({ accepted: false, reason: "standing_amount_invalid" });
  });

  test("a row already paid by another deposit, or decided, is not paid again", () => {
    expect(
      standingDepositCounts(
        LEDGER,
        deposit(),
        row({ paidNetwork: LEDGER, paidDepositId: 3 }),
      ),
    ).toEqual({ accepted: false, reason: "item_already_paid" });
    // The same deposit id on another ledger is another deposit.
    expect(
      standingDepositCounts(
        LEDGER,
        deposit(),
        row({ paidNetwork: RC, paidDepositId: 7 }),
      ),
    ).toEqual({ accepted: false, reason: "item_already_paid" });
    expect(
      standingDepositCounts(LEDGER, deposit(), row({ outcome: "refund_due" })),
    ).toEqual({ accepted: false, reason: "item_already_decided" });
    // The deposit that paid stays accepted when it is judged again.
    expect(
      standingDepositCounts(
        LEDGER,
        deposit(),
        row({ paidNetwork: LEDGER, paidDepositId: 7, outcome: "kept_due" }),
      ),
    ).toMatchObject({ accepted: true });
  });
});

describe("what may be sent for a standing deposit", () => {
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
    row({ paidNetwork: LEDGER, paidDepositId: 7, outcome });

  test("sent back on refund_due, kept only on kept_due", () => {
    expect(standingResolveAction(LEDGER, final(), paid("refund_due"))).toBe(
      "refund",
    );
    expect(standingResolveAction(LEDGER, final(), paid("kept_due"))).toBe(
      "keep",
    );
  });

  test("nothing while undecided, or once the row holds a final outcome", () => {
    for (const outcome of [null, "refunded", "kept"])
      expect(standingResolveAction(LEDGER, final(), paid(outcome))).toBe(null);
  });

  test("nothing before the deposit is finalized or judged, or after it left the open states", () => {
    expect(
      standingResolveAction(
        LEDGER,
        final({ finalizedAt: null }),
        paid("kept_due"),
      ),
    ).toBe(null);
    expect(
      standingResolveAction(
        LEDGER,
        final({ accepted: null }),
        paid("kept_due"),
      ),
    ).toBe(null);
    for (const state of ["refunded", "kept", "reclaimed"])
      expect(
        standingResolveAction(LEDGER, final({ state }), paid("kept_due")),
      ).toBe(null);
  });

  test("kept_due on a row that names another deposit keeps nothing", () => {
    for (const named of [
      row({ paidNetwork: LEDGER, paidDepositId: 8, outcome: "kept_due" }),
      row({ paidNetwork: RC, paidDepositId: 7, outcome: "kept_due" }),
      null,
    ])
      expect(standingResolveAction(LEDGER, final(), named)).toBe(null);
  });

  test("a refused deposit is sent back whatever the row says; another token is never resolved", () => {
    for (const outcome of [null, "refund_due", "kept_due"])
      expect(
        standingResolveAction(LEDGER, final({ accepted: 0 }), paid(outcome)),
      ).toBe("refund");
    expect(
      standingResolveAction(
        LEDGER,
        final({ token: OTHER, accepted: 0 }),
        paid("refund_due"),
      ),
    ).toBe(null);
  });

  test("keep needs the deposit's own terms: SLOP, the burn address, the standing ledger", () => {
    expect(
      standingResolveAction(
        LEDGER,
        final({ keptTo: FEE_WALLET }),
        paid("kept_due"),
      ),
    ).toBe(null);
    expect(
      standingResolveAction(LEDGER, final({ token: USDG }), paid("kept_due")),
    ).toBe(null);
    expect(
      standingResolveAction(
        RC,
        final(),
        row({ paidNetwork: RC, paidDepositId: 7, outcome: "kept_due" }),
      ),
    ).toBe(null);
  });
});
