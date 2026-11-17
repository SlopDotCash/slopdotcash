// spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"; spec/frontend/presentation.md, "Project tokens have one dollar prefix while native and approved stablecoin tickers have none"
import { type Chain, EVM_NATIVE_ASSET, type NetworkKey, NETWORKS, SOLANA_NATIVE_ASSET } from "@repo/settlement/kernels/networks";
import type { RewardAssetKind } from "../../../flows/projects/proposal.ts";
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

const mainnets = { base: "base-mainnet", ethereum: "ethereum", robinhood: "robinhood-mainnet", solana: "solana-mainnet" } as const satisfies Record<Chain, NetworkKey>;

const base58Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const base58Text = /^[1-9A-HJ-NP-Za-km-z]+$/u;
const evmAccount = /^0x[0-9a-f]{40}$/u;
const tokenSymbol = /^[A-Za-z0-9$._-]{1,16}$/u;

const chainOrder = ["base", "ethereum", "robinhood", "solana"] as const satisfies ReadonlyArray<Chain>;

export const rewardChains: ReadonlyArray<readonly [Chain, string]> = chainOrder.map((chain) => [chain, CHAIN_NAMES[chain]] as const);

/** @throws {never} */
export function rewardNetwork(chain: Chain): RewardNetwork {
  const network = NETWORKS[mainnets[chain]];
  const stablecoin = network.assets[0];
  return {
    name: CHAIN_NAMES[chain],
    family: network.family,
    native: network.family === "solana" ? { address: SOLANA_NATIVE_ASSET, symbol: "SOL", decimals: 9 } : { address: EVM_NATIVE_ASSET, symbol: "ETH", decimals: 18 },
    stablecoin: { address: stablecoin.address, symbol: stablecoin.symbol, decimals: stablecoin.decimals },
  };
}

/** @throws {never} */
export function rewardSymbol(selection: Pick<RewardAssetSelection, "network" | "assetKind" | "tokenSymbol">): string {
  const network = rewardNetwork(selection.network);
  if (selection.assetKind === "token") return selection.tokenSymbol.trim() || "token";
  return selection.assetKind === "native" ? network.native.symbol : network.stablecoin.symbol;
}

function base58Bytes(value: string): number | undefined {
  if (value.length < 32 || value.length > 44 || !base58Text.test(value)) return undefined;
  let number = 0n;
  for (const character of value) number = number * 58n + BigInt(base58Alphabet.indexOf(character));
  let bytes = 0;
  for (; number > 0n; number >>= 8n) bytes += 1;
  let zeros = 0;
  while (value[zeros] === "1") zeros += 1;
  return zeros + bytes;
}

function canonicalAddress(network: RewardNetwork, value: string): string | undefined {
  const trimmed = value.trim();
  if (network.family === "solana") return base58Bytes(trimmed) === 32 ? trimmed : undefined;
  const lowered = trimmed.toLowerCase();
  return evmAccount.test(lowered) && lowered !== EVM_NATIVE_ASSET ? lowered : undefined;
}

/** @throws {never} */
export function tokenProblem(selection: RewardAssetSelection): TokenProblem | undefined {
  const network = rewardNetwork(selection.network);
  const address = canonicalAddress(network, selection.tokenAddress);
  if (address === undefined) return { field: "tokenAddress", message: network.family === "evm" ? "Enter a 0x token contract address with 40 hexadecimal characters." : "Enter a base58 SPL mint address." };
  if (address === network.native.address) return { field: "tokenAddress", message: `Choose ${network.native.symbol} as the native coin.` };
  if (address === network.stablecoin.address) return { field: "tokenAddress", message: `That address is the network stablecoin; choose ${network.stablecoin.symbol}.` };
  if (!tokenSymbol.test(selection.tokenSymbol.trim())) return { field: "tokenSymbol", message: "Enter a token symbol of 1 to 16 letters or digits." };
  return undefined;
}
