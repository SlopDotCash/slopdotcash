import { ESCROW_NETWORKS } from "../../src/lib/escrow-policy.mjs";
import type { RewardAsset } from "../../src/lib/reward-asset.mjs";

export interface AwardAssetTerms {
  currency: string;
  decimals: number;
  network: string | null;
  asset?: RewardAsset;
}

export function sameAssetAddress(network: string, a: string, b: string) {
  return ESCROW_NETWORKS[network as keyof typeof ESCROW_NETWORKS]?.family ===
    "solana"
    ? a === b
    : a.toLowerCase() === b.toLowerCase();
}

/** Legacy USDC stays bound to the reviewed network's USDC, never a same-symbol token. */
export function awardAsset(
  terms: AwardAssetTerms,
  network: string,
  legacyAddress?: string,
) {
  const chain = ESCROW_NETWORKS[network as keyof typeof ESCROW_NETWORKS];
  if (!chain || chain.chain !== terms.network) return null;
  if (terms.asset) {
    if (
      terms.asset.network !== chain.chain ||
      terms.asset.symbol !== terms.currency ||
      terms.asset.decimals !== terms.decimals
    )
      return null;
    return {
      address: terms.asset.address,
      decimals: terms.decimals,
      symbol: terms.currency,
    };
  }
  if (legacyAddress && terms.currency === "USDC" && terms.decimals === 6)
    return { address: legacyAddress, decimals: 6, symbol: "USDC" };
  if (
    terms.currency !== "USDC" ||
    terms.decimals !== 6 ||
    chain.assetSymbol !== "USDC" ||
    !chain.asset
  )
    return null;
  return { address: chain.asset, decimals: 6, symbol: "USDC" };
}

export function sameAwardAsset(
  a: AwardAssetTerms,
  b: AwardAssetTerms,
  network: string,
  legacyAddress?: string,
) {
  const left = awardAsset(a, network, legacyAddress),
    right = awardAsset(b, network, legacyAddress);
  if (!left || !right) return false;
  return (
    left.decimals === right.decimals &&
    sameAssetAddress(network, left.address, right.address)
  );
}
