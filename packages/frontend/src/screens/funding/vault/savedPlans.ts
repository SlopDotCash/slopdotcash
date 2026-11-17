// spec/settlement/ownerTransactions.md, "The pending request is saved before the wallet call and recovered without resubmission"; spec/settlement/escrow.md, "Only the owner withdraws unused free funds, to itself, less a 2% fee rounded up"
import { EVM_NATIVE_ASSET, isNetworkKey, NETWORKS, SOLANA_NATIVE_ASSET } from "@repo/settlement/kernels/networks";
import { type MonthlySetting, settingCall } from "../../../wallets/owner/commitmentCalls.ts";
import { type Call, type Operation, type Step, samePlannedCall, transferCall, type VaultCallTerms } from "../../../wallets/owner/evmCalls.ts";
import type { EvmBatchPlan, EvmCallPlan, OwnerPlan, PlannedCall } from "../../../wallets/owner/ownerPlans.schema.ts";
import type { SolanaVaultTerms } from "../../../wallets/owner/solanaPlans.ts";
import type { FundingDeployment } from "./project.schema.ts";

export type Family = "evm" | "solana";

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

const wordAt = (data: string, start: number): bigint | undefined => {
  const word = data.slice(start, start + 64);
  return /^[0-9a-f]{64}$/u.test(word) ? BigInt(`0x${word}`) : undefined;
};

/** @throws {never} */
function rebuilt(terms: VaultCallTerms, operation: Operation, step: Step, gross: bigint): Call | undefined {
  try {
    return transferCall(terms, operation, step, gross);
  } catch {
    return undefined;
  }
}

/** @throws {never} */
function sameCall(planned: PlannedCall, call: Call): boolean {
  return planned.to === call.to.toLowerCase() && planned.data === call.data.toLowerCase() && planned.value === call.value;
}

/** @throws {never} */
export function familyOf(network: string): Family | undefined {
  return isNetworkKey(network) ? NETWORKS[network].family : undefined;
}

/** @throws {never} */
export function evmTerms(deployment: Pick<FundingDeployment, "vault" | "asset">): VaultCallTerms {
  return { vault: deployment.vault, asset: deployment.asset, native: deployment.asset.toLowerCase() === EVM_NATIVE_ASSET };
}

/** @throws {never} */
export function solanaTerms(deployment: FundingDeployment): SolanaVaultTerms | undefined {
  const { programId, projectPda } = deployment;
  if (familyOf(deployment.network) !== "solana" || !programId || !projectPda) return undefined;
  return { program: programId, project: projectPda, owner: deployment.owner, mint: deployment.asset === SOLANA_NATIVE_ASSET ? null : deployment.asset, tokenProgram: null };
}

/** @throws {never} */
export function savedTransfer(terms: VaultCallTerms, plan: OwnerPlan | undefined): SavedTransfer | undefined {
  const call: EvmCallPlan | undefined = plan?.kind === "evmDeposit" ? plan.call : plan?.kind === "evmCall" ? plan : undefined;
  if (call === undefined) return undefined;
  const value = BigInt(call.value);
  const amount = value > 0n ? value : wordAt(call.data, call.data.length - 64);
  if (amount === undefined) return undefined;
  for (const [operation, step] of shapes) {
    const gross = step === "reset" ? 0n : amount;
    const expected = rebuilt(terms, operation, step, gross);
    if (expected !== undefined && samePlannedCall(call, call.from, BigInt(call.chainId), expected)) return { operation, step, gross };
  }
  return undefined;
}

/** @throws {never} */
export function batchGross(terms: VaultCallTerms, plan: EvmBatchPlan): bigint | undefined {
  const last = plan.calls.at(-1);
  const gross = last === undefined ? undefined : wordAt(last.data, last.data.length - 64);
  const expected = gross === undefined ? undefined : rebuilt(terms, "deposit", "send", gross);
  return last !== undefined && expected !== undefined && sameCall(last, expected) ? gross : undefined;
}

/** @throws {never} */
export function savedSetting(plan: OwnerPlan | undefined): MonthlySetting | undefined {
  if (plan?.kind !== "evmCall") return undefined;
  const cap = wordAt(plan.data, 10);
  const flag = wordAt(plan.data, 74);
  if (cap === undefined || (flag !== 0n && flag !== 1n)) return undefined;
  const setting = { cap, enabled: flag === 1n };
  try {
    return settingCall(setting).toLowerCase() === plan.data ? setting : undefined;
  } catch {
    return undefined;
  }
}

/** @throws {never} */
export function periodOf(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 7);
}
