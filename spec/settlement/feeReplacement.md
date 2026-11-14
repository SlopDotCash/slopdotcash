# Same-nonce EVM fee replacement

PRD section 11 (owner decision of 25 October 2026): the operator keeper and
the fee converter may replace an unmined EVM send only by changing its fee
fields, with the same nonce and transaction content, in bounded steps of
about 25%, at most three times the original fees, and within the existing
per-network limits. Source approval does not activate replacement; the
deployment's activation flag does. Source anchor is development
`workers/verified-fee-replacement.ts` (`nextReplacementFees`), shared by
`workers/payment-executor/core.ts` and `scripts/payment-keeper/budget.ts`.
Fee values are wei per gas and stay well inside the safe-integer range.

## Story: Compute one bounded replacement step

### Each step raises both fee fields by at least 10% and at most 25%, within three times the original and the absolute ceiling

The node requires at least 10%; the policy targets 25%, rounded up. A step
that a cap would push below 10%, or that would leave the priority fee above
the maximum fee, is refused, so the send keeps waiting with its last fees.

```quint
type Fees = { ok: bool, maxFee: int, priorityFee: int }
pure def ceilingPercent(value: int, percent: int): int = (value * percent + 99) / 100
pure def lesser(left: int, right: int): int = if (left < right) left else right
pure def nextReplacementFees(originalMax: int, originalPriority: int, latestMax: int, latestPriority: int, ceiling: int): Fees =
  val feeCap = lesser(originalMax * 3, ceiling)
  val maxFee = lesser(ceilingPercent(latestMax, 125), feeCap)
  val priority = lesser(ceilingPercent(latestPriority, 125), originalPriority * 3)
  if (maxFee < ceilingPercent(latestMax, 110) or priority < ceilingPercent(latestPriority, 110) or priority > maxFee)
    { ok: false, maxFee: 0, priorityFee: 0 }
  else { ok: true, maxFee: maxFee, priorityFee: priority }
pure def validInputs(originalMax: int, originalPriority: int, latestMax: int, latestPriority: int, ceiling: int): bool =
  originalMax > 0 and originalPriority >= 0 and latestMax > 0 and latestPriority >= 0 and ceiling > 0
pure def lawReplacementBounded(originalMax: int, originalPriority: int, latestMax: int, latestPriority: int, ceiling: int): bool =
  val proposed = nextReplacementFees(originalMax, originalPriority, latestMax, latestPriority, ceiling)
  (validInputs(originalMax, originalPriority, latestMax, latestPriority, ceiling) and proposed.ok) implies
    proposed.maxFee <= originalMax * 3 and proposed.maxFee <= ceiling and proposed.priorityFee <= originalPriority * 3
      and proposed.priorityFee <= proposed.maxFee
      and proposed.maxFee * 100 >= latestMax * 110 and proposed.priorityFee * 100 >= latestPriority * 110
      and (proposed.maxFee - 1) * 100 < latestMax * 125 and (proposed.priorityFee - 1) * 100 < latestPriority * 125
pure def lawRefusalCarriesNoFees(originalMax: int, originalPriority: int, latestMax: int, latestPriority: int, ceiling: int): bool =
  val proposed = nextReplacementFees(originalMax, originalPriority, latestMax, latestPriority, ceiling)
  not(proposed.ok) implies proposed.maxFee == 0 and proposed.priorityFee == 0
pure val originalMaxValues = Set(100, 1000)
pure val originalPriorityValues = Set(0, 10, 100)
pure val latestMaxValues = Set(100, 125, 250, 1000, 2999)
pure val latestPriorityValues = Set(0, 10, 13, 100, 299)
pure val ceilingValues = Set(150, 3000, 100000)
```
