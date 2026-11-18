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
(`consumeBuckets`), `src/lib/payout-exclusions.mjs`, the D1 table
`monthly_payment_exclusions` and the ban rule of
`migrations/0071_monthly_ban_exclusions.sql`. The exclusion list comes from
the immutable project revision ([project registry](../backend/projects.md),
composition obligation C4); the ban comes from the verified enforcement
record; the freeze comes from [monthly settlement](../settlement/monthly.md)
through [periods](./periods.md). That settlement proposes exactly these
weights and creates no unfunded obligation for a banned recipient is
composition obligation C1, not a property this machine proves.

## Story: Derive each month's reward weights from accepted work only

### Penalty requests consume a month's accepted-work credit in recorded order

The penalty journal orders unreversed requests by occurrence time and then
work unit. Each request takes at most what remains. A zero balance spends
nothing. The applied debits never exceed the credit. Their total is the
smaller of the credit and the requests, which is the journal's
`penaltyDebit`; the journal recomputes it from the current credit, so a
later credit in the month is debited by an earlier request.

```quint
import journal as J from "./journal"
import periods as P from "./periods"
import allocation as A from "./allocation"
import workUnits as W from "./workUnits"
import evaluations as E from "./evaluations"
type Consumption = { remaining: int, applied: List[int] }
pure def takeFrom(remaining: int, request: int): int =
  if (request <= 0) 0 else if (request > remaining) remaining else request
pure def consumeStep(acc: Consumption, request: int): Consumption =
  { remaining: acc.remaining - takeFrom(acc.remaining, request), applied: acc.applied.append(takeFrom(acc.remaining, request)) }
pure def consume(credit: int, requests: List[int]): List[int] =
  requests.foldl({ remaining: if (credit > 0) credit else 0, applied: List() }, (acc, request) => consumeStep(acc, request)).applied
pure def pair(first: int, second: int): List[int] = List(first, second)
pure def total(xs: List[int]): int = xs.foldl(0, (acc, x) => acc + x)
pure def lawEarlierRequestConsumesFirst(credit: int, first: int, second: int): bool =
  (credit >= 0 and first >= 0 and second >= 0 and first >= credit) implies
    consume(credit, List(first, second)) == pair(credit, 0)
pure def lawZeroBalanceSpendsNothing(first: int, second: int): bool =
  consume(0, List(first, second)) == pair(0, 0)
pure def lawEnoughCreditAppliesAll(credit: int, first: int, second: int): bool =
  (first >= 0 and second >= 0 and credit >= first + second) implies
    consume(credit, List(first, second)) == pair(first, second)
pure def lawTwoRequestsBounded(credit: int, first: int, second: int): bool =
  total(consume(credit, List(first, second))) <= (if (credit > 0) credit else 0)
pure def lawJournalDebitMatchesConsumption(credit: int, first: int, second: int): bool =
  (first >= 0 and second >= 0) implies total(consume(credit, List(first, second))) == J::boundedDebit(credit, first + second)
pure val creditValues = Set(0, 10, 30, 40)
pure val firstValues = Set(0, 10, 30, 240)
pure val secondValues = Set(0, 10, 30)
```

### A month's net weight is its accepted-work credit less its applied debits

Evidence, payout recognition and participation are not accepted work, so
they never reach a weight. The book lists every actor the journal credits or
debits in the project and month, each once, so no credited actor can be left
out.

```quint
type Entry = { actor: int, credit: int, debit: int }
type PointWeight = { actor: int, weight: int }
pure def netWeight(e: Entry): int = if (e.debit >= e.credit) 0 else e.credit - e.debit
pure def entryFor(l: J::Ledger, project: str, period: int, actor: int): Entry =
  { actor: actor, credit: J::acceptedWorkCredit(l, project, actor, period), debit: J::penaltyDebit(l, project, actor, period) }
pure def addActor(xs: List[int], actor: int): List[int] = if (actor <= 0 or xs.includes(actor)) xs else xs.append(actor)
pure def revisionActors(xs: List[int], r: J::Revision): List[int] =
  if (r.key.category == J::MergedWork) r.shares.foldl(xs, (acc, s) => addActor(acc, s.actor)) else addActor(xs, r.key.actor)
pure def actorsIn(l: J::Ledger, project: str, period: int): List[int] =
  l.revisions.foldl(List(), (acc, r) => if (r.key.project == project and P::periodOf(r.occurredAt) == period and
    (J::acceptedWork(r.key.category) or r.key.category == J::Penalty)) revisionActors(acc, r) else acc)
pure def book(l: J::Ledger, project: str, period: int): List[Entry] =
  actorsIn(l, project, period).listMap(actor => entryFor(l, project, period, actor))
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
for one actor never overlap. For November 2026 the exclusion lists of
`slopdotcash`, `eliza`, `thenetwork` and `asi` stay empty (PRD section 7,
which names these projects): an exclusion that would cover that month for
one of them is refused, not silently ignored.

```quint
type Relationship = Owner | FundedEmployee | RelatedParty
type Exclusion = { actor: int, relationship: Relationship, fromPeriod: int, untilPeriod: int }
pure val novemberEmptyProjects = Set("slopdotcash", "eliza", "thenetwork", "asi")
pure def covers(x: Exclusion, period: int): bool =
  x.fromPeriod <= period and (x.untilPeriod == 0 or period < x.untilPeriod)
pure def excluded(exclusions: List[Exclusion], period: int, actor: int): bool =
  exclusions.some(x => x.actor == actor and covers(x, period))
pure def counted(period: int, exclusions: List[Exclusion], e: Entry): bool =
  e.actor > 0 and netWeight(e) > 0 and not(excluded(exclusions, period, e.actor))
pure def weightsFrom(period: int, entries: List[Entry], exclusions: List[Exclusion]): List[PointWeight] =
  entries.select(e => counted(period, exclusions, e)).listMap(e => { actor: e.actor, weight: netWeight(e) })
pure def overlaps(a: Exclusion, b: Exclusion): bool =
  a.actor == b.actor and (b.untilPeriod == 0 or a.fromPeriod < b.untilPeriod) and (a.untilPeriod == 0 or b.fromPeriod < a.untilPeriod)
pure def novemberAllowed(project: str, x: Exclusion): bool =
  not(novemberEmptyProjects.contains(project) and covers(x, P::november2026))
pure val projectValues = Set("p", "slopdotcash")
```

### One month's weights follow the journal until settlement freezes them

The prospective rule forbids any change to who is excluded, or why, in the
open month or earlier. A new or changed exclusion starts with a later month.
At the freeze the book must equal the book of a journal in which the month is
frozen. Once fixed, the month's weights never change: later credits,
penalties, appeals and exclusions affect Points standings only.

A ban does not remove or redistribute a weight. The fixed snapshot keeps the
banned recipient's weight, so every other recipient's share of the month is
unchanged; the banned recipient's unfunded award is not created by
settlement (composition obligation C1), and a funded award is never erased.

```quint
type WeightsPhase = Live | Fixed
type MonthlyWeights = { project: str, period: int, openPeriod: int, phase: WeightsPhase,
  exclusions: List[Exclusion], entries: List[Entry], banned: Set[int], snapshot: List[PointWeight] }
pure val initial: MonthlyWeights = { project: "slopdotcash", period: 24323, openPeriod: 24321, phase: Live,
  exclusions: List(), entries: List(), banned: Set(), snapshot: List() }
pure def weights(s: MonthlyWeights): List[PointWeight] =
  if (s.phase == Fixed) s.snapshot else weightsFrom(s.period, s.entries, s.exclusions)
pure def totalWeight(ws: List[PointWeight]): int = ws.foldl(0, (acc, w) => acc + w.weight)
pure def payable(s: MonthlyWeights): List[PointWeight] = weights(s).select(w => not(s.banned.contains(w.actor)))
pure def canObserve(s: MonthlyWeights, l: J::Ledger): bool = s.phase == Live
pure def observe(s: MonthlyWeights, l: J::Ledger): MonthlyWeights = { ...s, entries: book(l, s.project, s.period) }
pure def canAppendExclusion(s: MonthlyWeights, x: Exclusion): bool =
  x.actor > 0 and x.fromPeriod > s.openPeriod and (x.untilPeriod == 0 or x.untilPeriod > x.fromPeriod) and
  not(s.exclusions.some(o => overlaps(o, x))) and novemberAllowed(s.project, x)
pure def appendExclusion(s: MonthlyWeights, x: Exclusion): MonthlyWeights = { ...s, exclusions: s.exclusions.append(x) }
pure def canEndExclusion(s: MonthlyWeights, x: Exclusion, untilPeriod: int): bool =
  s.exclusions.includes(x) and untilPeriod > s.openPeriod and untilPeriod > x.fromPeriod and
  (x.untilPeriod == 0 or x.untilPeriod > s.openPeriod) and novemberAllowed(s.project, { ...x, untilPeriod: untilPeriod })
pure def endExclusion(s: MonthlyWeights, x: Exclusion, untilPeriod: int): MonthlyWeights =
  { ...s, exclusions: s.exclusions.listMap(o => if (o == x) { ...o, untilPeriod: untilPeriod } else o) }
pure def canAdvanceMonth(s: MonthlyWeights, period: int): bool = period > s.openPeriod
pure def advanceMonth(s: MonthlyWeights, period: int): MonthlyWeights = { ...s, openPeriod: period }
pure def canObserveBan(s: MonthlyWeights, actor: int): bool = actor > 0 and not(s.banned.contains(actor))
pure def observeBan(s: MonthlyWeights, actor: int): MonthlyWeights = { ...s, banned: s.banned.union(Set(actor)) }
pure def canFreeze(s: MonthlyWeights, f: P::FreezeEvidence, l: J::Ledger): bool =
  s.phase == Live and P::freezes(f) and f.project == s.project and f.period == s.period and s.openPeriod > s.period and
  J::isFrozen(l, s.project, s.period) and s.entries == book(l, s.project, s.period)
pure def freeze(s: MonthlyWeights, f: P::FreezeEvidence, l: J::Ledger): MonthlyWeights =
  { ...s, phase: Fixed, snapshot: weights(s) }
pure def alwaysWeightsPositive(s: MonthlyWeights): bool = weights(s).every(w => w.actor > 0 and w.weight > 0)
pure def alwaysNovemberListsEmpty(s: MonthlyWeights): bool = s.exclusions.every(x => novemberAllowed(s.project, x))
pure def stepFixedWeightsStable(before: MonthlyWeights, after: MonthlyWeights): bool =
  before.phase == Fixed implies (after.phase == Fixed and after.snapshot == before.snapshot)
pure def stepExclusionsProspective(before: MonthlyWeights, after: MonthlyWeights): bool =
  before.period <= before.openPeriod implies
    after.entries.every(e => excluded(before.exclusions, before.period, e.actor) == excluded(after.exclusions, after.period, e.actor))
pure def stepIdentityStable(before: MonthlyWeights, after: MonthlyWeights): bool =
  after.project == before.project and after.period == before.period and after.openPeriod >= before.openPeriod
pure def stepBanNeverRedistributes(before: MonthlyWeights, via: str, after: MonthlyWeights): bool =
  via == "observeBan" implies weights(after) == weights(before)
```

### Witnesses show exclusion, penalty netting, frozen stability and bans

```quint
pure def sometimesExcludedActorRemoved(s: MonthlyWeights): bool =
  s.entries.some(e => netWeight(e) > 0 and excluded(s.exclusions, s.period, e.actor)) and
  s.entries.some(e => counted(s.period, s.exclusions, e))
pure def sometimesPenaltyNetted(s: MonthlyWeights): bool = s.entries.some(e => e.debit > 0 and netWeight(e) > 0)
pure def sometimesFixed(s: MonthlyWeights): bool = s.phase == Fixed and s.snapshot.length() > 0
pure def sometimesBannedKeepsFixedWeight(s: MonthlyWeights): bool =
  s.phase == Fixed and s.snapshot.some(w => s.banned.contains(w.actor)) and payable(s).length() > 0
pure val keyOne: J::AwardKey = { project: "slopdotcash", actor: 1, category: J::Review, source: 1, workUnit: 1 }
pure val keyTwo: J::AwardKey = { project: "slopdotcash", actor: 2, category: J::Review, source: 2, workUnit: 2 }
pure val keyDebit: J::AwardKey = { project: "slopdotcash", actor: 2, category: J::Penalty, source: 3, workUnit: 3 }
pure def revisionOf(id: int, key: J::AwardKey, amount: int): J::Revision =
  { ...J::noRevision, id: id, key: key, amount: amount, occurredAt: 2432305, recordedAt: 2432306,
    rule: if (key.category == J::Penalty) J::PenaltyTable else J::ValueV1, sourceDigest: "d",
    tableVersion: if (key.category == J::Penalty) 1 else 0, debit: if (key.category == J::Penalty) 0 - amount else 0 }
pure val ledgerOne: J::Ledger = { ...J::initial, now: 2432306, nextId: 4,
  revisions: List(revisionOf(1, keyOne, 30), revisionOf(2, keyTwo, 90), revisionOf(3, keyDebit, -30)),
  frozen: List({ project: "slopdotcash", period: 24323 }) }
pure val ledgerOpen: J::Ledger = { ...ledgerOne, frozen: List() }
pure val lValues = Set(J::initial, ledgerOne, ledgerOpen)
pure val xValues = Set({ actor: 1, relationship: Owner, fromPeriod: 24323, untilPeriod: 0 },
  { actor: 2, relationship: FundedEmployee, fromPeriod: 24322, untilPeriod: 0 },
  { actor: 1, relationship: RelatedParty, fromPeriod: 24323, untilPeriod: 24325 })
pure val periodValues = Set(24322, 24323, 24324)
pure val untilPeriodValues = Set(24324, 24326)
pure val actorValues = Set(0, 1, 2)
pure val fValues = Set({ project: "slopdotcash", period: 24323, phase: P::Frozen, obligationExists: false },
  { project: "slopdotcash", period: 24323, phase: P::Proposed, obligationExists: false })
```
