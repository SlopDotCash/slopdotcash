# Referral attribution and monthly accrual

PRD section 11 governs this deferred program. Accrual starts off. A reviewed
reactivation may enable dry-run filings, which never post a root. The ledger
records all source payouts, including exclusions, and preserves every filed
rate. Token amounts use the exact Amount library. `tokenUnit` is the verified
number of base units in one program token; no token-decimal convention is
assumed. Stablecoin gross inputs use integer micro-units.

## Story: Retain the submitting maintainer's referral choice

### A project captures an eligible signed-in referrer once

The application adapter verifies current immutable actor identities and roles.
An omitted referrer is zero and cannot be filled in later. Capture cannot name
the submitting maintainer, project steward, administrator or moderator.

```quint
import money as M from "./money"
type Attribution = { project: int, applicant: int, steward: int, referrer: int }
type Rate = { fromPeriod: int, numerator: M::Amount, denominator: M::Amount }
type Payout = { id: int, project: int, period: int, firstPaidPeriod: int, gross: M::Amount,
  paid: bool, stablecoin: bool, team: bool, banned: bool, held: bool }
type Accrued = { payout: Payout, referrer: int, eligible: bool, rate: Rate, amount: M::Amount }
type Filing = { period: int, sourceDigest: str, sourceCount: int, recordCount: int }
type AccrualPhase = Off | Ready | Collecting
type Accrual = { phase: AccrualPhase, configured: bool, tokenUnit: M::Amount,
  attributions: List[Attribution], rates: List[Rate], records: List[Accrued], filings: List[Filing],
  nextPeriod: int, activePeriod: int, sourceDigest: str, sourceCount: int,
  startingRecordCount: int, pending: List[Payout] }
pure val firstPeriod = 2026 * 12 + 10
pure val emptyRate: Rate = { fromPeriod: firstPeriod, numerator: M::zero, denominator: List(1) }
pure val emptyPayout: Payout = { id: 0, project: 0, period: 0, firstPaidPeriod: 0,
  gross: M::zero, paid: false, stablecoin: false, team: true, banned: true, held: true }
pure val initial: Accrual = { phase: Off, configured: false, tokenUnit: M::zero,
  attributions: List(), rates: List(), records: List(), filings: List(), nextPeriod: firstPeriod,
  activePeriod: 0, sourceDigest: "", sourceCount: 0, startingRecordCount: 0, pending: List() }
pure def referrerFor(a: Accrual, project: int): int = a.attributions.foldl(0,
  (found, entry) => if (entry.project == project) entry.referrer else found)
pure def canCapture(a: Accrual, project: int, applicant: int, steward: int, referrer: int,
  signedIn: bool, administrator: bool, moderator: bool): bool = project > 0 and applicant > 0 and steward > 0
  and not(a.attributions.some(entry => entry.project == project))
  and (referrer == 0 or (referrer > 0 and signedIn and not(administrator) and not(moderator)
    and referrer != applicant and referrer != steward))
pure def capture(a: Accrual, project: int, applicant: int, steward: int, referrer: int,
  signedIn: bool, administrator: bool, moderator: bool): Accrual =
  { ...a, attributions: a.attributions.append({ project: project, applicant: applicant, steward: steward, referrer: referrer }) }
```

## Story: File every closed month once at its historical rate

### Verified token units and approved reactivation precede dry-run accrual

The canonical token adapter verifies token identity and decimals before
configuration. Reactivation does not activate posting. A zero or unverified
unit cannot create a rate or a monetary record.

```quint
pure def canConfigure(a: Accrual, tokenUnit: M::Amount, verified: bool, by: str): bool =
  a.phase == Off and not(a.configured) and by == "owner" and verified
    and M::validAmount(tokenUnit) and M::positiveAmount(tokenUnit)
pure def configure(a: Accrual, tokenUnit: M::Amount, verified: bool, by: str): Accrual =
  { ...a, configured: true, tokenUnit: tokenUnit,
    rates: List({ fromPeriod: firstPeriod, numerator: M::multiplySmall(tokenUnit, 3), denominator: List(0, 0, 1) }) }
pure def canEnableDryRun(a: Accrual, reactivationApproved: bool, by: str): bool =
  a.phase == Off and a.configured and reactivationApproved and by == "owner"
pure def enableDryRun(a: Accrual, reactivationApproved: bool, by: str): Accrual = { ...a, phase: Ready }
pure def canDisable(a: Accrual, by: str): bool = a.phase == Ready and by == "owner"
pure def disable(a: Accrual, by: str): Accrual = { ...a, phase: Off }
pure def canSetRate(a: Accrual, rate: Rate, by: str): bool = a.configured and a.phase != Collecting and by == "owner"
  and rate.fromPeriod >= a.nextPeriod and a.rates.every(old => old.fromPeriod < rate.fromPeriod)
  and M::validAmount(rate.numerator) and M::positiveAmount(rate.numerator)
  and M::validAmount(rate.denominator) and M::positiveAmount(rate.denominator)
pure def setRate(a: Accrual, rate: Rate, by: str): Accrual = { ...a, rates: a.rates.append(rate) }
pure def rateFor(a: Accrual, period: int): Rate = a.rates.foldl(emptyRate,
  (selected, rate) => if (rate.fromPeriod <= period) rate else selected)
pure val byValues = Set("owner", "wrong")
pure val tokenUnitValues = Set(List(1), List(0, 0, 1))
```

### A complete immutable source snapshot is filed in ordinal-month order

A period is `year * 12 + month - 1`, so the twelve-month window works across
year boundaries. The first period is November 2026. The trusted payout adapter
provides the complete closed-month snapshot, immutable payout IDs and a digest.
A repeat or out-of-order month is refused. Source acquisition must include
ineligible rows; dropping those rows would change the published source count.

```quint
pure def validSource(a: Accrual, payouts: List[Payout], period: int): bool = payouts.every(p =>
  p.id > 0 and p.project > 0 and a.attributions.some(entry => entry.project == p.project) and p.period == period and p.firstPaidPeriod >= firstPeriod
    and p.firstPaidPeriod <= period and M::validAmount(p.gross)
    and payouts.select(other => other.id == p.id).length() == 1
    and not(a.records.some(record => record.payout.id == p.id)))
pure def canStartMonth(a: Accrual, period: int, payouts: List[Payout], sourceDigest: str,
  closed: bool, complete: bool): bool = a.phase == Ready and period == a.nextPeriod
    and closed and complete and sourceDigest != "" and validSource(a, payouts, period)
pure def startMonth(a: Accrual, period: int, payouts: List[Payout], sourceDigest: str,
  closed: bool, complete: bool): Accrual = { ...a, phase: Collecting, activePeriod: period,
    sourceDigest: sourceDigest, sourceCount: payouts.length(), startingRecordCount: a.records.length(), pending: payouts }
pure def totalAccrued(a: Accrual): M::Amount = a.records.foldl(M::zero, (sum, r) => M::addAmounts(sum, r.amount))
pure def projectAccrued(a: Accrual, project: int): M::Amount = a.records.foldl(M::zero,
  (sum, r) => M::addAmounts(sum, if (r.payout.project == project) r.amount else M::zero))
pure def actorAccrued(a: Accrual, actor: int): M::Amount = a.records.foldl(M::zero,
  (sum, r) => M::addAmounts(sum, if (r.referrer == actor) r.amount else M::zero))
pure def poolCap(a: Accrual): M::Amount = M::multiplyAmounts(a.tokenUnit, M::smallAmount(2000000))
pure def projectCap(a: Accrual): M::Amount = M::multiplyAmounts(a.tokenUnit, M::smallAmount(250000))
pure def smaller(left: M::Amount, right: M::Amount): M::Amount =
  if (M::compareAmounts(left, right) <= 0) left else right
pure def payoutEligible(a: Accrual, p: Payout): bool = p.paid and p.stablecoin
  and p.period >= firstPeriod and p.period >= p.firstPaidPeriod and p.period - p.firstPaidPeriod < 12
  and not(p.team) and not(p.banned) and not(p.held) and referrerFor(a, p.project) > 0
pure def nextAccrual(a: Accrual): Accrued =
  val p = a.pending.nthOr(0, emptyPayout)
  val rate = rateFor(a, p.period)
  val eligible = payoutEligible(a, p)
  val calculated = if (eligible) M::divideAmounts(M::multiplyAmounts(p.gross, rate.numerator), rate.denominator).quotient else M::zero
  val remaining = smaller(M::subtractAmounts(poolCap(a), totalAccrued(a)),
    M::subtractAmounts(projectCap(a), projectAccrued(a, p.project)))
  { payout: p, referrer: referrerFor(a, p.project), eligible: eligible, rate: rate, amount: smaller(calculated, remaining) }
pure def canAccrueNext(a: Accrual): bool = a.phase == Collecting and a.pending.length() > 0
pure def accrueNext(a: Accrual): Accrual =
  val entry = nextAccrual(a)
  { ...a, records: a.records.append(entry), pending: a.pending.select(p => p.id != entry.payout.id) }
pure def canFileMonth(a: Accrual): bool = a.phase == Collecting and a.pending.length() == 0
pure def fileMonth(a: Accrual): Accrual = { ...a, phase: Ready, nextPeriod: a.nextPeriod + 1,
  filings: a.filings.append({ period: a.activePeriod, sourceDigest: a.sourceDigest,
    sourceCount: a.sourceCount, recordCount: a.records.length() - a.startingRecordCount }) }
```

### Filed records, historical rates and source counts never change

The public projection includes the complete immutable record and cumulative
referrer totals. A missing wallet changes root inclusion only; it never deletes
or reallocates accrued tokens. The exact quotient rounds down to token base
units once per payout at its recorded rate.

```quint
pure def alwaysConfigured(a: Accrual): bool = a.phase != Off implies a.configured
pure def alwaysUnconfiguredEmpty(a: Accrual): bool = not(a.configured) implies
  a.phase == Off and a.records.length() == 0 and a.filings.length() == 0 and a.rates.length() == 0 and a.tokenUnit == M::zero
pure def alwaysUnitValid(a: Accrual): bool = M::validAmount(a.tokenUnit) and
  (a.configured implies M::positiveAmount(a.tokenUnit) and a.rates.length() > 0)
pure def alwaysRatesValid(a: Accrual): bool = a.rates.every(rate => rate.fromPeriod >= firstPeriod
  and M::validAmount(rate.numerator) and M::positiveAmount(rate.numerator)
  and M::validAmount(rate.denominator) and M::positiveAmount(rate.denominator))
pure def alwaysNextPeriod(a: Accrual): bool = a.nextPeriod == firstPeriod + a.filings.length()
pure def alwaysPendingUnique(a: Accrual): bool = a.pending.every(p =>
  a.pending.select(other => other.id == p.id).length() == 1 and not(a.records.some(r => r.payout.id == p.id)))
pure def alwaysCaps(a: Accrual): bool = M::compareAmounts(totalAccrued(a), poolCap(a)) <= 0
  and a.records.every(r => M::validAmount(r.amount) and M::compareAmounts(projectAccrued(a, r.payout.project), projectCap(a)) <= 0)
pure def alwaysUniquePayouts(a: Accrual): bool = a.records.every(r =>
  a.records.select(other => other.payout.id == r.payout.id).length() == 1)
pure def alwaysCompleteFilings(a: Accrual): bool = a.filings.every(f => f.sourceCount == f.recordCount)
pure def alwaysUniqueAttribution(a: Accrual): bool = a.attributions.every(entry =>
  a.attributions.select(other => other.project == entry.project).length() == 1)
pure def alwaysActiveSourceCount(a: Accrual): bool = a.phase == Collecting implies
  a.records.length() - a.startingRecordCount + a.pending.length() == a.sourceCount
pure def stepRecordsRetained(before: Accrual, after: Accrual): bool = before.records.every(r => after.records.includes(r))
pure def stepRatesRetained(before: Accrual, after: Accrual): bool = before.rates.every(r => after.rates.includes(r))
pure def stepAttributionsRetained(before: Accrual, after: Accrual): bool = before.attributions.every(r => after.attributions.includes(r))
pure def stepFilingsRetained(before: Accrual, after: Accrual): bool = before.filings.every(r => after.filings.includes(r))
pure def sometimesFiled(a: Accrual): bool = a.filings.length() > 0
pure def sometimesExcludedRecorded(a: Accrual): bool = a.records.some(r => not(r.eligible))
pure def sometimesMultiProject(a: Accrual): bool = a.records.some(r => a.records.some(other => r.payout.project != other.payout.project))
```

### Simulation distinguishes eligible, excluded and repeated payout evidence

```quint
pure val projectValues = Set(1, 2)
pure val applicantValues = Set(1, 2)
pure val stewardValues = Set(1, 2)
pure val referrerValues = Set(0, 3)
pure val periodValues = Set(firstPeriod, firstPeriod + 1)
pure val sourceDigestValues = Set("source", "")
pure val rateValues = Set({ fromPeriod: firstPeriod + 1, numerator: List(6), denominator: List(0, 0, 1) })
pure val payoutsValues = Set(List(),
  List({ id: 1, project: 1, period: firstPeriod, firstPaidPeriod: firstPeriod, gross: List(0, 0, 1), paid: true, stablecoin: true, team: false, banned: false, held: false }),
  List({ id: 1, project: 1, period: firstPeriod, firstPaidPeriod: firstPeriod, gross: List(0, 0, 1), paid: true, stablecoin: true, team: false, banned: false, held: false },
    { id: 2, project: 2, period: firstPeriod, firstPaidPeriod: firstPeriod, gross: List(0, 0, 1), paid: true, stablecoin: true, team: true, banned: false, held: false }))
```
