# Accepted work units

PRD section 7 groups split or related PRs into one work unit and prevents
duplicate credit across commits, stacked PRs and indirect merges. Every
accepted merge receives at least 10 Points, including a zero-size
assessment. Commit counts never increase a unit's value. This machine follows
`workers/slopbot/value-work-unit-journal.ts`, the D1 table of
`migrations/0046_slopbot_work_unit_journal.sql` and the `:joint:` work-unit
key of `src/lib/points.ts`, and the legacy `bot_joint_journal` model.

A new group supersedes every current group that shares a PR or a commit with
it, whole: a current group is never forked or partly dropped. A group whose
reward month is frozen cannot be superseded. The GitHub ingestion adapter
supplies `GroupEvidence` for the exact PRs and accepted commits it names,
verified by immutable IDs and hashes. The [allocation](./allocation.md)
divides a unit's value; the [Points journal](./journal.md) records the
shares.

## Story: Value one logical work unit once

### Current units are disjoint in PRs and commits

```quint
import allocation as A from "./allocation"
type Unit = { id: int, sources: Set[int], commits: Set[int], band: int, value: int,
  accepted: bool, superseded: bool, frozen: bool, supersededBy: int }
type Units = { units: List[Unit], nextId: int }
pure val initial: Units = { units: List(), nextId: 1 }
pure def live(u: Unit): bool = not(u.superseded)
pure def touches(u: Unit, sources: Set[int], commits: Set[int]): bool =
  live(u) and (u.sources.exists(x => sources.contains(x)) or u.commits.exists(x => commits.contains(x)))
pure def unitValue(band: int): int = A::sizePoints(band)
pure def alwaysNextIdPositive(s: Units): bool = s.nextId >= 1
pure def alwaysUnitsWellFormed(s: Units): bool = s.units.every(u =>
  u.id > 0 and u.id < s.nextId and u.sources.size() > 0 and u.value == unitValue(u.band) and u.value >= 10 and
  (u.superseded implies (u.supersededBy > u.id and u.supersededBy < s.nextId)) and
  (not(u.superseded) implies u.supersededBy == 0) and (u.frozen implies u.accepted))
pure def alwaysCurrentUnitsDisjoint(s: Units): bool = s.units.every(u => live(u) implies
  s.units.every(v => (live(v) and v.id != u.id) implies
    (u.sources.forall(x => not(v.sources.contains(x))) and u.commits.forall(x => not(v.commits.contains(x))))))
```

### A new group supersedes every current group it touches, whole

An unassessed group takes the 10-Point minimum. The band follows the size
table; a zero-size assessment keeps 10 Points.

```quint
type GroupEvidence = { sources: Set[int], commits: Set[int], band: int, completeHashes: bool, digest: str }
pure def wholeCover(s: Units, g: GroupEvidence): bool =
  s.units.every(u => touches(u, g.sources, g.commits) implies
    (u.sources.subseteq(g.sources) and u.commits.subseteq(g.commits) and not(u.frozen)))
pure def canForm(s: Units, g: GroupEvidence): bool =
  g.sources.size() > 0 and g.completeHashes and g.digest != "" and g.band >= -1 and g.band <= 5 and wholeCover(s, g)
pure def form(s: Units, g: GroupEvidence): Units =
  { units: s.units.listMap(u => if (touches(u, g.sources, g.commits)) { ...u, superseded: true, supersededBy: s.nextId } else u)
      .append({ id: s.nextId, sources: g.sources, commits: g.commits, band: g.band, value: unitValue(g.band),
        accepted: false, superseded: false, frozen: false, supersededBy: 0 }),
    nextId: s.nextId + 1 }
pure def lawValueIgnoresCommitCount(band: int): bool = unitValue(band) == A::sizePoints(band) and unitValue(band) >= 10
pure def lawZeroSizeKeepsMinimum(band: int): bool = band <= 0 implies unitValue(band) == 10
```

### Acceptance and freezing follow the accepted merge and the reward month

```quint
pure def canAccept(s: Units, unit: int): bool = s.units.some(u => u.id == unit and live(u) and not(u.accepted))
pure def accept(s: Units, unit: int): Units =
  { ...s, units: s.units.listMap(u => if (u.id == unit and live(u) and not(u.accepted)) { ...u, accepted: true } else u) }
pure def canFreezeUnit(s: Units, unit: int): bool = s.units.some(u => u.id == unit and live(u) and u.accepted and not(u.frozen))
pure def freezeUnit(s: Units, unit: int): Units =
  { ...s, units: s.units.listMap(u => if (u.id == unit and live(u) and u.accepted and not(u.frozen)) { ...u, frozen: true } else u) }
pure def shares(u: Unit, recipients: List[A::Recipient]): List[A::PointShare] = A::allocatePoints(u.value, recipients)
pure def sameUnit(u: Unit, v: Unit): bool =
  v.id == u.id and v.value == u.value and v.band == u.band and v.accepted == u.accepted and v.frozen == u.frozen and
  v.superseded == u.superseded and v.supersededBy == u.supersededBy and
  u.sources.subseteq(v.sources) and v.sources.subseteq(u.sources) and u.commits.subseteq(v.commits) and v.commits.subseteq(u.commits)
pure def stepSupersessionFinal(before: Units, after: Units): bool =
  before.units.every(u => u.superseded implies after.units.some(v => sameUnit(u, v))) and after.nextId >= before.nextId and
  after.units.length() >= before.units.length()
pure def stepFrozenUnitsKept(before: Units, after: Units): bool =
  before.units.every(u => (u.frozen and live(u)) implies after.units.some(v => sameUnit(u, v)))
pure def sometimesJoined(s: Units): bool = s.units.some(u => live(u) and u.sources.size() > 1) and s.units.some(u => u.superseded)
pure def sometimesAcceptedMinimum(s: Units): bool = s.units.some(u => u.accepted and u.value == 10)
pure def sometimesFrozenUnit(s: Units): bool = s.units.some(u => u.frozen)
```

### Simulation samples join stacked PRs and refuse forks

```quint
pure val gValues = Set(
  { sources: Set(1), commits: Set(11), band: -1, completeHashes: true, digest: "a" },
  { sources: Set(2), commits: Set(11, 12), band: 1, completeHashes: true, digest: "b" },
  { sources: Set(1, 2), commits: Set(11, 12), band: 2, completeHashes: true, digest: "c" },
  { sources: Set(3), commits: Set(13), band: 0, completeHashes: false, digest: "d" })
pure val unitValues = Set(1, 2, 3)
pure val bandValues = Set(-1, 0, 1, 5)
```
