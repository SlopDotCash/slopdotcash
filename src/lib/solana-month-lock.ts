import {
  solanaExpirePledgeInstruction,
  solanaPledgeMonthsInstructions,
} from "../../contracts/solana/adapter";
import { message } from "../../contracts/solana/transactions";
import { decodeBase58Bytes } from "./base58";
import { readBoundedJson } from "./browser-json";
import type { EscrowDeployment } from "./escrow-policy.mjs";
import type { VaultConnection } from "./evm-vault-actions";
import { chainMonth } from "./month-lock";
import { isAssetDecimals } from "./payments/contracts";
import { apiRequest } from "./project-api";
import { CANONICAL_UINT } from "./record-validation.mjs";
import { sendSolanaWalletTransaction } from "./solana-vault-actions";
import { assertUnsignedSolanaWire } from "./solana-wire";

/**
 * Month locks and their release on a Solana vault (operator decision,
 * 15 November 2026). The server plans and simulates; this module rebuilds
 * the exact message before the wallet is asked, and the wallet signs and
 * sends. Nothing here holds a key.
 */

type Transaction = {
  blockhash: string;
  lastValidBlockHeight: number;
  transaction: string;
  networkFeeLamports: string;
};

export type SolanaMonthLockPlan = {
  action: "lock" | "release";
  /** Months the transaction pledges or releases, as YYYYMM. */
  periods: number[];
  /** Months asked for; a lock already at this amount needs no change. */
  requested: number[];
  amountMinor: string;
  decimals: number | null;
  /** Null when every month is already locked at this amount. */
  transaction: Transaction | null;
};

function config(deployment: EscrowDeployment) {
  if (!deployment.programId || !deployment.projectPda)
    throw new Error("The Solana vault configuration is incomplete.");
  return {
    programId: deployment.programId,
    projectPda: deployment.projectPda,
    owner: deployment.owner,
  };
}

async function post(
  projectId: string,
  deployment: EscrowDeployment,
  body: Record<string, unknown>,
) {
  const response = await apiRequest(
    `payments/projects/${encodeURIComponent(projectId)}/solana-month-lock`,
    {
      body: { network: deployment.network, vault: deployment.vault, ...body },
      timeoutMs: 90_000,
    },
  );
  const value = (await readBoundedJson(
    response,
    16384,
    "Solana month lock response",
  )) as Record<string, unknown>;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("The month lock service returned an invalid response.");
  if (!response.ok) {
    if (response.status === 422 && typeof value.message === "string")
      throw new Error(value.message);
    throw new Error("The month lock could not be prepared. Review again.");
  }
  return value;
}

function validTransaction(value: unknown): value is Transaction {
  const t = value as Transaction;
  return (
    !!t &&
    typeof t.blockhash === "string" &&
    decodeBase58Bytes(t.blockhash).length === 32 &&
    Number.isSafeInteger(t.lastValidBlockHeight) &&
    t.lastValidBlockHeight >= 0 &&
    typeof t.transaction === "string" &&
    typeof t.networkFeeLamports === "string" &&
    CANONICAL_UINT.test(t.networkFeeLamports)
  );
}

/** The exact unsigned message of a plan, rebuilt here. */
export function solanaMonthLockMessage(
  deployment: EscrowDeployment,
  wallet: string,
  plan: Pick<SolanaMonthLockPlan, "action" | "periods" | "amountMinor">,
  blockhash: string,
) {
  const vault = config(deployment);
  return plan.action === "lock"
    ? // The same bytes as solanaPledgeMonthsMessage, without its RPC module.
      message(
        wallet,
        blockhash,
        solanaPledgeMonthsInstructions(vault, {
          wallet,
          periods: plan.periods,
          amountMinor: BigInt(plan.amountMinor),
        }),
      )
    : message(wallet, blockhash, [
        solanaExpirePledgeInstruction(vault, plan.periods[0] as number),
      ]);
}

function checkedPlan(
  deployment: EscrowDeployment,
  wallet: VaultConnection,
  plan: SolanaMonthLockPlan,
) {
  if (plan.transaction === null) return plan;
  if (!validTransaction(plan.transaction))
    throw new Error("The month lock plan is invalid.");
  assertUnsignedSolanaWire(
    plan.transaction.transaction,
    solanaMonthLockMessage(
      deployment,
      wallet.address,
      plan,
      plan.transaction.blockhash,
    ),
    "The prepared transaction differs from the reviewed month lock.",
  );
  return plan;
}

/** Plans a lock of `count` months at `amount` each, from the current month. */
export async function reviewSolanaMonthLock(
  projectId: string,
  deployment: EscrowDeployment,
  wallet: VaultConnection,
  count: number,
  amount: string,
): Promise<SolanaMonthLockPlan> {
  if (!wallet.solanaSend)
    throw new Error("Choose a wallet with Solana transaction support.");
  const value = await post(projectId, deployment, {
    step: "review",
    action: "lock",
    wallet: wallet.address,
    count,
    amount,
  });
  const plan = value.plan as Record<string, unknown> | undefined;
  if (
    !plan ||
    plan.wallet !== wallet.address ||
    typeof plan.amountMinor !== "string" ||
    !/^[1-9][0-9]{0,19}$/u.test(plan.amountMinor) ||
    !isAssetDecimals(plan.decimals) ||
    !Array.isArray(plan.periods) ||
    !Array.isArray(plan.requested) ||
    plan.requested.length !== count ||
    !plan.periods.every((period) =>
      (plan.requested as unknown[]).includes(period),
    ) ||
    (plan.transaction !== null && plan.periods.length === 0)
  )
    throw new Error("The month lock plan is invalid.");
  return checkedPlan(deployment, wallet, {
    action: "lock",
    periods: plan.periods as number[],
    requested: plan.requested as number[],
    amountMinor: plan.amountMinor,
    decimals: plan.decimals as number,
    transaction: plan.transaction as Transaction | null,
  });
}

/** Plans the release of one lapsed lock ("2026-12"). */
export async function reviewSolanaLockRelease(
  projectId: string,
  deployment: EscrowDeployment,
  wallet: VaultConnection,
  period: string,
): Promise<SolanaMonthLockPlan> {
  if (!wallet.solanaSend)
    throw new Error("Choose a wallet with Solana transaction support.");
  const value = await post(projectId, deployment, {
    step: "review",
    action: "release",
    wallet: wallet.address,
    period,
  });
  const plan = value.plan as Record<string, unknown> | undefined;
  if (
    !plan ||
    plan.wallet !== wallet.address ||
    plan.period !== chainMonth(period) ||
    typeof plan.amountMinor !== "string" ||
    plan.transaction === null
  )
    throw new Error("The release plan is invalid.");
  return checkedPlan(deployment, wallet, {
    action: "release",
    periods: [chainMonth(period)],
    requested: [chainMonth(period)],
    amountMinor: plan.amountMinor,
    decimals: null,
    transaction: plan.transaction as Transaction,
  });
}

export async function sendSolanaMonthLock(
  deployment: EscrowDeployment,
  wallet: VaultConnection,
  plan: SolanaMonthLockPlan,
  beforeSend: () => void,
) {
  if (!plan.transaction) throw new Error("Nothing to send.");
  const msg = solanaMonthLockMessage(
    deployment,
    wallet.address,
    plan,
    plan.transaction.blockhash,
  );
  return sendSolanaWalletTransaction(
    deployment,
    wallet,
    plan.transaction.transaction,
    msg,
    beforeSend,
  );
}

export async function checkSolanaMonthLock(
  projectId: string,
  deployment: EscrowDeployment,
  wallet: VaultConnection,
  plan: SolanaMonthLockPlan,
  transactionId: string,
): Promise<"pending" | "failed" | "finalized"> {
  if (!plan.transaction) throw new Error("Nothing was sent.");
  const value = await post(projectId, deployment, {
    step: "check",
    action: plan.action,
    wallet: wallet.address,
    periods: plan.periods,
    amountMinor: plan.amountMinor,
    blockhash: plan.transaction.blockhash,
    transactionId,
  });
  if (
    value.status !== "pending" &&
    value.status !== "failed" &&
    value.status !== "finalized"
  )
    throw new Error("The transaction status could not be verified.");
  return value.status;
}
