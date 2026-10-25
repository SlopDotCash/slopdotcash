import {
  ESCROW_NETWORKS,
  type EscrowChain,
  MAX_BASE_UNITS,
} from "../escrow-policy.mjs";

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
  projectId: string;
  chain: PaymentChain;
  grossBase: string;
  netBase: string;
  feeBase: string;
  state: "reserved" | "paid";
  /** PRD section 6 payment states of a reserved award. */
  deliveryState: "needs_wallet" | "ready" | "submitted" | "held" | "paid";
  submittedTransactionId: string | null;
  transactionId: string | null;
}
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
  | "paid";
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
  state: Extract<MonthlyAwardState, "underfunded" | "awaiting-reservation">;
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
 * nothing else. Remove the floor branch once every deployed vault and program runs the
 * rounded-up code and its manifest digest is updated. */
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
/** Exact decimal text of a base-unit amount; trailing fraction zeros removed. */
export function formatBaseUnits(value: string, decimals: number): string {
  const amount = BigInt(value);
  if (amount < 0n || !isAssetDecimals(decimals))
    throw new Error("Invalid base-unit amount");
  if (decimals === 0) return amount.toLocaleString("en-US");
  const scale = 10n ** BigInt(decimals);
  const fraction = (amount % scale)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return `${(amount / scale).toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`;
}
/**
 * The display name of a vault asset. Only a reviewed reference token of the
 * network (escrow-policy `assets`) with the same decimals has a symbol. Any
 * other token shows its shortened address, because a token's own symbol()
 * text is not reviewed.
 */
export function assetLabel(
  network: string,
  assetAddress: string,
  assetDecimals: number,
): string {
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
  return (
    reference?.symbol ??
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
