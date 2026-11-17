// spec/security/terms.md, "Paid terms carry their split, funding policy, eligibility class and asset"
import { type Chain, EVM_NATIVE_ASSET, type Network, NETWORKS, SOLANA_NATIVE_ASSET, isNativeAssetAddress } from "@repo/settlement/kernels/networks";
import type { FundingChoice, RewardAssetKind } from "../projects/proposal.ts";

export interface RewardAsset {
  readonly network: Chain;
  readonly kind: RewardAssetKind;
  readonly address: string;
  readonly symbol: string;
}

export type AssetChoice =
  | { readonly kind: "asset"; readonly asset: RewardAsset; readonly decimals: number }
  | { readonly kind: "invalid"; readonly message: string };

export type BaseUnits =
  | { readonly kind: "units"; readonly minor: string }
  | { readonly kind: "invalid"; readonly message: string };

export const tokenDecimals = 36;

const symbolPattern = /^[A-Za-z0-9$._-]{1,16}$/u;
const evmAccount = /^0x[0-9a-f]{40}$/u;
const base58Text = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u;
const base58Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const plainAmount = /^(0|[1-9]\d{0,12})(?:\.(\d{1,36}))?$/u;

function mainnetOf(chain: Chain): Network | undefined {
  return Object.values(NETWORKS).find((network: Network) => network.chain === chain && !network.testnet);
}

function base58ByteLength(text: string): number {
  let value = 0n;
  for (const character of text) value = value * 58n + BigInt(base58Alphabet.indexOf(character));
  let bytes = 0;
  for (; value > 0n; value >>= 8n) bytes += 1;
  let zeros = 0;
  while (text[zeros] === "1") zeros += 1;
  return zeros + bytes;
}

/** @throws {never} */
export function canonicalAssetAddress(network: Network, value: string): string | undefined {
  const trimmed = value.trim();
  if (network.family === "evm") {
    const lowered = trimmed.toLowerCase();
    return evmAccount.test(lowered) && lowered !== EVM_NATIVE_ASSET ? lowered : undefined;
  }
  return base58Text.test(trimmed) && base58ByteLength(trimmed) === 32 ? trimmed : undefined;
}

/** @throws {never} */
export function rewardAssetChoice(choice: Pick<FundingChoice, "network" | "assetKind" | "tokenAddress" | "tokenSymbol">): AssetChoice {
  const network = mainnetOf(choice.network);
  const stablecoin = network?.assets[0];
  if (network === undefined || stablecoin === undefined) return { kind: "invalid", message: `No reviewed mainnet stablecoin for ${choice.network}` };
  const native = network.family === "solana" ? { address: SOLANA_NATIVE_ASSET, symbol: "SOL", decimals: 9 } : { address: EVM_NATIVE_ASSET, symbol: "ETH", decimals: 18 };
  switch (choice.assetKind) {
    case "stablecoin":
      return { kind: "asset", asset: { network: choice.network, kind: "stablecoin", address: stablecoin.address, symbol: stablecoin.symbol }, decimals: stablecoin.decimals };
    case "native":
      return { kind: "asset", asset: { network: choice.network, kind: "native", address: native.address, symbol: native.symbol }, decimals: native.decimals };
    case "token": {
      const address = canonicalAssetAddress(network, choice.tokenAddress);
      if (address === undefined) return { kind: "invalid", message: network.family === "evm" ? "Enter a 0x token contract address with 40 hexadecimal characters" : "Enter a base58 SPL mint address" };
      if (isNativeAssetAddress(choice.network, address)) return { kind: "invalid", message: `Choose ${native.symbol} as the native coin` };
      if (address === stablecoin.address) return { kind: "invalid", message: `That address is the network stablecoin; choose ${stablecoin.symbol}` };
      const symbol = choice.tokenSymbol.trim();
      if (!symbolPattern.test(symbol)) return { kind: "invalid", message: "Enter a token symbol of 1 to 16 letters or digits" };
      return { kind: "asset", asset: { network: choice.network, kind: "token", address, symbol }, decimals: tokenDecimals };
    }
    default: {
      const unknownKind: never = choice.assetKind;
      return unknownKind;
    }
  }
}

/** @throws {never} */
export function assetBaseUnits(text: string, decimals: number): BaseUnits {
  const match = plainAmount.exec(text);
  if (match === null) return { kind: "invalid", message: "amount must be a plain decimal number" };
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) return { kind: "invalid", message: `amount has more decimal places than the asset's ${decimals}` };
  const minor = BigInt(match[1] ?? "0") * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  return { kind: "units", minor: minor.toString() };
}
