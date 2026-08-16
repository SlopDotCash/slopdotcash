/** Types the shared canonical receiving-address validator. */

export type FundingNetwork = "base" | "bitcoin" | "ethereum" | "solana";
export type FundingAsset = "BTC" | "USDC";

export interface FundingAddressRoute {
  readonly network: FundingNetwork;
  readonly asset: FundingAsset;
  readonly address: string;
  readonly effectiveAt: string;
  readonly replacedAt: string | null;
}

export declare const MAX_FUNDING_ROUTES: 32;

export declare function assertFundingAddresses(
  value: unknown,
  field?: string,
): readonly FundingAddressRoute[];

export declare function fundingAssetForNetwork(
  network: unknown,
): FundingAsset | null;

export declare function isFundingAddress(
  network: FundingNetwork,
  value: unknown,
): value is string;

export declare function isSolanaTransactionId(value: unknown): value is string;
