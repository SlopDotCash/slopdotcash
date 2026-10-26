import { encodeFunctionData, parseAbi } from "viem";
import type {
  MonthlyCommitmentInput,
  MonthlyCommitmentPlan,
} from "../../backend/payments/monthly";
import {
  buildCommitAwardCalldata,
  EVM_ESCROW_EVENT_TOPICS,
  evmAwardId,
  readVaultTotals,
  verifyEvmDeployment,
  verifyReserve,
} from "../../contracts/evm/adapter";
import { readBoundedJson } from "./browser-json";
import { ESCROW_NETWORKS, maxBaseUnitsForChain } from "./escrow-policy.mjs";
import {
  assertVaultWalletAccount,
  readFinalizedWalletTransaction,
  type VaultConnection,
  walletVaultConfig,
} from "./evm-vault-actions";
import { acceptsPayoutFee } from "./payments/contracts";
import { apiRequest } from "./project-api";

export type OwnerCommitmentPlan = MonthlyCommitmentPlan;
export async function requestOwnerCommitment(
  projectId: string,
  cycleId: string,
  expected: MonthlyCommitmentInput,
) {
  const response = await apiRequest(
    `payments/projects/${encodeURIComponent(projectId)}/monthly/${encodeURIComponent(cycleId)}/commitment`,
    { body: expected, timeoutMs: 120_000 },
  );
  const value = (await readBoundedJson(
    response,
    65536,
    "Owner commitment",
  )) as OwnerCommitmentPlan & { message?: string };
  if (!response.ok)
    throw new Error(
      value.message ?? "The award could not be reverified. Reload the awards.",
    );
  if (
    value.schemaVersion !== "2" ||
    value.projectId !== projectId ||
    value.cycleId !== cycleId ||
    value.manifestSha256 !== expected.manifestSha256 ||
    value.snapshotSha256 !== expected.snapshotSha256 ||
    value.deployment?.network !== expected.network ||
    value.award?.githubUserId !== expected.githubUserId ||
    !/^[a-f0-9]{64}$/.test(value.award.sourceDigest) ||
    !/^[1-9][0-9]*$/.test(value.award.gross)
  )
    throw new Error("The prepared award differs from the finalized awards.");
  const gross = BigInt(value.award.gross);
  // The award range is the vault network's chain range (PRD section 6): the
  // EVM vault accounts in uint128, Solana in u64. A single u64 cap here
  // rejected EVM awards the server range and the on-chain amount word accept.
  const chain = value.deployment
    ? ESCROW_NETWORKS[value.deployment.network]?.chain
    : undefined;
  if (
    !chain ||
    gross > maxBaseUnitsForChain(chain) ||
    !/^(0|[1-9][0-9]*)$/.test(value.award.fee) ||
    !acceptsPayoutFee(gross, BigInt(value.award.fee)) ||
    value.award.net !== (gross - BigInt(value.award.fee)).toString()
  )
    throw new Error("The prepared award amounts are invalid.");
  return value;
}
export function evmCommitmentIntent(plan: OwnerCommitmentPlan) {
  const network = ESCROW_NETWORKS[plan.deployment.network];
  if (network.family !== "evm" || !network.chainId)
    throw new Error("Choose an EVM vault.");
  const obligationId = evmAwardId(
    BigInt(network.chainId),
    plan.deployment.vault,
    `0x${plan.award.sourceDigest}`,
  );
  return {
    obligationId,
    data: buildCommitAwardCalldata({
      obligationId,
      sourceDigest: `0x${plan.award.sourceDigest}`,
      githubUserId: plan.award.githubUserId,
      grossMicro: plan.award.gross,
    }),
  };
}
export async function reviewEvmCommitment(
  plan: OwnerCommitmentPlan,
  wallet: VaultConnection,
) {
  const config = walletVaultConfig(plan.deployment, wallet);
  await assertVaultWalletAccount(wallet, config);
  if (wallet.address.toLowerCase() !== plan.deployment.owner.toLowerCase())
    throw new Error("Connect the vault owner's wallet to authorize awards.");
  await verifyEvmDeployment(config);
  const totals = await readVaultTotals({
    ...config,
    network: plan.deployment.network,
  });
  if (totals.asset.toLowerCase() !== plan.deployment.asset.toLowerCase())
    throw new Error("The vault asset differs from the reviewed policy.");
  const request = wallet.evmRequest;
  if (!request) throw new Error("Choose an EVM wallet.");
  const consumed = await request("eth_call", [
    {
      to: plan.deployment.vault,
      data: encodeFunctionData({
        abi: parseAbi([
          "function consumedSources(bytes32) view returns (bool)",
        ]),
        functionName: "consumedSources",
        args: [`0x${plan.award.sourceDigest}`],
      }),
    },
    "latest",
  ]);
  if (consumed === `0x${"0".repeat(63)}1`)
    throw new Error(
      "This award is already committed. Check its existing transaction.",
    );
  if (consumed !== `0x${"0".repeat(64)}`)
    throw new Error("The existing award state could not be verified.");
  if (
    totals.freeBalance === null ||
    BigInt(totals.freeBalance) < BigInt(plan.award.gross)
  )
    throw new Error("The vault has insufficient free funds for this award.");
  const transaction = {
    from: wallet.address,
    to: plan.deployment.vault,
    value: "0x0",
    data: evmCommitmentIntent(plan).data,
  };
  await request("eth_estimateGas", [transaction]);
  return {
    transaction,
    decimals: totals.decimals,
    freeBalance: totals.freeBalance,
  };
}
export async function sendEvmCommitment(
  plan: OwnerCommitmentPlan,
  wallet: VaultConnection,
  beforeSend: () => void,
) {
  const review = await reviewEvmCommitment(plan, wallet);
  await assertVaultWalletAccount(
    wallet,
    walletVaultConfig(plan.deployment, wallet),
  );
  if (!wallet.evmRequest) throw new Error("Choose an EVM wallet.");
  beforeSend();
  const hash = await wallet.evmRequest("eth_sendTransaction", [
    review.transaction,
  ]);
  if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash))
    throw new Error(
      "The wallet result is unclear. Check wallet activity before another attempt.",
    );
  return hash;
}
export async function checkEvmCommitment(
  plan: OwnerCommitmentPlan,
  wallet: VaultConnection,
  transactionId: string,
) {
  const intent = evmCommitmentIntent(plan);
  const checked = await readFinalizedWalletTransaction(
    plan.deployment,
    wallet,
    transactionId,
    plan.deployment.vault,
    intent.data,
  );
  if (checked.status !== "finalized") return checked.status;
  const events = checked.receipt.logs.filter(
    (log) =>
      log.address.toLowerCase() === plan.deployment.vault.toLowerCase() &&
      log.topics[0]?.toLowerCase() === EVM_ESCROW_EVENT_TOPICS.AwardCommitted,
  );
  if (events.length !== 1)
    throw new Error("The transaction has no unique award commitment event.");
  const event = await verifyReserve(
    walletVaultConfig(plan.deployment, wallet),
    transactionId,
    Number(BigInt(events[0].logIndex)),
    intent.obligationId,
  );
  if (
    event.githubUserId !== plan.award.githubUserId ||
    event.grossMicro !== plan.award.gross ||
    // A vault not yet upgraded to rounded-up fees records floor(gross / 50).
    !acceptsPayoutFee(BigInt(event.grossMicro), BigInt(event.feeMicro)) ||
    event.netMicro !==
      (BigInt(event.grossMicro) - BigInt(event.feeMicro)).toString() ||
    event.sourceDigest !== `0x${plan.award.sourceDigest}`
  )
    throw new Error(
      "The finalized commitment differs from the approved award.",
    );
  return "finalized" as const;
}
