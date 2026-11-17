// spec/settlement/feeReplacement.md, "Each step raises both fee fields by at least 10% and at most 25%, within three times the original and the absolute ceiling"; spec/settlement/keeperLifecycle.md, "An unmined send is replaced only by fee, same nonce and content, after activation"
import { nextReplacementFees, validInputs } from "../../gen/settlement__feeReplacement.ts";

export interface FeeFields {
  readonly maxFeePerGas: bigint;
  readonly maxPriorityFeePerGas: bigint;
}

export type Replacement = { readonly kind: "Replace"; readonly fees: FeeFields } | { readonly kind: "Keep" };

const LARGEST_FEE = BigInt(Math.floor((Number.MAX_SAFE_INTEGER - 99) / 125));

const exact = (value: bigint) => value >= 0n && value <= LARGEST_FEE;

/** @throws {never} */
export function nextReplacement({ original, latest, ceiling }: { original: FeeFields; latest: FeeFields; ceiling: bigint }): Replacement {
  const fields = [original.maxFeePerGas, original.maxPriorityFeePerGas, latest.maxFeePerGas, latest.maxPriorityFeePerGas, ceiling];
  if (!fields.every(exact)) return { kind: "Keep" };
  const [originalMax, originalPriority, latestMax, latestPriority, cap] = fields.map(Number);
  if (!validInputs(originalMax, originalPriority, latestMax, latestPriority, cap)) return { kind: "Keep" };
  const next = nextReplacementFees(originalMax, originalPriority, latestMax, latestPriority, cap);
  if (!next.ok) return { kind: "Keep" };
  return { kind: "Replace", fees: { maxFeePerGas: BigInt(next.maxFee), maxPriorityFeePerGas: BigInt(next.priorityFee) } };
}
