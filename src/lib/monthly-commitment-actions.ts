/**
 * The owner's automatic monthly payment switch on an ordinary vault: EVM
 * `setMonthlyCommitment(cap, enabled)` and Solana `set_monthly_commitment`.
 * The owner's wallet signs; Slop holds no key and never broadcasts.
 */
import {
  buildSetMonthlyCommitmentCalldata,
  EVM_ESCROW_EVENT_TOPICS,
  readEvmMonthlyCommitment,
  readVaultTotals,
  verifyEvmDeployment,
  verifyMonthlyCommitmentSet,
} from "../../contracts/evm/adapter";
import {
  type prepareSolanaMonthlyCommitment,
  solanaMonthlyCommitmentMessage,
} from "../../contracts/solana/monthly-commitment";
import { decodeBase58Bytes } from "./base58";
import { readBoundedJson } from "./browser-json";
import { ESCROW_NETWORKS, type EscrowDeployment } from "./escrow-policy.mjs";
import {
  assertVaultWalletAccount,
  readFinalizedWalletTransaction,
  type VaultConnection,
  walletVaultConfig,
} from "./evm-vault-actions";
import { isAssetDecimals } from "./payments/contracts";
import type { ProjectDefinition } from "./projects.mjs";
import { sendSolanaWalletTransaction } from "./solana-vault-actions";

export interface MonthlySetting {
  /** Token base units as decimal text. */
  cap: string;
  enabled: boolean;
}
export type SolanaMonthlyPlan = Awaited<
  ReturnType<typeof prepareSolanaMonthlyCommitment>
>;
export interface MonthlyReview {
  target: MonthlySetting;
  /** The finalized on-chain setting the review read. */
  current: MonthlySetting;
  decimals: number;
  /** False when the vault already holds the target setting: nothing to sign. */
  changes: boolean;
  evmTransaction?: Record<string, string>;
  solanaPlan?: SolanaMonthlyPlan;
}

/**
 * The project's recorded monthly amount in the vault token's base units.
 * Stablecoin amounts are recorded in 6-decimal micro-units and a token amount
 * in that token's verified decimals. The vault must use that asset, not a
 * different token with the same decimals.
 */
export function vaultMonthlyCap(
  project: Pick<ProjectDefinition, "reward" | "rewardAsset">,
  deployment: Pick<EscrowDeployment, "network" | "asset">,
  vaultDecimals: number,
): bigint {
  if (project.reward.kind !== "monthly-pool")
    throw new Error("This project has no monthly amount.");
  const network = ESCROW_NETWORKS[deployment.network];
  const expectedAsset =
    project.rewardAsset?.kind === "token"
      ? project.rewardAsset.address
      : network.asset;
  const canonical = (address: string) =>
    network.family === "evm" ? address.toLowerCase() : address;
  if (
    network.chain !== project.reward.chain ||
    (project.rewardAsset && project.rewardAsset.network !== network.chain) ||
    !expectedAsset ||
    canonical(deployment.asset) !== canonical(expectedAsset)
  )
    throw new Error(
      "The vault token differs from the project's reward asset. Record the matching asset in a project revision first.",
    );
  const recorded =
    project.rewardAsset?.kind === "token" ? project.rewardAsset.decimals : 6;
  if (vaultDecimals !== recorded)
    throw new Error(
      "The vault token's decimals differ from the project's monthly amount. Record the matching asset in a project revision first.",
    );
  if (!/^(0|[1-9][0-9]*)$/.test(project.reward.monthlyCapMinor))
    throw new Error("The project's monthly amount is invalid.");
  return BigInt(project.reward.monthlyCapMinor);
}
/** On uses the project's monthly amount; off keeps the cap the vault already holds. */
export function monthlyTarget(
  automatic: boolean,
  projectCap: bigint,
  current: MonthlySetting,
): MonthlySetting {
  if (!automatic) return { cap: current.cap, enabled: false };
  if (projectCap <= 0n)
    throw new Error(
      "Set a monthly amount in a project revision before turning on automatic monthly payment.",
    );
  return { cap: projectCap.toString(), enabled: true };
}
const same = (a: MonthlySetting, b: MonthlySetting) =>
  a.cap === b.cap && a.enabled === b.enabled;

export async function reviewEvmMonthlySetting(
  project: Pick<ProjectDefinition, "reward" | "rewardAsset">,
  deployment: EscrowDeployment,
  wallet: VaultConnection,
  automatic: boolean,
): Promise<MonthlyReview> {
  const config = walletVaultConfig(deployment, wallet);
  await assertVaultWalletAccount(wallet, config);
  if (wallet.address.toLowerCase() !== deployment.owner.toLowerCase())
    throw new Error(
      "Connect the vault owner's wallet to change automatic monthly payment.",
    );
  await verifyEvmDeployment(config);
  const totals = await readVaultTotals({
    ...config,
    network: deployment.network,
  });
  if (totals.asset.toLowerCase() !== deployment.asset.toLowerCase())
    throw new Error("The vault asset changed. Reload the project.");
  const read = await readEvmMonthlyCommitment({
    ...config,
    network: deployment.network,
  });
  const current = { cap: read.cap, enabled: read.enabled };
  const target = monthlyTarget(
    automatic,
    automatic ? vaultMonthlyCap(project, deployment, totals.decimals) : 0n,
    current,
  );
  if (same(target, current))
    return { target, current, decimals: totals.decimals, changes: false };
  const transaction = {
    from: wallet.address,
    to: deployment.vault,
    value: "0x0",
    data: buildSetMonthlyCommitmentCalldata(target.cap, target.enabled),
  };
  const request = wallet.evmRequest;
  if (!request) throw new Error("Choose an EVM wallet.");
  await request("eth_estimateGas", [transaction]);
  return {
    target,
    current,
    decimals: totals.decimals,
    changes: true,
    evmTransaction: transaction,
  };
}
/** Sends exactly the reviewed transaction once. The caller handles rejection and recovery. */
export async function sendEvmMonthlySetting(
  deployment: EscrowDeployment,
  wallet: VaultConnection,
  review: MonthlyReview,
  beforeSend: () => void,
) {
  const transaction = review.evmTransaction;
  if (
    !transaction ||
    transaction.data !==
      buildSetMonthlyCommitmentCalldata(
        review.target.cap,
        review.target.enabled,
      ) ||
    transaction.to.toLowerCase() !== deployment.vault.toLowerCase()
  )
    throw new Error("Review the monthly payment setting again.");
  await assertVaultWalletAccount(wallet, walletVaultConfig(deployment, wallet));
  const request = wallet.evmRequest;
  if (!request) throw new Error("Choose an EVM wallet.");
  beforeSend();
  const hash = await request("eth_sendTransaction", [transaction]);
  if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash))
    throw new Error(
      "The wallet did not return a transaction hash. Check wallet activity before another attempt.",
    );
  return hash;
}
/** Exact calldata, canonical finality and the one matching vault event. */
export async function checkEvmMonthlySetting(
  deployment: EscrowDeployment,
  wallet: VaultConnection,
  target: MonthlySetting,
  transactionId: string,
) {
  const checked = await readFinalizedWalletTransaction(
    deployment,
    wallet,
    transactionId,
    deployment.vault,
    buildSetMonthlyCommitmentCalldata(target.cap, target.enabled),
  );
  if (checked.status !== "finalized") return checked.status;
  const events = checked.receipt.logs.filter(
    (log) =>
      log.address.toLowerCase() === deployment.vault.toLowerCase() &&
      log.topics[0]?.toLowerCase() ===
        EVM_ESCROW_EVENT_TOPICS.MonthlyCommitmentSet,
  );
  if (events.length !== 1)
    throw new Error(
      "The transaction has no unique monthly commitment setting event.",
    );
  await verifyMonthlyCommitmentSet(
    walletVaultConfig(deployment, wallet),
    transactionId,
    Number(BigInt(events[0].logIndex)),
    target,
  );
  return "finalized" as const;
}

function solanaDeployment(deployment: EscrowDeployment) {
  if (!deployment.programId || !deployment.projectPda)
    throw new Error("The Solana vault configuration is incomplete.");
  return {
    ...deployment,
    programId: deployment.programId,
    projectPda: deployment.projectPda,
    mint: deployment.asset,
  };
}
/** Rebuilds the reviewed message locally and requires the prepared wire bytes to match it. */
export function verifySolanaMonthlyPlan(
  deployment: EscrowDeployment,
  plan: SolanaMonthlyPlan,
  wallet: string,
  target: MonthlySetting,
) {
  const transaction = plan.transaction;
  if (
    !transaction ||
    plan.wallet !== wallet ||
    wallet !== deployment.owner ||
    plan.cap !== target.cap ||
    plan.enabled !== target.enabled ||
    typeof transaction.blockhash !== "string" ||
    decodeBase58Bytes(transaction.blockhash).length !== 32 ||
    !Number.isSafeInteger(transaction.lastValidBlockHeight) ||
    transaction.lastValidBlockHeight < 0 ||
    typeof transaction.transaction !== "string" ||
    typeof transaction.networkFeeLamports !== "string" ||
    !/^(0|[1-9][0-9]*)$/.test(transaction.networkFeeLamports)
  )
    throw new Error(
      "The prepared transaction differs from the reviewed setting.",
    );
  const msg = solanaMonthlyCommitmentMessage(solanaDeployment(deployment), {
    wallet,
    cap: target.cap,
    enabled: target.enabled,
    blockhash: transaction.blockhash,
  });
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
      "The prepared transaction differs from the reviewed setting.",
    );
  return msg;
}
async function solanaRequest(
  projectId: string,
  deployment: EscrowDeployment,
  body: Record<string, unknown>,
) {
  const response = await fetch(
    `/api/v1/payments/projects/${encodeURIComponent(projectId)}/solana-monthly-commitment`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        network: deployment.network,
        vault: deployment.vault,
        ...body,
      }),
      signal: AbortSignal.timeout(90000),
    },
  );
  const value = (await readBoundedJson(
    response,
    16384,
    "Solana monthly payment setting",
  )) as Record<string, unknown>;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("The vault service returned an invalid response.");
  if (!response.ok) {
    if (response.status === 422 && typeof value.message === "string")
      throw new Error(value.message);
    throw new Error(
      "The monthly payment setting could not be verified. Retry the review or transaction check.",
    );
  }
  return value;
}
const isSetting = (value: unknown): value is MonthlySetting =>
  !!value &&
  typeof value === "object" &&
  typeof (value as MonthlySetting).cap === "string" &&
  /^(0|[1-9][0-9]{0,19})$/.test((value as MonthlySetting).cap) &&
  typeof (value as MonthlySetting).enabled === "boolean";

/**
 * Reads the finalized setting first, chooses the target from it, then asks
 * the service to plan exactly that target when it differs.
 */
export async function reviewSolanaMonthlySetting(
  project: Pick<ProjectDefinition, "id" | "reward" | "rewardAsset">,
  deployment: EscrowDeployment,
  wallet: VaultConnection,
  automatic: boolean,
): Promise<MonthlyReview> {
  if (!wallet.solanaSend)
    throw new Error("Choose a wallet with Solana transaction support.");
  if (wallet.address !== deployment.owner)
    throw new Error(
      "Connect the vault owner's wallet to change automatic monthly payment.",
    );
  const read = (await solanaRequest(project.id, deployment, { step: "read" }))
    .setting as { current: unknown; decimals: unknown } | undefined;
  if (!read || !isSetting(read.current) || !isAssetDecimals(read.decimals))
    throw new Error("The monthly payment setting response is invalid.");
  const decimals = read.decimals;
  const target = monthlyTarget(
    automatic,
    automatic ? vaultMonthlyCap(project, deployment, decimals) : 0n,
    read.current,
  );
  if (same(target, read.current))
    return { target, current: read.current, decimals, changes: false };
  const plan = (
    await solanaRequest(project.id, deployment, {
      step: "review",
      wallet: wallet.address,
      cap: target.cap,
      enabled: target.enabled,
    })
  ).plan as SolanaMonthlyPlan;
  if (
    !plan ||
    !isSetting(plan.current) ||
    plan.decimals !== decimals ||
    plan.wallet !== wallet.address ||
    plan.cap !== target.cap ||
    plan.enabled !== target.enabled
  )
    throw new Error("The monthly payment review response is invalid.");
  if (!same(plan.current, read.current))
    throw new Error(
      "The vault's monthly payment setting changed during review. Review again.",
    );
  verifySolanaMonthlyPlan(deployment, plan, wallet.address, target);
  return {
    target,
    current: plan.current,
    decimals,
    changes: true,
    solanaPlan: plan,
  };
}
export async function sendSolanaMonthlySetting(
  deployment: EscrowDeployment,
  wallet: VaultConnection,
  review: MonthlyReview,
  beforeSend: () => void,
) {
  const plan = review.solanaPlan;
  if (!plan?.transaction)
    throw new Error("Review the monthly payment setting again.");
  const msg = verifySolanaMonthlyPlan(
    deployment,
    plan,
    wallet.address,
    review.target,
  );
  return sendSolanaWalletTransaction(
    deployment,
    wallet,
    plan.transaction.transaction,
    msg,
    beforeSend,
  );
}
export async function checkSolanaMonthlySetting(
  projectId: string,
  deployment: EscrowDeployment,
  wallet: VaultConnection,
  target: MonthlySetting,
  blockhash: string,
  transactionId: string,
) {
  const value = await solanaRequest(projectId, deployment, {
    step: "check",
    wallet: wallet.address,
    cap: target.cap,
    enabled: target.enabled,
    blockhash,
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
