import { expect, test } from "bun:test";
import {
  formatMonthlyAmount,
  monthlyPoolValue,
  rewardFields,
  type FundingChoice,
} from "../src/lib/project-proposal";
import { REWARD_ASSET_NETWORKS, REWARD_ASSET_NETWORK_IDS } from "../src/lib/reward-asset.mjs";

const at = new Date("2026-11-09T12:34:56.000Z");
const choice: FundingChoice = { mode: "monthly", network: "base", assetKind: "stablecoin",
  tokenAddress: "", tokenSymbol: "", monthlyAmount: "1.25" };

test("USD proposal amounts use exact cent-precise base units", () => {
  expect(monthlyPoolValue("1200.50")).toEqual({ display: "$1,200.50", minor: "1200500000", valid: true });
  expect(monthlyPoolValue("0.01")).toEqual({ display: "$0.01", minor: "10000", valid: true });
  expect(monthlyPoolValue("0.000001")).toMatchObject({ display: "$0", minor: "0", valid: false });
});

test("USD display limit is inclusive and rejects an extra cent", () => {
  expect(monthlyPoolValue("1000000000")).toEqual({ display: "$1,000,000,000", minor: "1000000000000000", valid: true });
  expect(monthlyPoolValue("1000000000.01")).toMatchObject({ minor: "0", valid: false });
});

test.each(["", " ", "0", "0.000"])("empty/zero spelling %s keeps the positive-amount error", (value) => {
  expect(monthlyPoolValue(value)).toMatchObject({ valid: false, minor: "0", error: "Enter a positive amount." });
});

test.each([" 1", "01", "1e3"])("plain-decimal validation rejects %s without trimming or coercion", (value) => {
  expect(monthlyPoolValue(value)).toEqual({ display: "$0", minor: "0", valid: false, error: "Use up to 2 decimals, at most 1 billion." });
});

test("unknown token precision keeps exact input display and stages zero", () => {
  expect(monthlyPoolValue("1.2300", { symbol: "TKN" }))
    .toEqual({ display: "1.2300 TKN", minor: "0", valid: true });
});

test("unknown token precision does not claim a u128-verified cap", () => {
  const value = `9999999999999.${"9".repeat(36)}`;
  expect(monthlyPoolValue(value, { symbol: "TKN" }))
    .toEqual({ display: `${value} TKN`, minor: "0", valid: true });
  expect(monthlyPoolValue("9999999999999", { symbol: "TKN", decimals: 36 }))
    .toMatchObject({ display: "0 TKN", minor: "0", valid: false, error: "monthly amount is too large" });
});

test("known token precision normalizes display and returns exact units", () => {
  expect(monthlyPoolValue("1.20", { symbol: "TKN", decimals: 2 }))
    .toEqual({ display: "1.2 TKN", minor: "120", valid: true });
  expect(monthlyPoolValue("1", { symbol: "NFT", decimals: 0 }))
    .toEqual({ display: "1 NFT", minor: "1", valid: true });
});

test("zero error precedence survives an excessive fraction", () => {
  expect(monthlyPoolValue("0.0", { symbol: "NFT", decimals: 0 }))
    .toMatchObject({ valid: false, minor: "0", error: "Enter a positive amount." });
});

test("invalid known precision is caught while symbol contents are not validated here", () => {
  expect(monthlyPoolValue("1", { symbol: "TKN", decimals: -1 }))
    .toMatchObject({ valid: false, minor: "0" });
  expect(monthlyPoolValue("1", { symbol: "not a validated symbol" }))
    .toEqual({ display: "1 not a validated symbol", minor: "0", valid: true });
});

test("standalone amount formatting does not impose the funding cap", () => {
  expect(formatMonthlyAmount("340282366920938463463374607431768211456", 0, "T"))
    .toBe("340,282,366,920,938,463,463,374,607,431,768,211,456 T");
  expect(formatMonthlyAmount("1234500", 2, "TKN")).toBe("12,345 TKN");
  expect(formatMonthlyAmount("10020", 2, "TKN")).toBe("100.2 TKN");
  expect(formatMonthlyAmount("0", 0, "")).toBe("0 ");
});

test.each([
  ["01", 6], ["1e3", 6], ["1", -1], ["1", 37], ["1", 1.5],
] as const)("standalone format rejects invalid amount/precision %s/%s", (value, decimals) => {
  expect(() => formatMonthlyAmount(value, decimals, "TKN")).toThrow();
});

test("unfunded staging ignores selected network and token fields", () => {
  const value = rewardFields({ ...choice, mode: "none", network: "unsupported", assetKind: "token",
    tokenAddress: "invalid", tokenSymbol: "unvalidated", monthlyAmount: "invalid" }, at);
  expect(value).not.toHaveProperty("escrow");
  expect(value).not.toHaveProperty("rewardAsset");
  expect(value.reward).toMatchObject({ chain: "base", currency: "USDC", monthlyCapMinor: "0",
    monthlyCapDisplay: "$0", committedMinor: "0", paymentMode: "disabled", feeBasisPoints: 100,
    fundingState: "pledged", rewardStartAt: at.toISOString() });
});

test.each(REWARD_ASSET_NETWORK_IDS)("stablecoin staging on %s remains unfunded and disabled", (network) => {
  const value = rewardFields({ ...choice, network }, at);
  const expected = REWARD_ASSET_NETWORKS[network].stablecoin;
  expect(value.rewardAsset).toEqual({ network, kind: "stablecoin", address: expected.address, symbol: expected.symbol });
  expect(value.reward).toMatchObject({ currency: expected.symbol, chain: network, monthlyCapMinor: "1250000",
    monthlyCapDisplay: "$1.25", committedMinor: "0", paymentMode: "disabled", feeBasisPoints: 200, fundingState: "pledged" });
  expect(value.escrow).toMatchObject({ chain: network, effectiveCycle: "2026-11", deployments: [],
    feeBasisPoints: 200, feeMode: "deduct-from-gross" });
});

test.each(REWARD_ASSET_NETWORK_IDS)("native staging on %s uses its native precision and symbol", (network) => {
  const value = rewardFields({ ...choice, network, assetKind: "native", monthlyAmount: "0.000000001" }, at);
  const native = REWARD_ASSET_NETWORKS[network].native;
  expect(value.rewardAsset).toEqual({ network, kind: "native", address: native.address, symbol: native.symbol });
  expect(value.reward).toMatchObject({ currency: native.symbol,
    monthlyCapMinor: native.decimals === 9 ? "1" : "1000000000",
    monthlyCapDisplay: `0.000000001 ${native.symbol}`, paymentMode: "disabled" });
});

test("custom token staging trims but delegates validation and decimal discovery", () => {
  const value = rewardFields({ ...choice, assetKind: "token", tokenAddress: " not-a-token ",
    tokenSymbol: " TKN ", monthlyAmount: "not-an-amount" }, at);
  expect(value.rewardAsset).toEqual({ network: "base", kind: "token", address: "not-a-token", symbol: "TKN" });
  expect(value.reward).toMatchObject({ monthlyCapMinor: "0", monthlyCapDisplay: "0 TKN", committedMinor: "0", paymentMode: "disabled" });
});

test("custom token helper does not itself refuse an unknown network", () => {
  const value = rewardFields({ ...choice, network: "unsupported", assetKind: "token", tokenSymbol: "TKN" }, at);
  expect(value).not.toHaveProperty("escrow");
  expect(value.rewardAsset).toMatchObject({ network: "unsupported", kind: "token" });
  expect(value.reward).toMatchObject({ chain: "unsupported", monthlyCapMinor: "0", feeBasisPoints: 100 });
});

test.each(["native", "stablecoin"] as const)("unknown %s network is refused by asset selection", (assetKind) => {
  expect(() => rewardFields({ ...choice, network: "unsupported", assetKind }, at)).toThrow("Choose a supported reward network");
});

test("invalid native amount is staged as zero, leaving validity to the form", () => {
  const value = rewardFields({ ...choice, assetKind: "native", monthlyAmount: "-1" }, at);
  expect(value.reward).toMatchObject({ monthlyCapMinor: "0", monthlyCapDisplay: "0 ETH", paymentMode: "disabled" });
});

test.each(["none", "monthly"] as const)("%s staging requires a valid Date", (mode) => {
  expect(() => rewardFields({ ...choice, mode }, new Date(NaN))).toThrow();
});
