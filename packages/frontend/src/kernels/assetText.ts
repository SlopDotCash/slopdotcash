// spec/frontend/presentation.md, "Project tokens have one dollar prefix while native and approved stablecoin tickers have none"; spec/frontend/presentation.md, "Amounts display exactly in their asset's decimals with grouped whole digits and no trailing fraction zeros"
import { formatBaseUnits } from "@repo/settlement/kernels/amounts";
import { type Chain, EVM_NATIVE_ASSET, isNetworkKey, type Network, NETWORKS, type ReferenceAsset, SOLANA_NATIVE_ASSET } from "@repo/settlement/kernels/networks";
import { type DecodedTicker, displayTicker, type TickerKind, type TickerView } from "../../gen/frontend__presentation.ts";

export type AssetKind = "native" | "stablecoin" | "token";

export interface AssetTicker {
  readonly kind: AssetKind;
  readonly symbol: string;
}

export interface RewardAmountAsset extends AssetTicker {
  readonly decimals: number;
}

export interface PaymentAsset {
  readonly network: string;
  readonly assetAddress: string;
  readonly assetDecimals: number;
}

export interface PoolCommitment {
  readonly committedMinor: bigint;
  readonly fundingState: "pledged" | "committed";
  readonly monthlyCapDisplay: string;
}

const tickerKinds = { native: "NativeCoin", stablecoin: "ApprovedStablecoin", token: "ProjectToken" } as const satisfies Record<AssetKind, TickerKind>;

export const CHAIN_NAMES = Object.freeze({
  base: "Base",
  ethereum: "Ethereum",
  robinhood: "Robinhood Chain",
  solana: "Solana",
} as const satisfies Record<Chain, string>);

const NETWORK_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "base-mainnet": "Base",
  "base-sepolia": "Base Sepolia (test)",
  "solana-mainnet": "Solana",
  "solana-devnet": "Solana Devnet (test)",
  "solana-testnet": "Solana Testnet (test)",
  "robinhood-mainnet": "Robinhood Chain",
  "robinhood-testnet": "Robinhood Chain Testnet (test)",
  ethereum: "Ethereum",
  "ethereum-sepolia": "Ethereum Sepolia (test)",
  anvil: "Local EVM test",
});

/** @throws {never} */
export function networkLabel(network: string): string {
  return NETWORK_LABELS[network] ?? network;
}

/** @throws {never} */
export function decodedTicker(symbol: string): DecodedTicker {
  const body = symbol.replace(/^\$+/u, "");
  return { canonicalSymbol: symbol, leadingDollars: symbol.length - body.length, body: Array.from(body) };
}

/** @throws {never} */
export function tickerOf({ kind, symbol }: AssetTicker): TickerView {
  return displayTicker(tickerKinds[kind], decodedTicker(symbol));
}

/** @throws {never} */
export function tickerText({ available, prefixDollars, body }: TickerView): string | undefined {
  return available ? "$".repeat(prefixDollars) + body.join("") : undefined;
}

/** @throws {never} */
export function assetSymbol(asset: AssetTicker): string | undefined {
  return tickerText(tickerOf(asset));
}

/** @throws {RangeError} */
export function formatRewardMinor(minor: bigint, asset?: RewardAmountAsset): string {
  const amount = formatBaseUnits({ value: minor, decimals: asset?.decimals ?? 6 });
  if (!asset || asset.kind === "stablecoin") return `$${amount}`;
  const ticker = assetSymbol(asset);
  return ticker === undefined ? amount : `${amount} ${ticker}`;
}

/** @throws {never} */
export function formatRewardCapDisplay(display: string, asset?: AssetTicker): string {
  const ticker = asset && asset.kind !== "stablecoin" ? assetSymbol(asset) : undefined;
  return ticker === undefined ? display : display.replace(/\S+$/u, () => ticker);
}

/** @throws {never} */
export function monthlyPoolUnfunded({ committedMinor, fundingState }: Pick<PoolCommitment, "committedMinor" | "fundingState">): boolean {
  return fundingState !== "committed" || committedMinor === 0n;
}

/** @throws {RangeError} */
export function monthlyPoolLabel(reward: PoolCommitment, asset?: RewardAmountAsset): string {
  const cap = formatRewardCapDisplay(reward.monthlyCapDisplay, asset);
  return monthlyPoolUnfunded(reward) ? `${cap} monthly · not funded` : `${formatRewardMinor(reward.committedMinor, asset)} funded · ${cap} monthly`;
}

/** @throws {never} */
export function knownAsset({ network, assetAddress, assetDecimals }: PaymentAsset): AssetTicker | undefined {
  if (!isNetworkKey(network)) return undefined;
  const policy: Network = NETWORKS[network];
  const assets: readonly ReferenceAsset[] = policy.assets;
  const same = (address: string) => (policy.family === "evm" ? address.toLowerCase() === assetAddress.toLowerCase() : address === assetAddress);
  const native = policy.family === "solana" ? { address: SOLANA_NATIVE_ASSET, symbol: "SOL", decimals: 9 } : { address: EVM_NATIVE_ASSET, symbol: "ETH", decimals: 18 };
  if (assetDecimals === native.decimals && same(native.address)) return { kind: "native", symbol: native.symbol };
  const reviewed = assets.find((asset) => asset.decimals === assetDecimals && same(asset.address));
  return reviewed === undefined ? undefined : { kind: "stablecoin", symbol: reviewed.symbol };
}

/** @throws {never} */
export function knownAssetSymbol(payment: PaymentAsset): string | undefined {
  return knownAsset(payment)?.symbol;
}

/** @throws {RangeError} */
export function formatAssetAmount(value: bigint, asset: PaymentAsset): string {
  const label = knownAssetSymbol(asset) ?? `token ${asset.assetAddress.slice(0, 6)}…${asset.assetAddress.slice(-4)}`;
  return `${formatBaseUnits({ value, decimals: asset.assetDecimals })} ${label}`;
}
