import { ESCROW_NETWORKS } from "./escrow-policy.mjs";
import type { PaymentChain, PaymentsAccount } from "./payments/contracts";

/**
 * The contributor token allocation that Slop Cash S.P. sends from its own
 * wallet (PRD section 11, "Contributor token allocation"). Slop only displays
 * this reviewed file; it holds no key and sends nothing.
 */
export const CONTRIBUTOR_ALLOCATION_URL = "/contributor-allocation.json";

export interface ContributorAllocationRecipient {
  githubId: string;
  amountBase: string;
  /** The transfer the sender recorded for this recipient, or null before it. */
  transactionId: string | null;
}
export interface ContributorAllocation {
  network: keyof typeof ESCROW_NETWORKS;
  chain: PaymentChain;
  token: { symbol: string; decimals: number; address: string };
  registrationClosesAt: string;
  /** True once the sender recorded the final batch; no later transfer follows. */
  closed: boolean;
  recipients: ContributorAllocationRecipient[];
}
export type ContributorAllocationState =
  | "sent"
  | "scheduled"
  | "awaiting-wallet"
  | "unclaimed";

const evmAddress = (v: unknown): v is string =>
  typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
const evmHash = (v: unknown): v is string =>
  typeof v === "string" && /^0x[0-9a-f]{64}$/.test(v);
const positiveBase = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[1-9][0-9]{0,77}$/.test(v) &&
  BigInt(v) < 1n << 256n;
const utcInstant = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v) &&
  !Number.isNaN(Date.parse(v));

/** The published file, or null when no allocation is published. Throws on any invalid field. */
export function contributorAllocation(
  value: unknown,
): ContributorAllocation | null {
  const invalid = () =>
    new Error("The contributor allocation could not be verified.");
  if (!value || typeof value !== "object") throw invalid();
  const { distribution } = value as { distribution?: unknown };
  if (distribution === null) return null;
  if (!distribution || typeof distribution !== "object") throw invalid();
  const d = distribution as Record<string, unknown>;
  const token = d.token as Record<string, unknown> | null | undefined;
  const policy =
    typeof d.network === "string" && Object.hasOwn(ESCROW_NETWORKS, d.network)
      ? ESCROW_NETWORKS[d.network as keyof typeof ESCROW_NETWORKS]
      : null;
  // Only an EVM network is supported: transaction ids and addresses are EVM.
  if (
    !policy ||
    policy.family !== "evm" ||
    !token ||
    typeof token.symbol !== "string" ||
    !/^[A-Z0-9]{1,11}$/.test(token.symbol) ||
    !Number.isInteger(token.decimals) ||
    (token.decimals as number) < 0 ||
    (token.decimals as number) > 36 ||
    !evmAddress(token.address) ||
    !utcInstant(d.registrationClosesAt) ||
    typeof d.closed !== "boolean" ||
    !Array.isArray(d.recipients)
  )
    throw invalid();
  const seen = new Set<string>();
  const recipients = d.recipients.map((r: unknown) => {
    const row = r as Record<string, unknown> | null;
    if (
      !row ||
      typeof row.githubId !== "string" ||
      !/^[1-9][0-9]{0,19}$/.test(row.githubId) ||
      seen.has(row.githubId) ||
      !positiveBase(row.amountBase) ||
      (row.transactionId !== null && !evmHash(row.transactionId))
    )
      throw invalid();
    seen.add(row.githubId);
    return {
      githubId: row.githubId,
      amountBase: row.amountBase,
      transactionId: row.transactionId,
    };
  });
  return {
    network: d.network as keyof typeof ESCROW_NETWORKS,
    chain: policy.chain,
    token: {
      symbol: token.symbol,
      decimals: token.decimals as number,
      address: token.address,
    },
    registrationClosesAt: d.registrationClosesAt,
    closed: d.closed,
    recipients,
  };
}

/**
 * A recorded transfer is sent. Until the final batch, a confirmed wallet on
 * the allocation's chain is scheduled, and a missing one awaits a wallet
 * until registration closes. Anything else is unclaimed.
 */
export function contributorAllocationState(
  allocation: ContributorAllocation,
  recipient: ContributorAllocationRecipient,
  wallets: PaymentsAccount["wallets"],
  now: number,
): ContributorAllocationState {
  if (recipient.transactionId) return "sent";
  if (allocation.closed) return "unclaimed";
  if (wallets.some((w) => w.chain === allocation.chain && w.authorized))
    return "scheduled";
  return now < Date.parse(allocation.registrationClosesAt)
    ? "awaiting-wallet"
    : "unclaimed";
}
