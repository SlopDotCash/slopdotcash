# Full-width largest-remainder allocation

PRD sections 6 and 7 require exact integer shares and permanent actor-ID tie breaking. Both the pool and every accepted-work weight use arbitrary-length Amount limbs. Collection indices use JavaScript integers while ranks and monetary remainders remain Amount values. This is the canonical full-width monetary allocation algorithm.

## Story: Allocate the complete monthly pool without losing or creating units

### A positive pool requires unique actors and positive accepted-work weight

An empty recipient list is valid only for a zero pool. It produces no obligations.

```quint
import money as M from "./money"
type Weight = { actor: int, weight: M::Amount }
type Share = { actor: int, amount: M::Amount }
type Portion = { actor: int, floor: M::Amount, remainder: M::Amount }
pure def totalWeight(weights: List[Weight]): M::Amount = weights.foldl(M::zero, (total, recipient) => M::addAmounts(total, recipient.weight))
pure def validWeights(weights: List[Weight]): bool = weights.length() > 0
  and weights.every(recipient => recipient.actor > 0 and M::validAmount(recipient.weight)
    and weights.select(other => other.actor == recipient.actor).length() == 1)
  and M::positiveAmount(totalWeight(weights))
pure def canAllocate(total: M::Amount, weights: List[Weight]): bool = M::validAmount(total) and
  (validWeights(weights) or (weights.length() == 0 and M::equalAmounts(total, M::zero)))
```

### Each floor and remainder comes from full-width multiplication and division

```quint
pure def portion(total: M::Amount, recipient: Weight, weights: List[Weight]): M::Division =
  M::divideAmounts(M::multiplyAmounts(total, recipient.weight), totalWeight(weights))
pure def floorTotal(total: M::Amount, weights: List[Weight]): M::Amount =
  weights.foldl(M::zero, (sum, recipient) => M::addAmounts(sum, portion(total, recipient, weights).quotient))
pure def weightedPortion(total: M::Amount, weightedRecipient: Weight, denominator: M::Amount): Portion =
  val divided = M::divideAmounts(M::multiplyAmounts(total, weightedRecipient.weight), denominator)
  { actor: weightedRecipient.actor, floor: divided.quotient, remainder: divided.remainder }
pure def portionTotal(portions: List[Portion]): M::Amount = portions.foldl(M::zero, (sum, p) => M::addAmounts(sum, p.floor))
pure def remainderRank(rankedPortion: Portion, portions: List[Portion]): M::Amount =
  portions.foldl(M::zero, (rank, other) =>
    if (M::compareAmounts(other.remainder, rankedPortion.remainder) > 0
      or (M::equalAmounts(other.remainder, rankedPortion.remainder) and other.actor < rankedPortion.actor))
      M::addAmounts(rank, List(1)) else rank)

```

### The largest remainders receive the remaining units exactly once

Each quotient and remainder is computed once and retained through ranking. A rank is counted directly into limb form before comparison with the unallocated amount. No monetary value is converted back to a JavaScript number. Invalid weights return an empty allocation and cannot be committed.

```quint
pure def allocateAmounts(total: M::Amount, weights: List[Weight]): List[Share] =
  val admitted = canAllocate(total, weights)
  val denominator = if (admitted) totalWeight(weights) else M::zero
  val portions = if (admitted) weights.listMap(recipient => weightedPortion(total, recipient, denominator)) else List()
  val remaining = if (admitted) M::subtractAmounts(total, portionTotal(portions)) else M::zero
  if (admitted) portions.listMap(recipient => {
    actor: recipient.actor,
    amount: M::addAmounts(recipient.floor,
      if (M::compareAmounts(remainderRank(recipient, portions), remaining) < 0) List(1) else M::zero)
  }) else List()
pure def allocatedTotal(shares: List[Share]): M::Amount = shares.foldl(M::zero, (sum, share) => M::addAmounts(sum, share.amount))
pure def canCommitAllocation(total: M::Amount, weights: List[Weight]): bool = canAllocate(total, weights)
  and M::equalAmounts(allocatedTotal(allocateAmounts(total, weights)), total)
pure val totalValues = Set(List(0), List(1), List(10), List(0, 0, 0, 0, 0, 0, 1))
pure val weightsValues = Set(List(), List({ actor: 1, weight: List(1) }),
  List({ actor: 1, weight: List(1) }, { actor: 2, weight: List(3) }),
  List({ actor: 2, weight: List(5, 1) }, { actor: 1, weight: List(5, 1) }, { actor: 3, weight: List(0) }))
pure def lawAllocationConserves(total: M::Amount, weights: List[Weight]): bool = canAllocate(total, weights) implies
  M::equalAmounts(allocatedTotal(allocateAmounts(total, weights)), total)
pure def lawSingleRecipient(total: M::Amount, actor: int): bool = (M::validAmount(total) and actor > 0) implies
  M::equalAmounts(allocateAmounts(total, List({ actor: actor, weight: List(1) })).nthOr(0, { actor: actor, amount: M::zero }).amount, total)
```

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val actorValues = Set(0, 1, 2)
```
