// spec/frontend/presentation.md, "Project tokens have one dollar prefix while native and approved stablecoin tickers have none"; spec/frontend/presentation.md, "Amounts display exactly in their asset's decimals with grouped whole digits and no trailing fraction zeros"
import { type AssetTicker, assetSymbol, formatAssetAmount, formatRewardCapDisplay, formatRewardMinor, knownAsset, monthlyPoolLabel, networkLabel, type PaymentAsset, type PoolCommitment, type RewardAmountAsset } from "./assetText.ts";
import { vectors } from "./vectors.ts";

const oneEth = 10n ** 18n;
const eth: RewardAmountAsset = { kind: "native", decimals: 18, symbol: "ETH" };
const sol: RewardAmountAsset = { kind: "native", decimals: 9, symbol: "SOL" };
const open: RewardAmountAsset = { kind: "token", decimals: 18, symbol: "OPEN" };
const credit: RewardAmountAsset = { kind: "token", decimals: 18, symbol: "CREDIT" };
const usdc: RewardAmountAsset = { kind: "stablecoin", decimals: 6, symbol: "USDC" };

export const rewardAmountsKeepTheirOwnAsset = vectors<readonly [bigint, RewardAmountAsset | undefined], string>([
  [[oneEth, eth], "1 ETH"],
  [[oneEth, open], "1 $OPEN"],
  [[1_500_000_000_000_000_000n, open], "1.5 $OPEN"],
  [[1_000_000n, open], "0.000000000001 $OPEN"],
  [[1_500_000_000n, sol], "1.5 SOL"],
  [[1_000_000n, usdc], "$1"],
  [[1_000_000n, undefined], "$1"],
  [[2_500_000n, usdc], "$2.5"],
  [[0n, eth], "0 ETH"],
  [[1_234_567n, usdc], "$1.234567"],
  [[1_005_000n, usdc], "$1.005"],
  [[999_995_000n, usdc], "$999.995"],
  [[4_999n, undefined], "$0.004999"],
  [[12_345_678n, { kind: "stablecoin", decimals: 18, symbol: "USDG" }], "$0.000000000012345678"],
  [[1_000_000_000_000n, undefined], "$1,000,000"],
], ([minor, asset]) => formatRewardMinor(minor, asset));

export const tickersFollowTheAssetKindNotTheSpelling = vectors<AssetTicker, string | undefined>([
  [{ kind: "token", symbol: "CREDIT" }, "$CREDIT"],
  [{ kind: "token", symbol: "$CREDIT" }, "$CREDIT"],
  [{ kind: "token", symbol: "EPYH" }, "$EPYH"],
  [{ kind: "token", symbol: "$$EPYH" }, "$EPYH"],
  [{ kind: "token", symbol: "ETH" }, "$ETH"],
  [{ kind: "native", symbol: "ETH" }, "ETH"],
  [{ kind: "native", symbol: "$SOL" }, "SOL"],
  [{ kind: "stablecoin", symbol: "USDC" }, "USDC"],
  [{ kind: "stablecoin", symbol: "$USDG" }, "USDG"],
  [{ kind: "token", symbol: "" }, undefined],
  [{ kind: "token", symbol: "$$" }, undefined],
], assetSymbol);

export const capDisplaysSwapOnlyTheirUnit = vectors<readonly [string, AssetTicker | undefined], string>([
  [["1,000.5 CREDIT", { kind: "token", symbol: "CREDIT" }], "1,000.5 $CREDIT"],
  [["10,000,000 $EPYH", { kind: "token", symbol: "$EPYH" }], "10,000,000 $EPYH"],
  [["1 A$$B", { kind: "token", symbol: "A$$B" }], "1 $A$$B"],
  [["1.5 SOL", { kind: "native", symbol: "SOL" }], "1.5 SOL"],
  [["$1,000", usdc], "$1,000"],
  [["$1,000", undefined], "$1,000"],
  [["0 TOKEN", { kind: "token", symbol: "CREDIT" }], "0 $CREDIT"],
], ([display, asset]) => formatRewardCapDisplay(display, asset));

export const monthlyPoolLabelsNameTheirFunding = vectors<readonly [PoolCommitment, RewardAmountAsset | undefined], string>([
  [[{ committedMinor: oneEth, fundingState: "committed", monthlyCapDisplay: "1 ETH" }, eth], "1 ETH funded · 1 ETH monthly"],
  [[{ committedMinor: 1_000_000_000n, fundingState: "committed", monthlyCapDisplay: "$1,000" }, usdc], "$1,000 funded · $1,000 monthly"],
  [[{ committedMinor: 1_000_000_000n, fundingState: "committed", monthlyCapDisplay: "$1,000" }, undefined], "$1,000 funded · $1,000 monthly"],
  [[{ committedMinor: 1_234_567n, fundingState: "committed", monthlyCapDisplay: "$250" }, usdc], "$1.234567 funded · $250 monthly"],
  [[{ committedMinor: 0n, fundingState: "pledged", monthlyCapDisplay: "1 ETH" }, eth], "1 ETH monthly · not funded"],
  [[{ committedMinor: 0n, fundingState: "pledged", monthlyCapDisplay: "1,000.5 CREDIT" }, credit], "1,000.5 $CREDIT monthly · not funded"],
  [[{ committedMinor: 0n, fundingState: "committed", monthlyCapDisplay: "$250" }, usdc], "$250 monthly · not funded"],
], ([reward, asset]) => monthlyPoolLabel(reward, asset));

export const paymentAmountsNameOnlyReviewedAssets = vectors<readonly [bigint, PaymentAsset], string>([
  [[1_500_000n, { network: "base-mainnet", assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", assetDecimals: 6 }], "1.5 USDC"],
  [[5n, { network: "solana-mainnet", assetAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", assetDecimals: 6 }], "0.000005 USDC"],
  [[1_500_000n, { network: "base-mainnet", assetAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", assetDecimals: 18 }], "0.0000000000015 token 0x8335…2913"],
  [[1n, { network: "anvil", assetAddress: "0x1234567890abcdef1234567890abcdef12345678", assetDecimals: 18 }], "0.000000000000000001 token 0x1234…5678"],
  [[12_345_000_000n, { network: "robinhood-mainnet", assetAddress: "0x5fc5360d0400a0fd4f2af552add042d716f1d168", assetDecimals: 6 }], "12,345 USDG"],
], ([value, asset]) => formatAssetAmount(value, asset));

export const paymentAmountsNameNativeCoins = vectors<readonly [bigint, PaymentAsset], string>([
  [[1_500_000_000_000_000_000n, { network: "base-mainnet", assetAddress: "0x0000000000000000000000000000000000000000", assetDecimals: 18 }], "1.5 ETH"],
  [[1_500_000_000n, { network: "solana-mainnet", assetAddress: "11111111111111111111111111111111", assetDecimals: 9 }], "1.5 SOL"],
  [[1_500_000n, { network: "base-mainnet", assetAddress: "0x0000000000000000000000000000000000000000", assetDecimals: 6 }], "1.5 token 0x0000…0000"],
], ([value, asset]) => formatAssetAmount(value, asset));

export const knownAssetsKeepTheirKind = vectors<PaymentAsset, AssetTicker | undefined>([
  [{ network: "base-mainnet", assetAddress: "0x0000000000000000000000000000000000000000", assetDecimals: 18 }, { kind: "native", symbol: "ETH" }],
  [{ network: "solana-mainnet", assetAddress: "11111111111111111111111111111111", assetDecimals: 9 }, { kind: "native", symbol: "SOL" }],
  [{ network: "base-mainnet", assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", assetDecimals: 6 }, { kind: "stablecoin", symbol: "USDC" }],
  [{ network: "base-mainnet", assetAddress: "0x0000000000000000000000000000000000000000", assetDecimals: 6 }, undefined],
], knownAsset);

export const networksShowTheirRecordedLabel = vectors<string, string>([
  ["base-mainnet", "Base"],
  ["base-sepolia", "Base Sepolia (test)"],
  ["robinhood-testnet", "Robinhood Chain Testnet (test)"],
  ["anvil", "Local EVM test"],
  ["unlisted-network", "unlisted-network"],
], networkLabel);
