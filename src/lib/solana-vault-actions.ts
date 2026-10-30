import { ed25519 } from "@noble/curves/ed25519.js";
import {
  SOLANA_NATIVE_ASSET,
  solanaBase58,
} from "../../contracts/solana/adapter";
import {
  type prepareSolanaFunding,
  solanaFundingMessage,
} from "../../contracts/solana/funding";
import {
  CLASSIC_TOKEN_PROGRAM,
  TOKEN_2022_PROGRAM,
} from "../../contracts/solana/token";
import { decodeBase58Bytes } from "./base58";
import { readBoundedJson } from "./browser-json";
import type { EscrowDeployment } from "./escrow-policy.mjs";
import type { VaultConnection, VaultOperation } from "./evm-vault-actions";
import {
  isAssetDecimals,
  ordinaryFee,
  type PayoutPolicy,
} from "./payments/contracts";
import { parseVaultAmount } from "./payments/vault-amount";
import { apiRequest, projectApiRequest } from "./project-api";
import { CANONICAL_UINT } from "./record-validation.mjs";

export type SolanaFundingPlan = Awaited<
  ReturnType<typeof prepareSolanaFunding>
>;
const decode = (value: string) =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
function fundingConfig(deployment: EscrowDeployment) {
  if (!deployment.programId || !deployment.projectPda)
    throw new Error("The Solana vault configuration is incomplete.");
  return {
    ...deployment,
    programId: deployment.programId,
    projectPda: deployment.projectPda,
    mint: deployment.asset,
  };
}
function planMessage(deployment: EscrowDeployment, plan: SolanaFundingPlan) {
  if (
    plan.tokenProgram !== undefined &&
    plan.tokenProgram !== CLASSIC_TOKEN_PROGRAM &&
    plan.tokenProgram !== TOKEN_2022_PROGRAM &&
    !(
      deployment.asset === SOLANA_NATIVE_ASSET &&
      plan.tokenProgram === SOLANA_NATIVE_ASSET
    )
  )
    throw new Error("Unsupported mint token program.");
  const msg = solanaFundingMessage(
    { ...fundingConfig(deployment), tokenProgram: plan.tokenProgram },
    plan,
  );
  const wire = decode(plan.transaction);
  if (
    wire.length !== 65 + msg.length ||
    wire[0] !== 1 ||
    wire.slice(1, 65).some((byte) => byte !== 0) ||
    msg.some((byte, index) => byte !== wire[index + 65])
  )
    throw new Error(
      "The prepared transaction differs from the reviewed vault action.",
    );
  return msg;
}
async function request(
  projectId: string,
  deployment: EscrowDeployment,
  body: Record<string, unknown>,
  payoutPolicy: PayoutPolicy,
) {
  if (payoutPolicy === "security-bounty")
    return projectApiRequest<Record<string, unknown>>(
      "POST",
      `project-vaults/${encodeURIComponent(projectId)}/solana-funding`,
      { network: deployment.network, vault: deployment.vault, ...body },
    );
  const response = await apiRequest(
    `payments/projects/${encodeURIComponent(projectId)}/solana-funding`,
    {
      body: { network: deployment.network, vault: deployment.vault, ...body },
      timeoutMs: 90_000,
    },
  );
  const value = (await readBoundedJson(
    response,
    16384,
    "Solana funding response",
  )) as Record<string, unknown>;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("The funding service returned an invalid response.");
  if (!response.ok) {
    if (response.status === 422 && typeof value.message === "string")
      throw new Error(value.message);
    throw new Error(
      "Solana funding could not be verified. Retry the review or transaction check.",
    );
  }
  return value;
}
export async function reviewSolanaVaultAction(
  projectId: string,
  deployment: EscrowDeployment,
  wallet: VaultConnection,
  operation: VaultOperation,
  amount: string,
  payoutPolicy: PayoutPolicy = "ordinary",
) {
  if (!wallet.solanaSend)
    throw new Error("Choose a wallet with Solana transaction support.");
  const value = await request(
    projectId,
    deployment,
    {
      step: "review",
      operation,
      wallet: wallet.address,
      amount,
    },
    payoutPolicy,
  );
  const plan = value.plan as SolanaFundingPlan;
  if (
    !plan ||
    plan.operation !== operation ||
    plan.wallet !== wallet.address ||
    !isAssetDecimals(plan.decimals) ||
    typeof plan.gross !== "string" ||
    !/^[1-9][0-9]{0,19}$/.test(plan.gross) ||
    typeof plan.blockhash !== "string" ||
    decodeBase58Bytes(plan.blockhash).length !== 32 ||
    !Number.isSafeInteger(plan.lastValidBlockHeight) ||
    plan.lastValidBlockHeight < 0 ||
    typeof plan.transaction !== "string" ||
    typeof plan.freeBalance !== "string" ||
    !/^(0|[1-9][0-9]{0,19})$/.test(plan.freeBalance) ||
    typeof plan.networkFeeLamports !== "string" ||
    !CANONICAL_UINT.test(plan.networkFeeLamports)
  )
    throw new Error("The funding review response is invalid.");
  const gross = parseVaultAmount(amount, plan.decimals);
  const fee = operation === "withdraw" ? ordinaryFee(gross) : 0n;
  if (
    plan.gross !== gross.toString() ||
    plan.fee !== fee.toString() ||
    plan.net !== (gross - fee).toString()
  )
    throw new Error("The funding review amount differs from your request.");
  planMessage(deployment, plan);
  return {
    ...plan,
    approvalNeeded: false,
    resetAllowance: false,
    solanaPlan: plan,
  };
}
export async function sendSolanaVaultAction(
  deployment: EscrowDeployment,
  wallet: VaultConnection,
  plan: SolanaFundingPlan,
  beforeSend: () => void,
) {
  if (!wallet.solanaSend || plan.wallet !== wallet.address)
    throw new Error("Connect and review the intended wallet again.");
  const msg = planMessage(deployment, plan);
  return sendSolanaWalletTransaction(
    deployment,
    wallet,
    plan.transaction,
    msg,
    beforeSend,
  );
}
export async function sendSolanaWalletTransaction(
  deployment: Pick<EscrowDeployment, "network">,
  wallet: VaultConnection,
  transaction: string,
  msg: Uint8Array,
  beforeSend: () => void,
) {
  if (!wallet.solanaSend)
    throw new Error("Choose a wallet with Solana transaction support.");
  const chain = (
    {
      "solana-mainnet": "solana:mainnet",
      "solana-devnet": "solana:devnet",
      "solana-testnet": "solana:testnet",
    } as const
  )[
    deployment.network as "solana-mainnet" | "solana-devnet" | "solana-testnet"
  ];
  if (!chain) throw new Error("Unsupported Solana network.");
  const signature = await wallet.solanaSend(
    decode(transaction),
    chain,
    beforeSend,
  );
  if (
    !ed25519.verify(signature, msg, decodeBase58Bytes(wallet.address), {
      zip215: false,
    })
  )
    throw new Error(
      "The wallet did not return a signature for this action. Check wallet activity before another attempt.",
    );
  return solanaBase58(signature);
}
export async function checkSolanaVaultAction(
  projectId: string,
  deployment: EscrowDeployment,
  wallet: VaultConnection,
  operation: VaultOperation,
  gross: string,
  blockhash: string,
  transactionId: string,
  payoutPolicy: PayoutPolicy = "ordinary",
) {
  const value = await request(
    projectId,
    deployment,
    {
      step: "check",
      wallet: wallet.address,
      operation,
      gross,
      blockhash,
      transactionId,
    },
    payoutPolicy,
  );
  if (
    value.status !== "pending" &&
    value.status !== "failed" &&
    value.status !== "finalized"
  )
    throw new Error("The transaction status could not be verified.");
  return value.status;
}
