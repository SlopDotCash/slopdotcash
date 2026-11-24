// The shared rules of the standing deposit (PRD section 5, "Standing
// deposit"; section 6, FEE-08; operator decision, 23 November 2026).
import { expect, test } from "bun:test";
import { encodePacked, keccak256 } from "viem";
import { reportDepositItem } from "../src/lib/security-report-deposit.mjs";
import {
  standingCoverEndsAt,
  standingCoverState,
  standingDepositAmount,
  standingDepositCovers,
  standingDepositDeployed,
  standingDepositDue,
  standingDepositItem,
  standingDepositsAccepted,
} from "../src/lib/standing-deposit.mjs";
import { submissionFeeItem } from "../src/lib/submission-fee.mjs";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const at = (iso: string) => new Date(iso);
const plus = (iso: string, ms: number) =>
  new Date(Date.parse(iso) + ms).toISOString();

test("the item is the contract's packed encoding and never another kind's", () => {
  const item = standingDepositItem(18633264, 2);
  expect(item).toBe(
    keccak256(
      encodePacked(
        ["string", "uint64", "uint64"],
        ["slop-standing-v1", 18633264n, 2n],
      ),
    ),
  );
  expect(standingDepositItem(18633264, 3)).not.toBe(item);
  expect(item).not.toBe(submissionFeeItem(18633264, 2));
  expect(item).not.toBe(reportDepositItem("sc_abcdefgh"));
  expect(() => standingDepositItem(0, 1)).toThrow();
  expect(() => standingDepositItem(1, 0)).toThrow();
});

test("the amount is 10 dollars at the rate, rounded up to a whole SLOP", () => {
  expect(standingDepositAmount(null)).toBeNull();
  // 78.908929 SLOP per dollar: 789.08929 -> 790 whole SLOP.
  expect(standingDepositAmount("78.908929")).toBe(`790${"0".repeat(18)}`);
  expect(standingDepositAmount("80")).toBe(`800${"0".repeat(18)}`);
});

test("nothing is deployed until an address and a start block are recorded", () => {
  expect(standingDepositDeployed()).toBe(false);
  expect(
    standingDepositDeployed("0xDe40B32A4156ABC2A05987367966d994BcFbf8D8", null),
  ).toBe(false);
  expect(
    standingDepositDeployed("0xDe40B32A4156ABC2A05987367966d994BcFbf8D8", 1),
  ).toBe(true);
});

test("a project accepts standing deposits unless its owner refused", () => {
  expect(standingDepositsAccepted({})).toBe(true);
  expect(
    standingDepositsAccepted({ slopbot: { submissionFee: { enabled: true } } }),
  ).toBe(true);
  expect(
    standingDepositsAccepted({
      slopbot: { submissionFee: { standingDeposits: false } },
    }),
  ).toBe(false);
});

const paidAt = "2026-12-01T00:00:00.000Z";
const deposit = {
  paidAt,
  outcome: null,
  cancelledAt: null,
  withdrawRequestedAt: null,
};
const covers = (over: Record<string, unknown>) =>
  standingDepositCovers({
    deposit,
    accepted: true,
    mergedOnProject: true,
    openCovered: 0,
    openedAt: plus(paidAt, DAY),
    ...over,
  });

test("cover needs a paid standing deposit, the project's acceptance, an earlier merge there and room under the cap", () => {
  expect(covers({})).toBe(true);
  expect(covers({ mergedOnProject: false })).toBe(false);
  expect(covers({ mergedOnProject: null })).toBe(false);
  expect(covers({ accepted: false })).toBe(false);
  expect(covers({ openCovered: 9 })).toBe(true);
  expect(covers({ openCovered: 10 })).toBe(false);
  expect(covers({ deposit: { ...deposit, paidAt: null } })).toBe(false);
  expect(covers({ deposit: { ...deposit, outcome: "kept_due" } })).toBe(false);
  // A withdrawal stops new cover at once.
  const withdrawn = { ...deposit, withdrawRequestedAt: plus(paidAt, 5 * DAY) };
  expect(covers({ deposit: withdrawn, openedAt: plus(paidAt, 4 * DAY) })).toBe(
    true,
  );
  expect(covers({ deposit: withdrawn, openedAt: plus(paidAt, 6 * DAY) })).toBe(
    false,
  );
  // 340 days after payment it covers nothing new.
  expect(covers({ openedAt: plus(paidAt, 339 * DAY) })).toBe(true);
  expect(covers({ openedAt: plus(paidAt, 340 * DAY) })).toBe(false);
  expect(standingCoverEndsAt(deposit)?.toISOString()).toBe(
    plus(paidAt, 340 * DAY),
  );
});

const opened = plus(paidAt, DAY);
const state = (over: Record<string, unknown>, now: string) =>
  standingCoverState(
    {
      windowStart: opened,
      merged: false,
      closed: false,
      closedAt: null,
      keepMarked: false,
      strikeSeenAt: null,
      ...over,
    },
    at(now),
  );

test("only a labelled close inside the window that stands 48 hours is a strike", () => {
  const closedAt = plus(opened, 3 * DAY);
  const seen = plus(opened, 3 * DAY + HOUR);
  // Open inside the window: watched.
  expect(state({}, plus(opened, 2 * DAY))).toBe("watch");
  // Ordinary close: watched until the window ends, then clear.
  expect(state({ closed: true, closedAt }, plus(opened, 10 * DAY))).toBe(
    "watch",
  );
  expect(state({ closed: true, closedAt }, plus(opened, 22 * DAY))).toBe(
    "clear",
  );
  // Labelled close: pending until 48 hours after first seen, then a strike.
  const labelled = {
    closed: true,
    closedAt,
    keepMarked: true,
    strikeSeenAt: seen,
  };
  expect(state(labelled, plus(seen, 47 * HOUR))).toBe("pending");
  expect(state(labelled, plus(seen, 48 * HOUR))).toBe("strike");
  expect(
    state({ ...labelled, strikeSeenAt: null }, plus(seen, 72 * HOUR)),
  ).toBe("pending");
  // Closed after the window: never a strike, label or not.
  const late = plus(opened, 22 * DAY);
  expect(
    state(
      { closed: true, closedAt: late, keepMarked: true, strikeSeenAt: late },
      plus(late, 3 * DAY),
    ),
  ).toBe("clear");
  // A merge is always clear.
  expect(state({ ...labelled, merged: true }, plus(seen, 72 * HOUR))).toBe(
    "clear",
  );
});

test("a strike keeps the deposit; a withdrawal sends it back after 21 days once every cover is clear", () => {
  const now = at(plus(paidAt, 10 * DAY));
  expect(standingDepositDue(deposit, ["watch", "strike"], now)).toBe(
    "kept_due",
  );
  expect(standingDepositDue(deposit, ["watch"], now)).toBeNull();
  const requested = plus(paidAt, 30 * DAY);
  const withdrawn = { ...deposit, withdrawRequestedAt: requested };
  expect(
    standingDepositDue(withdrawn, [], at(plus(requested, 20 * DAY))),
  ).toBeNull();
  expect(
    standingDepositDue(withdrawn, ["clear"], at(plus(requested, 21 * DAY))),
  ).toBe("refund_due");
  // A cover not yet read as clear holds the refund until Slopbot reads it.
  expect(
    standingDepositDue(
      withdrawn,
      ["clear", "watch"],
      at(plus(requested, 21 * DAY)),
    ),
  ).toBeNull();
  expect(
    standingDepositDue(withdrawn, ["pending"], at(plus(requested, 21 * DAY))),
  ).toBeNull();
  // Expiry acts as a withdrawal on day 340.
  expect(standingDepositDue(deposit, [], at(plus(paidAt, 361 * DAY)))).toBe(
    "refund_due",
  );
  expect(
    standingDepositDue({ ...deposit, outcome: "refund_due" }, ["strike"], now),
  ).toBeNull();
});
