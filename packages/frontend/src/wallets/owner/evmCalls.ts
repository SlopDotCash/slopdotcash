// spec/settlement/ownerTransactions.md, "A request is reviewed against current authority and becomes a fixed plan"; spec/frontend/batchedDeposit.md, "Capabilities that require a wallet upgrade use the separate-signature path"
import type { VaultPurpose } from "@repo/settlement/chain/evm/abi";
import { depositCalldata, withdrawCalldata } from "@repo/settlement/chain/evm/actions";
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

export interface VaultReview {
  readonly codeSha256: string;
  readonly implementation: { readonly address: string; readonly codeSha256: string } | undefined;
  readonly factory: string;
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
export function batchCalls(terms: VaultCallTerms, gross: bigint, approval: BatchApproval): ReadonlyArray<Call> {
  return [
    ...(approval.resetAllowance ? [approveCall(terms, 0n)] : []),
    ...(approval.approvalNeeded ? [approveCall(terms, gross)] : []),
    { to: terms.vault, data: depositCalldata(gross), value: "0x0" },
  ];
}

/** @throws {never} */
export function reviewedVaultOf(network: string, purpose: VaultPurpose): VaultReview | undefined {
  const factory = isNetworkKey(network) ? reviewedFactory(network) : undefined;
  if (factory === undefined) return undefined;
  return {
    codeSha256: factory.codeSha256,
    implementation: { address: factory.upgrade.vaultImplementation, codeSha256: factory.upgrade.vaultImplementationCodeSha256 },
    factory: factory.factory,
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
