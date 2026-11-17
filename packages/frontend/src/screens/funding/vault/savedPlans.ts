// spec/settlement/ownerTransactions.md, "The pending request is saved before the wallet call and recovered without resubmission"; spec/settlement/escrow.md, "Only the owner withdraws unused free funds, to itself, less a 2% fee rounded up"
import { U256_MAX, decodeUint } from "@repo/settlement/chain/evm/abi";
import { EVM_NATIVE_ASSET, SOLANA_NATIVE_ASSET } from "@repo/settlement/kernels/networks";
import { storageKeys } from "../../../platform/storage.vibe";
import type { SlotStorage } from "../../../wallets/core/slots.ts";
import { type MonthlySetting, settingOf } from "../../../wallets/owner/commitmentCalls.ts";
import { familyOf } from "../../../wallets/owner/commitments.vibe";
import type { Operation, Step, VaultCallTerms } from "../../../wallets/owner/evmCalls.ts";
import { readText, slotOfText } from "../../../wallets/owner/flowSlots.ts";
import { type EvmBatchPlan, type OwnerPlan, planOf } from "../../../wallets/owner/ownerPlans.schema.ts";
import type { SolanaVaultTerms } from "../../../wallets/owner/solanaPlans.ts";
import type { FundingDeployment } from "./project.schema.ts";

export interface SavedTransfer {
  readonly operation: Operation;
  readonly step: Step;
  readonly gross: bigint;
}

const shapes: ReadonlyArray<readonly [Operation, Step]> = [
  ["deposit", "send"],
  ["withdraw", "send"],
  ["deposit", "approve"],
  ["deposit", "reset"],
];

/** @throws {never} */
const lastWord = (data: string) => `0x${data.slice(-64)}`;

/** @throws {never} */
export function evmTerms(vault: { readonly vault: string; readonly asset: string }): VaultCallTerms {
  return { vault: vault.vault, asset: vault.asset, native: vault.asset.toLowerCase() === EVM_NATIVE_ASSET };
}

/** @throws {never} */
export function solanaTerms(deployment: FundingDeployment): SolanaVaultTerms | undefined {
  const { programId, projectPda } = deployment;
  if (familyOf(deployment) !== "solana" || !programId || !projectPda) return undefined;
  return { program: programId, project: projectPda, owner: deployment.owner, mint: deployment.asset === SOLANA_NATIVE_ASSET ? null : deployment.asset, tokenProgram: null };
}

/** The operations a saved single-call plan could be, each to be verified against the vault before it is used. @throws {never} */
export function transferCandidates(plan: OwnerPlan | undefined): ReadonlyArray<SavedTransfer> {
  const call = plan?.kind === "evmDeposit" ? plan.call : plan?.kind === "evmCall" ? plan : undefined;
  if (call === undefined) return [];
  const value = BigInt(call.value);
  const amount = value > 0n ? value : decodeUint(lastWord(call.data), U256_MAX);
  if (amount === undefined) return [];
  return shapes.map(([operation, step]) => ({ operation, step, gross: step === "reset" ? 0n : amount }));
}

/** @throws {never} */
export function sameBatch(saved: EvmBatchPlan, expected: EvmBatchPlan): boolean {
  return (
    saved.from === expected.from &&
    saved.chainId === expected.chainId &&
    saved.calls.length === expected.calls.length &&
    expected.calls.every((call, index) => {
      const kept = saved.calls[index];
      return kept !== undefined && kept.to === call.to && kept.data === call.data && kept.value === call.value;
    })
  );
}

/** The setting a saved plan asks for; the chain check verifies the plan against it before it counts. @throws {never} */
export function savedSetting(plan: OwnerPlan | undefined): MonthlySetting | undefined {
  return plan?.kind === "evmCall" ? settingOf(`0x${plan.data.slice(10, 74)}`, `0x${plan.data.slice(74, 138)}`) : undefined;
}

export interface VaultKeys {
  readonly creation: string;
  readonly transfer: string;
  readonly batch: string;
  readonly commitment: string;
  readonly setting: string;
  readonly release: string;
}

/** @throws {never} */
export function vaultKeys(projectId: string, deployment: FundingDeployment, period: string): VaultKeys {
  const target = `${deployment.network}:${deployment.vault}:${deployment.asset}`;
  return {
    creation: `${storageKeys.vaultSetup.key}${projectId}`,
    transfer: `${storageKeys.vaultAction.key}${target}`,
    batch: `${storageKeys.vaultAction.key}${target}:batch`,
    commitment: `${storageKeys.awardCommitment.key}${projectId}:${period}`,
    setting: `${storageKeys.vaultMonthly.key}${deployment.network}:${deployment.vault}`,
    release: `${storageKeys.monthlyRelease.key}${projectId}:${period}`,
  };
}

/** @throws {never} */
export function storedPlan(storage: SlotStorage | undefined, key: string): OwnerPlan | undefined {
  const read = slotOfText(readText(storage, key));
  return read.kind === "owned" ? planOf(read.slot.plan) : undefined;
}

/** @throws {never} */
export function periodOf(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 7);
}
