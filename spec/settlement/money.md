# Exact asset amounts

This library serves PRD sections 2, 6 and 12. Values are arbitrary-length little-endian base-1000 limbs. A limb arithmetic operation stays within the JavaScript safe-integer range. The representation preserves integer token amounts above 2^53 without converting a balance to a floating-point number. Trailing zero limbs are permitted and equality compares value. Network, asset and decimals remain separate identity facts. RPC decoding and decimal rendering require later shell conformance.

## Story: Preserve every base unit

### Every amount contains only integer limbs from zero through 999

```quint
type Amount = List[int]
type CompareFold = { index: int, comparison: int }
type AddFold = { index: int, carry: int, digits: Amount }
type SubtractFold = { index: int, borrow: int, digits: Amount }
type SafeConversion = { remaining: int, digits: Amount }
type ScaleFold = { carry: int, digits: Amount }
type ProductFold = { prefix: Amount, product: Amount }
type Division = { quotient: Amount, remainder: Amount }
pure val zero: Amount = List(0)
pure def validAmount(a: Amount): bool = a.length() > 0 and a.every(x => x >= 0 and x < 1000)
pure def smallAmount(n: int): Amount =
  val converted = List(0, 0, 0, 0, 0, 0).foldl({ remaining: n, digits: List() }, (acc, ignored) => {
    remaining: acc.remaining / 1000, digits: acc.digits.append(acc.remaining % 1000)
  })
  if (n < 0) zero else converted.digits
pure def compareAmounts(a: Amount, b: Amount): int =
  val longest = if (a.length() >= b.length()) a else b
  val result = longest.foldl({ index: 0, comparison: 0 }, (acc, ignored) => {
    index: acc.index + 1,
    comparison: if (a.nthOr(acc.index, 0) == b.nthOr(acc.index, 0)) acc.comparison
      else if (a.nthOr(acc.index, 0) > b.nthOr(acc.index, 0)) 1 else -1
  })
  result.comparison
pure def equalAmounts(a: Amount, b: Amount): bool = compareAmounts(a, b) == 0
pure def positiveAmount(a: Amount): bool = compareAmounts(a, zero) > 0
pure def lawEqualReflexive(a: Amount): bool = equalAmounts(a, a)
```

### Addition carries each limb and subtraction borrows each limb

Subtraction is used only after the caller establishes that the minuend covers the subtrahend. These operations impose no asset-decimal convention. An invalid incoming limb vector is refused before a financial transition.

```quint
pure def addAmounts(a: Amount, b: Amount): Amount =
  val longest = if (a.length() >= b.length()) a else b
  val result = longest.foldl({ index: 0, carry: 0, digits: List() }, (acc, ignored) => {
    index: acc.index + 1,
    carry: (a.nthOr(acc.index, 0) + b.nthOr(acc.index, 0) + acc.carry) / 1000,
    digits: acc.digits.append((a.nthOr(acc.index, 0) + b.nthOr(acc.index, 0) + acc.carry) % 1000)
  })
  if (result.carry > 0) result.digits.append(result.carry) else result.digits
pure def subtractAmounts(a: Amount, b: Amount): Amount =
  val result = a.foldl({ index: 0, borrow: 0, digits: List() }, (acc, ignored) => {
    index: acc.index + 1,
    borrow: if (a.nthOr(acc.index, 0) - b.nthOr(acc.index, 0) - acc.borrow < 0) 1 else 0,
    digits: acc.digits.append(if (a.nthOr(acc.index, 0) - b.nthOr(acc.index, 0) - acc.borrow < 0)
      a.nthOr(acc.index, 0) - b.nthOr(acc.index, 0) - acc.borrow + 1000
      else a.nthOr(acc.index, 0) - b.nthOr(acc.index, 0) - acc.borrow)
  })
  result.digits
pure def lawZeroIdentity(a: Amount): bool = validAmount(a) implies equalAmounts(addAmounts(a, zero), a)
```

### Ordinary fees round upward and private splits require exact division

Scalar compatibility helpers retain existing safe-integer callers. Full-width fee and allocation operations below use limb arithmetic. A one-unit ordinary award has zero net. A private 75/25 award requires exact quarter division and never adds the ordinary fee.

```quint
pure def ordinaryFee(scalarGross: int): int = if (scalarGross <= 0) 0 else scalarGross / 50 + (if (scalarGross % 50 == 0) 0 else 1)
pure def ordinaryNet(scalarGross: int): int = scalarGross - ordinaryFee(scalarGross)
pure def privateResearcher(scalarGross: int): int = if (scalarGross >= 0 and scalarGross % 4 == 0) scalarGross / 4 * 3 else 0
pure def privateSponsor(scalarGross: int): int = if (scalarGross >= 0 and scalarGross % 4 == 0) scalarGross / 4 else 0
pure def lawOrdinaryConservation(scalarGross: int): bool = scalarGross >= 0 implies ordinaryNet(scalarGross) + ordinaryFee(scalarGross) == scalarGross
pure def lawPrivateConservation(scalarGross: int): bool = (scalarGross >= 0 and scalarGross % 4 == 0) implies privateResearcher(scalarGross) + privateSponsor(scalarGross) == scalarGross
```

## Story: Admit the exact supported token behavior

### Token-2022 admission permits only immutable metadata and immutable token ownership

Native ETH and SOL use their native asset path. Classic tokens retain their verified mint and token-program identity. Stablecoin approval is registry policy and is never inferred from a ticker. Every token must keep the same verified decimals throughout its obligation history.

```quint
type AssetKind = Native | Classic | Token2022
pure def token2022Admissible(mintBytes: int, mintAuthority: bool, freezeAuthority: bool,
  pointerAuthority: bool, updateAuthority: bool, selfHosted: bool,
  mintExtensions: List[str], accountExtensions: List[str]): bool =
  mintBytes > 0 and mintBytes <= 1024 and not(mintAuthority) and not(freezeAuthority)
    and not(pointerAuthority) and not(updateAuthority) and selfHosted
    and mintExtensions.every(x => x == "MetadataPointer" or x == "TokenMetadata")
    and accountExtensions.every(x => x == "ImmutableOwner")
pure def sameAsset(network: str, asset: str, program: str, decimals: int,
  expectedNetwork: str, expectedAsset: str, expectedProgram: str, expectedDecimals: int): bool =
  network == expectedNetwork and asset == expectedAsset and program == expectedProgram
    and decimals == expectedDecimals and decimals >= 0
```


## Story: Multiply and divide full-width monetary values

### Multiplication accumulates shifted limb products without converting the amount to a number

Every multiplier limb is below 1000. A per-limb product plus carry stays below one million. The six extraction steps in smallAmount cover every nonnegative JavaScript safe integer, including collection ranks, and impose no bound on Amount length.

```quint
pure def multiplySmall(a: Amount, factor: int): Amount =
  val scaled = a.foldl({ carry: 0, digits: List() }, (acc, digit) => {
    carry: (digit * factor + acc.carry) / 1000,
    digits: acc.digits.append((digit * factor + acc.carry) % 1000)
  })
  if (scaled.carry > 0) scaled.digits.append(scaled.carry) else scaled.digits
pure def multiplyAmounts(a: Amount, b: Amount): Amount =
  val multiplied = b.foldl({ prefix: List(), product: zero }, (acc, digit) => {
    prefix: acc.prefix.append(0),
    product: addAmounts(acc.product, acc.prefix.concat(multiplySmall(a, digit)))
  })
  multiplied.product
pure def reverseAmount(a: Amount): Amount = a.foldl(List(), (acc, digit) => List(digit).concat(acc))
pure def lawMultiplyOne(a: Amount): bool = validAmount(a) implies equalAmounts(multiplyAmounts(a, List(1)), a)
```

### Long division chooses each quotient limb by ten fixed binary decisions

The dividend is processed from its most significant limb. The prior remainder is below the divisor, so bringing down one base-1000 limb yields a quotient digit below 1000. The bit decisions select the largest digit whose product fits. Division by zero returns the input as remainder and a zero quotient, and financial callers require a positive divisor.

```quint
pure def quotientDigit(partial: Amount, divisor: Amount): int =
  List(512, 256, 128, 64, 32, 16, 8, 4, 2, 1).foldl(0, (digit, bit) =>
    if (digit + bit < 1000 and compareAmounts(multiplySmall(divisor, digit + bit), partial) <= 0)
      digit + bit else digit)
pure def divisionStep(acc: Division, nextDigit: int, divisor: Amount): Division =
  val broughtDown = List(nextDigit).concat(acc.remainder)
  val selected = quotientDigit(broughtDown, divisor)
  { quotient: acc.quotient.append(selected),
    remainder: subtractAmounts(broughtDown, multiplySmall(divisor, selected)) }
pure def divideAmounts(dividend: Amount, divisor: Amount): Division =
  val divided = reverseAmount(dividend).foldl({ quotient: List(), remainder: zero },
    (acc, digit) => divisionStep(acc, digit, divisor))
  if (not(positiveAmount(divisor))) { quotient: zero, remainder: dividend }
  else { quotient: reverseAmount(divided.quotient), remainder: divided.remainder }
pure val aValues = Set(List(0), List(1), List(999), List(0, 1), List(999, 999), List(123, 456, 789, 123, 456, 789, 1))
pure val bValues = Set(List(1), List(2), List(50), List(999), List(0, 1), List(5, 12))
pure def lawDivisionReconstructs(a: Amount, b: Amount): bool =
  val divided = divideAmounts(a, b)
  (validAmount(a) and validAmount(b) and positiveAmount(b)) implies
    equalAmounts(addAmounts(multiplyAmounts(divided.quotient, b), divided.remainder), a)
pure def lawDivisionRemainder(a: Amount, b: Amount): bool =
  (validAmount(a) and validAmount(b) and positiveAmount(b)) implies
    compareAmounts(divideAmounts(a, b).remainder, b) < 0
```

### Full-width ordinary and private fee calculations conserve every base unit

```quint
pure def ordinaryFeeAmount(gross: Amount): Amount =
  val divided = divideAmounts(gross, List(50))
  if (positiveAmount(divided.remainder)) addAmounts(divided.quotient, List(1)) else divided.quotient
pure def ordinaryNetAmount(gross: Amount): Amount = subtractAmounts(gross, ordinaryFeeAmount(gross))
pure def privateSplitPossible(gross: Amount): bool = validAmount(gross) and equalAmounts(divideAmounts(gross, List(4)).remainder, zero)
pure def privateFeeAmount(gross: Amount): Amount = divideAmounts(gross, List(4)).quotient
pure def privateResearcherAmount(gross: Amount): Amount = multiplySmall(privateFeeAmount(gross), 3)
pure def lawFullOrdinaryConservation(a: Amount): bool = validAmount(a) implies
  equalAmounts(addAmounts(ordinaryFeeAmount(a), ordinaryNetAmount(a)), a)
pure def lawFullPrivateConservation(a: Amount): bool = privateSplitPossible(a) implies
  equalAmounts(addAmounts(privateFeeAmount(a), privateResearcherAmount(a)), a)
```

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val assetValues = Set("", "a", "b")
pure val decimalsValues = Set(0, 1, 2)
pure val expectedAssetValues = Set("", "a", "b")
pure val expectedDecimalsValues = Set(0, 1, 2)
pure val expectedNetworkValues = Set("", "a", "b")
pure val expectedProgramValues = Set("", "a", "b")
pure val factorValues = Set(0, 1, 2)
pure val scalarGrossValues = Set(0, 1, 2, 49, 50, 51)
pure val grossValues = Set(List(0), List(1), List(4), List(50), List(0, 0, 0, 0, 0, 0, 1))
pure val mintBytesValues = Set(0, 1, 2)
pure val nValues = Set(0, 1, 2)
pure val networkValues = Set("", "a", "b")
pure val programValues = Set("", "a", "b")
```
