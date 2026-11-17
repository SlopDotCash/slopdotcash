// spec/settlement/ownerTransactions.md, "A request is reviewed against current authority and becomes a fixed plan"; spec/settlement/ownerTransactions.md, "The pending request is saved before the wallet call and recovered without resubmission"
import { Result, Schema } from "effect";

const address = Schema.String.check(Schema.isPattern(/^0x[0-9a-f]{40}$/u));
const data = Schema.String.check(Schema.isPattern(/^0x(?:[0-9a-f]{2})*$/u));
const quantity = Schema.String.check(Schema.isPattern(/^0x(?:0|[1-9a-f][0-9a-f]*)$/u));
const hash = Schema.String.check(Schema.isPattern(/^(?:0x[0-9a-f]{64})?$/u));
const units = Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,19}$/u));
const blockhash = Schema.String.check(Schema.isPattern(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/u));

export const PlannedCall = Schema.Struct({ to: address, data, value: quantity });

export const EvmCallPlan = Schema.Struct({ kind: Schema.Literal("evmCall"), from: address, chainId: quantity, to: address, data, value: quantity });

export const EvmDepositPlan = Schema.Struct({ kind: Schema.Literal("evmDeposit"), call: EvmCallPlan, hash });

export const EvmBatchPlan = Schema.Struct({
  kind: Schema.Literal("evmBatch"),
  from: address,
  chainId: quantity,
  calls: Schema.Array(PlannedCall).check(Schema.isMinLength(1), Schema.isMaxLength(3)),
  reference: Schema.String.check(Schema.isMaxLength(4096)),
  transaction: hash,
});

export const SolanaFundingPlan = Schema.Struct({ kind: Schema.Literal("solanaFunding"), operation: Schema.Literals(["deposit", "withdraw"]), gross: units, blockhash });

export const SolanaCommitmentPlan = Schema.Struct({
  kind: Schema.Literal("solanaCommitment"),
  sourceDigest: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u)),
  githubUserId: units,
  gross: units,
  blockhash,
});

export const OwnerPlan = Schema.Union([EvmCallPlan, EvmDepositPlan, EvmBatchPlan, SolanaFundingPlan, SolanaCommitmentPlan]);

export type PlannedCall = typeof PlannedCall.Type;
export type EvmCallPlan = typeof EvmCallPlan.Type;
export type EvmDepositPlan = typeof EvmDepositPlan.Type;
export type EvmBatchPlan = typeof EvmBatchPlan.Type;
export type SolanaFundingPlan = typeof SolanaFundingPlan.Type;
export type SolanaCommitmentPlan = typeof SolanaCommitmentPlan.Type;
export type OwnerPlan = typeof OwnerPlan.Type;

const decodePlan = Schema.decodeUnknownResult(OwnerPlan, { onExcessProperty: "error" });

/** @throws {never} */
export function planOf(text: string): OwnerPlan | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const decoded = decodePlan(parsed);
  return Result.isSuccess(decoded) ? decoded.success : undefined;
}

/** @throws {never} */
export function planText(plan: OwnerPlan): string {
  return JSON.stringify(plan);
}
