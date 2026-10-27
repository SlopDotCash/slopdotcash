export const ESCROW_PAYOUT_FEE_BASIS_POINTS: 200;
export const ESCROW_WITHDRAWAL_FEE_BASIS_POINTS: 200;
export interface EscrowDeployment {
  /** Optional EVM per-operation gas envelope, in native base units. Not a lifetime budget. */
  maxNativeCostWei?: string;
  evmUpgrade?: import("../../contracts/evm/adapter").EvmUpgrade;
  network:
    | "base-sepolia"
    | "base-mainnet"
    | "solana-devnet"
    | "solana-testnet"
    | "solana-mainnet"
    | "robinhood-testnet"
    | "robinhood-mainnet"
    | "ethereum-sepolia"
    | "ethereum";
  vault: string;
  programId: string | null;
  upgradeAuthority: string | null;
  projectPda: string | null;
  networkDomain: string | null;
  asset: string;
  owner: string;
  identityAuthority: string;
  feeRecipient: string;
  rotationAuthority?: string;
  deploymentTransaction: string;
  sourceCommit: string;
  codeSha256: string;
  bindingDelaySeconds: string;
  /** Solana only; null on EVM chains, where the factory fixes 7 days. */
  rotationDelaySeconds: string | null;
  /** EVM chains only; null on Solana. The EscrowFactory that created the vault and rotates its identity authority. */
  factory: string | null;
  /** EVM chains only; null on Solana. sha256 of the factory runtime code. */
  factoryCodeSha256: string | null;
  /** EVM chains only; null on Solana. The factory registrar, which alone proposes an authority rotation. */
  registrar: string | null;
}
export type EscrowChain = "base" | "solana" | "robinhood" | "ethereum";
export type EscrowFamily = "evm" | "solana";
export interface EscrowPolicy {
  schemaVersion: "1";
  effectiveCycle: string;
  chain: EscrowChain;
  feeBasisPoints: 200;
  /** Escrow v2: 2%, ceil(gross / 50) per withdrawal, equal to the payout fee and enforced by the contracts. */
  withdrawalFeeBasisPoints: 200;
  feeMode: "deduct-from-gross";
  deployments: EscrowDeployment[];
}
export declare const MIN_PRODUCTION_BINDING_DELAY: number;
export declare const MIN_PRODUCTION_ROTATION_DELAY: number;
/** A reference stablecoin on a network. Vaults accept any standard token; this is not an allowlist. */
export interface EscrowAsset {
  address: string;
  symbol: string;
  decimals: number;
  /** The primary source that publishes the address. */
  source: string;
}
export interface EscrowNetwork {
  chain: EscrowChain;
  family: EscrowFamily;
  testnet: boolean;
  chainId?: string;
  /** The default reference stablecoin (assets[0]), or null. */
  asset: string | null;
  assetSymbol: string;
  assetDecimals: number | null;
  assets: readonly EscrowAsset[];
  /** EVM only: executor gas ceiling in gas units, decimal string. */
  gasCeiling?: string;
  /** EVM only: blocks per eth_getLogs page, inclusive, decimal string. */
  scanPageBlocks?: string;
  /** Solana only: the cluster genesis hash that identifies its RPC. */
  genesisHash?: string;
}
export declare const ESCROW_NETWORKS: Readonly<
  Record<EscrowDeployment["network"], EscrowNetwork>
>;
export declare const ESCROW_CHAINS: readonly EscrowChain[];
export declare const EVM_CHAINS: readonly EscrowChain[];
export declare function isEscrowChain(value: unknown): value is EscrowChain;
export declare function chainFamily(chain: string): EscrowFamily;
export declare function isMaxNativeCostWei(value: unknown): value is string;
export declare function assertEscrowPolicy(value: unknown): EscrowPolicy;
export declare function assertEscrowTransition(
  previous: EscrowPolicy | undefined,
  next: EscrowPolicy | undefined,
  allowUnfundedChange?: boolean,
): void;
/** One reviewed deployment with the network registry's values, as the payment workers read it. */
export type PaymentDeploymentRecord = EscrowDeployment & {
  projectId: string;
  chain: EscrowChain;
  chainId?: string;
  gasCeiling?: string;
  scanPageBlocks?: string;
};
export declare function paymentDeploymentRecord(
  projectId: string,
  deployment: EscrowDeployment,
): PaymentDeploymentRecord;

export type SecurityEscrowPolicy = Omit<EscrowPolicy, "feeBasisPoints"> & {
  feeBasisPoints: 2500;
};
export declare function assertSecurityEscrowPolicy(
  value: unknown,
): SecurityEscrowPolicy;

export const MAX_BASE_UNITS: bigint;
export function isBaseUnits(value: unknown): value is string;
export const SOLANA_MAX_BASE_UNITS: bigint;
export function maxBaseUnitsForChain(chain: string): bigint;
