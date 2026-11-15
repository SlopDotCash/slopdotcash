# Accepted work units

PRD section 7 groups split or related PRs into one work unit and prevents
duplicate credit across commits, stacked PRs and indirect merges. Every
accepted merge receives at least 10 Points, including a zero-size
assessment. Commit counts never increase a unit's value. A no-change branch
promotion earns no additional Points only when complete, hash-verified trees
prove identical base, submitted head and accepted merge content, and every
imported commit belongs to an earlier complete accepted source; missing
trees leave it unresolved. This machine follows
`workers/slopbot/value-work-unit-journal.ts`, the D1 table of
`migrations/0046_slopbot_work_unit_journal.sql` and the `:joint:` work-unit
key of `src/lib/points.ts`, and the legacy `bot_joint_journal` model.

A new group supersedes every current group that shares a PR or a commit with
it, whole: a current group is never forked or partly dropped. A group whose
reward month is frozen cannot be superseded. The GitHub ingestion adapter
supplies `GroupEvidence` for the exact PRs and accepted commits it names; its
`hashesVerified` field is that adapter's verification of the immutable IDs
and commit hashes (an adapter obligation). The freeze comes from monthly
settlement through [periods](./periods.md). The [allocation](./allocation.md)
divides a unit's value; the [Points journal](./journal.md) owns one copy of
this machine and records each unit's shares.

## Story: Value one logical work unit once

### Current units are disjoint in PRs and commits

```quint
import allocation as A from "./allocation"
import periods as P from "./periods"
type Unit = { id: int, project: str, sources: Set[int], commits: Set[int], band: int, value: int,
  accepted: bool, acceptedPeriod: int, superseded: bool, frozen: bool, supersededBy: int }
type Units = { units: List[Unit], nextId: int, promotions: List[str], heldPromotions: List[str] }
pure val initial: Units = { units: List(), nextId: 1, promotions: List(), heldPromotions: List() }
pure def live(u: Unit): bool = not(u.superseded)
pure def touches(u: Unit, sources: Set[int], commits: Set[int]): bool =
  live(u) and (u.sources.exists(x => sources.contains(x)) or u.commits.exists(x => commits.contains(x)))
pure def unitValue(band: int): int = A::sizePoints(band)
pure def alwaysNextIdPositive(s: Units): bool = s.nextId >= 1
pure def alwaysUnitsWellFormed(s: Units): bool = s.units.every(u =>
  u.id > 0 and u.id < s.nextId and u.project != "" and u.sources.size() > 0 and u.value == unitValue(u.band) and u.value >= 10 and
  (u.superseded implies (u.supersededBy > u.id and u.supersededBy < s.nextId)) and
  (not(u.superseded) implies u.supersededBy == 0) and (u.frozen implies u.accepted) and
  (u.accepted implies u.acceptedPeriod >= 0) and (not(u.accepted) implies u.acceptedPeriod == -1))
pure def alwaysCurrentUnitsDisjoint(s: Units): bool = s.units.every(u => live(u) implies
  s.units.every(v => (live(v) and v.id != u.id) implies
    (u.sources.forall(x => not(v.sources.contains(x))) and u.commits.forall(x => not(v.commits.contains(x))))))
```

### A new group supersedes every current group it touches, whole

An unassessed group takes the 10-Point minimum. The band follows the size
table; a zero-size assessment keeps 10 Points. A branch promotion forms a
unit only when its complete trees show changed content.

```quint
type Trees = { base: str, head: str, merge: str }
type Promotion = NotPromotion | PromotionTrees(Trees) | PromotionMissingTrees
type GroupEvidence = { project: str, sources: Set[int], commits: Set[int], band: int, hashesVerified: bool,
  digest: str, promotion: Promotion }
pure def isPromotion(p: Promotion): bool = match p { | NotPromotion => false | _ => true }
pure def identicalTrees(p: Promotion): bool =
  match p { | PromotionTrees(t) => t.base != "" and t.base == t.head and t.head == t.merge | _ => false }
pure def changedTrees(p: Promotion): bool =
  match p { | PromotionTrees(t) => t.base != "" and t.head != "" and t.merge != "" and not(t.base == t.head and t.head == t.merge) | _ => false }
pure def missingTrees(p: Promotion): bool = match p { | PromotionMissingTrees => true | _ => false }
pure def wholeCover(s: Units, g: GroupEvidence): bool =
  s.units.every(u => touches(u, g.sources, g.commits) implies
    (u.sources.subseteq(g.sources) and u.commits.subseteq(g.commits) and not(u.frozen)))
pure def canForm(s: Units, g: GroupEvidence): bool =
  g.project != "" and g.sources.size() > 0 and g.hashesVerified and g.digest != "" and g.band >= -1 and g.band <= 5 and
  (not(isPromotion(g.promotion)) or changedTrees(g.promotion)) and wholeCover(s, g)
pure def form(s: Units, g: GroupEvidence): Units =
  { ...s, units: s.units.listMap(u => if (touches(u, g.sources, g.commits)) { ...u, superseded: true, supersededBy: s.nextId } else u)
      .append({ id: s.nextId, project: g.project, sources: g.sources, commits: g.commits, band: g.band, value: unitValue(g.band),
        accepted: false, acceptedPeriod: -1, superseded: false, frozen: false, supersededBy: 0 }),
    nextId: s.nextId + 1 }
pure def lawValueIgnoresCommitCount(band: int): bool = unitValue(band) == A::sizePoints(band) and unitValue(band) >= 10
pure def lawZeroSizeKeepsMinimum(band: int): bool = band <= 0 implies unitValue(band) == 10
```

### A no-change promotion adds no unit and no value; missing trees stay unresolved

Identical complete trees are recorded only when every imported commit is in
an earlier accepted, current unit of the same project. Otherwise, and when
trees are missing, the promotion is held unresolved and earns nothing. Its
digest is recorded once.

```quint
pure def coveredByAccepted(s: Units, g: GroupEvidence): bool =
  g.commits.size() > 0 and
  g.commits.forall(c => s.units.some(u => live(u) and u.accepted and u.project == g.project and u.commits.contains(c)))
pure def promotionSeen(s: Units, digest: str): bool = s.promotions.includes(digest) or s.heldPromotions.includes(digest)
pure def canRecordPromotion(s: Units, g: GroupEvidence): bool =
  g.project != "" and g.hashesVerified and g.digest != "" and identicalTrees(g.promotion) and coveredByAccepted(s, g) and
  not(s.promotions.includes(g.digest))
pure def recordPromotion(s: Units, g: GroupEvidence): Units = { ...s, promotions: s.promotions.append(g.digest) }
pure def canHoldPromotion(s: Units, g: GroupEvidence): bool =
  g.digest != "" and not(promotionSeen(s, g.digest)) and
  (missingTrees(g.promotion) or not(g.hashesVerified) or (identicalTrees(g.promotion) and not(coveredByAccepted(s, g))))
pure def holdPromotion(s: Units, g: GroupEvidence): Units = { ...s, heldPromotions: s.heldPromotions.append(g.digest) }
pure def stepPromotionAddsNoUnit(before: Units, via: str, after: Units): bool =
  (via == "recordPromotion" or via == "holdPromotion") implies
    (after.nextId == before.nextId and after.units.length() == before.units.length())
pure def alwaysPromotionDigestsPresent(s: Units): bool =
  s.promotions.every(d => d != "") and s.heldPromotions.every(d => d != "")
```

### Acceptance and freezing follow the accepted merge and the reward month

A unit is accepted with the instant of its accepted merge, which fixes its
reward month. Only settlement's freeze of that project and month freezes it.

```quint
pure def canAccept(s: Units, unit: int, at: int): bool =
  at >= 0 and s.units.some(u => u.id == unit and live(u) and not(u.accepted))
pure def accept(s: Units, unit: int, at: int): Units =
  { ...s, units: s.units.listMap(u => if (u.id == unit and live(u) and not(u.accepted)) { ...u, accepted: true, acceptedPeriod: P::periodOf(at) } else u) }
pure def canFreezeUnit(s: Units, unit: int, f: P::FreezeEvidence): bool =
  P::freezes(f) and
  s.units.some(u => u.id == unit and live(u) and u.accepted and not(u.frozen) and u.project == f.project and u.acceptedPeriod == f.period)
pure def freezeUnit(s: Units, unit: int, f: P::FreezeEvidence): Units =
  { ...s, units: s.units.listMap(u => if (u.id == unit and live(u) and u.accepted and not(u.frozen)) { ...u, frozen: true } else u) }
pure def shares(u: Unit, recipients: List[A::Recipient]): List[A::PointShare] = A::allocatePoints(u.value, recipients)
pure def sameUnit(u: Unit, v: Unit): bool =
  v.id == u.id and v.project == u.project and v.value == u.value and v.band == u.band and v.accepted == u.accepted and
  v.acceptedPeriod == u.acceptedPeriod and v.frozen == u.frozen and
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
pure def sometimesNoChangePromotion(s: Units): bool = s.promotions.length() > 0
pure def sometimesPromotionHeld(s: Units): bool = s.heldPromotions.length() > 0 and s.units.some(u => u.accepted)
```

### Simulation samples join stacked PRs, refuse forks and classify promotions

```quint
pure val gValues = Set(
  { project: "p", sources: Set(1), commits: Set(11), band: -1, hashesVerified: true, digest: "a", promotion: NotPromotion },
  { project: "p", sources: Set(2), commits: Set(11, 12), band: 1, hashesVerified: true, digest: "b", promotion: NotPromotion },
  { project: "p", sources: Set(1, 2), commits: Set(11, 12), band: 2, hashesVerified: true, digest: "c", promotion: NotPromotion },
  { project: "p", sources: Set(3), commits: Set(13), band: 0, hashesVerified: false, digest: "d", promotion: NotPromotion },
  { project: "p", sources: Set(4), commits: Set(11), band: 0, hashesVerified: true, digest: "e",
    promotion: PromotionTrees({ base: "t", head: "t", merge: "t" }) },
  { project: "p", sources: Set(5), commits: Set(14), band: 1, hashesVerified: true, digest: "f",
    promotion: PromotionTrees({ base: "t", head: "u", merge: "u" }) },
  { project: "p", sources: Set(6), commits: Set(11), band: 0, hashesVerified: true, digest: "g", promotion: PromotionMissingTrees })
pure val unitValues = Set(1, 2, 3)
pure val bandValues = Set(-1, 0, 1, 5)
pure val atValues = Set(2432005, 2432105)
pure val fValues = Set({ project: "p", period: 24320, phase: P::Frozen, obligationExists: false },
  { project: "p", period: 24320, phase: P::Proposed, obligationExists: false },
  { project: "p", period: 24321, phase: P::Reserved, obligationExists: false })
```
