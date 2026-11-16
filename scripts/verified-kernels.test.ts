import { describe, expect, it } from "bun:test";
import { isBaseUnits } from "../src/lib/escrow-policy.mjs";
import { isFundingAddress } from "../src/lib/funding-address.mjs";
import { githubUserIdFromNodeId } from "../src/lib/github-actor";
import {
  mergedPullRequestPoints,
  shareScoreThirds,
} from "../src/lib/leaderboard";
import { cycleBounds } from "../src/lib/project-view";
import { eventThirds } from "../src/lib/score-penalties";
import { securityBountySplit } from "../src/lib/security-bounty.mjs";
import { daysInMonth, monthStartDay } from "../src/lib/verified-calendar";
import {
  combineAwards,
  payoutAmountsAccepted,
} from "../src/lib/verified-money";
import { nextReplacementFees } from "../workers/verified-fee-replacement";

describe("verified merge credit", () => {
  it("equals max(1, ceil(10 / sqrt(n))) for every ordinal up to 2,000,000", () => {
    let mismatches = 0;
    for (let ordinal = 1; ordinal <= 2_000_000; ordinal += 1)
      if (
        mergedPullRequestPoints(ordinal) !==
        Math.max(1, Math.ceil(10 / Math.sqrt(ordinal)))
      )
        mismatches += 1;
    expect(mismatches).toBe(0);
    expect([1, 2, 4, 25, 26, 99, 100].map(mergedPullRequestPoints)).toEqual([
      10, 8, 5, 2, 2, 2, 1,
    ]);
  });
});

describe("verified UTC calendar", () => {
  it("matches Date.UTC month starts and lengths for years 100 to 9999", () => {
    let mismatches = 0;
    for (let year = 100; year <= 9999; year += 1)
      for (let month = 1; month <= 12; month += 1) {
        if (
          monthStartDay(year, month) * 86_400_000 !==
          Date.UTC(year, month - 1, 1)
        )
          mismatches += 1;
        if (
          daysInMonth(year, month) !==
          new Date(Date.UTC(year, month, 0)).getUTCDate()
        )
          mismatches += 1;
      }
    expect(mismatches).toBe(0);
  });

  it("bounds a reward cycle by its first and next month", () => {
    expect(cycleBounds("2026-12")).toEqual({
      from: Date.UTC(2026, 11, 1),
      to: Date.UTC(2027, 0, 1),
    });
    expect(cycleBounds("2028-02").to - cycleBounds("2028-02").from).toBe(
      29 * 86_400_000,
    );
  });
});

describe("verified score shares", () => {
  it("conserves the total and keeps the one-third floor", () => {
    expect(shareScoreThirds(10, 3)).toEqual([4, 3, 3]);
    expect(shareScoreThirds(2, 3)).toEqual([1, 1, 1]);
    expect(shareScoreThirds(2, 3, 0)).toEqual([1, 1, 0]);
    expect(() => shareScoreThirds(0, 2)).toThrow(TypeError);
  });

  it("rounds a fractional legacy point value to whole thirds in every ledger path", () => {
    expect(eventThirds({ points: 0.1 + 0.2 })).toBe(1);
    expect(eventThirds({ points: 2, scoreThirds: 5 })).toBe(5);
  });
});

describe("verified security split", () => {
  it("splits 75/25 exactly or pays a full award", () => {
    expect(
      securityBountySplit("1000", {
        researcherBasisPoints: 7500,
        slopBasisPoints: 2500,
      }),
    ).toEqual({ grossMinor: "1000", researcherMinor: "750", slopMinor: "250" });
    expect(() =>
      securityBountySplit("1001", {
        researcherBasisPoints: 7500,
        slopBasisPoints: 2500,
      }),
    ).toThrow(RangeError);
  });
});

describe("verified fee replacement", () => {
  it("raises fees 25% per step and stops at three times the original", () => {
    expect(nextReplacementFees(100n, 10n, 100n, 10n, 1_000n)).toEqual({
      ok: true,
      maxFeePerGas: 125n,
      maxPriorityFeePerGas: 13n,
    });
    expect(nextReplacementFees(100n, 10n, 290n, 29n, 1_000n).ok).toBe(false);
    expect(nextReplacementFees(100n, 10n, 100n, 10n, 105n).ok).toBe(false);
  });
});

describe("verified identifiers and base units", () => {
  it("decodes only canonical uint32 and uint64 GitHub user payloads", () => {
    const node = (bytes: number[]) =>
      `U_${btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "")}`;
    expect(
      githubUserIdFromNodeId(node([0x92, 0, 0xce, 0, 0, 0x30, 0x39])),
    ).toBe("12345");
    expect(
      githubUserIdFromNodeId(node([0x92, 0, 0xcd, 0x30, 0x39])),
    ).toBeNull();
    expect(
      githubUserIdFromNodeId(
        node([0x92, 0, 0xcf, 0, 0, 0, 0, 0, 0, 0x30, 0x39]),
      ),
    ).toBeNull();
    expect(
      githubUserIdFromNodeId(node([0x92, 0, 0xcf, 0, 0, 0, 1, 0, 0, 0, 0])),
    ).toBe("4294967296");
    expect(
      githubUserIdFromNodeId(node([0x92, 0, 0xce, 0, 0, 0, 0])),
    ).toBeNull();
  });

  it("accepts lowercase nonzero EVM accounts only", () => {
    expect(isFundingAddress("base", `0x${"a".repeat(40)}`)).toBe(true);
    expect(isFundingAddress("base", `0x${"0".repeat(40)}`)).toBe(false);
    expect(isFundingAddress("base", `0x${"A".repeat(40)}`)).toBe(false);
    expect(isFundingAddress("base", `0x${"a".repeat(39)}`)).toBe(false);
  });

  it("accepts canonical base units up to 2^128 - 1", () => {
    const max = ((1n << 128n) - 1n).toString();
    expect([max, "0", "7"].every(isBaseUnits)).toBe(true);
    expect(
      [(1n << 128n).toString(), "01", "", "1e3", "-1", "١", 7].some(
        isBaseUnits,
      ),
    ).toBe(false);
  });
});

describe("verified payout amounts", () => {
  it("accepts either ordinary fee rounding or the exact bounty quarter", () => {
    expect(payoutAmountsAccepted(101n, 3n, 98n, false)).toBe(true);
    expect(payoutAmountsAccepted(101n, 2n, 99n, false)).toBe(true);
    expect(payoutAmountsAccepted(101n, 4n, 97n, false)).toBe(false);
    expect(payoutAmountsAccepted(100n, 25n, 75n, true)).toBe(true);
    expect(payoutAmountsAccepted(100n, 2n, 98n, true)).toBe(false);
    expect(payoutAmountsAccepted(100n, 2n, 99n, false)).toBe(false);
  });

  it("combines pool and review awards within both caps", () => {
    const combined = combineAwards([60n, 40n], [0n, 10n], 100n, 10n);
    expect(combined.ok).toBe(true);
    expect(combined.awards).toEqual([
      { gross: 60n, fee: 2n, net: 58n },
      { gross: 50n, fee: 1n, net: 49n },
    ]);
    expect(combineAwards([60n, 41n], [0n, 10n], 100n, 10n).ok).toBe(false);
    expect(combineAwards([-1n], [0n], 100n, 10n).ok).toBe(false);
  });
});
