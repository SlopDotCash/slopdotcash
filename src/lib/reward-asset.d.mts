/** Types for the one reward asset a project pays in. */

import type { EscrowChain } from "./escrow-policy.mjs";

export type RewardAssetNetwork = EscrowChain;
export type RewardAssetKind = "stablecoin" | "token" | "native";

export interface RewardAssetNetworkDefinition {
  readonly name: string;
  readonly family: "evm" | "solana";
  readonly chainId: string | null;
  readonly cluster: "mainnet-beta" | null;
  readonly native: {
    readonly address: string;
    readonly symbol: "ETH" | "SOL";
    readonly decimals: 18 | 9;
  };
  readonly stablecoin: {
    readonly address: string;
    readonly symbol: string;
    readonly decimals: number;
  };
}

export interface RewardAsset {
  readonly network: RewardAssetNetwork;
  readonly kind: RewardAssetKind;
  readonly address: string;
  readonly symbol: string;
  readonly decimals: number;
  readonly chainId: string | null;
  readonly cluster: "mainnet-beta" | null;
  readonly verifiedAt: string;
}

export interface RewardAssetChoice {
  readonly network: RewardAssetNetwork;
  readonly kind: RewardAssetKind;
  readonly address: string;
  readonly symbol: string;
}

export declare const REWARD_ASSET_NETWORKS: Readonly<
  Record<RewardAssetNetwork, RewardAssetNetworkDefinition>
>;
export declare const NETWORK_NAMES: Readonly<
  Record<RewardAssetNetwork, string>
>;
export declare const REWARD_ASSET_NETWORK_IDS: readonly RewardAssetNetwork[];
export declare function rewardAssetChoice(
  network: string,
  kind: string,
  address: string,
  symbol: string,
): RewardAssetChoice;
export declare function assertRewardAsset(
  value: unknown,
  field?: string,
): RewardAsset;
export declare function sameRewardAsset(
  left: RewardAsset | undefined,
  right: RewardAsset | undefined,
): boolean;
