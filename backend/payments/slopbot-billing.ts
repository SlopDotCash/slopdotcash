/**
 * Slopbot billing, PRD BOT-11 Step A: prepaid USDC credit intake and the
 * deterministic monthly invoice. This module reads finalized chain evidence
 * and appends credit rows. It never moves funds or signs anything.
 */
import { verifyFundingEvm } from "../../scripts/verify-funding-evm";
import { verifyFundingSolana } from "../../scripts/verify-funding-solana";
import {
  BASE_PLATFORM_FEE_RECIPIENT,
  SOLANA_PLATFORM_FEE_RECIPIENT,
} from "../../src/lib/fresh-cycle-policy.mjs";
import { isSolanaTransactionId } from "../../src/lib/funding-address.mjs";
import type { D1Database } from "../trace/cloudflare-persistence";

/** Slop's published service addresses are its reviewed fee recipients (PAY-09). */
export const SLOPBOT_SERVICE_ADDRESSES = {
  base: BASE_PLATFORM_FEE_RECIPIENT,
  solana: SOLANA_PLATFORM_FEE_RECIPIENT,
} as const;

type Network = keyof typeof SLOPBOT_SERVICE_ADDRESSES;

export type DepositResult =
  | { status: 201; body: { reference: string; amountMicroUsdc: string } }
  | {
      status: 400 | 404 | 409 | 422;
      body: { error: string; message?: string };
    };

/** Verifies the exact finalized transfer from the payer to the service address. */
const verifyDeposit = (input: {
  network: Network;
  reference: string;
  amountMicroUsdc: string;
  payer: string;
}) => {
  const { network, reference, amountMicroUsdc, payer } = input;
  return network === "base"
    ? verifyFundingEvm({
        network,
        transactionHash: reference,
        recipient: SLOPBOT_SERVICE_ADDRESSES.base,
        amountMinor: amountMicroUsdc,
        requiredSender: payer,
      })
    : verifyFundingSolana({
        signature: reference,
        recipient: SLOPBOT_SERVICE_ADDRESSES.solana,
        amountMinor: amountMicroUsdc,
        requiredSender: payer,
      });
};

/**
 * Credits one prepaid deposit. The payment reference is the payer wallet: it
 * must be the signed-in member's current, signature-authorized wallet on that
 * chain, so a transfer seen on chain cannot be claimed by another account.
 */
export async function creditSlopbotDeposit(
  db: D1Database,
  githubUserId: string,
  input: unknown,
  now: string,
): Promise<DepositResult> {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    return { status: 400, body: { error: "invalid_deposit" } };
  const body = input as Record<string, unknown>;
  const network = body.network;
  const installationId = body.installationId;
  const amount = body.amountMicroUsdc;
  const reference =
    network === "base" && typeof body.transaction === "string"
      ? body.transaction.toLowerCase()
      : body.transaction;
  if (
    (network !== "base" && network !== "solana") ||
    !Number.isSafeInteger(installationId) ||
    (installationId as number) <= 0 ||
    typeof amount !== "string" ||
    !/^[1-9]\d{0,14}$/u.test(amount) ||
    typeof reference !== "string" ||
    !(network === "base"
      ? /^0x[0-9a-f]{64}$/u.test(reference)
      : isSolanaTransactionId(reference))
  )
    return { status: 400, body: { error: "invalid_deposit" } };
  const installation = await db
    .prepare(
      "SELECT 1 AS ok FROM slopbot_installations WHERE installation_id=? AND removed_at IS NULL",
    )
    .bind(installationId)
    .first();
  if (!installation)
    return { status: 404, body: { error: "installation_not_found" } };
  if (
    await db
      .prepare("SELECT 1 AS ok FROM slopbot_credits WHERE reference=?")
      .bind(reference)
      .first()
  )
    return { status: 409, body: { error: "deposit_already_credited" } };
  const wallet = await db
    .prepare(
      "SELECT w.wallet_address FROM wallet_claims w JOIN payment_wallet_authorizations a ON a.claim_id=w.id WHERE w.github_user_id=? AND w.chain=? AND NOT EXISTS(SELECT 1 FROM wallet_claims n WHERE n.supersedes_claim_id=w.id)",
    )
    .bind(githubUserId, network)
    .first<{ wallet_address: string }>();
  if (!wallet)
    return {
      status: 422,
      body: {
        error: "payer_wallet_required",
        message: `Register and authorize your ${network} wallet first. Only a deposit sent from that wallet can be credited.`,
      },
    };
  try {
    await verifyDeposit({
      network,
      reference,
      amountMicroUsdc: amount,
      payer: wallet.wallet_address,
    });
  } catch (error) {
    return {
      status: 422,
      body: {
        error: "transfer_not_verified",
        message: error instanceof Error ? error.message : "Verification failed",
      },
    };
  }
  const inserted = await db
    .prepare(
      "INSERT OR IGNORE INTO slopbot_credits (installation_id, kind, amount_micro_usdc, reference, created_at) VALUES (?, 'deposit', ?, ?, ?)",
    )
    .bind(installationId, Number(amount), reference, now)
    .run();
  if (inserted.meta?.changes !== 1)
    return { status: 409, body: { error: "deposit_already_credited" } };
  return { status: 201, body: { reference, amountMicroUsdc: amount } };
}

export interface SlopbotInvoice {
  installationId: number;
  month: string;
  state: "open" | "closed";
  periodStart: string;
  periodEnd: string;
  modelCalls: number;
  billedMicroUsdc: string;
  feeOffsetMicroUsdc: string;
  feeOffsetReason: string;
  dueMicroUsdc: string;
}

/** Sums one installation's billed model calls in one UTC month (BOT-10, BOT-11). */
export async function slopbotInvoice(
  db: D1Database,
  installationId: number,
  month: string,
  now: string,
): Promise<SlopbotInvoice | null> {
  const [year, monthNumber] = month.split("-").map(Number);
  const periodStart = new Date(
    Date.UTC(year, monthNumber - 1, 1),
  ).toISOString();
  const periodEnd = new Date(Date.UTC(year, monthNumber, 1)).toISOString();
  const installation = await db
    .prepare(
      "SELECT 1 AS ok FROM slopbot_installations WHERE installation_id=?",
    )
    .bind(installationId)
    .first();
  if (!installation) return null;
  const totals = await db
    .prepare(
      "SELECT COUNT(*) AS calls, COALESCE(SUM(billed_micro_usdc), 0) AS billed FROM slopbot_costs WHERE installation_id=? AND created_at>=? AND created_at<?",
    )
    .bind(installationId, periodStart, periodEnd)
    .first<{ calls: number; billed: number }>();
  const billed = BigInt(totals?.billed ?? 0);
  return {
    installationId,
    month,
    state: now >= periodEnd ? "closed" : "open",
    periodStart,
    periodEnd,
    modelCalls: totals?.calls ?? 0,
    billedMicroUsdc: billed.toString(),
    feeOffsetMicroUsdc: "0",
    feeOffsetReason:
      "No reviewed link from a Slopbot installation to a funded project exists yet, so Slop's payout fee cannot offset this invoice.",
    dueMicroUsdc: billed.toString(),
  };
}
