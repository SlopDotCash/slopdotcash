// spec/settlement/allocation.md, "Each floor and remainder comes from full-width multiplication and division"; spec/settlement/allocation.md, "The largest remainders receive the remaining units exactly once"; spec/settlement/allocation.md, "A positive pool requires unique actors and positive accepted-work weight"
import { allocateAmounts, canCommitAllocation, type Weight } from "../../gen/settlement__allocation.ts";
import { divideAmounts, multiplyAmounts } from "../../gen/settlement__money.ts";
import { fromAmount, toAmount } from "./amounts.ts";

export interface WeightedActor {
  readonly actor: number;
  readonly weight: bigint;
}

export interface ActorShare {
  readonly actor: number;
  readonly amount: bigint;
}

export type Allocation = { readonly kind: "Allocated"; readonly shares: readonly ActorShare[] } | { readonly kind: "Refused" };

const storable = (recipient: WeightedActor) => Number.isSafeInteger(recipient.actor) && recipient.weight >= 0n;

/** @throws {never} */
export function allocate(total: bigint, recipients: readonly WeightedActor[]): Allocation {
  if (total < 0n || !recipients.every(storable)) return { kind: "Refused" };
  const pool = toAmount(total);
  const weights: Weight[] = recipients.map((recipient) => ({ actor: recipient.actor, weight: toAmount(recipient.weight) }));
  if (!canCommitAllocation(pool, weights)) return { kind: "Refused" };
  return { kind: "Allocated", shares: allocateAmounts(pool, weights).map((share) => ({ actor: share.actor, amount: fromAmount(share.amount) })) };
}

/** @throws {RangeError} */
export function weightedShare({ total, weight, totalWeight }: { total: bigint; weight: bigint; totalWeight: bigint }): { readonly amount: bigint; readonly remainder: bigint } {
  if (total < 0n || weight < 0n || weight > totalWeight || totalWeight <= 0n) throw new RangeError("A weighted share needs a nonnegative pool and a weight within a positive total weight");
  const divided = divideAmounts(multiplyAmounts(toAmount(total), toAmount(weight)), toAmount(totalWeight));
  return { amount: fromAmount(divided.quotient), remainder: fromAmount(divided.remainder) };
}
