/**
 * The one reward asset a project pays in: a network and either that
 * network's native coin, reviewed stablecoin or one standard token (ERC-20 or
 * classic SPL mint). The manifest stores the chain identity, address, symbol and decimals
 * as display metadata. The server reads decimals from chain once, when the
 * asset is submitted or changed; page views never read chain.
 */

import {
  ESCROW_NETWORKS,
  EVM_NATIVE_ASSET,
  isNativeAssetAddress,
  SOLANA_NATIVE_ASSET,
} from "./escrow-policy.mjs";
import { isFundingAddress } from "./funding-address.mjs";

/** Display names of the four reward networks, in picker order. */
export const NETWORK_NAMES = Object.freeze({
  base: "Base",
  ethereum: "Ethereum",
  robinhood: "Robinhood Chain",
  solana: "Solana",
});

/**
 * Each reward network's mainnet identity and default stablecoin, read from
 * the reviewed escrow network definitions (src/lib/escrow-policy.mjs), so the
 * picker and the vaults name the same chain and asset.
 */
function rewardNetwork(chain) {
  const definition = Object.values(ESCROW_NETWORKS).find(
    (candidate) => candidate.chain === chain && !candidate.testnet,
  );
  const stablecoin = definition?.assets[0];
  if (!definition || !stablecoin)
    throw new TypeError(`No reviewed mainnet stablecoin for ${chain}`);
  return Object.freeze({
    name: NETWORK_NAMES[chain],
    family: definition.family,
    chainId: definition.chainId ?? null,
    cluster: definition.family === "solana" ? "mainnet-beta" : null,
    native: Object.freeze({
      address:
        definition.family === "solana" ? SOLANA_NATIVE_ASSET : EVM_NATIVE_ASSET,
      symbol: definition.family === "solana" ? "SOL" : "ETH",
      decimals: definition.family === "solana" ? 9 : 18,
    }),
    stablecoin: Object.freeze({
      address: stablecoin.address,
      symbol: stablecoin.symbol,
      decimals: stablecoin.decimals,
    }),
  });
}

export const REWARD_ASSET_NETWORKS = Object.freeze(
  Object.fromEntries(
    Object.keys(NETWORK_NAMES).map((chain) => [chain, rewardNetwork(chain)]),
  ),
);

export const REWARD_ASSET_NETWORK_IDS = Object.freeze(
  Object.keys(REWARD_ASSET_NETWORKS),
);

const SYMBOL = /^[A-Za-z0-9$._-]{1,16}$/u;
const MAX_REWARD_ASSET_DECIMALS = 36;

/** Lowercases EVM addresses; Solana mints are case-sensitive base58. */
function canonicalRewardAssetAddress(network, value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const definition = REWARD_ASSET_NETWORKS[network];
  if (!definition) return null;
  const canonical =
    definition.family === "evm" ? trimmed.toLowerCase() : trimmed;
  return isFundingAddress(network, canonical) ? canonical : null;
}

/** The unverified part of an asset choice: what a maintainer enters. */
export function rewardAssetChoice(network, kind, address, symbol) {
  const definition = REWARD_ASSET_NETWORKS[network];
  if (!definition) throw new TypeError("Choose a supported reward network");
  if (kind === "stablecoin") {
    return {
      network,
      kind,
      address: definition.stablecoin.address,
      symbol: definition.stablecoin.symbol,
    };
  }
  if (kind === "native")
    return {
      network,
      kind,
      address: definition.native.address,
      symbol: definition.native.symbol,
    };
  if (kind !== "token")
    throw new TypeError("Choose native coin, stablecoin or token");
  const canonical = canonicalRewardAssetAddress(network, address);
  if (canonical === null)
    throw new TypeError(
      definition.family === "evm"
        ? "Enter a 0x token contract address with 40 hexadecimal characters"
        : "Enter a base58 SPL mint address",
    );
  if (isNativeAssetAddress(network, canonical))
    throw new TypeError(
      `Choose ${definition.native.symbol} as the native coin`,
    );
  if (canonical === definition.stablecoin.address)
    throw new TypeError(
      `That address is the network stablecoin; choose ${definition.stablecoin.symbol}`,
    );
  if (typeof symbol !== "string" || !SYMBOL.test(symbol.trim()))
    throw new TypeError("Enter a token symbol of 1 to 16 letters or digits");
  return { network, kind, address: canonical, symbol: symbol.trim() };
}

/**
 * Validates a stored reward asset. Throws a TypeError naming the field.
 */
export function assertRewardAsset(value, field = "project.rewardAsset") {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new TypeError(`${field} must be an object`);
  const keys = [
    "address",
    "chainId",
    "cluster",
    "decimals",
    "kind",
    "network",
    "symbol",
    "verifiedAt",
  ];
  if (Object.keys(value).sort().join("\0") !== keys.join("\0"))
    throw new TypeError(`${field} has unexpected or missing fields`);
  const definition = REWARD_ASSET_NETWORKS[value.network];
  if (!definition) throw new TypeError(`${field}.network is unsupported`);
  if (
    value.chainId !== definition.chainId ||
    value.cluster !== definition.cluster
  )
    throw new TypeError(`${field} chain identity does not match its network`);
  if (
    value.kind === "native"
      ? !isNativeAssetAddress(value.network, value.address)
      : canonicalRewardAssetAddress(value.network, value.address) !==
          value.address || isNativeAssetAddress(value.network, value.address)
  )
    throw new TypeError(`${field}.address is not a canonical address`);
  if (
    !Number.isSafeInteger(value.decimals) ||
    value.decimals < 0 ||
    value.decimals > MAX_REWARD_ASSET_DECIMALS
  )
    throw new TypeError(`${field}.decimals is invalid`);
  if (typeof value.symbol !== "string" || !SYMBOL.test(value.symbol))
    throw new TypeError(`${field}.symbol is invalid`);
  if (
    typeof value.verifiedAt !== "string" ||
    !Number.isFinite(Date.parse(value.verifiedAt)) ||
    new Date(value.verifiedAt).toISOString() !== value.verifiedAt
  )
    throw new TypeError(`${field}.verifiedAt is invalid`);
  const stablecoin = definition.stablecoin;
  if (value.kind === "native") {
    if (
      value.address !== definition.native.address ||
      value.symbol !== definition.native.symbol ||
      value.decimals !== definition.native.decimals
    )
      throw new TypeError(`${field} is not the network native coin`);
  } else if (value.kind === "stablecoin") {
    if (
      value.address !== stablecoin.address ||
      value.symbol !== stablecoin.symbol ||
      value.decimals !== stablecoin.decimals
    )
      throw new TypeError(`${field} is not the network stablecoin`);
  } else if (value.kind === "token") {
    if (value.address === stablecoin.address)
      throw new TypeError(`${field} names the network stablecoin as a token`);
  } else {
    throw new TypeError(`${field}.kind is invalid`);
  }
  return value;
}

/** True when two assets name the same chain object, so decimals carry over. */
export function sameRewardAsset(left, right) {
  return (
    left !== undefined &&
    right !== undefined &&
    left.network === right.network &&
    left.kind === right.kind &&
    left.address === right.address
  );
}
