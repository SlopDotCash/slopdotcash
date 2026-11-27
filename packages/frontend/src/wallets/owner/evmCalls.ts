// spec/settlement/ownerTransactions.md, "A request is reviewed against current authority and becomes a fixed plan"; spec/frontend/batchedDeposit.md, "Capabilities that require a wallet upgrade use the separate-signature path"; spec/frontend/monthLock.md, "A review runs the lock refusals against the card's own read, and only the owner's accepted review can be sent"; spec/frontend/monthLock.md, "A lapsed month stays locked until any connected wallet sends its release"
import type { VaultPurpose } from "@repo/settlement/chain/evm/abi";
import { depositCalldata, expirePledgeCalldata, pledgeMonthsCalldata, withdrawCalldata } from "@repo/settlement/chain/evm/actions";
import { reviewedFactory } from "@repo/settlement/chain/evm/factories";
import { isNetworkKey } from "@repo/settlement/kernels/networks";
import { encodeFunctionData, hexToBytes, parseAbi } from "viem";
import type { EvmBatchPlan, EvmCallPlan } from "./ownerPlans.schema.ts";

export type Operation = "deposit" | "withdraw";
export type Step = "approve" | "reset" | "send";

export interface Call {
  readonly to: string;
  readonly data: string;
  readonly value: string;
}

export interface VaultCallTerms {
  readonly vault: string;
  readonly asset: string;
  readonly native: boolean;
}

interface ContractReview {
  readonly address: string;
  readonly codeSha256: string;
}

export interface VaultReview {
  readonly codeSha256: string;
  readonly implementation: ContractReview | undefined;
  readonly factory: ContractReview & {
    readonly implementation: ContractReview;
    readonly registrar: string;
  };
  readonly feeRecipient: string;
  readonly bindingDelaySeconds: bigint;
  readonly purpose: VaultPurpose;
}

const tokenAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);

const wordPattern = /^0x[0-9a-fA-F]{64}$/u;

/** @throws {never} */
export function hexQuantity(value: bigint): string {
  return `0x${value.toString(16)}`;
}

/** @throws {never} */
export function wordValue(answer: unknown): bigint | undefined {
  return typeof answer === "string" && wordPattern.test(answer) ? BigInt(answer) : undefined;
}

/** @throws {never} */
export function quantityValue(answer: unknown): bigint | undefined {
  return typeof answer === "string" && /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u.test(answer) ? BigInt(answer) : undefined;
}

/** @throws {never} */
export function balanceOfData(owner: string): string {
  return encodeFunctionData({ abi: tokenAbi, functionName: "balanceOf", args: [owner as `0x${string}`] });
}

/** @throws {never} */
export function allowanceData(owner: string, spender: string): string {
  return encodeFunctionData({ abi: tokenAbi, functionName: "allowance", args: [owner as `0x${string}`, spender as `0x${string}`] });
}

/** @throws {never} */
export function approveCall(terms: VaultCallTerms, value: bigint): Call {
  return { to: terms.asset, data: encodeFunctionData({ abi: tokenAbi, functionName: "approve", args: [terms.vault as `0x${string}`, value] }), value: "0x0" };
}

/** @throws {RangeError} */
export function transferCall(terms: VaultCallTerms, operation: Operation, step: Step, gross: bigint): Call {
  if (step !== "send") return approveCall(terms, step === "reset" ? 0n : gross);
  if (operation === "withdraw") return { to: terms.vault, data: withdrawCalldata(gross), value: "0x0" };
  return { to: terms.vault, data: depositCalldata(gross), value: terms.native ? hexQuantity(gross) : "0x0" };
}

export interface BatchApproval {
  readonly resetAllowance: boolean;
  readonly approvalNeeded: boolean;
}

/** @throws {RangeError} */
export function batchCalls(terms: VaultCallTerms, gross: bigint, approval: BatchApproval, extraCalls: ReadonlyArray<Call> = []): ReadonlyArray<Call> {
  return [
    ...(approval.resetAllowance ? [approveCall(terms, 0n)] : []),
    ...(approval.approvalNeeded ? [approveCall(terms, gross)] : []),
    { to: terms.vault, data: depositCalldata(gross), value: terms.native ? hexQuantity(gross) : "0x0" },
    ...extraCalls,
  ];
}

/** @throws {RangeError} */
export function pledgeCall(vault: string, fromPeriod: number, count: number, amountMinor: bigint): Call {
  return { to: vault, data: pledgeMonthsCalldata(fromPeriod, count, amountMinor), value: "0x0" };
}

/** @throws {RangeError} */
export function releaseCall(vault: string, period: number): Call {
  return { to: vault, data: expirePledgeCalldata(period), value: "0x0" };
}

export interface RecordedVaultReview {
  readonly codeSha256?: string | null | undefined;
  readonly factory?: string | null | undefined;
  readonly factoryCodeSha256?: string | null | undefined;
  readonly registrar?: string | null | undefined;
  readonly feeRecipient?: string | null | undefined;
  readonly bindingDelaySeconds?: string | null | undefined;
  readonly evmUpgrade?:
    | {
        readonly vaultImplementation: string;
        readonly vaultImplementationCodeSha256: string;
        readonly factoryImplementation: string;
        readonly factoryImplementationCodeSha256: string;
      }
    | null
    | undefined;
}

/** @throws {never} */
export function recordedVaultReviewOf(deployment: RecordedVaultReview, purpose: VaultPurpose): VaultReview | undefined {
  if (
    typeof deployment.codeSha256 !== "string" ||
    typeof deployment.factory !== "string" ||
    typeof deployment.factoryCodeSha256 !== "string" ||
    typeof deployment.registrar !== "string" ||
    typeof deployment.feeRecipient !== "string" ||
    typeof deployment.bindingDelaySeconds !== "string" ||
    deployment.evmUpgrade === null ||
    deployment.evmUpgrade === undefined ||
    !/^(?:0|[1-9][0-9]*)$/u.test(deployment.bindingDelaySeconds)
  )
    return undefined;
  return {
    codeSha256: deployment.codeSha256,
    implementation: {
      address: deployment.evmUpgrade.vaultImplementation,
      codeSha256: deployment.evmUpgrade.vaultImplementationCodeSha256,
    },
    factory: {
      address: deployment.factory,
      codeSha256: deployment.factoryCodeSha256,
      implementation: {
        address: deployment.evmUpgrade.factoryImplementation,
        codeSha256: deployment.evmUpgrade.factoryImplementationCodeSha256,
      },
      registrar: deployment.registrar,
    },
    feeRecipient: deployment.feeRecipient,
    bindingDelaySeconds: BigInt(deployment.bindingDelaySeconds),
    purpose,
  };
}

/** @throws {never} */
export function reviewedVaultOf(network: string, purpose: VaultPurpose): VaultReview | undefined {
  const factory = isNetworkKey(network) ? reviewedFactory(network) : undefined;
  if (factory === undefined) return undefined;
  return {
    codeSha256: factory.codeSha256,
    implementation: { address: factory.upgrade.vaultImplementation, codeSha256: factory.upgrade.vaultImplementationCodeSha256 },
    factory: {
      address: factory.factory,
      codeSha256: factory.factoryCodeSha256,
      implementation: { address: factory.upgrade.factoryImplementation, codeSha256: factory.upgrade.factoryImplementationCodeSha256 },
      registrar: factory.registrar,
    },
    feeRecipient: factory.feeRecipient,
    bindingDelaySeconds: factory.bindingDelaySeconds,
    purpose,
  };
}

/** @throws {never} */
export function codeBytes(code: unknown): Uint8Array | undefined {
  return typeof code === "string" && /^0x(?:[0-9a-fA-F]{2})+$/u.test(code) ? hexToBytes(code as `0x${string}`) : undefined;
}

/** @throws {never} */
export function callPlan(from: string, chainId: bigint, call: Call): EvmCallPlan {
  return { kind: "evmCall", from: from.toLowerCase(), chainId: hexQuantity(chainId), to: call.to.toLowerCase(), data: call.data.toLowerCase(), value: call.value };
}

/** @throws {never} */
export function batchPlan(from: string, chainId: bigint, calls: ReadonlyArray<Call>): EvmBatchPlan {
  return { kind: "evmBatch", from: from.toLowerCase(), chainId: hexQuantity(chainId), calls: calls.map((call) => ({ to: call.to.toLowerCase(), data: call.data.toLowerCase(), value: call.value })), reference: "", transaction: "" };
}

/** @throws {never} */
export function samePlannedCall(plan: EvmCallPlan, from: string, chainId: bigint, call: Call): boolean {
  const expected = callPlan(from, chainId, call);
  return plan.from === expected.from && plan.chainId === expected.chainId && plan.to === expected.to && plan.data === expected.data && plan.value === expected.value;
}
