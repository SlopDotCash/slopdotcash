import { decodeEventLog, parseAbi } from "viem";
import {
  buildCommitMonthlyCalldata,
  buildReserveMonthlyCalldata,
  readVaultTotals,
  verifyEvmDeployment,
} from "../../contracts/evm/adapter";
import {
  type MonthlyFinalizationExpected,
  verifyMonthlyOwnerAuthorization,
} from "../../contracts/monthly-authorization";
import {
  type SolanaMonthlyOwnerPlan,
  solanaMonthlyOwnerMessage,
} from "../../contracts/solana/monthly-finalization";
import type { MonthlyAuthorization } from "../../workers/payment-executor/monthly";
import { decodeBase58Bytes } from "./base58";
import { readBoundedJson } from "./browser-json";
import {
  assertVaultWalletAccount,
  readFinalizedWalletTransaction,
  type VaultConnection,
  walletVaultConfig,
} from "./evm-vault-actions";
import { apiRequest } from "./project-api";
import { sendSolanaWalletTransaction } from "./solana-vault-actions";

export interface MonthlyFinalizationReview {
  authorization: MonthlyAuthorization;
  transaction?: SolanaMonthlyOwnerPlan;
}

export async function reviewMonthlyFinalization(
  expected: MonthlyFinalizationExpected & { manifestSha256: string },
  wallet: VaultConnection,
): Promise<MonthlyFinalizationReview & { decimals: number }> {
  const response = await apiRequest(
    `payments/projects/${encodeURIComponent(expected.projectId)}/monthly/${encodeURIComponent(expected.period)}/finalization`,
    {
      body: {
        step: "review",
        network: expected.deployment.network,
        wallet: wallet.address,
        snapshotSha256: expected.snapshotSha256,
        manifestSha256: expected.manifestSha256,
      },
      timeoutMs: 120_000,
    },
  );
  const result = (await readBoundedJson(
    response,
    4 * 1024 * 1024,
    "Monthly finalization",
  )) as MonthlyFinalizationReview & { message?: string };
  if (!response.ok)
    throw new Error(
      result.message ??
        "The monthly authorization is not ready. Retry its review.",
    );
  await verifyMonthlyOwnerAuthorization(result.authorization, expected);
  if (result.authorization.plan.family === "solana") {
    if (!result.transaction)
      throw new Error("The Solana wallet request is missing.");
    verifySolanaMonthlyWalletPlan(
      result.authorization,
      result.transaction,
      wallet.address,
    );
    return { ...result, decimals: result.transaction.decimals };
  }
  const reviewed = await reviewEvmMonthlyFinalization(
    result.authorization,
    wallet,
  );
  return { ...result, decimals: reviewed.decimals };
}

export function monthlyEvmCalldata(authorization: MonthlyAuthorization) {
  const { plan, signatureHex } = authorization;
  if (plan.family !== "evm")
    throw new Error("Choose an EVM monthly allocation.");
  return plan.evmReservation
    ? buildReserveMonthlyCalldata(
        plan.request.period,
        plan.evmReservation,
        `0x${signatureHex}`,
      )
    : buildCommitMonthlyCalldata(
        plan.request.period,
        plan.entries,
        `0x${signatureHex}`,
      );
}

async function reviewEvmMonthlyFinalization(
  authorization: MonthlyAuthorization,
  wallet: VaultConnection,
) {
  const { plan } = authorization;
  const deployment = plan.deployment;
  if (wallet.address.toLowerCase() !== deployment.owner.toLowerCase())
    throw new Error("Connect the vault owner's wallet.");
  const config = walletVaultConfig(deployment, wallet);
  await assertVaultWalletAccount(wallet, config);
  await verifyEvmDeployment(config);
  const totals = await readVaultTotals({
    ...config,
    network: deployment.network,
  });
  const required = plan.evmReservation?.remainingGross ?? plan.totalGrossBase;
  if (
    totals.freeBalance === null ||
    BigInt(totals.freeBalance) < BigInt(required)
  )
    throw new Error(
      "The whole monthly allocation needs enough free vault funds.",
    );
  const transaction = {
    from: wallet.address,
    to: deployment.vault,
    value: "0x0",
    data: monthlyEvmCalldata(authorization),
  };
  if (!wallet.evmRequest) throw new Error("Choose an EVM wallet.");
  await wallet.evmRequest("eth_estimateGas", [transaction]);
  return { transaction, decimals: totals.decimals };
}

export function verifySolanaMonthlyWalletPlan(
  authorization: MonthlyAuthorization,
  transaction: SolanaMonthlyOwnerPlan,
  wallet: string,
) {
  if (
    !transaction ||
    transaction.wallet !== wallet ||
    !Number.isInteger(transaction.decimals) ||
    transaction.decimals < 0 ||
    transaction.decimals > 36 ||
    decodeBase58Bytes(transaction.blockhash).length !== 32 ||
    !Number.isSafeInteger(transaction.lastValidBlockHeight) ||
    transaction.lastValidBlockHeight < 0 ||
    !/^(0|[1-9][0-9]*)$/.test(transaction.networkFeeLamports)
  )
    throw new Error("The prepared monthly wallet request is invalid.");
  const msg = solanaMonthlyOwnerMessage(
    authorization,
    wallet,
    transaction.blockhash,
  );
  const wire = Uint8Array.from(atob(transaction.transaction), (c) =>
    c.charCodeAt(0),
  );
  if (
    wire.length !== 65 + msg.length ||
    wire[0] !== 1 ||
    wire.slice(1, 65).some((byte) => byte !== 0) ||
    msg.some((byte, index) => byte !== wire[index + 65])
  )
    throw new Error(
      "The prepared transaction differs from the monthly authorization.",
    );
  return msg;
}

export async function sendMonthlyFinalization(
  review: MonthlyFinalizationReview,
  wallet: VaultConnection,
  beforeSend: () => void,
) {
  const { authorization, transaction } = review;
  await verifyMonthlyOwnerAuthorization(authorization, {
    ...authorization.plan.request,
    deployment: authorization.plan.deployment,
  });
  if (authorization.plan.family === "solana") {
    if (!transaction) throw new Error("The Solana wallet request is missing.");
    const msg = verifySolanaMonthlyWalletPlan(
      authorization,
      transaction,
      wallet.address,
    );
    return sendSolanaWalletTransaction(
      authorization.plan.deployment,
      wallet,
      transaction.transaction,
      msg,
      beforeSend,
    );
  }
  const current = await reviewEvmMonthlyFinalization(authorization, wallet);
  if (!wallet.evmRequest) throw new Error("Choose an EVM wallet.");
  await assertVaultWalletAccount(
    wallet,
    walletVaultConfig(authorization.plan.deployment, wallet),
  );
  beforeSend();
  const hash = await wallet.evmRequest("eth_sendTransaction", [
    current.transaction,
  ]);
  if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash))
    throw new Error(
      "The wallet result is unclear. Check wallet activity before another attempt.",
    );
  return hash;
}

const events = parseAbi([
  "event MonthlyReserved(uint32 indexed period,bytes32 allocationDigest,bytes32 allocationRoot,uint128 wholeGross,uint128 remainingGross,uint32 count,uint256 sourceSequence)",
  "event MonthlyCommitted(uint32 indexed period,bytes32 allocationRoot,uint128 gross,uint256 awards)",
]);

export async function checkMonthlyFinalization(
  review: MonthlyFinalizationReview,
  wallet: VaultConnection,
  transactionId: string,
) {
  const { authorization, transaction } = review;
  const { plan } = authorization;
  await verifyMonthlyOwnerAuthorization(authorization, {
    ...plan.request,
    deployment: plan.deployment,
  });
  if (
    plan.family === "evm" &&
    wallet.address.toLowerCase() !== plan.deployment.owner.toLowerCase()
  )
    throw new Error(
      "Reconnect the owner wallet that submitted this reservation.",
    );
  if (plan.family === "solana") {
    if (!transaction)
      throw new Error("The retained Solana request is missing.");
    verifySolanaMonthlyWalletPlan(authorization, transaction, wallet.address);
    const response = await apiRequest(
      `payments/projects/${encodeURIComponent(plan.request.projectId)}/monthly/${encodeURIComponent(plan.request.period)}/finalization`,
      {
        body: {
          step: "check",
          network: plan.request.network,
          wallet: wallet.address,
          authorization,
          blockhash: transaction.blockhash,
          transactionId,
        },
        timeoutMs: 120_000,
      },
    );
    const result = (await readBoundedJson(
      response,
      4096,
      "Monthly transaction status",
    )) as { status?: string; message?: string };
    if (
      !response.ok ||
      !["pending", "failed", "finalized"].includes(result.status ?? "")
    )
      throw new Error(
        result.message ?? "The monthly transaction status is unavailable.",
      );
    return result.status as "pending" | "failed" | "finalized";
  }
  const checked = await readFinalizedWalletTransaction(
    plan.deployment,
    wallet,
    transactionId,
    plan.deployment.vault,
    monthlyEvmCalldata(authorization),
  );
  if (checked.status !== "finalized") return checked.status;
  const matches = checked.receipt.logs.flatMap((log) => {
    if (log.address.toLowerCase() !== plan.deployment.vault.toLowerCase())
      return [];
    const data = (log as typeof log & { data?: string }).data;
    if (!data) return [];
    try {
      return [
        decodeEventLog({
          abi: events,
          topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
          data: data as `0x${string}`,
        }),
      ];
    } catch {
      return [];
    }
  });
  const reservation = plan.evmReservation;
  const relevant = matches.filter(
    (item) =>
      item.eventName === (reservation ? "MonthlyReserved" : "MonthlyCommitted"),
  );
  const event = relevant.length === 1 ? relevant[0] : undefined;
  if (
    !event ||
    Number(event.args.period) !==
      Number(plan.request.period.replace("-", "")) ||
    event.args.allocationRoot.toLowerCase() !==
      plan.allocationRoot.toLowerCase()
  )
    throw new Error(
      "The finalized transaction does not contain the approved monthly reservation.",
    );
  if (reservation) {
    if (
      event.eventName !== "MonthlyReserved" ||
      event.args.allocationDigest !== reservation.allocationDigest ||
      event.args.wholeGross !== BigInt(reservation.wholeGross) ||
      event.args.remainingGross !== BigInt(reservation.remainingGross) ||
      Number(event.args.count) !== reservation.count ||
      event.args.sourceSequence !== BigInt(reservation.sourceSequence)
    )
      throw new Error(
        "The finalized monthly reservation amounts differ from the approved request.",
      );
  } else if (
    event.eventName !== "MonthlyCommitted" ||
    event.args.gross !== BigInt(plan.totalGrossBase) ||
    event.args.awards !== BigInt(plan.entries.length)
  )
    throw new Error(
      "The finalized monthly awards differ from the approved request.",
    );
  return "finalized" as const;
}
