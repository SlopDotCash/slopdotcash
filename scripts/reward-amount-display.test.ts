import { describe, expect, test } from "bun:test";
import {
  formatMonthlyAmount,
  monthlyPoolValue,
} from "../src/lib/project-proposal";
import {
  hasProjectCardBounty,
  projectRewardSummaries,
  securityBountyAmountLabel,
} from "../src/lib/project-reward-summary";
import { PROJECTS } from "../src/lib/projects.mjs";
import {
  formatMicroUsdc,
  formatRewardCapDisplay,
  formatRewardMinor,
  monthlyPoolLabel,
} from "../src/lib/reward-amount";
import {
  formatAssetSymbol,
  REWARD_ASSET_NETWORKS,
} from "../src/lib/reward-asset.mjs";
import { formatSecurityAmount } from "../src/lib/security-bounty.mjs";
import {
  bountyAmountFields,
  bountyAmountPreview,
} from "../src/lib/security-bounty-proposal";

const oneEth = "1000000000000000000";
const eth = { kind: "native" as const, decimals: 18, symbol: "ETH" };
const token = { kind: "token" as const, decimals: 18, symbol: "OPEN" };
const usdc = { kind: "stablecoin" as const, decimals: 6, symbol: "USDC" };

test("a points-only ordinary project names its existing open critical bounty without changing terms", () => {
  const project = {
    reward: { kind: "monthly-pool" as const, monthlyCapMinor: "0" },
    securityBounty: {
      rewardMode: "separate" as const,
      status: "open" as const,
      eligibility: "critical-loss-of-funds" as const,
      amount: {
        currency: "USDC",
        decimals: 6,
        network: "base" as const,
        grossMinor: "10000000000",
      },
      funding: { state: "pledged" as const },
    },
  };
  const original = structuredClone(project);
  expect(hasProjectCardBounty(project)).toBe(true);
  expect(securityBountyAmountLabel(project.securityBounty)).toBe("$10k");
  expect(project).toEqual(original);
  for (const status of [
    "draft",
    "pending-approval",
    "paused",
    "closed",
  ] as const)
    expect(
      hasProjectCardBounty({
        ...project,
        securityBounty: { ...project.securityBounty, status },
      }),
    ).toBe(false);
  expect(
    hasProjectCardBounty({
      ...project,
      reward: { ...project.reward, monthlyCapMinor: "1000000000" },
    }),
  ).toBe(false);
  expect(
    hasProjectCardBounty({
      ...project,
      reward: { ...project.reward, kind: "external-prize-share" },
    }),
  ).toBe(false);
  expect(hasProjectCardBounty({ reward: project.reward })).toBe(false);
  expect(
    hasProjectCardBounty({
      ...project,
      securityBounty: {
        ...project.securityBounty,
        rewardMode: "bounty-only",
        status: "closed",
      },
    }),
  ).toBe(true);
});

describe("formatRewardMinor", () => {
  test("shows a native amount in that coin", () => {
    const shown = formatRewardMinor(oneEth, eth);
    expect(shown).toBe("1 ETH");
    expect(shown).not.toBe(formatMicroUsdc(oneEth));
  });

  test("shows a token amount in that token, including a fractional unit", () => {
    expect(formatRewardMinor(oneEth, token)).toBe("1 $OPEN");
    expect(formatRewardMinor("1500000000000000000", token)).toBe("1.5 $OPEN");
    expect(formatRewardMinor("1000000", { ...token, decimals: 18 })).toBe(
      "0.000000000001 $OPEN",
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

test("project-token labels have one dollar prefix while the supported main assets have none", () => {
  for (const [symbol, expected] of [
    ["CREDIT", "$CREDIT"],
    ["$CREDIT", "$CREDIT"],
    ["EPYH", "$EPYH"],
    ["$EPYH", "$EPYH"],
    ["$$EPYH", "$EPYH"],
  ])
    expect(formatAssetSymbol(symbol, "token")).toBe(expected);
  for (const network of Object.values(REWARD_ASSET_NETWORKS))
    for (const [kind, asset] of [
      ["native", network.native],
      ["stablecoin", network.stablecoin],
    ] as const) {
      expect(formatAssetSymbol(asset.symbol, kind)).toBe(asset.symbol);
      expect(formatAssetSymbol(`$${asset.symbol}`, kind)).toBe(asset.symbol);
      expect(formatAssetSymbol(asset.symbol)).toBe(asset.symbol);
    }
  expect(formatAssetSymbol("CREDIT")).toBe("$CREDIT");
  for (const [symbol, expected] of [
    ["ETH", "ETH"],
    ["$ETH", "ETH"],
    ["SOL", "SOL"],
    ["$SOL", "SOL"],
    ["USDC", "USDC"],
    ["$USDC", "USDC"],
    ["USDG", "USDG"],
    ["$USDG", "USDG"],
    ["USD", "USD"],
    ["$USD", "USD"],
  ])
    expect(formatAssetSymbol(symbol, "token")).toBe(expected);
});

test("draft and funding previews format tickers without changing canonical draft amounts", () => {
  const amount = bountyAmountFields({
    mode: "monthly",
    network: "ethereum",
    assetKind: "token",
    tokenAddress: `0x${"a".repeat(40)}`,
    tokenSymbol: "CREDIT",
    monthlyAmount: "2000",
  });
  const original = structuredClone(amount);
  expect(amount.grossMinor).toBe("0");
  expect(bountyAmountPreview(amount, "2000")).toEqual({
    gross: "2000 $CREDIT",
    researcher: "75%",
    slop: "25%",
  });
  expect(amount).toEqual(original);
  expect(formatMonthlyAmount("1500000", 6, "CREDIT")).toBe("1.5 $CREDIT");
  expect(formatMonthlyAmount("1500000", 6, "$EPYH")).toBe("1.5 $EPYH");
  expect(formatMonthlyAmount("1500000", 6, "USDC")).toBe("1.5 USDC");
  expect(formatMonthlyAmount("1500000", 6, "USD")).toBe("1.5 USD");
  const pool = monthlyPoolValue("1000.5", { symbol: "CREDIT", decimals: 6 });
  expect(pool.display).toBe("1,000.5 CREDIT");
  expect(pool.minor).toBe("1000500000");
  expect(
    formatRewardCapDisplay(pool.display, { kind: "token", symbol: "CREDIT" }),
  ).toBe("1,000.5 $CREDIT");
  expect(pool.display).toBe("1,000.5 CREDIT");
  expect(
    formatRewardCapDisplay("10,000,000 $EPYH", {
      kind: "token",
      symbol: "$EPYH",
    }),
  ).toBe("10,000,000 $EPYH");
  expect(
    formatRewardCapDisplay("1 A$$B", { kind: "token", symbol: "A$$B" }),
  ).toBe("1 $A$$B");
  expect(
    formatRewardCapDisplay("1.5 SOL", { kind: "native", symbol: "SOL" }),
  ).toBe("1.5 SOL");
  expect(formatRewardCapDisplay("$1,000", usdc)).toBe("$1,000");
});

test("security award labels distinguish project tokens, native coins, stablecoins and dollar amounts", () => {
  const amount = {
    currency: "CREDIT",
    decimals: 6,
    asset: { kind: "token" as const, symbol: "CREDIT" },
  };
  expect(formatSecurityAmount("2000000000", amount)).toBe("2,000 $CREDIT");
  expect(formatSecurityAmount("1500000000", amount)).toBe("1,500 $CREDIT");
  expect(
    formatSecurityAmount("1500000000", {
      ...amount,
      currency: "$EPYH",
      asset: { kind: "token", symbol: "$EPYH" },
    }),
  ).toBe("1,500 $EPYH");
  expect(
    formatSecurityAmount("1500000000", {
      currency: "SOL",
      decimals: 9,
      asset: { kind: "native", symbol: "SOL" },
    }),
  ).toBe("1.5 SOL");
  for (const symbol of ["USDC", "USDG"])
    expect(
      formatSecurityAmount("1000000000", {
        currency: symbol,
        decimals: 6,
        asset: { kind: "stablecoin", symbol },
      }),
    ).toBe(`1,000 ${symbol}`);
  expect(
    formatSecurityAmount("1000000000", { currency: "USD", decimals: 6 }),
  ).toBe("$1,000");
  expect(
    formatSecurityAmount("1000000000", { currency: "USDC", decimals: 6 }),
  ).toBe("1,000 USDC");
});

test("compact public reward summaries keep the asset kind without changing stored terms", () => {
  const source = PROJECTS.find(
    (project) => project.reward.kind === "monthly-pool",
  );
  if (!source) throw Error("Expected a monthly-pool fixture");
  const base = {
    ...source,
    reward: { ...source.reward, monthlyCapMinor: oneEth },
    rewardAsset: {
      ...eth,
      network: "ethereum" as const,
      address: REWARD_ASSET_NETWORKS.ethereum.native.address,
      chainId: REWARD_ASSET_NETWORKS.ethereum.chainId,
      cluster: null,
      verifiedAt: "2026-10-29T00:00:00.000Z",
    },
  };
  expect(projectRewardSummaries(base)).toContainEqual({
    kind: "monthly-pool",
    amount: "1",
    token: { symbol: "ETH", url: "https://etherscan.io/" },
  });
  const custom = {
    ...base,
    rewardAsset: {
      ...base.rewardAsset,
      kind: "token" as const,
      symbol: "$EPYH",
    },
  };
  expect(projectRewardSummaries(custom)[0]).toMatchObject({
    token: { symbol: "$EPYH" },
  });
  expect(base.rewardAsset.symbol).toBe("ETH");
  expect(custom.rewardAsset.symbol).toBe("$EPYH");
  expect(source.reward.monthlyCapDisplay).toBe(base.reward.monthlyCapDisplay);
  expect(
    securityBountyAmountLabel({
      amount: {
        currency: "CREDIT",
        decimals: 6,
        network: "ethereum",
        grossMinor: "2000000000",
        asset: { ...custom.rewardAsset, decimals: 6, symbol: "CREDIT" },
      },
    }),
  ).toBe("2k $CREDIT");
  expect(
    securityBountyAmountLabel({
      amount: {
        currency: "USDC",
        decimals: 6,
        network: "base",
        grossMinor: "10000000000",
      },
    }),
  ).toBe("$10k");
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

  test("formats stored project token caps without rewriting their display metadata", () => {
    const reward = {
      committedMinor: "0",
      fundingState: "pledged" as const,
      monthlyCapDisplay: "1,000.5 CREDIT",
    };
    expect(monthlyPoolLabel(reward, { ...token, symbol: "CREDIT" })).toBe(
      "1,000.5 $CREDIT monthly · not funded",
    );
    expect(reward.monthlyCapDisplay).toBe("1,000.5 CREDIT");
  });
});
