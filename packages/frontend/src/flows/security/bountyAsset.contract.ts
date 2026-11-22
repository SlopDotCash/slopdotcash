// spec/security/terms.md, "Paid terms carry their split, funding policy, eligibility class and asset"
import { Schema } from "effect";
import { NETWORKS } from "@repo/settlement/kernels/networks";
import { contract } from "vibestack/testing";
import { vectors } from "../../kernels/vectors.ts";
import { type AssetChoice, type BaseUnits, assetBaseUnits, canonicalAssetAddress, rewardAssetChoice } from "./bountyAsset.ts";

type Choice = Parameters<typeof rewardAssetChoice>[0];

const token = (network: Choice["network"], tokenAddress: string, tokenSymbol: string): Choice => ({ network, assetKind: "token", tokenAddress, tokenSymbol });

export const rewardAssetsAreTheReviewedCoinOrAValidToken = vectors<Choice, AssetChoice>([
  [{ network: "base", assetKind: "stablecoin", tokenAddress: "", tokenSymbol: "" }, { kind: "asset", asset: { network: "base", kind: "stablecoin", address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", symbol: "USDC" }, decimals: 6 }],
  [{ network: "robinhood", assetKind: "stablecoin", tokenAddress: "", tokenSymbol: "" }, { kind: "asset", asset: { network: "robinhood", kind: "stablecoin", address: "0x5fc5360d0400a0fd4f2af552add042d716f1d168", symbol: "USDG" }, decimals: 6 }],
  [{ network: "solana", assetKind: "native", tokenAddress: "", tokenSymbol: "" }, { kind: "asset", asset: { network: "solana", kind: "native", address: "11111111111111111111111111111111", symbol: "SOL" }, decimals: 9 }],
  [{ network: "ethereum", assetKind: "native", tokenAddress: "", tokenSymbol: "" }, { kind: "asset", asset: { network: "ethereum", kind: "native", address: "0x0000000000000000000000000000000000000000", symbol: "ETH" }, decimals: 18 }],
  [token("base", " 0xABCDEFabcdef0123456789012345678901234567 ", " $VAULT "), { kind: "asset", asset: { network: "base", kind: "token", address: "0xabcdefabcdef0123456789012345678901234567", symbol: "$VAULT" }, decimals: 36 }],
  [token("solana", "So11111111111111111111111111111111111111112", "wSOL"), { kind: "asset", asset: { network: "solana", kind: "token", address: "So11111111111111111111111111111111111111112", symbol: "wSOL" }, decimals: 36 }],
  [token("base", "0x1234", "TOK"), { kind: "invalid", message: "Enter a 0x address with 40 hex characters" }],
  [token("ethereum", "0x0000000000000000000000000000000000000000", "ETH"), { kind: "invalid", message: "Enter a 0x address with 40 hex characters" }],
  [token("solana", "0xabcdefabcdef0123456789012345678901234567", "TOK"), { kind: "invalid", message: "Enter a base58 SPL mint address" }],
  [token("solana", "11111111111111111111111111111111", "SOL"), { kind: "invalid", message: "Choose SOL as the native coin" }],
  [token("base", "0x833589FCD6EDB6E08F4C7C32D4F71B54BDA02913", "USDC"), { kind: "invalid", message: "That address is the network stablecoin; choose USDC" }],
  [token("solana", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "USDC"), { kind: "invalid", message: "That address is the network stablecoin; choose USDC" }],
  [token("base", "0xabcdefabcdef0123456789012345678901234567", "  "), { kind: "invalid", message: "Enter a symbol of 1-16 letters or digits" }],
  [token("base", "0xabcdefabcdef0123456789012345678901234567", "SEVENTEEN-LETTERS"), { kind: "invalid", message: "Enter a symbol of 1-16 letters or digits" }],
], rewardAssetChoice);

export const amountsBecomeExactBaseUnits = vectors<readonly [string, number], BaseUnits>([
  [["12.5", 6], { kind: "units", minor: "12500000" }],
  [["0", 18], { kind: "units", minor: "0" }],
  [["1", 0], { kind: "units", minor: "1" }],
  [["9999999999999.000000000000000000000000000000000001", 36], { kind: "units", minor: "9999999999999000000000000000000000000000000000001" }],
  [["1.25", 1], { kind: "invalid", message: "amount has more decimal places than the asset's 1" }],
  [["01", 6], { kind: "invalid", message: "amount must be a plain decimal number" }],
  [["1e6", 6], { kind: "invalid", message: "amount must be a plain decimal number" }],
  [["", 6], { kind: "invalid", message: "amount must be a plain decimal number" }],
  [["10000000000000", 6], { kind: "invalid", message: "amount must be a plain decimal number" }],
], ([text, decimals]) => assetBaseUnits(text, decimals));

export const canonicalAddressesStayCanonical = contract({
  input: Schema.String,
  run: (text) => [canonicalAssetAddress(NETWORKS["base-mainnet"], text), canonicalAssetAddress(NETWORKS["solana-mainnet"], text)] as const,
  invariant: (_text, [evm, solana]) =>
    (evm === undefined || canonicalAssetAddress(NETWORKS["base-mainnet"], evm) === evm) &&
    (solana === undefined || canonicalAssetAddress(NETWORKS["solana-mainnet"], solana) === solana),
});

export const baseUnitsAreWholeDigitsWithoutLeadingZeros = contract({
  input: Schema.Tuple([Schema.String, Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 36 }))]),
  run: ([text, decimals]) => assetBaseUnits(text, decimals),
  invariant: (_input, parsed) => parsed.kind === "invalid" || /^(0|[1-9]\d*)$/u.test(parsed.minor),
});
