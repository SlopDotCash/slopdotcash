// The submission fee's money rules: the item hash, the SLOP amount, the rate
// in force, whether a deposit counts, and what may be sent for it.
import { describe, expect, test } from "bun:test";
import { encodePacked, keccak256 } from "viem";
import {
  averageSlopRate,
  nextSlopRate,
  SUBMISSION_FEE_BURN,
  SUBMISSION_FEE_CONTRACTS,
  SUBMISSION_FEE_KEPT_TO,
  SUBMISSION_FEE_START_BLOCKS,
  SUBMISSION_FEE_TOKENS,
  slopFeeBase,
  slopFeeDueAt,
  slopFeeShareBps,
  slopRateScaled,
  slopRatesAt,
  slopRateText,
  submissionDepositCounts,
  submissionFeeItem,
  submissionFeeOptions,
  submissionFeeTokenKind,
  submissionResolveAction,
  validStableFee,
} from "./submission-fee.mjs";

const BASE = "base-mainnet";
const RC = "robinhood-mainnet";
const USDC = SUBMISSION_FEE_TOKENS[BASE].usdc as string;
const USDG = SUBMISSION_FEE_TOKENS[RC].usdg as string;
const SLOP = SUBMISSION_FEE_TOKENS[RC].slop as string;
const FEE_WALLET = SUBMISSION_FEE_KEPT_TO[BASE];
const slop = (whole: string) => `${whole}${"0".repeat(18)}`;

describe("submissionFeeItem", () => {
  test("is the packed keccak the contract's callers compute", () => {
    for (const [repository, pull] of [
      [1n, 1n],
      [1271472696n, 49n],
      [2n ** 64n - 1n, 2n ** 64n - 1n],
    ] as const)
      expect(submissionFeeItem(repository, pull)).toBe(
        keccak256(
          encodePacked(
            ["string", "uint64", "uint64"],
            ["slop-fee-v1", repository, pull],
          ),
        ),
      );
    // A fixed value, so a change to the encoding cannot pass unnoticed.
    expect(submissionFeeItem(1271472696, 49)).toBe(
      keccak256("0x736c6f702d6665652d7631000000004bc922380000000000000031"),
    );
  });

  test("numbers, strings and bigints of one pull request agree", () => {
    expect(submissionFeeItem("987", "12")).toBe(submissionFeeItem(987, 12));
    expect(submissionFeeItem(987n, 12n)).toBe(submissionFeeItem(987, 12));
  });

  test("the two numbers cannot be swapped or run together", () => {
    expect(submissionFeeItem(12, 3)).not.toBe(submissionFeeItem(3, 12));
    expect(submissionFeeItem(1, 23)).not.toBe(submissionFeeItem(12, 3));
  });

  test("refuses anything that is not a positive 64-bit integer", () => {
    for (const bad of [
      0,
      -1,
      1.5,
      "01",
      "",
      "1e3",
      2n ** 64n,
      null,
      Number.NaN,
    ])
      expect(() => submissionFeeItem(bad as never, 1)).toThrow(TypeError);
    expect(() => submissionFeeItem(1, 0)).toThrow(TypeError);
  });
});

describe("the SLOP amount for a stablecoin fee", () => {
  test("is half the fee's value, rounded to two significant digits", () => {
    // 2.00 at 75.4717 SLOP per dollar: 75.4717 SLOP, which becomes 75.
    expect(slopFeeBase("2000000", "75.4717")).toBe(slop("75"));
    // 1.00: 37.73585 becomes 38. 10.00: 377.3585 becomes 380.
    expect(slopFeeBase("1000000", "75.4717")).toBe(slop("38"));
    expect(slopFeeBase("10000000", "75.4717")).toBe(slop("380"));
    // 5.00 at 150: exactly 375, which rounds half up to 380.
    expect(slopFeeBase("5000000", "150")).toBe(slop("380"));
    // 2.00 at 99.9: 99.9 becomes 100.
    expect(slopFeeBase("2000000", "99.9")).toBe(slop("100"));
  });

  test("stays exact below one SLOP and never reaches zero", () => {
    // SLOP at 4.00: 0.25 SLOP per dollar; 2.00 costs 0.25 SLOP.
    expect(slopFeeBase("2000000", "0.25")).toBe("250000000000000000");
    expect(BigInt(slopFeeBase("1000000", "0.000000000000000002"))).toBe(1n);
    expect(() => slopFeeBase("1", "0.000000000000000001")).toThrow(TypeError);
  });

  test("refuses a malformed fee or rate", () => {
    expect(() => slopFeeBase("0", "75")).toThrow(TypeError);
    expect(() => slopFeeBase("2.5", "75")).toThrow(TypeError);
    expect(() => slopFeeBase(2000000 as never, "75")).toThrow(TypeError);
    for (const bad of ["0", "-1", "1e2", "", "1.", ".5", "01", "7,5"])
      expect(() => slopFeeBase("2000000", bad)).toThrow(TypeError);
  });

  test("a rate round-trips through its text", () => {
    expect(slopRateText(slopRateScaled("75.4717"))).toBe("75.4717");
    expect(slopRateText(slopRateScaled("75"))).toBe("75");
    expect(slopRateText(75_471_698_113_207_547_169n)).toBe("75.471698");
    expect(slopRateText(999_999_500_000_000_000n)).toBe("1");
  });

  test("validStableFee keeps a project's fee inside 1.00 to 10.00", () => {
    expect(validStableFee("2000000")).toBe(true);
    expect(validStableFee("1000000")).toBe(true);
    expect(validStableFee("10000000")).toBe(true);
    expect(validStableFee("999999")).toBe(false);
    expect(validStableFee("10000001")).toBe(false);
    expect(validStableFee(2000000)).toBe(false);
    expect(validStableFee("2e6")).toBe(false);
  });
});

const RATES = [
  { effectiveAt: "2026-11-20T00:00:00.000Z", slopPerUsd: "100" },
  { effectiveAt: "2026-11-27T00:00:00.000Z", slopPerUsd: "50" },
  { effectiveAt: "2026-12-04T00:00:00.000Z", slopPerUsd: "200" },
];

describe("the rate in force", () => {
  test("there is none before the first rate", () => {
    expect(slopRatesAt(RATES, "2026-11-19T23:59:59.999Z")).toEqual({
      current: null,
      previous: null,
    });
    expect(slopFeeDueAt("2000000", RATES, "2026-11-19T23:59:59.999Z")).toBe(
      null,
    );
    expect(slopFeeDueAt("2000000", [], "2026-12-01T00:00:00.000Z")).toBe(null);
  });

  test("a rate applies from its own instant, in any row order", () => {
    const shuffled = [RATES[2], RATES[0], RATES[1]];
    expect(slopRatesAt(shuffled, "2026-11-20T00:00:00.000Z").current).toEqual(
      RATES[0],
    );
    expect(slopRatesAt(shuffled, "2026-11-26T23:59:59.999Z").current).toEqual(
      RATES[0],
    );
    expect(slopRatesAt(shuffled, "2026-11-27T00:00:00.000Z").current).toEqual(
      RATES[1],
    );
    // The first rate has no predecessor to accept.
    expect(slopRatesAt(shuffled, "2026-11-20T01:00:00.000Z").previous).toBe(
      null,
    );
  });

  test("the previous rate counts for exactly 48 hours after a change", () => {
    const inside = slopRatesAt(RATES, "2026-11-28T23:59:59.999Z");
    expect(inside.previous).toEqual({
      ...RATES[0],
      acceptedUntil: "2026-11-29T00:00:00.000Z",
    });
    expect(slopRatesAt(RATES, "2026-11-29T00:00:00.000Z").previous).toBe(null);
  });

  test("the amount due is the lower of the two during the 48 hours", () => {
    // 2.00: 100 SLOP at the old rate, 50 at the new one.
    expect(slopFeeDueAt("2000000", RATES, "2026-11-26T00:00:00.000Z")).toBe(
      slop("100"),
    );
    // The rate fell to 50: the new amount is already the lower one.
    expect(slopFeeDueAt("2000000", RATES, "2026-11-27T12:00:00.000Z")).toBe(
      slop("50"),
    );
    // The rate rose to 200: the old 50 still pays for 48 hours, then 200.
    expect(slopFeeDueAt("2000000", RATES, "2026-12-05T12:00:00.000Z")).toBe(
      slop("50"),
    );
    expect(slopFeeDueAt("2000000", RATES, "2026-12-06T00:00:00.000Z")).toBe(
      slop("200"),
    );
  });

  test("refuses a time or a stored rate that is not exact", () => {
    expect(() => slopRatesAt(RATES, "2026-11-27")).toThrow(TypeError);
    expect(() =>
      slopRatesAt(
        [{ effectiveAt: "2026-11-20T00:00:00Z", slopPerUsd: "1" }],
        "2026-11-27T00:00:00.000Z",
      ),
    ).toThrow(TypeError);
    expect(() =>
      slopRatesAt(
        [{ effectiveAt: "2026-11-20T00:00:00.000Z", slopPerUsd: "0" }],
        "2026-11-27T00:00:00.000Z",
      ),
    ).toThrow(TypeError);
  });
});

const ITEM = { stableMinor: "2000000", paidDepositId: null, outcome: null };
const AT = "2026-11-21T00:00:00.000Z";
const stable = (overrides = {}) => ({
  depositId: 7,
  token: USDC,
  amount: "2000000",
  keptTo: FEE_WALLET,
  blockTime: AT,
  ...overrides,
});
const inSlop = (overrides = {}) => ({
  depositId: 9,
  token: SLOP,
  amount: slop("100"),
  keptTo: SUBMISSION_FEE_BURN,
  blockTime: AT,
  ...overrides,
});

describe("whether a deposit counts", () => {
  test("the exact stablecoin fee to the fee wallet counts on each network", () => {
    expect(submissionDepositCounts(BASE, stable(), ITEM, RATES)).toEqual({
      accepted: true,
      kind: "stable",
      due: "2000000",
    });
    expect(
      submissionDepositCounts(RC, stable({ token: USDG }), ITEM, RATES),
    ).toEqual({ accepted: true, kind: "stable", due: "2000000" });
    // Addresses compare without case.
    expect(
      submissionDepositCounts(
        BASE,
        stable({
          token: USDC.toLowerCase(),
          keptTo: FEE_WALLET.toLowerCase(),
        }),
        ITEM,
        RATES,
      ).accepted,
    ).toBe(true);
  });

  test("more than the fee counts; one unit less does not", () => {
    expect(
      submissionDepositCounts(BASE, stable({ amount: "2000001" }), ITEM, RATES)
        .accepted,
    ).toBe(true);
    expect(
      submissionDepositCounts(BASE, stable({ amount: "1999999" }), ITEM, RATES),
    ).toEqual({ accepted: false, reason: "amount_below_due" });
  });

  test("the fee is the one the pull request was first asked for", () => {
    const asked = { ...ITEM, stableMinor: "5000000" };
    expect(submissionDepositCounts(BASE, stable(), asked, RATES)).toEqual({
      accepted: false,
      reason: "amount_below_due",
    });
    expect(
      submissionDepositCounts(BASE, stable({ amount: "5000000" }), asked, RATES)
        .accepted,
    ).toBe(true);
  });

  test("a pull request Slop never asked a fee for does not count", () => {
    expect(submissionDepositCounts(BASE, stable(), null, RATES)).toEqual({
      accepted: false,
      reason: "unknown_item",
    });
  });

  test("a token outside the table, or on the wrong network, does not count", () => {
    expect(
      submissionDepositCounts(
        BASE,
        stable({ token: `0x${"1".repeat(40)}` }),
        ITEM,
        RATES,
      ),
    ).toEqual({ accepted: false, reason: "token_not_accepted" });
    // USDG and SLOP are Robinhood Chain tokens; Base accepts only USDC.
    for (const token of [USDG, SLOP])
      expect(
        submissionDepositCounts(BASE, stable({ token }), ITEM, RATES),
      ).toEqual({ accepted: false, reason: "token_not_accepted" });
    expect(
      submissionDepositCounts("ethereum-mainnet", stable(), ITEM, RATES),
    ).toEqual({ accepted: false, reason: "token_not_accepted" });
    expect(submissionFeeTokenKind(RC, SLOP)).toBe("slop");
    expect(submissionFeeTokenKind(RC, "not an address")).toBe(null);
  });

  test("a kept fee must go to the fee wallet, and kept SLOP to the burn address", () => {
    expect(
      submissionDepositCounts(
        BASE,
        stable({ keptTo: SUBMISSION_FEE_BURN }),
        ITEM,
        RATES,
      ),
    ).toEqual({ accepted: false, reason: "wrong_kept_to" });
    expect(
      submissionDepositCounts(
        BASE,
        stable({ keptTo: `0x${"2".repeat(40)}` }),
        ITEM,
        RATES,
      ),
    ).toEqual({ accepted: false, reason: "wrong_kept_to" });
    expect(
      submissionDepositCounts(RC, inSlop({ keptTo: FEE_WALLET }), ITEM, RATES),
    ).toEqual({ accepted: false, reason: "wrong_kept_to" });
  });

  test("SLOP counts at the rate in force at the deposit's block time", () => {
    expect(submissionDepositCounts(RC, inSlop(), ITEM, RATES)).toEqual({
      accepted: true,
      kind: "slop",
      due: slop("100"),
    });
    expect(
      submissionDepositCounts(
        RC,
        inSlop({ amount: (BigInt(slop("100")) - 1n).toString() }),
        ITEM,
        RATES,
      ),
    ).toEqual({ accepted: false, reason: "amount_below_due" });
    // A stablecoin-sized number of SLOP base units is far below the fee.
    expect(
      submissionDepositCounts(RC, inSlop({ amount: "2000000" }), ITEM, RATES),
    ).toEqual({ accepted: false, reason: "amount_below_due" });
  });

  test("the previous SLOP amount still pays for 48 hours after the rate rises", () => {
    const old = inSlop({ amount: slop("50") });
    expect(
      submissionDepositCounts(
        RC,
        { ...old, blockTime: "2026-12-05T23:59:59.999Z" },
        ITEM,
        RATES,
      ).accepted,
    ).toBe(true);
    expect(
      submissionDepositCounts(
        RC,
        { ...old, blockTime: "2026-12-06T00:00:00.000Z" },
        ITEM,
        RATES,
      ),
    ).toEqual({ accepted: false, reason: "amount_below_due" });
  });

  test("SLOP does not count before any rate is in force", () => {
    expect(submissionDepositCounts(RC, inSlop(), ITEM, [])).toEqual({
      accepted: false,
      reason: "no_slop_rate",
    });
    // The stablecoin needs no rate.
    expect(
      submissionDepositCounts(RC, stable({ token: USDG }), ITEM, []).accepted,
    ).toBe(true);
  });

  test("a second deposit for a paid or decided pull request does not count", () => {
    const paid = { ...ITEM, paidNetwork: BASE, paidDepositId: 3 };
    expect(submissionDepositCounts(BASE, stable(), paid, RATES)).toEqual({
      accepted: false,
      reason: "item_already_paid",
    });
    // The same deposit id on another network is another deposit.
    expect(
      submissionDepositCounts(
        RC,
        stable({ token: USDG, depositId: 3 }),
        paid,
        RATES,
      ),
    ).toEqual({ accepted: false, reason: "item_already_paid" });
    // The deposit that paid stays accepted when it is read again.
    expect(
      submissionDepositCounts(BASE, stable({ depositId: 3 }), paid, RATES)
        .accepted,
    ).toBe(true);
    expect(
      submissionDepositCounts(
        BASE,
        stable({ depositId: 3 }),
        { ...paid, outcome: "refund_due" },
        RATES,
      ).accepted,
    ).toBe(true);
    expect(
      submissionDepositCounts(
        BASE,
        stable(),
        { ...ITEM, outcome: "refunded" },
        RATES,
      ),
    ).toEqual({ accepted: false, reason: "item_already_decided" });
  });

  test("a stored fee that is not a positive amount refuses the deposit", () => {
    for (const stableMinor of ["0", "", "2.5", null])
      expect(
        submissionDepositCounts(
          BASE,
          stable(),
          { ...ITEM, stableMinor: stableMinor as never },
          RATES,
        ),
      ).toEqual({ accepted: false, reason: "item_fee_invalid" });
  });

  test("a rehearsal's own token table replaces the mainnet one", () => {
    const terms = {
      tokens: { local: { usdc: `0x${"a".repeat(40)}` } },
      keptTo: { local: `0x${"b".repeat(40)}` },
    };
    const deposit = stable({
      token: `0x${"A".repeat(40)}`,
      keptTo: `0x${"B".repeat(40)}`,
    });
    expect(
      submissionDepositCounts("local", deposit, ITEM, RATES, terms).accepted,
    ).toBe(true);
    expect(submissionDepositCounts(BASE, deposit, ITEM, RATES, terms)).toEqual({
      accepted: false,
      reason: "token_not_accepted",
    });
  });
});

describe("what may be sent for a deposit", () => {
  const deposit = (overrides = {}) => ({
    depositId: 7,
    token: USDC,
    finalizedAt: "2026-11-21T00:30:00.000Z",
    state: "open",
    accepted: 1,
    ...overrides,
  });
  const paying = (outcome: string | null) => ({
    paidNetwork: BASE,
    paidDepositId: 7,
    outcome,
  });

  test("nothing before the deposit is finalized and judged", () => {
    expect(
      submissionResolveAction(
        BASE,
        deposit({ finalizedAt: null }),
        paying("refund_due"),
      ),
    ).toBe(null);
    expect(
      submissionResolveAction(
        BASE,
        deposit({ finalizedAt: null, accepted: 0 }),
        null,
      ),
    ).toBe(null);
    expect(
      submissionResolveAction(
        BASE,
        deposit({ accepted: null }),
        paying("kept_due"),
      ),
    ).toBe(null);
  });

  test("a deposit that does not count is refunded, whatever its item says", () => {
    expect(submissionResolveAction(BASE, deposit({ accepted: 0 }), null)).toBe(
      "refund",
    );
    expect(
      submissionResolveAction(
        BASE,
        deposit({ accepted: 0 }),
        paying("kept_due"),
      ),
    ).toBe("refund");
  });

  test("a deposit of a token outside the table is never resolved", () => {
    const junk = `0x${"9".repeat(40)}`;
    for (const item of [null, paying("refund_due"), paying("kept_due")])
      expect(
        submissionResolveAction(
          BASE,
          deposit({ token: junk, accepted: 0 }),
          item,
        ),
      ).toBe(null);
    // SLOP is accepted on Robinhood Chain only.
    expect(
      submissionResolveAction(
        BASE,
        deposit({ token: SLOP, accepted: 0 }),
        null,
      ),
    ).toBe(null);
    // A rehearsal's own token table decides, when one is given.
    expect(
      submissionResolveAction(
        BASE,
        deposit({ token: junk, accepted: 0 }),
        null,
        {
          tokens: { [BASE]: { usdc: junk } },
        },
      ),
    ).toBe("refund");
  });

  test("a counted deposit waits until its pull request is decided", () => {
    expect(submissionResolveAction(BASE, deposit(), paying(null))).toBe(null);
    expect(submissionResolveAction(BASE, deposit(), null)).toBe(null);
    expect(submissionResolveAction(BASE, deposit(), paying("refund_due"))).toBe(
      "refund",
    );
    expect(submissionResolveAction(BASE, deposit(), paying("kept_due"))).toBe(
      "keep",
    );
  });

  test("a fee is kept only for the deposit that paid that pull request", () => {
    expect(
      submissionResolveAction(BASE, deposit(), {
        ...paying("kept_due"),
        paidDepositId: 8,
      }),
    ).toBe(null);
    expect(
      submissionResolveAction(BASE, deposit(), {
        ...paying("kept_due"),
        paidNetwork: RC,
      }),
    ).toBe(null);
    expect(
      submissionResolveAction(BASE, deposit(), {
        ...paying("kept_due"),
        paidDepositId: null,
      }),
    ).toBe(null);
  });

  test("nothing is sent twice or after a reclaim", () => {
    for (const state of ["refunded", "kept", "reclaimed", "elsewhere"])
      expect(
        submissionResolveAction(BASE, deposit({ state }), paying("kept_due")),
      ).toBe(null);
    for (const outcome of ["refunded", "kept", "paid", ""])
      expect(submissionResolveAction(BASE, deposit(), paying(outcome))).toBe(
        null,
      );
  });
});

describe("the next rate", () => {
  const hours = (count: number, rate: string) =>
    Array.from({ length: count }, () => rate);
  const current = { effectiveAt: "2026-11-20T00:00:00.000Z", slopPerUsd: "75" };

  test("the average is taken over the price, not over SLOP per dollar", () => {
    // Prices 0.01 and 0.02 average 0.015, which is 66.666667 SLOP a dollar.
    expect(averageSlopRate(["100", "50"])).toBe("66.666667");
    expect(averageSlopRate(["75", "75", "75"])).toBe("75");
    expect(() => averageSlopRate([])).toThrow(TypeError);
  });

  test("the first rate needs a full day of readings", () => {
    const at = "2026-11-20T00:00:00.000Z";
    expect(
      nextSlopRate({
        current: null,
        at,
        week: hours(23, "75"),
        day: hours(23, "75"),
      }),
    ).toBe(null);
    expect(
      nextSlopRate({
        current: null,
        at,
        week: hours(24, "75"),
        day: hours(24, "75"),
      }),
    ).toEqual({ slopPerUsd: "75", reason: "first" });
  });

  test("a week-old rate is reset from the seven-day average", () => {
    const at = "2026-11-27T00:00:00.000Z";
    expect(
      nextSlopRate({
        current,
        at,
        week: hours(168, "80"),
        day: hours(24, "90"),
      }),
    ).toEqual({ slopPerUsd: "80", reason: "weekly" });
    // Under half the week read: the last rate stays.
    expect(
      nextSlopRate({
        current,
        at,
        week: hours(83, "80"),
        day: hours(24, "80"),
      }),
    ).toBe(null);
    // An unchanged average writes no new row.
    expect(
      nextSlopRate({
        current,
        at,
        week: hours(168, "75"),
        day: hours(24, "75"),
      }),
    ).toBe(null);
  });

  test("inside the week it changes only when the SLOP fee leaves 35% to 65%", () => {
    const at = "2026-11-23T00:00:00.000Z";
    const day = (rate: string) =>
      nextSlopRate({
        current,
        at,
        week: hours(72, rate),
        day: hours(24, rate),
      });
    // SLOP fell: 75 SLOP is worth 75/107.2 of a dollar, 34.98% of the fee.
    expect(slopFeeShareBps("75", "107.2")).toBe(3498);
    expect(day("107.2")).toEqual({ slopPerUsd: "107.2", reason: "drift" });
    expect(slopFeeShareBps("75", "107.1")).toBe(3501);
    expect(day("107.1")).toBe(null);
    // SLOP rose: at 57.6 a dollar the 75 SLOP fee is 65.1% of the fee.
    expect(slopFeeShareBps("75", "57.6")).toBe(6510);
    expect(day("57.6")).toEqual({ slopPerUsd: "57.6", reason: "drift" });
    expect(slopFeeShareBps("75", "57.7")).toBe(6499);
    expect(day("57.7")).toBe(null);
    expect(slopFeeShareBps("75", "75")).toBe(5000);
  });

  test("the source being unavailable keeps the last rate", () => {
    const at = "2026-11-23T00:00:00.000Z";
    expect(nextSlopRate({ current, at, week: [], day: [] })).toBe(null);
    expect(
      nextSlopRate({
        current,
        at,
        week: hours(11, "200"),
        day: hours(11, "200"),
      }),
    ).toBe(null);
    expect(
      nextSlopRate({
        current,
        at: "2026-12-20T00:00:00.000Z",
        week: [],
        day: [],
      }),
    ).toBe(null);
  });
});

describe("the ways to pay", () => {
  test("lists each stablecoin, and SLOP only while a rate is in force", () => {
    const before = submissionFeeOptions("2000000", [], AT);
    expect(before.map((option) => [option.network, option.symbol])).toEqual([
      [BASE, "USDC"],
      [RC, "USDG"],
    ]);
    const options = submissionFeeOptions("2000000", RATES, AT);
    expect(options.map((option) => option.symbol)).toEqual([
      "USDC",
      "USDG",
      "SLOP",
    ]);
    expect(options[0]).toEqual({
      network: BASE,
      chainId: 8453,
      contract: SUBMISSION_FEE_CONTRACTS[BASE],
      token: USDC,
      symbol: "USDC",
      decimals: 6,
      amount: "2000000",
      minimumAccepted: "2000000",
      keptTo: FEE_WALLET,
    });
    expect(options[2]).toMatchObject({
      network: RC,
      chainId: 4663,
      token: SLOP,
      decimals: 18,
      amount: slop("100"),
      minimumAccepted: slop("100"),
      keptTo: SUBMISSION_FEE_BURN,
    });
  });

  test("each network's deployed contract and its start block are published", () => {
    for (const network of [BASE, RC] as const) {
      expect(SUBMISSION_FEE_CONTRACTS[network]).toBe(
        "0xDe40B32A4156ABC2A05987367966d994BcFbf8D8",
      );
      expect(
        submissionFeeOptions("2000000", [], AT).find(
          (option) => option.network === network,
        )?.contract,
      ).toBe(SUBMISSION_FEE_CONTRACTS[network]);
    }
    expect(SUBMISSION_FEE_START_BLOCKS).toEqual({
      [BASE]: 59572869,
      [RC]: 118349901,
      // The Solana program is not deployed: no id, no start slot.
      "solana-mainnet": null,
    });
    expect(SUBMISSION_FEE_CONTRACTS["solana-mainnet"]).toBeNull();
    // A network without a contract is listed with none.
    expect(
      submissionFeeOptions("2000000", [], AT, {
        contracts: { [BASE]: null, [RC]: null },
      }).map((option) => option.contract),
    ).toEqual([null, null]);
  });

  test("every listed option is one a deposit of that amount satisfies", () => {
    for (const at of [AT, "2026-12-05T12:00:00.000Z"])
      for (const option of submissionFeeOptions("3000000", RATES, at))
        for (const amount of [option.amount, option.minimumAccepted])
          expect(
            submissionDepositCounts(
              option.network,
              {
                depositId: 1,
                token: option.token,
                amount,
                keptTo: option.keptTo,
                blockTime: at,
              },
              { stableMinor: "3000000" },
              RATES,
            ).accepted,
          ).toBe(true);
  });

  test("in a rate's 48 hours the lower previous amount is the minimum", () => {
    const slopOption = submissionFeeOptions(
      "2000000",
      RATES,
      "2026-12-05T12:00:00.000Z",
    ).find((option) => option.symbol === "SLOP");
    expect(slopOption?.amount).toBe(slop("200"));
    expect(slopOption?.minimumAccepted).toBe(slop("50"));
  });
});
