// spec/settlement/signer.md, "A signer stack signs only for its own networks, and production signs only enabled mainnets as the attester"; spec/settlement/money.md, "Contract amounts stay inside the unsigned integer range of their network"
import type { ServiceNetwork } from "../../gen/settlement__signer.ts";
import { type Family, maxBaseUnitsFor } from "./amounts.ts";

export type Chain = "base" | "ethereum" | "robinhood" | "solana";

export interface ReferenceAsset {
  readonly address: string;
  readonly symbol: string;
  readonly decimals: number;
  readonly source: string;
}

interface NetworkCommon {
  readonly service: ServiceNetwork;
  readonly chain: Chain;
  readonly testnet: boolean;
  readonly assets: readonly ReferenceAsset[];
}

export interface EvmNetwork extends NetworkCommon {
  readonly family: "evm";
  readonly chainId: number;
  readonly gasCeiling: bigint;
  readonly scanPageBlocks: bigint;
}

export interface SolanaNetwork extends NetworkCommon {
  readonly family: "solana";
  readonly genesisHash: string;
}

export type Network = EvmNetwork | SolanaNetwork;

export const EVM_NATIVE_ASSET = "0x0000000000000000000000000000000000000000";
export const SOLANA_NATIVE_ASSET = "11111111111111111111111111111111";
export const PAYOUT_FEE_BASIS_POINTS = 200;
export const WITHDRAWAL_FEE_BASIS_POINTS = 200;
export const SECURITY_FEE_BASIS_POINTS = 2500;

const CIRCLE_USDC_ADDRESSES = "https://developers.circle.com/stablecoins/usdc-contract-addresses";
const usdc = (address: string): ReferenceAsset => ({ address, symbol: "USDC", decimals: 6, source: CIRCLE_USDC_ADDRESSES });

export const NETWORKS = Object.freeze({
  "base-sepolia": {
    service: "BaseSepolia", chain: "base", family: "evm", testnet: true, chainId: 84532, gasCeiling: 500000n, scanPageBlocks: 2000n,
    assets: [usdc("0x036cbd53842c5426634e7929541ec2318f3dcf7e")],
  },
  "base-mainnet": {
    service: "BaseMainnet", chain: "base", family: "evm", testnet: false, chainId: 8453, gasCeiling: 500000n, scanPageBlocks: 2000n,
    assets: [usdc("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913")],
  },
  "solana-devnet": {
    service: "SolanaDevnet", chain: "solana", family: "solana", testnet: true, genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
    assets: [usdc("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU")],
  },
  "solana-testnet": {
    service: "SolanaTestnet", chain: "solana", family: "solana", testnet: true, genesisHash: "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY",
    assets: [],
  },
  "solana-mainnet": {
    service: "SolanaMainnet", chain: "solana", family: "solana", testnet: false, genesisHash: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
    assets: [usdc("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")],
  },
  "robinhood-testnet": {
    service: "RobinhoodTestnet", chain: "robinhood", family: "evm", testnet: true, chainId: 46630, gasCeiling: 2000000n, scanPageBlocks: 9000n,
    assets: [{ address: "0x7e955252e15c84f5768b83c41a71f9eba181802f", symbol: "USDG", decimals: 6, source: "https://docs.paxos.com/guides/stablecoin/usdg/testnet" }],
  },
  "robinhood-mainnet": {
    service: "RobinhoodMainnet", chain: "robinhood", family: "evm", testnet: false, chainId: 4663, gasCeiling: 2000000n, scanPageBlocks: 9000n,
    assets: [{ address: "0x5fc5360d0400a0fd4f2af552add042d716f1d168", symbol: "USDG", decimals: 6, source: "https://docs.robinhood.com/chain/contracts" }],
  },
  "ethereum-sepolia": {
    service: "EthereumSepolia", chain: "ethereum", family: "evm", testnet: true, chainId: 11155111, gasCeiling: 1000000n, scanPageBlocks: 2000n,
    assets: [usdc("0x1c7d4b196cb0c7b01d743fbc6116a902379c7238")],
  },
  ethereum: {
    service: "EthereumMainnet", chain: "ethereum", family: "evm", testnet: false, chainId: 1, gasCeiling: 500000n, scanPageBlocks: 2000n,
    assets: [usdc("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48")],
  },
} as const satisfies Record<string, Network>);

export type NetworkKey = keyof typeof NETWORKS;

const keys = Object.keys(NETWORKS).filter((key): key is NetworkKey => Object.hasOwn(NETWORKS, key));

/** @throws {never} */
export function isNetworkKey(value: string): value is NetworkKey {
  return Object.hasOwn(NETWORKS, value);
}

/** @throws {never} */
export function networkKeyOf(service: ServiceNetwork): NetworkKey | undefined {
  return keys.find((key) => NETWORKS[key].service === service);
}

export const CHAINS: readonly Chain[] = [...new Set(keys.map((key) => NETWORKS[key].chain))];

/** @throws {never} */
export function isChain(value: string): value is Chain {
  return CHAINS.some((chain) => chain === value);
}

/** @throws {never} */
export function chainFamily(chain: Chain): Family {
  return chain === "solana" ? "solana" : "evm";
}

/** @throws {never} */
export function maxBaseUnitsForChain(chain: Chain): bigint {
  return maxBaseUnitsFor(chainFamily(chain));
}

/** @throws {never} */
export function isNativeAssetAddress(chain: Chain, address: string): boolean {
  return chain === "solana" ? address === SOLANA_NATIVE_ASSET : address === EVM_NATIVE_ASSET;
}

/** @throws {never} */
export function defaultAsset(network: Network): ReferenceAsset | undefined {
  return network.assets[0];
}
