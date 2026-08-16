/** Types the shared canonical receiving-address validator. */

export type FundingNetwork = "base" | "bitcoin" | "ethereum" | "solana";
export type FundingAsset = "BTC" | "USDC";

export declare function fundingAssetForNetwork(
  network: unknown,
): FundingAsset | null;

export declare function isFundingAddress(
  network: FundingNetwork,
  value: unknown,
): value is string;

export declare function isSolanaTransactionId(value: unknown): value is string;
