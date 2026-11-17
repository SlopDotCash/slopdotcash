// spec/security/terms.md, "Paid terms carry their split, funding policy, eligibility class and asset"; spec/security/terms.md, "A fixed offer permits its receipt-time gross amount or no award"
import { offerAllowed, platformShare, researcherShare, splitPossible } from "./kernel.ts";

export interface AwardShares {
  readonly grossMinor: string;
  readonly researcherMinor: string;
  readonly slopMinor: string;
}

export type SplitOutcome = { readonly kind: "split"; readonly shares: AwardShares } | { readonly kind: "indivisible"; readonly message: string };

export interface AwardAssetTerms {
  readonly currency: string;
  readonly decimals: number;
  readonly network: string | null;
  readonly asset?: { readonly network: string; readonly symbol: string; readonly decimals: number; readonly address: string };
}

export interface ReviewedNetwork {
  readonly family: string;
  readonly chain: string;
  readonly assetSymbol: string;
  readonly asset: string | null;
}

export interface AwardAsset {
  readonly address: string;
  readonly decimals: number;
  readonly symbol: string;
}

const baseUnits = /^[0-9]+$/u;

/** @throws {never} */
export function limbsOf(base: string): number[] {
  if (!baseUnits.test(base)) return [];
  const digits = base.replace(/^0+(?=.)/u, "");
  const parts: number[] = [];
  for (let end = digits.length; end > 0; end -= 3) parts.push(Number(digits.slice(Math.max(0, end - 3), end)));
  return parts;
}

/** @throws {never} */
export function awardSplit(grossMinor: string, full: boolean): SplitOutcome {
  const gross = BigInt(grossMinor);
  if (!splitPossible(gross, full)) return { kind: "indivisible", message: "gross amount must be divisible by four minor units so the 75/25 split is exact" };
  return { kind: "split", shares: { grossMinor, researcherMinor: researcherShare(gross, full).toString(), slopMinor: platformShare(gross, full).toString() } };
}

/** @throws {never} */
export function fixedOfferMatches(offeredMinor: string, chosenMinor: string, full: boolean): boolean {
  return baseUnits.test(offeredMinor) && offerAllowed(BigInt(offeredMinor), BigInt(chosenMinor), true, full);
}

/** @throws {never} */
export function sameAssetAddress(network: ReviewedNetwork | undefined, left: string, right: string): boolean {
  return network?.family === "solana" ? left === right : left.toLowerCase() === right.toLowerCase();
}

/** @throws {never} */
export function awardAsset(terms: AwardAssetTerms, network: ReviewedNetwork | undefined, legacyAddress?: string): AwardAsset | undefined {
  if (network === undefined || network.chain !== terms.network) return undefined;
  const asset = terms.asset;
  if (asset !== undefined) {
    if (asset.network !== network.chain || asset.symbol !== terms.currency || asset.decimals !== terms.decimals) return undefined;
    return { address: asset.address, decimals: terms.decimals, symbol: terms.currency };
  }
  const usdc = terms.currency === "USDC" && terms.decimals === 6;
  if (legacyAddress !== undefined && legacyAddress !== "" && usdc) return { address: legacyAddress, decimals: 6, symbol: "USDC" };
  if (!usdc || network.assetSymbol !== "USDC" || network.asset === null || network.asset === "") return undefined;
  return { address: network.asset, decimals: 6, symbol: "USDC" };
}

/** @throws {never} */
export function sameAwardAsset(left: AwardAssetTerms, right: AwardAssetTerms, network: ReviewedNetwork | undefined, legacyAddress?: string): boolean {
  const a = awardAsset(left, network, legacyAddress);
  const b = awardAsset(right, network, legacyAddress);
  return a !== undefined && b !== undefined && a.decimals === b.decimals && sameAssetAddress(network, a.address, b.address);
}
