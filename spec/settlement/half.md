# Exact half shares

PRD section 6 requires the buyback share to round down to the nearest base
unit. The amount can exceed the JavaScript safe integer range.

## Story: Split any supported amount into its whole half and remainder

### Halving carries one remainder bit between adjacent limbs

Read the amount from its most significant base-1000 limb. The carried bit
is either zero or one. Divide the current limb plus 1,000 times that bit by
two, retain the quotient limb, and carry the new remainder. The final
remainder is zero or one base unit. The algorithm keeps little-endian Amount
encoding and never converts the whole amount to a JavaScript number.

```quint
import money as M from "./money"
type Half = { quotient: M::Amount, remainder: int }
pure def halfStep(acc: Half, limb: int): Half =
  val partial = 1000 * acc.remainder + limb
  { quotient: List(partial / 2).concat(acc.quotient), remainder: partial % 2 }
pure def half(amount: M::Amount): Half = M::reverseAmount(amount).foldl({ quotient: List(), remainder: 0 },
  (acc, limb) => halfStep(acc, limb))
pure def lawHalfValid(amount: M::Amount): bool = M::validAmount(amount) implies
  M::validAmount(half(amount).quotient) and (half(amount).remainder == 0 or half(amount).remainder == 1)
pure val amountValues = Set(List(0), List(1), List(2), List(999), List(0, 1), List(1, 1), List(999, 999, 0))
```
