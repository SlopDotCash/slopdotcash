# Reward weights and payout exclusions

PRD sections 6 and 7: only accepted-work Points for the project and period
set monthly reward shares. Participation, payout recognition, usage and trace
evidence never weigh. Owners, funded employees and related parties keep their
public Points but receive no share of the project's pool; an excluded weight
leaves the allocation, so it never reduces another contributor's share.
Exclusions apply prospectively: a revision cannot change who is excluded in
the open UTC month or earlier. For November 2026 the exclusion lists of
`slopdotcash`, `eliza`, `thenetwork` and `asi` stay empty.

Source anchors are development `src/lib/payout-exclusions.mjs`
(`validatePayoutExclusions`, `covers`, `payoutExcludedGithubUserIds`),
`src/lib/payments/monthly-allocation.ts` (`assertAllocationChange`) and
`scripts/prepare-monthly-rewards.ts`. The accepted-work snapshot is the
typed output of the Points ledger (`points/` owns penalty netting, work-unit
grouping and source coverage); this unit owns only how a complete snapshot
and the exclusion list become reward weights. The exclusion list lives in the
project's immutable D1 revisions.

## Story: Derive weights only from accepted work

### A complete accepted-work snapshot carries every actor's categories separately

Each row names one immutable GitHub actor. Accepted work is the net of
merged-work, review and evaluation Points after penalties for this project
and period. Participation and payout recognition are carried only so the
weights can be shown to ignore them.

```quint
import allocation as A from "./allocation"
import money as M from "./money"
type Coverage = CompleteCoverage | MissingSources | ConflictedSources
type WorkRow = { actor: int, acceptedWork: M::Amount, participation: int, recognition: int }
type WorkSnapshot = { project: str, period: int, digest: str, coverage: Coverage, rows: List[WorkRow] }
type Relationship = ProjectOwner | FundedEmployee | RelatedParty
type Exclusion = { actor: int, relationship: Relationship, fromPeriod: int, untilPeriod: int }
pure def covers(e: Exclusion, period: int): bool = e.fromPeriod <= period and (e.untilPeriod == 0 or period < e.untilPeriod)
pure def excludedIn(exclusions: List[Exclusion], actor: int, period: int): bool =
  exclusions.some(e => e.actor == actor and covers(e, period))
pure def usableSnapshot(s: WorkSnapshot, project: str, period: int): bool =
  s.project == project and s.period == period and s.digest != "" and s.coverage == CompleteCoverage
    and s.rows.every(r => r.actor > 0 and s.rows.select(o => o.actor == r.actor).length() == 1)
pure def rewardWeights(s: WorkSnapshot, exclusions: List[Exclusion]): List[A::Weight] =
  s.rows.select(r => M::validAmount(r.acceptedWork) and M::positiveAmount(r.acceptedWork) and not(excludedIn(exclusions, r.actor, s.period)))
    .listMap(r => { actor: r.actor, weight: r.acceptedWork })
```

### Participation and recognition never weigh, and an exclusion removes only its actor

Changing an actor's participation or recognition leaves every weight
unchanged. Adding an exclusion keeps every other actor's weight exactly as it
was and adds nothing, so no remaining contributor's share of the pool can
fall; only the excluded actor's weight can leave. An actor with no positive
accepted work gets no weight.

```quint
pure def withSideCategories(r: WorkRow, participation: int, recognition: int): WorkRow =
  { ...r, participation: participation, recognition: recognition }
pure def lawParticipationNeverWeights(s: WorkSnapshot, exclusions: List[Exclusion], participation: int, recognition: int): bool =
  rewardWeights({ ...s, rows: s.rows.listMap(r => withSideCategories(r, participation, recognition)) }, exclusions)
    == rewardWeights(s, exclusions)
pure def lawExclusionKeepsOthers(s: WorkSnapshot, exclusions: List[Exclusion], e: Exclusion): bool =
  val after = rewardWeights(s, exclusions.append(e))
  rewardWeights(s, exclusions).every(w => (covers(e, s.period) and w.actor == e.actor) or after.includes(w))
pure def lawExclusionOnlyRemoves(s: WorkSnapshot, exclusions: List[Exclusion], e: Exclusion): bool =
  val before = rewardWeights(s, exclusions)
  rewardWeights(s, exclusions.append(e)).every(w => before.includes(w) and not(covers(e, s.period) and w.actor == e.actor))
pure def lawWeightsPositive(s: WorkSnapshot, exclusions: List[Exclusion]): bool =
  rewardWeights(s, exclusions).every(w => M::validAmount(w.weight) and M::positiveAmount(w.weight))
```

## Story: Keep the exclusion list prospective

### A project's exclusion list starts empty and is revised only for later months

Each entry names one immutable actor and the UTC months it covers, from
`fromPeriod` up to but not including `untilPeriod` (0 for open-ended).
Entries for one actor never overlap. A revision may add an entry only from
a month after the open month, and may close an entry only from a month after
the open month; entries that already cover the open month or earlier keep
those months.

```quint
type ExclusionRegistry = { project: str, openPeriod: int, revision: int, entries: List[Exclusion], history: List[List[Exclusion]] }
pure val initial: ExclusionRegistry = { project: "eliza", openPeriod: 202611, revision: 1, entries: List(), history: List(List()) }
pure def validPeriod(period: int): bool = period >= 200001 and period <= 999912 and period % 100 >= 1 and period % 100 <= 12
pure def validEntry(e: Exclusion): bool = e.actor > 0 and validPeriod(e.fromPeriod) and (e.untilPeriod == 0 or (validPeriod(e.untilPeriod) and e.untilPeriod > e.fromPeriod))
pure def overlapping(a: Exclusion, b: Exclusion): bool = a.actor == b.actor and
  (b.untilPeriod == 0 or a.fromPeriod < b.untilPeriod) and (a.untilPeriod == 0 or b.fromPeriod < a.untilPeriod)
pure def validList(entries: List[Exclusion]): bool = entries.every(e => validEntry(e)
  and entries.select(o => overlapping(o, e)).length() == 1)
pure def keptOrClosedLater(old: Exclusion, entries: List[Exclusion], openPeriod: int): bool =
  old.fromPeriod > openPeriod or entries.includes(old) or entries.some(n => n.actor == old.actor and n.relationship == old.relationship
    and n.fromPeriod == old.fromPeriod and (n.untilPeriod == 0 or n.untilPeriod > openPeriod) and (old.untilPeriod == 0 or old.untilPeriod > openPeriod))
pure def newOnlyLater(n: Exclusion, old: List[Exclusion], openPeriod: int): bool =
  old.includes(n) or n.fromPeriod > openPeriod or old.some(o => o.actor == n.actor and o.relationship == n.relationship
    and o.fromPeriod == n.fromPeriod and (n.untilPeriod == 0 or n.untilPeriod > openPeriod) and (o.untilPeriod == 0 or o.untilPeriod > openPeriod))
pure def prospective(old: List[Exclusion], entries: List[Exclusion], openPeriod: int): bool =
  old.every(o => keptOrClosedLater(o, entries, openPeriod)) and entries.every(n => newOnlyLater(n, old, openPeriod))
pure val novemberEmptyProjects = List("slopdotcash", "eliza", "thenetwork", "asi")
pure def novemberException(project: str, entries: List[Exclusion]): bool =
  novemberEmptyProjects.includes(project) implies not(entries.some(e => covers(e, 202611)))
pure def canRevise(r: ExclusionRegistry, entries: List[Exclusion], by: str): bool =
  by == "owner" and validList(entries) and novemberException(r.project, entries)
    and prospective(r.entries, entries, r.openPeriod)
pure def revise(r: ExclusionRegistry, entries: List[Exclusion], by: str): ExclusionRegistry =
  { ...r, revision: r.revision + 1, entries: entries, history: r.history.append(entries) }
pure def canOpenNextPeriod(r: ExclusionRegistry): bool = r.openPeriod % 100 >= 1
pure def openNextPeriod(r: ExclusionRegistry): ExclusionRegistry =
  { ...r, openPeriod: if (r.openPeriod % 100 == 12) (r.openPeriod / 100 + 1) * 100 + 1 else r.openPeriod + 1 }
```

### Who is excluded in the open month or earlier never changes

```quint
pure def lawRevisionKeepsPastMonths(previous: List[Exclusion], entries: List[Exclusion], openPeriod: int, actor: int, period: int): bool =
  (prospective(previous, entries, openPeriod) and period <= openPeriod) implies excludedIn(previous, actor, period) == excludedIn(entries, actor, period)
pure def alwaysValidList(r: ExclusionRegistry): bool = validList(r.entries) and novemberException(r.project, r.entries)
pure def stepHistoryAppendOnly(before: ExclusionRegistry, after: ExclusionRegistry): bool =
  after.history.length() >= before.history.length() and before.history.every(h => after.history.includes(h))
    and after.revision >= before.revision and after.openPeriod >= before.openPeriod
pure def sometimesFutureExclusion(r: ExclusionRegistry): bool = r.entries.some(e => e.fromPeriod > 202611) and r.revision > 1
pure def sometimesClosedLater(r: ExclusionRegistry): bool = r.entries.some(e => e.untilPeriod > 0) and r.openPeriod > 202612
```

### Simulation samples

```quint
pure val entriesValues = Set(List(),
  List({ actor: 1, relationship: ProjectOwner, fromPeriod: 202612, untilPeriod: 0 }),
  List({ actor: 1, relationship: ProjectOwner, fromPeriod: 202612, untilPeriod: 202702 }),
  List({ actor: 1, relationship: ProjectOwner, fromPeriod: 202611, untilPeriod: 0 }),
  List({ actor: 2, relationship: FundedEmployee, fromPeriod: 202701, untilPeriod: 0 }),
  List({ actor: 1, relationship: ProjectOwner, fromPeriod: 202612, untilPeriod: 0 }, { actor: 1, relationship: RelatedParty, fromPeriod: 202701, untilPeriod: 0 }))
pure val previousValues = entriesValues
pure val openPeriodValues = Set(202611, 202612)
pure val actorValues = Set(1, 2)
pure val periodValues = Set(202611, 202612, 202701, 202702)
pure val byValues = Set("owner", "anyone")
pure val sValues = Set({ project: "eliza", period: 202612, digest: "d", coverage: CompleteCoverage,
  rows: List({ actor: 1, acceptedWork: List(10), participation: 30, recognition: 5 }, { actor: 2, acceptedWork: List(25), participation: 0, recognition: 0 },
    { actor: 3, acceptedWork: List(0), participation: 30, recognition: 0 }) })
pure val exclusionsValues = Set(List(), List({ actor: 1, relationship: ProjectOwner, fromPeriod: 202612, untilPeriod: 0 }))
pure val eValues = Set({ actor: 2, relationship: RelatedParty, fromPeriod: 202612, untilPeriod: 0 },
  { actor: 2, relationship: RelatedParty, fromPeriod: 202701, untilPeriod: 0 })
pure val participationValues = Set(0, 30)
pure val recognitionValues = Set(0, 5)
```
