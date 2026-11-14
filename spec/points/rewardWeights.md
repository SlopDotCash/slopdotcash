# Reward weights from accepted-work Points

PRD sections 6 and 7: only accepted-work Points for the project and period
determine reward shares. Participation, payout recognition, usage and trace
evidence never change a payment share. A penalty debit affects only that UTC
month's accepted-work Points of its author in that project and never reduces
them below zero. Payout exclusions apply prospectively to owners, funded
employees and related parties, and an excluded weight never reduces another
contributor's share. A ban never erases a funded award.

This machine derives one project's monthly weights from the [Points
journal](./journal.md) and keeps them fixed once the month is frozen. It
follows `src/lib/points.ts` (`reconcilePointPenalties`, bucket
`actor/project/month`), `src/lib/verified-aggregation.ts`
(`consumeBuckets`), `src/lib/payout-exclusions.mjs` and the D1 table
`monthly_payment_exclusions`. The exclusion list comes from the immutable
project revision ([project registry](../backend/projects.md)); the ban comes
from the verified enforcement record; the freeze comes from [monthly
settlement](../settlement/monthly.md), which must propose exactly these
weights.

## Story: Derive each month's reward weights from accepted work only

### Penalty requests consume a month's accepted-work credit in recorded order

The penalty journal orders unreversed requests by occurrence time and then
work unit. Each request takes at most what remains. A zero balance spends
nothing. The applied debits never exceed the credit.

```quint
import journal as J from "./journal"
type Consumption = { remaining: int, applied: List[int] }
pure def takeFrom(remaining: int, request: int): int =
  if (request <= 0) 0 else if (request > remaining) remaining else request
pure def consumeStep(acc: Consumption, request: int): Consumption =
  { remaining: acc.remaining - takeFrom(acc.remaining, request), applied: acc.applied.append(takeFrom(acc.remaining, request)) }
pure def consume(credit: int, requests: List[int]): List[int] =
  requests.foldl({ remaining: if (credit > 0) credit else 0, applied: List() }, (acc, request) => consumeStep(acc, request)).applied
pure def total(xs: List[int]): int = xs.foldl(0, (acc, x) => acc + x)
pure def lawEarlierRequestConsumesFirst(credit: int, first: int, second: int): bool =
  (credit >= 0 and first >= 0 and second >= 0 and first >= credit) implies
    consume(credit, List(first, second)) == List(credit, 0)
pure def lawZeroBalanceSpendsNothing(first: int, second: int): bool =
  consume(0, List(first, second)) == List(0, 0)
pure def lawEnoughCreditAppliesAll(credit: int, first: int, second: int): bool =
  (first >= 0 and second >= 0 and credit >= first + second) implies
    consume(credit, List(first, second)) == List(first, second)
pure def lawTwoRequestsBounded(credit: int, first: int, second: int): bool =
  total(consume(credit, List(first, second))) <= (if (credit > 0) credit else 0)
pure val creditValues = Set(0, 10, 30, 40)
pure val firstValues = Set(0, 10, 30, 240)
pure val secondValues = Set(0, 10, 30)
```

### A month's net weight is its accepted-work credit less its applied debits

Evidence, payout recognition and participation are not accepted work, so
they never reach a weight. An actor appears once per month's book.

```quint
type Entry = { actor: int, credit: int, debit: int }
type PointWeight = { actor: int, weight: int }
pure def netWeight(e: Entry): int = if (e.debit >= e.credit) 0 else e.credit - e.debit
pure def entryFor(l: J::Ledger, project: str, period: int, actor: int): Entry =
  { actor: actor, credit: J::acceptedWorkCredit(l, project, actor, period), debit: J::penaltyDebit(l, project, actor, period) }
pure def book(l: J::Ledger, project: str, period: int, actors: List[int]): List[Entry] =
  actors.listMap(actor => entryFor(l, project, period, actor))
pure def lawNotAcceptedWork(cat: J::Category): bool =
  (cat == J::PayoutReceived or cat == J::Evidence or cat == J::Penalty) implies not(J::acceptedWork(cat))
pure def lawNetNeverNegative(e: Entry): bool = netWeight(e) >= 0
pure def lawDebitNeverRaises(e: Entry, extra: int): bool =
  extra >= 0 implies netWeight({ ...e, debit: e.debit + extra }) <= netWeight(e)
pure val eValues = Set({ actor: 1, credit: 30, debit: 0 }, { actor: 2, credit: 30, debit: 240 }, { actor: 3, credit: 0, debit: 0 })
pure val extraValues = Set(0, 10, 240)
pure val catValues = Set(J::MergedWork, J::Review, J::Evaluated, J::Evidence, J::PayoutReceived, J::Penalty)
```

### Payout exclusions cover whole months and leave every other weight unchanged

An exclusion names one immutable GitHub actor and the months from its first
month up to, but not including, its end month (0 means open-ended). Entries
for one actor never overlap. For November 2026 the lists of `slopdotcash`,
`eliza`, `thenetwork` and `asi` are empty (PRD section 7). A ban removes the
weight of an unfrozen month only.

```quint
type Relationship = Owner | FundedEmployee | RelatedParty
type Exclusion = { actor: int, relationship: Relationship, fromPeriod: int, untilPeriod: int }
pure val novemberEmptyProjects = Set("slopdotcash", "eliza", "thenetwork", "asi")
pure def covers(x: Exclusion, period: int): bool =
  x.fromPeriod <= period and (x.untilPeriod == 0 or period < x.untilPeriod)
pure def effectiveExclusions(project: str, period: int, exclusions: List[Exclusion]): List[Exclusion] =
  if (period == J::november2026 and novemberEmptyProjects.contains(project)) List() else exclusions
pure def excluded(project: str, period: int, exclusions: List[Exclusion], actor: int): bool =
  effectiveExclusions(project, period, exclusions).some(x => x.actor == actor and covers(x, period))
pure def counted(project: str, period: int, exclusions: List[Exclusion], banned: Set[int], e: Entry): bool =
  netWeight(e) > 0 and not(excluded(project, period, exclusions, e.actor)) and not(banned.contains(e.actor))
pure def weightsFrom(project: str, period: int, entries: List[Entry], exclusions: List[Exclusion], banned: Set[int]): List[PointWeight] =
  entries.select(e => counted(project, period, exclusions, banned, e)).listMap(e => { actor: e.actor, weight: netWeight(e) })
pure def overlaps(a: Exclusion, b: Exclusion): bool =
  a.actor == b.actor and (b.untilPeriod == 0 or a.fromPeriod < b.untilPeriod) and (a.untilPeriod == 0 or b.fromPeriod < a.untilPeriod)
pure def lawNovemberListsEmpty(project: str, actor: int): bool =
  novemberEmptyProjects.contains(project) implies
    not(excluded(project, J::november2026, List({ actor: actor, relationship: Owner, fromPeriod: J::november2026, untilPeriod: 0 }), actor))
pure val projectValues = Set("p", "slopdotcash")
```

### One month's weights follow the journal until settlement freezes them

The prospective rule forbids any change to who is excluded, or why, in the
open month or earlier. A new or changed exclusion starts with a later month.
Once frozen, the month's weights never change: later credits, penalties,
appeals, exclusions and bans affect Points standings only.

```quint
type WeightsPhase = Live | Fixed
type MonthlyWeights = { project: str, period: int, openPeriod: int, phase: WeightsPhase,
  exclusions: List[Exclusion], entries: List[Entry], banned: Set[int], snapshot: List[PointWeight] }
pure val initial: MonthlyWeights = { project: "p", period: 24323, openPeriod: 24322, phase: Live,
  exclusions: List(), entries: List(), banned: Set(), snapshot: List() }
pure def weights(s: MonthlyWeights): List[PointWeight] =
  if (s.phase == Fixed) s.snapshot else weightsFrom(s.project, s.period, s.entries, s.exclusions, s.banned)
pure def distinctActors(actors: List[int]): bool =
  actors.every(a => a > 0 and actors.select(o => o == a).length() == 1)
pure def canObserve(s: MonthlyWeights, l: J::Ledger, actors: List[int]): bool = distinctActors(actors)
pure def observe(s: MonthlyWeights, l: J::Ledger, actors: List[int]): MonthlyWeights =
  { ...s, entries: book(l, s.project, s.period, actors) }
pure def canAppendExclusion(s: MonthlyWeights, x: Exclusion): bool =
  x.actor > 0 and x.fromPeriod > s.openPeriod and (x.untilPeriod == 0 or x.untilPeriod > x.fromPeriod) and
  not(s.exclusions.some(o => overlaps(o, x)))
pure def appendExclusion(s: MonthlyWeights, x: Exclusion): MonthlyWeights = { ...s, exclusions: s.exclusions.append(x) }
pure def canEndExclusion(s: MonthlyWeights, x: Exclusion, untilPeriod: int): bool =
  s.exclusions.includes(x) and untilPeriod > s.openPeriod and untilPeriod > x.fromPeriod and
  (x.untilPeriod == 0 or x.untilPeriod > s.openPeriod)
pure def endExclusion(s: MonthlyWeights, x: Exclusion, untilPeriod: int): MonthlyWeights =
  { ...s, exclusions: s.exclusions.listMap(o => if (o == x) { ...o, untilPeriod: untilPeriod } else o) }
pure def canAdvanceMonth(s: MonthlyWeights, period: int): bool = period > s.openPeriod
pure def advanceMonth(s: MonthlyWeights, period: int): MonthlyWeights = { ...s, openPeriod: period }
pure def canObserveBan(s: MonthlyWeights, actor: int): bool = actor > 0 and not(s.banned.contains(actor))
pure def observeBan(s: MonthlyWeights, actor: int): MonthlyWeights = { ...s, banned: s.banned.union(Set(actor)) }
pure def canFreeze(s: MonthlyWeights, f: J::FreezeEvidence): bool =
  s.phase == Live and f.project == s.project and f.period == s.period and s.openPeriod > s.period and
  (f.phase == J::Frozen or f.phase == J::Reserved or f.phase == J::Completed or f.obligationExists)
pure def freeze(s: MonthlyWeights, f: J::FreezeEvidence): MonthlyWeights =
  { ...s, phase: Fixed, snapshot: weights(s) }
pure def alwaysWeightsPositive(s: MonthlyWeights): bool = weights(s).every(w => w.actor > 0 and w.weight > 0)
pure def alwaysEntryActorsPositive(s: MonthlyWeights): bool = s.entries.every(e => e.actor > 0)
pure def stepFixedWeightsStable(before: MonthlyWeights, after: MonthlyWeights): bool =
  before.phase == Fixed implies (after.phase == Fixed and after.snapshot == before.snapshot)
pure def stepExclusionsProspective(before: MonthlyWeights, after: MonthlyWeights): bool =
  before.period <= before.openPeriod implies
    after.entries.every(e => excluded(before.project, before.period, before.exclusions, e.actor) ==
      excluded(after.project, after.period, after.exclusions, e.actor))
pure def stepIdentityStable(before: MonthlyWeights, after: MonthlyWeights): bool =
  after.project == before.project and after.period == before.period and after.openPeriod >= before.openPeriod
```

### Witnesses show exclusion, penalty netting, frozen stability and bans

```quint
pure def sometimesExcludedActorRemoved(s: MonthlyWeights): bool =
  s.entries.some(e => netWeight(e) > 0 and excluded(s.project, s.period, s.exclusions, e.actor)) and
  s.entries.some(e => counted(s.project, s.period, s.exclusions, s.banned, e))
pure def sometimesPenaltyNetted(s: MonthlyWeights): bool = s.entries.some(e => e.debit > 0 and netWeight(e) > 0)
pure def sometimesFixed(s: MonthlyWeights): bool = s.phase == Fixed and s.snapshot.length() > 0
pure def sometimesLaterChangeKeepsFixedWeights(s: MonthlyWeights): bool =
  s.phase == Fixed and weightsFrom(s.project, s.period, s.entries, s.exclusions, s.banned) != s.snapshot
pure val keyOne: J::AwardKey = { project: "p", actor: 1, category: J::MergedWork, source: 1, workUnit: 1 }
pure val keyTwo: J::AwardKey = { project: "p", actor: 2, category: J::MergedWork, source: 2, workUnit: 2 }
pure val keyDebit: J::AwardKey = { project: "p", actor: 2, category: J::Penalty, source: 3, workUnit: 3 }
pure def revisionOf(id: int, key: J::AwardKey, amount: int): J::Revision =
  { ...J::noRevision, id: id, key: key, amount: amount, occurredAt: 2432305, recordedAt: 2432306,
    rule: if (key.category == J::Penalty) J::PenaltyTable else J::ValueV1, sourceDigest: "d",
    tableVersion: if (key.category == J::Penalty) 1 else 0 }
pure val ledgerOne: J::Ledger = { ...J::initial, now: 2432306, nextId: 4,
  revisions: List(revisionOf(1, keyOne, 30), revisionOf(2, keyTwo, 90), revisionOf(3, keyDebit, -30)) }
pure val lValues = Set(J::initial, ledgerOne)
pure val actorsValues = Set(List(1, 2), List(1), List())
pure val xValues = Set({ actor: 1, relationship: Owner, fromPeriod: 24323, untilPeriod: 0 },
  { actor: 2, relationship: FundedEmployee, fromPeriod: 24322, untilPeriod: 0 },
  { actor: 1, relationship: RelatedParty, fromPeriod: 24323, untilPeriod: 24325 })
pure val periodValues = Set(24322, 24323, 24324)
pure val untilPeriodValues = Set(24324, 24326)
pure val actorValues = Set(0, 1, 2)
pure val fValues = Set({ project: "p", period: 24323, phase: J::Frozen, obligationExists: false },
  { project: "p", period: 24323, phase: J::Proposed, obligationExists: false })
```
