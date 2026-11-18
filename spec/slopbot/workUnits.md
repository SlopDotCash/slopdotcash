# Slopbot work units and the joint assessment journal

PRD section 7 groups split or related pull requests into one work unit,
prevents duplicate credit across commits, stacked pull requests and
indirect merges, and keeps corrections append-only. Source is
`workers/slopbot/value-work-unit.ts` (`prepareWorkUnitEvidence`,
`validateWorkUnitPartition`), `workers/slopbot/verified-work-unit.ts`
(`completeClaimPartition`), `workers/slopbot/value-work-unit-journal.ts`
(`appendWorkUnitRecord`), `workers/slopbot/value-group-collection.ts` and
`migrations/0046_slopbot_work_unit_journal.sql` at the pinned development
revision. The retained `bot_joint_journal` and `bot_work_partition` models
cover the same constraints. `value-work-unit-consumption.ts`
(`consumeWorkUnitHistory`) checks the legacy predecessors on read.

This unit owns the write side of the joint journal: the claims of one
prepared group, their partition into outcomes, and each appended record
with its predecessors. The [value history](./valueHistory.md) reader
verifies the same constraints when it selects a current record. The
[value inference](./valueInference.md) unit supplies the retained result
and its publication fence. Identities stand for exact digests. The legacy
single-source journal is the per-source history of [value history](./valueHistory.md);
this unit keeps the part of it that bears on duplicate credit: which
single-source record is current for each source.

## Story: Prepare a group whose every claim is credited once

### A claim is one changed path in one commit and belongs to its first accepted carrier

Group collection follows current references and retained joint membership.
Its bounds are a collection limit, not a scoring cap: an unfinished group
stays pending and is never published in part. Each claim names a
repository, commit and path. Every pull request that carries the same
claim shares it. The group lists its sources in acceptance order, and a
claim is credited to the earliest accepted source that carries it. A
later carrier that only repeats an accepted claim never earns an
independent award. A limitation in any source refuses publication of the
whole group. Split, stacked, indirectly accepted and no-change-promoted
pull requests, and any source already in a joint record, take this joint
route instead of the single-source one. The merge reconstruction, patch
replay and retained copies that establish indirect acceptance and
no-change promotion are verified shell evidence of the merge verifier;
this unit consumes only their result for each source.

```quint
type Claim = { id: int, carriers: Set[int], credit: int }
type Evidence = { project: int, accepted: List[int], claims: List[Claim], limitations: bool }
pure def sourcesOf(e: Evidence): Set[int] = e.accepted.foldl(Set(), (ids, s) => ids.union(Set(s)))
pure def claimIds(e: Evidence): Set[int] = e.claims.foldl(Set(), (ids, c) => ids.union(Set(c.id)))
pure def firstCarrier(e: Evidence, c: Claim): int = e.accepted.select(s => c.carriers.contains(s)).nthOr(0, 0)
pure def validClaim(e: Evidence, c: Claim): bool =
  c.id > 0 and c.carriers.size() > 0 and c.carriers.subseteq(sourcesOf(e)) and c.credit == firstCarrier(e, c)
    and e.claims.select(o => o.id == c.id).length() == 1
pure def validEvidence(e: Evidence): bool =
  e.project > 0 and e.accepted.length() > 0 and not(e.limitations)
    and e.accepted.every(s => s > 0 and e.accepted.select(o => o == s).length() == 1)
    and e.claims.every(c => validClaim(e, c))
pure def sameSet(a: Set[int], b: Set[int]): bool = a.subseteq(b) and b.subseteq(a)
pure def lawLaterCarrierEarnsNothing(e: Evidence, first: int, later: int): bool =
  (validEvidence(e) and 0 <= first and first < later and later < e.accepted.length())
    implies e.claims.every(c => not(c.carriers.contains(e.accepted.nthOr(first, 0))
      and c.carriers.contains(e.accepted.nthOr(later, 0))) or c.credit != e.accepted.nthOr(later, 0))
```

### A complete partition assigns every claim to exactly one outcome

Several claims of one pull request may belong to different outcomes, and
several pull requests may share one outcome. Every outcome is nonempty
and names only claims of the group. A group with no claims has the empty
partition, which is complete (`completeClaimPartition(0, [])` in
`verified-work-unit.ts`); an empty outcome is still refused. A partial or
overlapping partition refuses publication. The record keeps the partition, and each outcome is
what the Points journal credits.

```quint
pure def completePartition(e: Evidence, units: List[Set[int]]): bool =
  units.every(u => u.size() > 0 and u.subseteq(claimIds(e)))
    and claimIds(e).forall(id => units.select(u => u.contains(id)).length() == 1)
pure def lawPartialPartitionRefused(e: Evidence, units: List[Set[int]]): bool =
  claimIds(e).exists(id => not(units.some(u => u.contains(id)))) implies not(completePartition(e, units))
pure def lawOverlappingPartitionRefused(e: Evidence, units: List[Set[int]]): bool =
  claimIds(e).exists(id => units.select(u => u.contains(id)).length() > 1) implies not(completePartition(e, units))
```

## Story: Append a joint record that consumes every affected predecessor

### One transaction checks predecessors, legacy records, sources, claims and the publication fence

A record appends once per assessment key, the digest of the source group,
rubric and producer revision. Its named joint predecessors must exist,
still be current and belong to the same project. It keeps every
predecessor source. Every current joint record that shares a source or
claim with it must be a named predecessor. Its legacy predecessors must be
exactly the current single-source records of its sources. A record with
any predecessor carries a revision reason, and a first record carries
none. The append retires every predecessor of both kinds in the same
transaction, so a current group can grow by merging but never split, and
no source is credited by a current single-source record and a current
joint record at once. The installation must be active and the fence that the
[value inference](./valueInference.md) captured before collection must
still be the current one; any registry, manifest or enforcement change
advances it. After a source enters the
joint journal, the single-source journal refuses any further record for
it.

```quint
import installation as I from "./installation"
type JointRecord = { digest: int, assessmentKey: int, project: int, sources: Set[int], claims: Set[int],
  units: List[Set[int]], parents: Set[int], legacyParents: Set[int], revisionReason: str, sequence: int }
type LegacyRecord = { digest: int, source: int }
type Journal = { records: List[JointRecord], retired: Set[int], legacy: List[LegacyRecord], legacyRetired: Set[int],
  lastSequence: int, fence: int, install: I::Installation }
pure val initial: Journal = { records: List(), retired: Set(), legacy: List(), legacyRetired: Set(), lastSequence: 0,
  fence: 1, install: I::initial }
pure val noRecord: JointRecord = { digest: 0, assessmentKey: 0, project: 0, sources: Set(), claims: Set(),
  units: List(), parents: Set(), legacyParents: Set(), revisionReason: "", sequence: 0 }
pure def recordOf(j: Journal, digest: int): JointRecord = j.records.select(r => r.digest == digest).nthOr(0, noRecord)
pure def liveRecords(j: Journal): List[JointRecord] = j.records.select(r => not(j.retired.contains(r.digest)))
pure def currentLegacy(j: Journal): List[LegacyRecord] = j.legacy.select(l => not(j.legacyRetired.contains(l.digest)))
pure def currentLegacyOf(j: Journal, sources: Set[int]): Set[int] =
  currentLegacy(j).foldl(Set(), (ds, l) => if (sources.contains(l.source)) ds.union(Set(l.digest)) else ds)
pure def jointSource(j: Journal, source: int): bool = j.records.some(r => r.sources.contains(source))
pure def predecessorOk(j: Journal, r: JointRecord, parent: int): bool =
  val p = recordOf(j, parent)
  p.digest > 0 and not(j.retired.contains(parent)) and p.project == r.project and p.sources.subseteq(r.sources)
pure def omitsNoCurrentOwner(j: Journal, r: JointRecord): bool =
  liveRecords(j).every(o => (o.sources.intersect(r.sources).size() == 0 and o.claims.intersect(r.claims).size() == 0)
    or r.parents.contains(o.digest))
pure def reasonMatches(r: JointRecord): bool =
  if (r.parents.size() + r.legacyParents.size() == 0) r.revisionReason == "" else r.revisionReason != ""
pure def observeRegistryChange(j: Journal): Journal = { ...j, fence: j.fence + 1 }
pure def canApplyInstallation(j: Journal, change: I::InstallEvent): bool = I::canDeliver(j.install, change)
pure def applyInstallation(j: Journal, change: I::InstallEvent): Journal = { ...j, install: I::deliver(j.install, change) }
pure def canAppendJoint(j: Journal, r: JointRecord, e: Evidence, captured: int): bool =
  I::active(j.install) and captured == j.fence and validEvidence(e) and completePartition(e, r.units)
    and r.digest > 0 and r.assessmentKey > 0 and recordOf(j, r.digest).digest == 0
    and not(j.records.some(o => o.assessmentKey == r.assessmentKey))
    and not(j.legacy.some(l => l.digest == r.digest))
    and r.project == e.project and sameSet(r.sources, sourcesOf(e)) and sameSet(r.claims, claimIds(e))
    and r.parents.forall(p => predecessorOk(j, r, p)) and omitsNoCurrentOwner(j, r)
    and sameSet(r.legacyParents, currentLegacyOf(j, r.sources)) and reasonMatches(r)
pure def appendJoint(j: Journal, r: JointRecord, e: Evidence, captured: int): Journal =
  { ...j, records: j.records.append({ ...r, sequence: j.lastSequence + 1 }), retired: j.retired.union(r.parents),
    legacyRetired: j.legacyRetired.union(r.legacyParents), lastSequence: j.lastSequence + 1 }
type SourceKind = { indirect: bool, noChangePromotion: bool }
pure def needsJointRoute(j: Journal, source: int, kind: SourceKind): bool =
  kind.indirect or kind.noChangePromotion or jointSource(j, source)
pure def canAppendLegacy(j: Journal, l: LegacyRecord, kind: SourceKind): bool =
  l.source > 0 and l.digest > 0 and not(needsJointRoute(j, l.source, kind))
    and not(j.legacy.some(o => o.digest == l.digest)) and recordOf(j, l.digest).digest == 0
pure def lawIndirectOrPromotedWorkNeverTakesTheSingleRoute(j: Journal, l: LegacyRecord, kind: SourceKind): bool =
  (kind.indirect or kind.noChangePromotion) implies not(canAppendLegacy(j, l, kind))
pure def appendLegacy(j: Journal, l: LegacyRecord, kind: SourceKind): Journal =
  { ...j, legacy: j.legacy.append(l),
    legacyRetired: j.legacyRetired.union(currentLegacyOf(j, Set(l.source))) }
pure def lawOmittedOwnerRefused(j: Journal, r: JointRecord, e: Evidence, captured: int): bool =
  not(omitsNoCurrentOwner(j, r)) implies not(canAppendJoint(j, r, e, captured))
pure def lawStaleFenceRefused(j: Journal, r: JointRecord, e: Evidence, captured: int): bool =
  (captured != j.fence or not(I::active(j.install))) implies not(canAppendJoint(j, r, e, captured))
pure def lawOmittedLegacyRefused(j: Journal, r: JointRecord, e: Evidence, captured: int): bool =
  not(currentLegacyOf(j, r.sources).subseteq(r.legacyParents)) implies not(canAppendJoint(j, r, e, captured))
pure def alwaysOneCurrentCreditPerSource(j: Journal): bool =
  currentLegacy(j).every(l => not(jointSource(j, l.source))
    and currentLegacy(j).select(o => o.source == l.source).length() == 1)
pure def alwaysCurrentRecordsAreDisjoint(j: Journal): bool =
  liveRecords(j).every(a => liveRecords(j).every(b => a.digest == b.digest
    or (a.sources.intersect(b.sources).size() == 0 and a.claims.intersect(b.claims).size() == 0)))
pure def alwaysRecordsAreUnique(j: Journal): bool =
  j.records.every(r => r.digest > 0 and r.assessmentKey > 0 and r.sequence > 0 and r.sequence <= j.lastSequence
    and j.records.select(o => o.digest == r.digest).length() == 1
    and j.records.select(o => o.assessmentKey == r.assessmentKey).length() == 1 and reasonMatches(r)
    and (r.claims.size() > 0 implies r.units.length() > 0) and r.units.every(u => u.size() > 0 and u.subseteq(r.claims)))
pure def alwaysPredecessorsAreRetiredAndEarlier(j: Journal): bool =
  j.records.every(r => r.parents.forall(p => j.retired.contains(p) and recordOf(j, p).digest > 0
    and recordOf(j, p).sequence < r.sequence and recordOf(j, p).sources.subseteq(r.sources))
    and r.legacyParents.forall(d => j.legacyRetired.contains(d)
      and j.legacy.some(l => l.digest == d and r.sources.contains(l.source))))
pure def alwaysRetiredWereRecorded(j: Journal): bool =
  j.retired.forall(d => recordOf(j, d).digest > 0) and j.legacyRetired.forall(d => j.legacy.some(l => l.digest == d))
pure def sameRecord(a: JointRecord, b: JointRecord): bool =
  a.digest == b.digest and a.assessmentKey == b.assessmentKey and a.project == b.project and a.sequence == b.sequence
    and a.revisionReason == b.revisionReason and sameSet(a.sources, b.sources) and sameSet(a.claims, b.claims)
    and sameSet(a.parents, b.parents) and sameSet(a.legacyParents, b.legacyParents)
    and a.units.length() == b.units.length()
pure def stepJournalIsAppendOnly(before: Journal, after: Journal): bool =
  before.records.every(r => after.records.some(a => sameRecord(a, r)))
    and before.legacy.every(l => after.legacy.includes(l))
    and before.retired.subseteq(after.retired) and before.legacyRetired.subseteq(after.legacyRetired)
    and after.lastSequence >= before.lastSequence and after.fence >= before.fence
pure def stepGroupsOnlyMerge(before: Journal, after: Journal): bool =
  liveRecords(before).every(r => not(after.retired.contains(r.digest))
    or after.records.some(n => n.parents.contains(r.digest) and r.sources.subseteq(n.sources)))
pure def sometimesMerged(j: Journal): bool = j.records.some(r => r.parents.size() > 1)
pure def sometimesCorrected(j: Journal): bool =
  j.records.some(r => r.parents.size() == 1 and r.revisionReason != "" and not(j.retired.contains(r.digest)))
pure def sometimesSecondRoot(j: Journal): bool = liveRecords(j).length() > 1
pure def sometimesClaimlessGroupRecorded(j: Journal): bool = j.records.some(r => r.claims.size() == 0)
pure def sometimesLegacyConsumed(j: Journal): bool =
  j.records.some(r => r.legacyParents.size() > 0) and currentLegacy(j).length() == 0 and j.legacy.length() > 0
pure val claimOne: Claim = { id: 1, carriers: Set(1), credit: 1 }
pure val claimTwo: Claim = { id: 2, carriers: Set(1, 2), credit: 1 }
pure val claimThree: Claim = { id: 3, carriers: Set(2), credit: 2 }
pure val evidenceOne: Evidence = { project: 1, accepted: List(1), claims: List(claimOne), limitations: false }
pure val evidenceTwo: Evidence = { project: 1, accepted: List(2), claims: List(claimThree), limitations: false }
pure val evidenceJoint: Evidence = { project: 1, accepted: List(1, 2), claims: List(claimOne, claimTwo, claimThree), limitations: false }
pure val eValues = Set(evidenceOne, evidenceTwo, evidenceJoint, { ...evidenceJoint, limitations: true },
  { ...evidenceJoint, claims: List(claimOne, { ...claimTwo, credit: 2 }, claimThree) },
  { ...evidenceJoint, accepted: List(2, 1) }, { project: 1, accepted: List(3), claims: List(), limitations: false })
pure val recordOne: JointRecord = { digest: 1, assessmentKey: 1, project: 1, sources: Set(1), claims: Set(1),
  units: List(Set(1)), parents: Set(), legacyParents: Set(), revisionReason: "", sequence: 0 }
pure val rValues = Set(recordOne, { ...recordOne, legacyParents: Set(11), revisionReason: "legacy" },
  { ...recordOne, digest: 2, assessmentKey: 2, sources: Set(2), claims: Set(3), units: List(Set(3)) },
  { ...recordOne, digest: 3, assessmentKey: 3, sources: Set(1, 2), claims: Set(1, 2, 3), units: List(Set(1, 2), Set(3)),
    parents: Set(1, 2), revisionReason: "merge" },
  { ...recordOne, digest: 4, assessmentKey: 4, sources: Set(1, 2), claims: Set(1, 2, 3), units: List(Set(1, 2, 3)),
    parents: Set(1), revisionReason: "merge" },
  { ...recordOne, digest: 5, assessmentKey: 5, parents: Set(1), revisionReason: "correction" },
  { ...recordOne, digest: 6, assessmentKey: 6, sources: Set(1, 2), claims: Set(1, 2, 3), units: List(Set(1, 2), Set(2, 3)) },
  { ...recordOne, digest: 7, assessmentKey: 7, sources: Set(3), claims: Set(), units: List() })
pure val lValues = Set({ digest: 11, source: 1 }, { digest: 12, source: 2 }, { digest: 13, source: 1 })
pure val kindValues = Set({ indirect: false, noChangePromotion: false }, { indirect: true, noChangePromotion: false })
pure val changeValues = Set({ delivery: 1, kind: I::Created, sourceTime: 1, hasAccount: true, validTime: true },
  { delivery: 2, kind: I::Suspend, sourceTime: 2, hasAccount: true, validTime: true })
pure val capturedValues = Set(1, 2)
pure val firstValues = Set(0, 1)
pure val laterValues = Set(1, 2)
pure val jValues = Set(initial)
pure val weight_appendJoint = 8
pure val weight_appendLegacy = 3
```
