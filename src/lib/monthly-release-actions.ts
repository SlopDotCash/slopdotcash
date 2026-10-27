import type { MonthlyOwnerView } from "../../backend/payments/monthly";
import { prepareEvmMonthlyWrongSumRelease } from "../../contracts/evm/monthly-reserve";
import {
  solanaAllocationRoot,
  solanaAllocationTotal,
} from "../../contracts/solana/adapter";
import { solanaMonthlyReleaseInstructions } from "../../contracts/solana/monthly-reserve";
import { message } from "../../contracts/solana/transactions";
import type { MonthlyReleaseResult } from "../../workers/payment-executor/monthly-release";
import { readBoundedJson } from "./browser-json";
import {
  assertVaultWalletAccount,
  type VaultConnection,
  walletVaultConfig,
} from "./evm-vault-actions";
import { apiRequest } from "./project-api";
import { sendSolanaWalletTransaction } from "./solana-vault-actions";

export type ReadyMonthlyRelease = Extract<
  MonthlyReleaseResult,
  { status: "ready" }
>;
export async function requestMonthlyRelease(
  view: MonthlyOwnerView,
  check?: { planId: string; transactionId: string },
) {
  if (!view.deployment) throw new Error("The vault is unavailable.");
  const response = await apiRequest(
    `payments/projects/${encodeURIComponent(view.projectId)}/monthly/${view.period}/reserve-release`,
    {
      body: {
        network: view.deployment.network,
        manifestSha256: view.manifestSha256,
        ...check,
      },
      timeoutMs: 120_000,
    },
  );
  const value = (await readBoundedJson(
    response,
    4 * 1024 * 1024,
    "Monthly reserve release",
  )) as MonthlyReleaseResult & { message?: string };
  if (!response.ok)
    throw new Error(
      value.message ?? "The reserve could not be verified. Retry the check.",
    );
  if (check) {
    if (!["pending", "failed", "finalized"].includes(value.status))
      throw new Error("The release status could not be verified.");
    return value as unknown as { status: "pending" | "failed" | "finalized" };
  }
  if (value.status === "held") return value;
  if (
    value.status !== "ready" ||
    value.request.projectId !== view.projectId ||
    value.request.period !== view.period ||
    value.request.manifestSha256 !== view.manifestSha256 ||
    value.request.network !== view.deployment.network ||
    JSON.stringify(value.deployment) !== JSON.stringify(view.deployment) ||
    !/^[a-f0-9]{64}$/.test(value.planId)
  )
    throw new Error(
      "The prepared release differs from this project and month.",
    );
  return value;
}
function solanaReleaseMessage(
  plan: Extract<ReadyMonthlyRelease, { family: "solana" }>,
) {
  const { deployment, capture, prepared, signatureHex } = plan;
  const evidence = prepared.evidence;
  if (
    !deployment.programId ||
    !deployment.projectPda ||
    !deployment.networkDomain ||
    evidence.programId !== deployment.programId ||
    evidence.projectPda !== deployment.projectPda ||
    evidence.owner !== deployment.owner ||
    prepared.requiredSigner !== deployment.owner ||
    evidence.mint !== deployment.asset ||
    evidence.period !== plan.request.period ||
    evidence.allocationRoot !== solanaAllocationRoot(capture.entries) ||
    evidence.computedTotal !== solanaAllocationTotal(capture.entries) ||
    evidence.computedTotal === evidence.storedTotal ||
    evidence.expectedUnsettled !== evidence.storedTotal ||
    evidence.releasedGross !== evidence.storedTotal
  )
    throw new Error("The prepared release differs from the verified reserve.");
  const instructions = solanaMonthlyReleaseInstructions(
    evidence,
    deployment.networkDomain,
    signatureHex,
  );
  const msg = message(deployment.owner, prepared.blockhash, instructions);
  const wire = Uint8Array.from(atob(prepared.transaction), (c) =>
    c.charCodeAt(0),
  );
  if (
    wire.length !== 65 + msg.length ||
    wire[0] !== 1 ||
    wire.slice(1, 65).some((b) => b !== 0) ||
    msg.some((b, i) => b !== wire[i + 65])
  )
    throw new Error(
      "The prepared transaction differs from the reviewed release.",
    );
  return msg;
}
export async function sendMonthlyRelease(
  plan: ReadyMonthlyRelease,
  wallet: VaultConnection,
  beforeSend: () => void,
) {
  if (plan.family === "solana") {
    if (wallet.address !== plan.deployment.owner)
      throw new Error("Connect the vault owner's wallet.");
    return sendSolanaWalletTransaction(
      plan.deployment,
      wallet,
      plan.prepared.transaction,
      solanaReleaseMessage(plan),
      beforeSend,
    );
  }
  const config = walletVaultConfig(plan.deployment, wallet);
  await assertVaultWalletAccount(wallet, config);
  if (
    wallet.address.toLowerCase() !== plan.deployment.owner.toLowerCase() ||
    !wallet.evmRequest
  )
    throw new Error("Connect the vault owner's wallet.");
  const fresh = await prepareEvmMonthlyWrongSumRelease(
    config,
    plan.request.period,
    plan.capture,
    `0x${plan.signatureHex}`,
  );
  if (
    JSON.stringify(fresh.transaction) !==
    JSON.stringify(plan.prepared.transaction)
  )
    throw new Error("The reserve changed. Review it again.");
  await wallet.evmRequest("eth_estimateGas", [fresh.transaction]);
  await assertVaultWalletAccount(wallet, config);
  beforeSend();
  const hash = await wallet.evmRequest("eth_sendTransaction", [
    fresh.transaction,
  ]);
  if (typeof hash !== "string" || !/^0x[0-9a-f]{64}$/i.test(hash))
    throw new Error(
      "The wallet result is unclear. Check wallet activity before another attempt.",
    );
  return hash;
}
