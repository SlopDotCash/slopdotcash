import { describe, expect, test } from "bun:test";
import {
  formatMicroUsdc,
  formatRewardMinor,
  monthlyPoolLabel,
} from "../src/lib/reward-amount";

const oneEth = "1000000000000000000";
const eth = { kind: "native" as const, decimals: 18, symbol: "ETH" };
const token = { kind: "token" as const, decimals: 18, symbol: "OPEN" };
const usdc = { kind: "stablecoin" as const, decimals: 6, symbol: "USDC" };

describe("formatRewardMinor", () => {
  test("shows a native amount in that coin", () => {
    const shown = formatRewardMinor(oneEth, eth);
    expect(shown).toBe("1 ETH");
    expect(shown).not.toBe(formatMicroUsdc(oneEth));
  });

  test("shows a token amount in that token, including a fractional unit", () => {
    expect(formatRewardMinor(oneEth, token)).toBe("1 OPEN");
    expect(formatRewardMinor("1500000000000000000", token)).toBe("1.5 OPEN");
    expect(formatRewardMinor("1000000", { ...token, decimals: 18 })).toBe(
      "0.000000000001 OPEN",
    );
  });

  test("shows SOL in lamports", () => {
    expect(
      formatRewardMinor("1500000000", {
        kind: "native",
        decimals: 9,
        symbol: "SOL",
      }),
    ).toBe("1.5 SOL");
  });

  test("keeps a stablecoin and a legacy pool in USDC", () => {
    expect(formatRewardMinor("1000000", usdc)).toBe("$1");
    expect(formatRewardMinor("1000000")).toBe("$1");
    expect(formatRewardMinor("2500000", usdc)).toBe("$2.50");
    expect(formatRewardMinor("0", eth)).toBe("0 ETH");
  });

  test("rejects a token amount that is not canonical base units", () => {
    expect(() => formatRewardMinor("1.5", token)).toThrow(TypeError);
    expect(() => formatRewardMinor("01", token)).toThrow(TypeError);
    expect(() => formatRewardMinor(oneEth, { ...token, decimals: 37 })).toThrow(
      RangeError,
    );
  });
});

describe("monthlyPoolLabel", () => {
  test("names a funded token or native balance in that asset", () => {
    const reward = {
      committedMinor: oneEth,
      fundingState: "committed" as const,
      monthlyCapDisplay: "1 ETH",
    };
    expect(monthlyPoolLabel(reward, eth)).toBe("1 ETH funded · 1 ETH monthly");
    expect(monthlyPoolLabel(reward, eth)).not.toContain(
      formatMicroUsdc(oneEth),
    );
  });

  test("keeps a funded stablecoin and a legacy pool in dollars", () => {
    const reward = {
      committedMinor: "1000000000",
      fundingState: "committed" as const,
      monthlyCapDisplay: "$1,000",
    };
    expect(monthlyPoolLabel(reward, usdc)).toBe(
      "$1,000 funded · $1,000 monthly",
    );
    expect(monthlyPoolLabel(reward)).toBe("$1,000 funded · $1,000 monthly");
  });

  test("leaves an unfunded cap on its stored display", () => {
    expect(
      monthlyPoolLabel(
        {
          committedMinor: "0",
          fundingState: "pledged",
          monthlyCapDisplay: "1 ETH",
        },
        eth,
      ),
    ).toBe("1 ETH monthly · not funded");
  });
});
