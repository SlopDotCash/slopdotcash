/** A private, owner-requested attestation; never a submission or a withdrawal. */
import { ed25519 } from "@noble/curves/ed25519.js";
import { recoverAddress } from "viem";
import type { D1TransactionalDatabase } from "../../backend/d1";
import type { MonthlyReleaseCheck } from "../../backend/payments/monthly-reserve-release";
import {
  type MonthlyReleaseRequest,
  retainedMonthlyAllocations,
} from "../../backend/payments/monthly-reserve-release";
import {
  type EvmEscrowConfig,
  evmRpc,
  isCanonicalEvmReceipt,
  verifyEvmDeployment,
} from "../../contracts/evm/adapter";
import {
  evmMonthlyReleaseDigest,
  inspectEvmMonthlyWrongSum,
  prepareEvmMonthlyWrongSumRelease,
} from "../../contracts/evm/monthly-reserve";
import type { SolanaEscrowConfig } from "../../contracts/solana/adapter";
import {
  inspectSolanaMonthlyWrongSum,
  prepareSolanaMonthlyWrongSumRelease,
  solanaMonthlyReleaseMessage,
} from "../../contracts/solana/monthly-reserve";
import { checkSolanaWalletTransaction } from "../../contracts/solana/wallet-transactions";
import { decodeBase58Bytes } from "../../src/lib/base58";
import {
  type EscrowDeployment,
  paymentDeploymentRecord,
} from "../../src/lib/escrow-policy.mjs";
import type { ProjectRecord } from "../../src/lib/project-contracts";
import { sha256Hex } from "../../src/lib/sha256";
import type { JournalStore } from "./core";

const hex = (value: Uint8Array) =>
  Array.from(value, (b) => b.toString(16).padStart(2, "0")).join("");
export interface MonthlyReleaseDependencies {
  db: D1TransactionalDatabase;
  journal: JournalStore;
  getProject(id: string): Promise<ProjectRecord | null>;
  pinned: Record<string, unknown>[];
  family: "evm" | "solana";
  evm(deployment: EscrowDeployment): Promise<EvmEscrowConfig>;
  solana(deployment: EscrowDeployment): Promise<SolanaEscrowConfig>;
  /** Invoked only after a positive fresh proof; a signature is verified by the builder. */
  sign(messageHex: string): Promise<string>;
}
export async function prepareMonthlyReserveRelease(
  deps: MonthlyReleaseDependencies,
  request: MonthlyReleaseRequest,
) {
  const project = await deps.getProject(request.projectId);
  if (!project || project.manifestSha256 !== request.manifestSha256)
    throw new Error("Project policy changed");
  const matches =
    project.manifest.escrow?.deployments.filter(
      (d) => d.network === request.network,
    ) ?? [];
  if (matches.length !== 1) throw new Error("Monthly deployment unavailable");
  const deployment = matches[0];
  const expected = paymentDeploymentRecord(request.projectId, deployment);
  const pinned = deps.pinned.filter(
    (d) =>
      d.projectId === request.projectId &&
      d.network === request.network &&
      d.vault === deployment.vault,
  );
  if (
    pinned.length !== 1 ||
    Object.entries(expected).some(
      ([key, value]) =>
        JSON.stringify(pinned[0][key]) !== JSON.stringify(value),
    )
  )
    throw new Error("Monthly deployment differs from pinned configuration");
  const plans = await retainedMonthlyAllocations(deps.db, request);
  const retained = JSON.stringify(plans);
  async function unchanged() {
    const current = await deps.getProject(request.projectId);
    if (
      !current ||
      current.manifestSha256 !== request.manifestSha256 ||
      current.revision !== project?.revision ||
      JSON.stringify(await retainedMonthlyAllocations(deps.db, request)) !==
        retained
    )
      throw new Error("Monthly release evidence changed");
  }
  async function sign(
    messageHex: string,
    authority: string,
    evidence: unknown,
  ) {
    await unchanged();
    const key = `monthly-release:${request.network}:${deployment.vault}:${request.period}:${sha256Hex(`${authority}:${messageHex}`)}`;
    const previous = await deps.journal.get<{ signatureHex?: string }>(key);
    if (!previous)
      await deps.journal.put(key, { request, authority, messageHex, evidence });
    const signatureHex =
      previous?.signatureHex ?? (await deps.sign(messageHex));
    const bytes = (value: string) =>
      Uint8Array.from(value.match(/../g) ?? [], (b) => Number.parseInt(b, 16));
    if (
      deps.family === "evm"
        ? !/^[0-9a-f]{130}$/i.test(signatureHex) ||
          (
            await recoverAddress({
              hash: `0x${messageHex}`,
              signature: `0x${signatureHex}`,
            })
          ).toLowerCase() !== authority.toLowerCase()
        : !/^[0-9a-f]{128}$/i.test(signatureHex) ||
          !ed25519.verify(
            bytes(signatureHex),
            bytes(messageHex),
            decodeBase58Bytes(authority),
            { zip215: false },
          )
    )
      throw new Error("Release signer is not the current identity authority");
    // Retain the verified attestation even if a later simulation refuses. It never submits funds.
    await deps.journal.put(key, {
      request,
      authority,
      messageHex,
      evidence,
      signatureHex,
    });
    return signatureHex;
  }
  if (!plans.length)
    return { status: "held", reason: "allocation-unavailable" } as const;
  for (const plan of plans) {
    if (
      plan.deployment.vault !== deployment.vault ||
      plan.family !== deps.family
    )
      throw new Error("Retained monthly deployment mismatch");
    const capture = {
      allocationDigest: `0x${plan.request.snapshotSha256}`,
      entries: plan.entries,
    };
    if (deps.family === "evm") {
      // The legacy root is not a V2 sum tree and cannot qualify for this repair.
      if (!plan.evmReservation) continue;
      const config = await deps.evm(deployment);
      const evidence = await inspectEvmMonthlyWrongSum(
        config,
        request.period,
        capture,
      );
      if (evidence.status !== "provably-unsettleable") {
        if (evidence.reason === "allocation-mismatch") continue;
        return evidence;
      }
      const signatureHex = await sign(
        evmMonthlyReleaseDigest(evidence).slice(2),
        evidence.identityAuthority,
        evidence,
      );
      const prepared = await prepareEvmMonthlyWrongSumRelease(
        config,
        request.period,
        capture,
        `0x${signatureHex}`,
      );
      await unchanged();
      return retainReleasePlan(deps.journal, {
        status: "ready",
        family: "evm",
        request,
        deployment,
        capture,
        signatureHex,
        prepared,
      } as const);
    }
    const config = await deps.solana(deployment);
    const evidence = await inspectSolanaMonthlyWrongSum(
      config,
      request.period,
      capture,
    );
    if (evidence.status !== "provably-unsettleable") {
      if (evidence.reason === "allocation-mismatch") continue;
      return evidence;
    }
    const signatureHex = await sign(
      hex(solanaMonthlyReleaseMessage(evidence, config.networkDomain)),
      evidence.identityAuthority,
      evidence,
    );
    const prepared = await prepareSolanaMonthlyWrongSumRelease(
      config,
      request.period,
      capture,
      signatureHex,
    );
    await unchanged();
    return retainReleasePlan(deps.journal, {
      status: "ready",
      family: "solana",
      request,
      deployment,
      capture,
      signatureHex,
      prepared,
    } as const);
  }
  return { status: "held", reason: "allocation-mismatch" } as const;
}
export type MonthlyReleaseResult = Awaited<
  ReturnType<typeof prepareMonthlyReserveRelease>
>;

async function retainReleasePlan<T>(journal: JournalStore, plan: T) {
  const planId = sha256Hex(JSON.stringify(plan));
  await journal.put(`monthly-release-plan:${planId}`, plan);
  return { ...plan, planId };
}
export async function checkMonthlyReserveRelease(
  deps: MonthlyReleaseDependencies,
  input: MonthlyReleaseCheck,
) {
  const plan = await deps.journal.get<
    Extract<MonthlyReleaseResult, { status: "ready" }>
  >(`monthly-release-plan:${input.planId}`);
  if (
    !plan ||
    Object.entries(plan.request).some(
      ([key, value]) =>
        key !== "manifestSha256" &&
        input[key as keyof MonthlyReleaseCheck] !== value,
    )
  )
    throw new Error("Unknown release request");
  const project = await deps.getProject(input.projectId);
  const deployment = project?.manifest.escrow?.deployments.find(
    (d) => d.network === input.network && d.vault === plan.deployment.vault,
  );
  if (
    !project ||
    project.manifestSha256 !== input.manifestSha256 ||
    !deployment ||
    JSON.stringify(deployment) !== JSON.stringify(plan.deployment)
  )
    throw new Error("Project policy changed");
  if (plan.family === "solana") {
    const config = await deps.solana(deployment);
    const wire = Uint8Array.from(atob(plan.prepared.transaction), (c) =>
      c.charCodeAt(0),
    );
    const result = await checkSolanaWalletTransaction(
      config,
      deployment.owner,
      wire.slice(65),
      input.transactionId,
    );
    return { status: result.status };
  }
  if (!/^0x[0-9a-f]{64}$/i.test(input.transactionId))
    throw new Error("Invalid transaction hash");
  const config = await deps.evm(deployment);
  const receipt = (await evmRpc(config, "eth_getTransactionReceipt", [
    input.transactionId,
  ])) as {
    status: string;
    transactionHash: string;
    blockNumber: string;
    blockHash: string;
    transactionIndex: string;
    from: string;
    to: string;
  } | null;
  if (!receipt) return { status: "pending" } as const;
  const transaction = (await evmRpc(config, "eth_getTransactionByHash", [
    input.transactionId,
  ])) as {
    hash: string;
    blockHash: string;
    blockNumber: string;
    transactionIndex: string;
    from: string;
    to: string;
    input: string;
    value: string;
  } | null;
  const expected = plan.prepared.transaction;
  if (
    !transaction ||
    transaction.hash.toLowerCase() !== input.transactionId.toLowerCase() ||
    transaction.blockHash.toLowerCase() !== receipt.blockHash.toLowerCase() ||
    BigInt(transaction.blockNumber) !== BigInt(receipt.blockNumber) ||
    BigInt(transaction.transactionIndex) !== BigInt(receipt.transactionIndex) ||
    receipt.from.toLowerCase() !== expected.from.toLowerCase() ||
    receipt.to?.toLowerCase() !== expected.to.toLowerCase() ||
    transaction.from.toLowerCase() !== expected.from.toLowerCase() ||
    transaction.to?.toLowerCase() !== expected.to.toLowerCase() ||
    transaction.input.toLowerCase() !== expected.data.toLowerCase() ||
    BigInt(transaction.value) !== 0n
  )
    throw new Error("Transaction does not match the reviewed release");
  const finalized = (await evmRpc(config, "eth_getBlockByNumber", [
    "finalized",
    false,
  ])) as { number: string };
  if (BigInt(receipt.blockNumber) > BigInt(finalized.number))
    return { status: "pending" } as const;
  const block = (await evmRpc(config, "eth_getBlockByNumber", [
    receipt.blockNumber,
    false,
  ])) as { hash: string; number: string; transactions: string[] } | null;
  if (
    !isCanonicalEvmReceipt(
      input.transactionId,
      {
        ...receipt,
        blockNumber: BigInt(receipt.blockNumber),
        transactionIndex: Number(BigInt(receipt.transactionIndex)),
      },
      block ? { ...block, number: BigInt(block.number) } : null,
    )
  )
    throw new Error("Transaction is not canonical and finalized");
  await verifyEvmDeployment(config, receipt.blockNumber);
  if (receipt.status !== "0x0" && receipt.status !== "0x1")
    throw new Error("Unknown transaction status");
  return { status: receipt.status === "0x1" ? "finalized" : "failed" } as const;
}
