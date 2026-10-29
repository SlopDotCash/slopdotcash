import { formatBaseUnits } from "../base-units.mjs";
import {
  ESCROW_NETWORKS,
  type EscrowChain,
  MAX_BASE_UNITS,
} from "../escrow-policy.mjs";

export { formatBaseUnits };

export type PaymentChain = EscrowChain;
/**
 * The vault asset of an amount. Amounts are base-unit integer text of this
 * asset: the token's smallest unit, scaled by `assetDecimals`.
 */
export interface PaymentAsset {
  network: string;
  assetAddress: string;
  assetDecimals: number;
}
export interface AccountPayment extends PaymentAsset {
  id: string;
  vault: string;
  projectId: string;
  chain: PaymentChain;
  grossBase: string;
  netBase: string;
  feeBase: string;
  state: "reserved" | "paid";
  /** PRD section 6 payment states of a reserved award. */
  deliveryState: (typeof PAYMENT_DELIVERY_STATES)[number];
  submittedTransactionId: string | null;
  transactionId: string | null;
}
export const PAYMENT_DELIVERY_STATES = [
  "needs_wallet",
  "ready",
  "submitted",
  "held",
  "paid",
] as const;
/** The states of an approved award before its vault reservation. */
export const UNRESERVED_AWARD_STATES = [
  "underfunded",
  "awaiting-reservation",
  "conflict",
] as const satisfies readonly MonthlyAwardState[];
/**
 * A monthly award's state before and after its vault reservation. Owners and
 * contributors read the same value; a reserved or paid state comes only from
 * the finalized chain projection, and excluded only from a recorded ban
 * decision.
 */
export type MonthlyAwardState =
  | "excluded"
  | "underfunded"
  | "awaiting-reservation"
  | "reserved"
  | "paid"
  /** Another award (other actor, gross or fee) is reserved under this award's source. */
  | "conflict";
/**
 * An approved monthly award that is frozen but not yet reserved in the vault
 * (PRD sections 3 and 6). Once reserved it is an AccountPayment instead.
 */
export interface AccountMonthlyAward extends PaymentAsset {
  projectId: string;
  period: string;
  chain: PaymentChain;
  grossBase: string;
  feeBase: string;
  netBase: string;
  state: (typeof UNRESERVED_AWARD_STATES)[number];
}
export interface PaymentsAccount {
  githubUserId: string;
  wallets: {
    chain: PaymentChain;
    claimId: string;
    address: string;
    authorized: boolean;
  }[];
  payments: AccountPayment[];
  /** Approved monthly awards not yet reserved; never counted in `balances`. */
  monthlyAwards: AccountMonthlyAward[];
  /** Unpaid net per network and asset; never summed across networks or assets. */
  balances: (PaymentAsset & { chain: PaymentChain; netBase: string })[];
  /** Imported from reviewed disclosures; never an escrow `paid` state. */
  directTransfers: DirectTransfer[];
  /** Opt-in clients load disclosed history separately through its page API. */
  directTransfersPaged?: boolean;
  /** Legacy README observations; history only, never a payout destination. */
  walletObservations: WalletObservation[];
}
export interface WalletObservation {
  chain: PaymentChain;
  address: string;
  proofLevel: "profile_readme";
  sourceUrl: string;
  observedAt: string;
}
/** A transfer a project creator sent outside escrow and Slop settlement. */
export interface DirectTransfer {
  projectId: string;
  contributionMonth: string;
  githubUserId: string;
  login: string;
  network: string;
  chain: PaymentChain;
  recipient: string;
  amountMicro: string;
  transactionId: string;
  blockTime: string;
}
/** One append-boundary page of disclosed transfers; totalMicro is for this page. */
export interface DirectTransferPage {
  transfers: DirectTransfer[];
  totalMicro: string;
  through: number;
  next: number | null;
  total: number;
}
/** Public projection of an ordinary, finalized vault payment. */
export interface PublicVaultPayment extends PaymentAsset {
  id: string;
  projectId: string;
  chain: PaymentChain;
  contributionMonth: string | null;
  netBase: string;
  transactionId: string;
  /** When finalized evidence was indexed, not the payment's block time. */
  indexedAt: string;
}
export interface PublicVaultPaymentPage {
  payments: PublicVaultPayment[];
  through: number;
  next: number | null;
  total: number;
}
export { isBaseUnits, MAX_BASE_UNITS } from "../escrow-policy.mjs";
export type PayoutPolicy = "ordinary" | "security-bounty";
/** The 2% payout fee is deducted from the gross award, in base units of the award asset.
 * It rounds up, ceil(gross / 50), on both chains, as does the unused-funds withdrawal fee. */
export function payoutFee(
  gross: bigint,
  policy: PayoutPolicy = "ordinary",
): bigint {
  if (gross <= 0n || gross > MAX_BASE_UNITS)
    throw new Error("Invalid gross award");
  if (policy === "security-bounty") {
    if (gross % 4n !== 0n) throw new Error("Bounty split must be exact");
    return gross / 4n;
  }
  if (policy !== "ordinary") throw new Error("Unknown payout policy");
  return (gross + 49n) / 50n;
}
/** The 2% ordinary fee for any amount, rounded up; zero for zero. For projections and plans. */
export function ordinaryFee(gross: bigint): bigint {
  return gross > 0n ? (gross + 49n) / 50n : 0n;
}
/** The fee a vault records for `gross`. Vaults deployed before fees rounded up still record
 * floor(gross / 50) until their upgrade, so reconciliation accepts either 2% rounding and
 * nothing else. Historical events and funded awards retain their original fee after
 * an upgrade; upgrading every deployment does not remove this compatibility need. */
export function acceptsPayoutFee(
  gross: bigint,
  fee: bigint,
  policy: PayoutPolicy = "ordinary",
): boolean {
  const expected = payoutFee(gross, policy);
  return (
    fee === expected ||
    (policy === "ordinary" && fee === gross / 50n && fee + 1n === expected)
  );
}
export function isAssetDecimals(value: unknown): value is number {
  return (
    Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 36
  );
}
/**
 * The display name of a vault asset. Only a reviewed reference token of the
 * network (escrow-policy `assets`) with the same decimals has a symbol. Any
 * other token shows its shortened address, because a token's own symbol()
 * text is not reviewed.
 */
/** The reviewed symbol of a registry asset, or null for an unlisted token. */
export function knownAssetSymbol(
  network: string,
  assetAddress: string,
  assetDecimals: number,
): string | null {
  const policy = Object.hasOwn(ESCROW_NETWORKS, network)
    ? ESCROW_NETWORKS[network as keyof typeof ESCROW_NETWORKS]
    : undefined;
  const reference = policy?.assets.find(
    (asset) =>
      asset.decimals === assetDecimals &&
      (policy.family === "evm"
        ? asset.address.toLowerCase() === assetAddress.toLowerCase()
        : asset.address === assetAddress),
  );
  return reference?.symbol ?? null;
}
function assetLabel(
  network: string,
  assetAddress: string,
  assetDecimals: number,
): string {
  return (
    knownAssetSymbol(network, assetAddress, assetDecimals) ??
    `token ${assetAddress.slice(0, 6)}…${assetAddress.slice(-4)}`
  );
}
export function formatAssetAmount(
  value: string,
  asset: Pick<PaymentAsset, "network" | "assetAddress" | "assetDecimals">,
): string {
  return `${formatBaseUnits(value, asset.assetDecimals)} ${assetLabel(asset.network, asset.assetAddress, asset.assetDecimals)}`;
}
/** Vault counters cached from one finalized chain read (vault_snapshots). */
export interface VaultSnapshot extends PaymentAsset {
  projectId: string;
  chain: PaymentChain;
  vault: string;
  totalDeposited: string;
  totalPaid: string;
  totalPayoutFees: string;
  totalGrossWithdrawn: string;
  totalWithdrawalFees: string;
  /** Null when this vault type has no such counter; never shown as zero. */
  freeBalance: string | null;
  reservedPrincipal: string | null;
  reservedFees: string | null;
  accruedFees: string | null;
  reserved: string | null;
  blockNumber: string;
  blockTime: string;
  observedAt: string;
}
/**
 * Gross reserved for committed awards, the same figure on both chains: EVM vaults
 * split reserved principal and fees, Solana reports one reserved total (which
 * also holds an admitted monthly allocation until its awards settle).
 */
export function reservedGross(snapshot: {
  reservedPrincipal: string | null;
  reservedFees: string | null;
  reserved: string | null;
}): string | null {
  return (
    snapshot.reserved ??
    (snapshot.reservedPrincipal !== null && snapshot.reservedFees !== null
      ? (
          BigInt(snapshot.reservedPrincipal) + BigInt(snapshot.reservedFees)
        ).toString()
      : null)
  );
}
/** A snapshot older than this is shown with a stale warning. Cron runs every 5 minutes. */
export const VAULT_SNAPSHOT_STALE_MS = 30 * 60 * 1000;

/** Public explorer link for a payment transaction, or null when none exists. */
export function transactionUrl(
  network: string,
  id: string | null,
): string | null {
  if (!id) return null;
  if (network === "base-sepolia")
    return `https://sepolia.basescan.org/tx/${encodeURIComponent(id)}`;
  if (network === "base-mainnet")
    return `https://basescan.org/tx/${encodeURIComponent(id)}`;
  if (network === "solana-mainnet")
    return `https://explorer.solana.com/tx/${encodeURIComponent(id)}`;
  if (network === "solana-devnet" || network === "solana-testnet")
    return `https://explorer.solana.com/tx/${encodeURIComponent(id)}?cluster=${network.slice(7)}`;
  if (network === "ethereum")
    return `https://etherscan.io/tx/${encodeURIComponent(id)}`;
  if (network === "ethereum-sepolia")
    return `https://sepolia.etherscan.io/tx/${encodeURIComponent(id)}`;
  if (network === "robinhood-mainnet")
    return `https://robinhoodchain.blockscout.com/tx/${encodeURIComponent(id)}`;
  if (network === "robinhood-testnet")
    return `https://explorer.testnet.chain.robinhood.com/tx/${encodeURIComponent(id)}`;
  return null;
}
