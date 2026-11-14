# Referral attribution and monthly accrual

PRD section 11 governs this deferred program. Accrual starts off. A reviewed
reactivation may enable dry-run filings, which never post a root. The ledger
records all source payouts, including exclusions, and preserves every filed
rate. Token amounts use the exact Amount library. `tokenUnit` is the verified
number of base units in one program token; no token-decimal convention is
assumed. Stablecoin gross inputs use integer micro-units. A source payout ID is an
opaque immutable handle bound to its exact obligation ID by the retained
source snapshot; it is not used as a numeric sorting key.

## Story: Retain the submitting maintainer's referral choice

### A project captures an eligible signed-in referrer once

The application adapter verifies current immutable actor identities and roles.
An omitted referrer is zero and cannot be filled in later. Capture cannot name
the submitting maintainer, project steward, administrator or moderator.

```quint
import money as M from "./money"
type Attribution = { project: int, applicant: int, steward: int, referrer: int }
type Rate = { fromPeriod: int, numerator: M::Amount, denominator: M::Amount }
type CalendarDate = { year: int, month: int, day: int, millis: int }
pure def leapYear(year: int): bool = year % 400 == 0 or (year % 4 == 0 and year % 100 != 0)
pure def monthDays(year: int, month: int): int = if (month == 2) (if (leapYear(year)) 29 else 28)
  else if (Set(4, 6, 9, 11).contains(month)) 30 else 31
pure def validDate(date: CalendarDate): bool = date.year >= 1 and date.month >= 1 and date.month <= 12
  and date.day >= 1 and date.day <= monthDays(date.year, date.month) and date.millis >= 0 and date.millis < 86400000
pure def beforeDate(earlierDate: CalendarDate, laterDate: CalendarDate): bool = earlierDate.year < laterDate.year
  or (earlierDate.year == laterDate.year and (earlierDate.month < laterDate.month or (earlierDate.month == laterDate.month
    and (earlierDate.day < laterDate.day or (earlierDate.day == laterDate.day and earlierDate.millis < laterDate.millis)))))
pure def windowEnd(first: CalendarDate): CalendarDate =
  { ...first, year: first.year + 1, day: if (first.day > monthDays(first.year + 1, first.month)) monthDays(first.year + 1, first.month) else first.day }
type Payout = { id: int, project: int, period: int, paidAt: CalendarDate, firstPaidAt: CalendarDate, gross: M::Amount,
  paid: bool, stablecoin: bool, team: bool, banned: bool, held: bool }
type AccrualOutcome = Accrued | ProjectCap | PoolCap | WindowClosed | Held | ReferrerExcluded | AssetNotEligible
type AccrualRecord = { payout: Payout, referrer: int, eligible: bool, rate: Rate, computed: M::Amount, amount: M::Amount, outcome: AccrualOutcome }
type Wallet = { actor: int, wallet: str, authorized: bool }
type RootEntry = { actor: int, wallet: str, amount: M::Amount }
type Filing = { period: int, sourceDigest: str, sourceCount: int, recordCount: int, entries: List[RootEntry], total: M::Amount }
pure val emptyFiling: Filing = { period: 0, sourceDigest: "", sourceCount: 0, recordCount: 0, entries: List(), total: M::zero }
type AccrualPhase = Off | Ready | Collecting
type Accrual = { phase: AccrualPhase, configured: bool, tokenUnit: M::Amount,
  attributions: List[Attribution], rates: List[Rate], records: List[AccrualRecord], staged: List[AccrualRecord], filings: List[Filing], pins: List[Wallet],
  nextPeriod: int, activePeriod: int, sourceDigest: str, sourceCount: int,
  leaseRun: str, pending: List[Payout] }
pure val firstPeriod = 2026 * 12 + 10
pure val emptyRate: Rate = { fromPeriod: firstPeriod, numerator: M::zero, denominator: List(1) }
pure val emptyPayout: Payout = { id: 0, project: 0, period: 0, paidAt: { year: 1, month: 1, day: 1, millis: 0 }, firstPaidAt: { year: 1, month: 1, day: 1, millis: 0 },
  gross: M::zero, paid: false, stablecoin: false, team: true, banned: true, held: true }
pure val initial: Accrual = { phase: Off, configured: false, tokenUnit: M::zero,
  attributions: List(), rates: List(), records: List(), staged: List(), filings: List(), pins: List(), nextPeriod: firstPeriod,
  activePeriod: 0, sourceDigest: "", sourceCount: 0, leaseRun: "", pending: List() }
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
    and M::equalAmounts(M::divideAmounts(M::multiplySmall(tokenUnit, 3), List(0, 0, 1)).remainder, M::zero)
pure def configure(a: Accrual, tokenUnit: M::Amount, verified: bool, by: str): Accrual =
  { ...a, configured: true, tokenUnit: tokenUnit,
    rates: List({ fromPeriod: firstPeriod, numerator: M::divideAmounts(M::multiplySmall(tokenUnit, 3), List(0, 0, 1)).quotient, denominator: List(1) }) }
pure def canEnableDryRun(a: Accrual, reactivationApproved: bool, by: str): bool =
  a.phase == Off and a.configured and reactivationApproved and by == "owner"
pure def enableDryRun(a: Accrual, reactivationApproved: bool, by: str): Accrual = { ...a, phase: Ready }
pure def canDisable(a: Accrual, by: str): bool = a.phase == Ready and by == "owner"
pure def disable(a: Accrual, by: str): Accrual = { ...a, phase: Off }
pure def canSetRate(a: Accrual, rate: Rate, by: str): bool = a.configured and a.phase != Collecting and by == "owner"
  and rate.fromPeriod >= a.nextPeriod and a.rates.every(old => old.fromPeriod < rate.fromPeriod)
  and M::validAmount(rate.numerator) and M::positiveAmount(rate.numerator)
  and M::validAmount(rate.denominator) and M::equalAmounts(rate.denominator, List(1))
pure def setRate(a: Accrual, rate: Rate, by: str): Accrual = { ...a, rates: a.rates.append(rate) }
pure def rateFor(a: Accrual, period: int): Rate = a.rates.foldl(emptyRate,
  (selected, rate) => if (rate.fromPeriod <= period) rate else selected)
pure val byValues = Set("owner", "wrong")
pure val tokenUnitValues = Set(List(0, 0, 1))
```

### A complete immutable source snapshot is filed in ordinal-month order

A filing period is `year * 12 + month - 1`. Eligibility ends at the first
paid timestamp's twelve-calendar-month anniversary, clamping an unavailable
day to the last day of that month and preserving the time of day. It does
not end at a month-number boundary. The first filing period is November 2026.
The source adapter freezes the per-project hold and first-paid evidence and
per-referrer ban evidence for the run, as the original judge caches them.
The source adapter orders the snapshot by paid-observation timestamp and then
by the exact obligation ID, matching pinned `workers/referral-accrual/store.ts`
lines 118–136. It verifies that canonical order before dispatching
`startMonth`; callers cannot assert the order flag themselves. The trusted payout adapter
provides the complete closed-month snapshot, immutable payout IDs and a digest.
A repeat or out-of-order month is refused. Source acquisition must include
ineligible rows; dropping those rows would change the published source count.

```quint
pure def validSource(a: Accrual, payouts: List[Payout], period: int): bool = payouts.every(p =>
  p.id > 0 and p.project > 0 and p.paid and referrerFor(a, p.project) > 0 and a.attributions.some(entry => entry.project == p.project) and p.period == period and validDate(p.paidAt) and validDate(p.firstPaidAt)
    and p.paidAt.year * 12 + p.paidAt.month - 1 == period and not(beforeDate(p.paidAt, p.firstPaidAt))
    and M::validAmount(p.gross)
    and payouts.select(other => other.id == p.id).length() == 1
    and not(allRecords(a).some(record => record.payout.id == p.id)))
pure def canStartMonth(a: Accrual, period: int, payouts: List[Payout], sourceDigest: str,
  closed: bool, complete: bool, canonicalOrder: bool, leaseId: str, leaseCurrent: bool): bool = a.phase == Ready and period == a.nextPeriod
    and closed and complete and canonicalOrder and leaseId != "" and leaseCurrent and sourceDigest != "" and validSource(a, payouts, period)
pure def startMonth(a: Accrual, period: int, payouts: List[Payout], sourceDigest: str,
  closed: bool, complete: bool, canonicalOrder: bool, leaseId: str, leaseCurrent: bool): Accrual = { ...a, phase: Collecting, activePeriod: period,
    sourceDigest: sourceDigest, sourceCount: payouts.length(), leaseRun: leaseId, staged: List(), pending: payouts }
pure def allRecords(a: Accrual): List[AccrualRecord] = a.records.concat(a.staged)
pure def totalAccrued(a: Accrual): M::Amount = allRecords(a).foldl(M::zero, (sum, r) => M::addAmounts(sum, r.amount))
pure def projectAccrued(a: Accrual, project: int): M::Amount = allRecords(a).foldl(M::zero,
  (sum, r) => M::addAmounts(sum, if (r.payout.project == project) r.amount else M::zero))
pure def actorAccrued(a: Accrual, actor: int): M::Amount = allRecords(a).foldl(M::zero,
  (sum, r) => M::addAmounts(sum, if (r.referrer == actor) r.amount else M::zero))
pure def poolCap(a: Accrual): M::Amount = M::multiplyAmounts(a.tokenUnit, M::smallAmount(2000000))
pure def projectCap(a: Accrual): M::Amount = M::multiplyAmounts(a.tokenUnit, M::smallAmount(250000))
pure def smaller(left: M::Amount, right: M::Amount): M::Amount =
  if (M::compareAmounts(left, right) <= 0) left else right
pure def payoutEligible(a: Accrual, p: Payout): bool = p.paid and p.stablecoin
  and p.period >= firstPeriod and beforeDate(p.paidAt, windowEnd(p.firstPaidAt))
  and not(p.team) and not(p.banned) and not(p.held) and referrerFor(a, p.project) > 0
pure def nextAccrual(a: Accrual): AccrualRecord =
  val p = a.pending.nthOr(0, emptyPayout)
  val rate = rateFor(a, p.period)
  val eligible = payoutEligible(a, p)
  val calculated = if (eligible) M::multiplyAmounts(p.gross, rate.numerator) else M::zero
  val remaining = smaller(M::subtractAmounts(poolCap(a), totalAccrued(a)),
    M::subtractAmounts(projectCap(a), projectAccrued(a, p.project)))
  val amount = smaller(calculated, remaining)
  val accrualOutcome = if (not(p.stablecoin)) AssetNotEligible
    else if (p.team or p.banned or referrerFor(a, p.project) == 0) ReferrerExcluded
    else if (p.held) Held
    else if (not(beforeDate(p.paidAt, windowEnd(p.firstPaidAt)))) WindowClosed
    else if (M::equalAmounts(amount, calculated)) Accrued
    else if (M::equalAmounts(amount, M::subtractAmounts(projectCap(a), projectAccrued(a, p.project)))) ProjectCap
    else PoolCap
  { payout: p, referrer: referrerFor(a, p.project), eligible: eligible, rate: rate, computed: calculated, amount: amount, outcome: accrualOutcome }
pure def canAccrueNext(a: Accrual): bool = a.phase == Collecting and a.pending.length() > 0
pure def accrueNext(a: Accrual): Accrual =
  val entry = nextAccrual(a)
  { ...a, staged: a.staged.append(entry), pending: a.pending.select(p => p.id != entry.payout.id) }
pure def walletFor(wallets: List[Wallet], actor: int): str = wallets.foldl("",
  (found, w) => if (w.actor == actor and w.authorized) w.wallet else found)
pure def pinnedWallet(pins: List[Wallet], actor: int): str = pins.foldl("",
  (found, pin) => if (pin.actor == actor) pin.wallet else found)
pure def actors(a: Accrual): List[int] = a.attributions.foldl(List(),
  (found, entry) => if (entry.referrer > 0 and not(found.includes(entry.referrer)))
    found.select(actor => actor < entry.referrer).concat(List(entry.referrer)).concat(found.select(actor => actor > entry.referrer)) else found)
pure def eligibleWallet(a: Accrual, wallets: List[Wallet], actor: int): str =
  val pinned = pinnedWallet(a.pins, actor)
  val candidateWallet = walletFor(wallets, actor)
  if (pinned != "") pinned
  else if (candidateWallet != "" and not(a.pins.some(pin => pin.wallet == candidateWallet))
    and not(actors(a).some(other => other < actor and pinnedWallet(a.pins, other) == ""
      and walletFor(wallets, other) == candidateWallet and M::positiveAmount(actorAccrued(a, other))))) candidateWallet else ""
pure def rootEntries(a: Accrual, wallets: List[Wallet]): List[RootEntry] =
  actors(a).select(actor => eligibleWallet(a, wallets, actor) != "" and M::positiveAmount(actorAccrued(a, actor)))
    .listMap(actor => { actor: actor, wallet: eligibleWallet(a, wallets, actor), amount: actorAccrued(a, actor) })
pure def entriesTotal(entries: List[RootEntry]): M::Amount = entries.foldl(M::zero, (total, e) => M::addAmounts(total, e.amount))
pure def canFileMonth(a: Accrual, wallets: List[Wallet], leaseId: str, leaseCurrent: bool): bool =
  a.phase == Collecting and a.pending.length() == 0 and leaseId == a.leaseRun and leaseId != "" and leaseCurrent
    and wallets.every(w => w.actor > 0 and wallets.select(other => other.actor == w.actor).length() == 1)
pure def fileMonth(a: Accrual, wallets: List[Wallet], leaseId: str, leaseCurrent: bool): Accrual =
  val entries = rootEntries(a, wallets)
  { ...a, phase: Ready, nextPeriod: a.nextPeriod + 1, records: a.records.concat(a.staged), staged: List(), leaseRun: "",
    pins: a.pins.concat(entries.select(e => pinnedWallet(a.pins, e.actor) == "")
      .listMap(e => { actor: e.actor, wallet: e.wallet, authorized: true })),
    filings: a.filings.append({ period: a.activePeriod, sourceDigest: a.sourceDigest,
      sourceCount: a.sourceCount, recordCount: a.staged.length(), entries: entries, total: entriesTotal(entries) }) }
pure def canAbandonMonth(a: Accrual, leaseId: str, leaseCurrent: bool): bool = a.phase == Collecting
  and leaseId == a.leaseRun and not(leaseCurrent)
pure def abandonMonth(a: Accrual, leaseId: str, leaseCurrent: bool): Accrual =
  { ...a, phase: Ready, staged: List(), pending: List(), leaseRun: "" }

```

### Filed records, first-use wallet pins and exact roots commit atomically

A missing, expired or replaced D1 lease refuses filing. Unfiled rows are
private staging state; abandoning a lost lease discards them and leaves every
prior record and pin unchanged. The matching lease commits the staged rows,
exact file entries and first-use wallet pins as one atomic operation, including
in dry-run mode. This follows `workers/referral-accrual/store.ts:258–306`.
The public projection includes the complete immutable record and cumulative
referrer totals. A missing wallet changes root inclusion only; it never deletes
or reallocates accrued tokens. Discovered by the proof: the empty wallet used for
a missing pin could satisfy the historical entry check and then invalidate an
old file when the actor gained a real pin. Every filed entry has a nonempty
wallet matching a retained pin. The recorded rate is an integer number of token base units per stablecoin
micro-unit. Multiplication is exact; no per-payout rounding occurs. This
matches pinned `workers/referral-accrual/core.ts:365` and `config.ts:73–80`.
The approved initial rate is three tokens per USDC; configuration refuses a
token unit that cannot express that rate exactly.

```quint
pure def alwaysConfigured(a: Accrual): bool = a.phase != Off implies a.configured
pure def alwaysUnconfiguredEmpty(a: Accrual): bool = not(a.configured) implies
  a.phase == Off and a.records.length() == 0 and a.staged.length() == 0 and a.pins.length() == 0 and a.filings.length() == 0 and a.rates.length() == 0 and a.tokenUnit == M::zero
pure def alwaysUnitValid(a: Accrual): bool = M::validAmount(a.tokenUnit) and
  (a.configured implies M::positiveAmount(a.tokenUnit) and a.rates.length() > 0)
pure def alwaysRatesValid(a: Accrual): bool = a.rates.every(rate => rate.fromPeriod >= firstPeriod
  and M::validAmount(rate.numerator) and M::positiveAmount(rate.numerator)
  and M::validAmount(rate.denominator) and M::equalAmounts(rate.denominator, List(1)))
pure def alwaysNextPeriod(a: Accrual): bool = a.nextPeriod == firstPeriod + a.filings.length()
pure def alwaysPendingUnique(a: Accrual): bool = a.pending.every(p =>
  a.pending.select(other => other.id == p.id).length() == 1 and not(allRecords(a).some(r => r.payout.id == p.id)))
pure def alwaysCaps(a: Accrual): bool = M::compareAmounts(totalAccrued(a), poolCap(a)) <= 0
  and allRecords(a).every(r => M::validAmount(r.amount) and M::compareAmounts(projectAccrued(a, r.payout.project), projectCap(a)) <= 0)
pure def alwaysUniquePayouts(a: Accrual): bool = allRecords(a).every(r =>
  allRecords(a).select(other => other.payout.id == r.payout.id).length() == 1)
pure def alwaysCompleteFilings(a: Accrual): bool = a.filings.every(f => f.sourceCount == f.recordCount)
pure def alwaysUniqueAttribution(a: Accrual): bool = a.attributions.every(entry =>
  a.attributions.select(other => other.project == entry.project).length() == 1)
pure def alwaysActiveSourceCount(a: Accrual): bool = a.phase == Collecting implies
  a.staged.length() + a.pending.length() == a.sourceCount
pure def alwaysCollectingHeader(a: Accrual): bool = a.phase == Collecting implies
  a.sourceDigest != "" and a.leaseRun != "" and a.activePeriod == a.nextPeriod
pure def alwaysFileTotals(a: Accrual): bool = a.filings.every(file => M::validAmount(file.total)
  and M::equalAmounts(file.total, entriesTotal(file.entries)))
pure def alwaysStagedPrivate(a: Accrual): bool = a.phase != Collecting implies a.staged.length() == 0
pure def alwaysPinsUnique(a: Accrual): bool = a.pins.every(pin => pin.wallet != "" and
  a.pins.select(other => other.actor == pin.actor).length() == 1 and a.pins.select(other => other.wallet == pin.wallet).length() == 1)
pure def entryWalletPinned(pins: List[Wallet], entry: RootEntry): bool =
  entry.wallet != "" and entry.wallet == pinnedWallet(pins, entry.actor)
pure def alwaysFileWalletPinned(a: Accrual): bool = a.filings.every(file => file.entries.every(e => entryWalletPinned(a.pins, e)))
pure def stepPinsRetained(before: Accrual, after: Accrual): bool = before.pins.every(pin => after.pins.includes(pin))
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
pure val dateValues = Set({ year: 2028, month: 2, day: 29, millis: 0 }, { year: 2029, month: 2, day: 28, millis: 0 })
pure val firstValues = dateValues
pure val earlierDateValues = dateValues
pure val laterDateValues = dateValues
pure val yearValues = Set(2028, 2029)
pure val monthValues = Set(2, 11)
pure val leaseIdValues = Set("leaseId", "wrong")
pure val walletsValues = Set(List({ actor: 3, wallet: "wallet", authorized: true }), List())
pure val projectValues = Set(1, 2)
pure val applicantValues = Set(1, 2)
pure val stewardValues = Set(1, 2)
pure val referrerValues = Set(0, 3)
pure val periodValues = Set(firstPeriod, firstPeriod + 1)
pure val sourceDigestValues = Set("source", "")
pure val rateValues = Set({ fromPeriod: firstPeriod + 1, numerator: List(6), denominator: List(1) })
pure val payoutsValues = Set(List(),
  List({ id: 1, project: 1, period: firstPeriod, paidAt: { year: 2026, month: 11, day: 1, millis: 0 }, firstPaidAt: { year: 2026, month: 11, day: 1, millis: 0 }, gross: List(0, 0, 1), paid: true, stablecoin: true, team: false, banned: false, held: false }),
  List({ id: 1, project: 1, period: firstPeriod, paidAt: { year: 2026, month: 11, day: 1, millis: 0 }, firstPaidAt: { year: 2026, month: 11, day: 1, millis: 0 }, gross: List(0, 0, 1), paid: true, stablecoin: true, team: false, banned: false, held: false },
    { id: 2, project: 2, period: firstPeriod, paidAt: { year: 2026, month: 11, day: 1, millis: 0 }, firstPaidAt: { year: 2026, month: 11, day: 1, millis: 0 }, gross: List(0, 0, 1), paid: true, stablecoin: true, team: true, banned: false, held: false }))
// These weights prioritize complete paths; all invalid values remain in the input sets.
pure val weight_capture = 20
pure val weight_configure = 15
pure val weight_enableDryRun = 15
pure val weight_startMonth = 25
pure val weight_accrueNext = 30
pure val weight_fileMonth = 30
```
