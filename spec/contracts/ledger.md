# Escrow ledger shared by both chains

The EVM `ProjectEscrow` and the Solana `slop-escrow` program keep the same
kind of ledger: a free balance that only the owner commits or refunds,
awards that reserve their whole gross until paid, a 2% ordinary fee or a
75/25 bounty split, and one monthly allocation per calendar UTC period inside
a fixed admission window. This library states those parts once. Amounts are
integer base units of the vault's one asset, using the scalar fee helpers of
[exact amounts](../settlement/money.md); the contracts' checked `uint128` and
`u64` arithmetic reverts above their widths, which the bounded models never
reach.

## Story: Charge the published fee once per award or withdrawal

### An ordinary award or withdrawal pays ceil(gross / 50) and a bounty award pays a quarter

`payoutFee` and `withdrawalFee` in `ProjectEscrow.sol` and `fee_for` in
`lib.rs` round 2% up once per award or withdrawal. `commitBountyAward` and
`commit_bounty` require a gross divisible by four and keep a quarter for
Slop, with no ordinary fee added. The purpose is fixed when the vault is
created and keys it, so ordinary and bounty funds never share a balance.

```quint
import money as M from "../settlement/money"
type Purpose = Ordinary | Bounty
pure def awardFee(purpose: Purpose, gross: int): int =
  if (purpose == Ordinary) M::ordinaryFee(gross) else M::privateSponsor(gross)
pure def awardGrossAdmissible(purpose: Purpose, gross: int): bool =
  gross > 0 and (purpose == Ordinary or gross % 4 == 0)
pure val grossValues = Set(0, 1, 4, 49, 50, 51, 100)
pure val otherValues = Set(1, 4, 49, 50)
```

### The ordinary fee never exceeds the gross and splitting never lowers it

A one-unit award pays its unit in fees and nothing net. Two separate awards
or withdrawals pay at least the fee of their combined gross.

```quint
pure def lawFeeWithinGross(gross: int): bool = gross > 0 implies
  M::ordinaryFee(gross) >= 1 and M::ordinaryFee(gross) <= gross
pure def lawFeeRoundsUp(gross: int): bool = gross > 0 implies
  M::ordinaryFee(gross) * 50 >= gross and (M::ordinaryFee(gross) - 1) * 50 < gross
pure def lawSplitNeverLowersFee(gross: int, other: int): bool = (gross > 0 and other > 0) implies
  M::ordinaryFee(gross) + M::ordinaryFee(other) >= M::ordinaryFee(gross + other)
pure def lawBountyQuarter(gross: int): bool = awardGrossAdmissible(Bounty, gross) implies
  awardFee(Bounty, gross) * 4 == gross and gross - awardFee(Bounty, gross) == M::privateResearcher(gross)
```

## Story: Reserve each award until it is paid

### An award reserves its principal and fee and is paid at most once

Each award is keyed by its source digest: `awardId` and `award_id_for` derive
the only valid ID from the source, and `consumedSources` or the origin
account refuses a second award for it. The reserved principal and fee are
the sums over unpaid awards, so paying one award never consumes another's
reserve. A paid award records the binding version and destination it paid.

```quint
type Award = { source: int, actor: int, gross: int, fee: int, committedAt: int, paid: bool, paidTo: str, paidVersion: int }
type Leaf = { actor: int, gross: int, source: int }
pure def newAward(source: int, actor: int, gross: int, fee: int, now: int): Award =
  { source: source, actor: actor, gross: gross, fee: fee, committedAt: now, paid: false, paidTo: "", paidVersion: 0 }
pure def hasSource(awards: List[Award], source: int): bool = awards.some(a => a.source == source)
pure val noAward: Award = newAward(0, 0, 0, 0, 0)
pure def awardFor(awards: List[Award], source: int): Award =
  awards.foldl(noAward, (found, a) => if (a.source == source) a else found)
pure def markPaid(awards: List[Award], source: int, recipient: str, version: int): List[Award] =
  awards.listMap(a => if (a.source == source) { ...a, paid: true, paidTo: recipient, paidVersion: version } else a)
pure def unpaidPrincipal(awards: List[Award]): int = awards.foldl(0, (t, a) => if (a.paid) t else t + a.gross - a.fee)
pure def unpaidFees(awards: List[Award]): int = awards.foldl(0, (t, a) => if (a.paid) t else t + a.fee)
pure def paidPrincipal(awards: List[Award]): int = awards.foldl(0, (t, a) => if (a.paid) t + a.gross - a.fee else t)
pure def paidFees(awards: List[Award]): int = awards.foldl(0, (t, a) => if (a.paid) t + a.fee else t)
pure def uniqueSources(awards: List[Award]): bool = awards.every(a => awards.select(b => b.source == a.source).length() == 1)
pure def leafTotal(leaves: List[Leaf]): int = leaves.foldl(0, (t, l) => t + l.gross)
```

### Paying one unique unpaid award moves exactly its principal and fee from reserved to paid

```quint
pure def lawPayMovesOneAward(awards: List[Award], source: int, recipient: str, version: int): bool =
  val chosen = awardFor(awards, source)
  val after = markPaid(awards, source, recipient, version)
  (uniqueSources(awards) and hasSource(awards, source) and not(chosen.paid)) implies
    unpaidPrincipal(after) == unpaidPrincipal(awards) - (chosen.gross - chosen.fee)
      and unpaidFees(after) == unpaidFees(awards) - chosen.fee
      and paidPrincipal(after) == paidPrincipal(awards) + (chosen.gross - chosen.fee)
      and paidFees(after) == paidFees(awards) + chosen.fee
      and uniqueSources(after)
pure val sourceValues = Set(1, 2)
pure val recipientValues = Set("wallet")
pure val versionValues = Set(1)
pure val awardsValues = Set(List(),
  List({ source: 1, actor: 1, gross: 50, fee: 1, committedAt: 0, paid: false, paidTo: "", paidVersion: 0 }),
  List({ source: 1, actor: 1, gross: 50, fee: 1, committedAt: 0, paid: false, paidTo: "", paidVersion: 0 },
    { source: 2, actor: 2, gross: 4, fee: 1, committedAt: 0, paid: true, paidTo: "wallet", paidVersion: 1 }),
  List({ source: 2, actor: 1, gross: 4, fee: 1, committedAt: 0, paid: false, paidTo: "", paidVersion: 0 },
    { source: 2, actor: 2, gross: 4, fee: 1, committedAt: 0, paid: false, paidTo: "", paidVersion: 0 }))
```

## Story: Bound the owner's binding cancellations

### An owner cancels at most three bindings of an actor between payments unless a rotation is pending

`cancelBinding` in `ProjectEscrow.sol` and `veto_binding` in `lib.rs` count
cancellations per actor since its last payment and refuse a fourth. A
pending identity-authority rotation waives the cap and leaves the count
unchanged; each chain defines when a rotation is pending. A payment resets
the count.

```quint
pure val maxCancels = 3
pure def cancelAllowed(count: int, waived: bool): bool = waived or count < maxCancels
pure def cancelsAfter(count: int, waived: bool): int = if (waived) count else count + 1
pure def lawCancelsStayBounded(count: int, waived: bool): bool =
  (count >= 0 and count <= maxCancels and cancelAllowed(count, waived)) implies
    cancelsAfter(count, waived) >= 0 and cancelsAfter(count, waived) <= maxCancels
pure val countValues = Set(0, 1, 2, 3, 4)
```

## Story: Admit one monthly allocation per period inside its window

### A period's window opens 72 hours after its month ends and closes 72 hours after the next month ends

`monthlyWindow` in `ProjectEscrow.sol` and `monthly_window` in `lib.rs`
accept a period `YYYYMM` with a year from 2000 through 9999 and compute
month starts in the proleptic Gregorian calendar. Each window ends where the
next period's begins, so at most one period is open at any time and a
stolen attester key can admit at most one capped allocation per month.

```quint
pure val cutoffDelay = 72 * 3600
pure def validPeriod(period: int): bool =
  period / 100 >= 2000 and period / 100 <= 9999 and period % 100 >= 1 and period % 100 <= 12
pure def nextPeriod(period: int): int = if (period % 100 == 12) (period / 100 + 1) * 100 + 1 else period + 1
pure def monthStart(period: int): int =
  val calendarYear = period / 100
  val calendarMonth = period % 100
  val shiftedYear = if (calendarMonth <= 2) calendarYear - 1 else calendarYear
  val eraIndex = shiftedYear / 400
  val yearInEra = shiftedYear - eraIndex * 400
  val dayInYear = (153 * (if (calendarMonth > 2) calendarMonth - 3 else calendarMonth + 9) + 2) / 5
  val dayInEra = yearInEra * 365 + yearInEra / 4 - yearInEra / 100 + dayInYear
  86400 * (eraIndex * 146097 + dayInEra - 719468)
pure def opensAt(period: int): int = monthStart(nextPeriod(period)) + cutoffDelay
pure def closesAt(period: int): int = monthStart(nextPeriod(nextPeriod(period))) + cutoffDelay
pure def inWindow(period: int, now: int): bool = validPeriod(period) and now >= opensAt(period) and now < closesAt(period)
pure def lawWindowNonEmpty(period: int): bool = validPeriod(period) implies opensAt(period) < closesAt(period)
pure def lawNextWindowFollows(period: int): bool = closesAt(period) == opensAt(nextPeriod(period))
pure val periodValues = Set(202610, 202611, 202612, 202702, 202713, 199912, 999912)
```

### The November 2026 window opens on 4 December 2026 and closes on 4 January 2027

The values match the program's own unit test.

```quint
pure def lawNovember2026Window(period: int): bool = period == 202611 implies
  opensAt(period) == 1796342400 and closesAt(period) == 1799020800 and opensAt(202802) == 1835740800
```
