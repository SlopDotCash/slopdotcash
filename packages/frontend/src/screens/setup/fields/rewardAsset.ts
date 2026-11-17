// spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"; spec/frontend/presentation.md, "Project tokens have one dollar prefix while native and approved stablecoin tickers have none"
import { type Chain, chainFamily } from "@repo/settlement/kernels/networks";
import type { RewardAssetKind } from "../../../flows/projects/proposal.ts";
import { rewardAssetChoice } from "../../../flows/security/bountyAsset.ts";
import { CHAIN_NAMES } from "../../../kernels/assetText.ts";

export interface RewardCoin {
  readonly address: string;
  readonly symbol: string;
  readonly decimals: number;
}

export interface RewardNetwork {
  readonly name: string;
  readonly family: "evm" | "solana";
  readonly native: RewardCoin;
  readonly stablecoin: RewardCoin;
}

export interface RewardAssetSelection {
  readonly network: Chain;
  readonly assetKind: RewardAssetKind;
  readonly tokenAddress: string;
  readonly tokenSymbol: string;
}

export type TokenProblem = { readonly field: "tokenAddress" | "tokenSymbol"; readonly message: string };

const chainOrder = ["base", "ethereum", "robinhood", "solana"] as const satisfies ReadonlyArray<Chain>;

function coinOf(network: Chain, assetKind: "native" | "stablecoin"): RewardCoin | undefined {
  const choice = rewardAssetChoice({ network, assetKind, tokenAddress: "", tokenSymbol: "" });
  return choice.kind === "asset" ? { address: choice.asset.address, symbol: choice.asset.symbol, decimals: choice.decimals } : undefined;
}

/** @throws {never} */
export function rewardNetwork(chain: Chain): RewardNetwork | undefined {
  const native = coinOf(chain, "native");
  const stablecoin = coinOf(chain, "stablecoin");
  return native && stablecoin ? { name: CHAIN_NAMES[chain], family: chainFamily(chain), native, stablecoin } : undefined;
}

export const rewardChains: ReadonlyArray<readonly [Chain, string]> = chainOrder.filter((chain) => rewardNetwork(chain) !== undefined).map((chain) => [chain, CHAIN_NAMES[chain]] as const);

/** @throws {never} */
export function rewardSymbol(selection: Pick<RewardAssetSelection, "network" | "assetKind" | "tokenSymbol">): string {
  if (selection.assetKind === "token") return selection.tokenSymbol.trim() || "token";
  return rewardNetwork(selection.network)?.[selection.assetKind].symbol ?? "token";
}

/** @throws {never} */
export function tokenProblem(selection: RewardAssetSelection): TokenProblem | undefined {
  const choice = rewardAssetChoice(selection);
  return choice.kind === "invalid" ? { field: /symbol/iu.test(choice.message) ? "tokenSymbol" : "tokenAddress", message: `${choice.message}.` } : undefined;
}
