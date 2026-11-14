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
cover the same constraints.

This unit owns the write side of the joint journal: the claims of one
prepared group, their partition into outcomes, and each appended record
with its predecessors. The [value history](./valueHistory.md) reader
verifies the same constraints when it selects a current record. The
[value inference](./valueInference.md) unit supplies the retained result
and its publication fence. Identities stand for exact digests.

## Story: Prepare a group whose every claim is credited once

### A claim is one changed path in one commit and belongs to its first accepted carrier

Group collection follows current references and retained joint membership.
Its bounds are a collection limit, not a scoring cap: an unfinished group
stays pending and is never published in part. Each claim names a
repository, commit and path. Every pull request that carries the same
claim shares it, and the claim is credited to its first accepted carrier.
A carrier that only repeats an accepted claim never earns an independent
award. A limitation in any source refuses publication of the whole group.

```quint
type Claim = { id: int, carriers: Set[int], credit: int }
type Evidence = { project: int, sources: Set[int], claims: List[Claim], limitations: bool }
pure def claimIds(e: Evidence): Set[int] = e.claims.foldl(Set(), (ids, c) => ids.union(Set(c.id)))
pure def validClaim(e: Evidence, c: Claim): bool =
  c.id > 0 and c.carriers.size() > 0 and c.carriers.contains(c.credit) and c.carriers.subseteq(e.sources)
    and e.claims.select(o => o.id == c.id).length() == 1
pure def validEvidence(e: Evidence): bool =
  e.project > 0 and e.sources.size() > 0 and not(e.limitations) and e.claims.every(c => validClaim(e, c))
pure def lawCreditGoesToACarrier(e: Evidence, c: Claim): bool = validClaim(e, c) implies c.carriers.contains(c.credit)
pure def lawLimitedGroupIsNotPublishable(e: Evidence): bool = e.limitations implies not(validEvidence(e))
```

### A complete partition assigns every claim to exactly one outcome

Several claims of one pull request may belong to different outcomes, and
several pull requests may share one outcome. Every outcome is nonempty
and names only claims of the group. A partial or overlapping partition
refuses publication.

```quint
pure def completePartition(e: Evidence, units: List[Set[int]]): bool =
  units.length() > 0 and units.every(u => u.size() > 0 and u.subseteq(claimIds(e)))
    and claimIds(e).forall(id => units.select(u => u.contains(id)).length() == 1)
pure def lawPartialPartitionRefused(e: Evidence, units: List[Set[int]]): bool =
  claimIds(e).exists(id => not(units.some(u => u.contains(id)))) implies not(completePartition(e, units))
pure def lawOverlappingPartitionRefused(e: Evidence, units: List[Set[int]]): bool =
  claimIds(e).exists(id => units.select(u => u.contains(id)).length() > 1) implies not(completePartition(e, units))
```

## Story: Append a joint record that consumes every affected predecessor

### One transaction checks predecessors, sources, claims and the publication fence

A record appends once per assessment key, the digest of the source group,
rubric and producer revision. Its named predecessors must exist, still be
current and belong to the same project. It keeps every predecessor source.
Every current record that shares a source or claim with it must be a named
predecessor. The append retires those predecessors in the same
transaction, so a current group can grow by merging but never split.
The installation must be active and the live registry fence current.
After a source enters the joint journal, the older single-source journal
refuses any further record for it.

```quint
type Fence = { installationActive: bool, registryCurrent: bool }
type JointRecord = { digest: int, assessmentKey: int, project: int, sources: Set[int], claims: Set[int],
  parents: Set[int], sequence: int }
type Journal = { records: List[JointRecord], retired: Set[int], legacy: Set[int], lastSequence: int }
pure val initial: Journal = { records: List(), retired: Set(), legacy: Set(), lastSequence: 0 }
pure val noRecord: JointRecord = { digest: 0, assessmentKey: 0, project: 0, sources: Set(), claims: Set(),
  parents: Set(), sequence: 0 }
pure def recordOf(j: Journal, digest: int): JointRecord = j.records.select(r => r.digest == digest).nthOr(0, noRecord)
pure def liveRecords(j: Journal): List[JointRecord] = j.records.select(r => not(j.retired.contains(r.digest)))
pure def predecessorOk(j: Journal, r: JointRecord, parent: int): bool =
  val p = recordOf(j, parent)
  p.digest > 0 and not(j.retired.contains(parent)) and p.project == r.project and p.sources.subseteq(r.sources)
pure def omitsNoCurrentOwner(j: Journal, r: JointRecord): bool =
  liveRecords(j).every(o => (o.sources.intersect(r.sources).size() == 0 and o.claims.intersect(r.claims).size() == 0)
    or r.parents.contains(o.digest))
pure def canAppendJoint(j: Journal, r: JointRecord, e: Evidence, units: List[Set[int]], fence: Fence): bool =
  fence.installationActive and fence.registryCurrent and validEvidence(e) and completePartition(e, units)
    and r.digest > 0 and r.assessmentKey > 0 and recordOf(j, r.digest).digest == 0
    and not(j.records.some(o => o.assessmentKey == r.assessmentKey))
    and r.project == e.project and r.sources.subseteq(e.sources) and e.sources.subseteq(r.sources)
    and r.claims.subseteq(claimIds(e)) and claimIds(e).subseteq(r.claims)
    and r.parents.forall(p => predecessorOk(j, r, p)) and omitsNoCurrentOwner(j, r)
pure def appendJoint(j: Journal, r: JointRecord, e: Evidence, units: List[Set[int]], fence: Fence): Journal =
  { ...j, records: j.records.append({ ...r, sequence: j.lastSequence + 1 }), retired: j.retired.union(r.parents),
    lastSequence: j.lastSequence + 1 }
pure def canAppendLegacy(j: Journal, source: int): bool =
  source > 0 and not(j.records.some(r => r.sources.contains(source)))
pure def appendLegacy(j: Journal, source: int): Journal = { ...j, legacy: j.legacy.union(Set(source)) }
pure def lawOmittedOwnerRefused(j: Journal, r: JointRecord, e: Evidence, units: List[Set[int]], fence: Fence): bool =
  not(omitsNoCurrentOwner(j, r)) implies not(canAppendJoint(j, r, e, units, fence))
pure def lawStaleFenceRefused(j: Journal, r: JointRecord, e: Evidence, units: List[Set[int]], fence: Fence): bool =
  not(fence.installationActive and fence.registryCurrent) implies not(canAppendJoint(j, r, e, units, fence))
pure def alwaysCurrentRecordsAreDisjoint(j: Journal): bool =
  liveRecords(j).every(a => liveRecords(j).every(b => a.digest == b.digest
    or (a.sources.intersect(b.sources).size() == 0 and a.claims.intersect(b.claims).size() == 0)))
pure def alwaysRecordsAreUnique(j: Journal): bool =
  j.records.every(r => r.digest > 0 and r.assessmentKey > 0 and r.sequence > 0 and r.sequence <= j.lastSequence
    and j.records.select(o => o.digest == r.digest).length() == 1
    and j.records.select(o => o.assessmentKey == r.assessmentKey).length() == 1)
pure def alwaysPredecessorsAreRetiredAndEarlier(j: Journal): bool =
  j.records.every(r => r.parents.forall(p => j.retired.contains(p) and recordOf(j, p).digest > 0
    and recordOf(j, p).sequence < r.sequence and recordOf(j, p).sources.subseteq(r.sources)))
pure def alwaysRetiredWereRecorded(j: Journal): bool = j.retired.forall(d => recordOf(j, d).digest > 0)
pure def stepJournalIsAppendOnly(before: Journal, after: Journal): bool =
  before.records.every(r => after.records.some(a => a.digest == r.digest and a.assessmentKey == r.assessmentKey
    and a.sequence == r.sequence and a.sources.subseteq(r.sources) and r.sources.subseteq(a.sources)
    and a.claims.subseteq(r.claims) and r.claims.subseteq(a.claims) and a.parents.subseteq(r.parents)
    and r.parents.subseteq(a.parents))) and before.retired.subseteq(after.retired)
    and before.legacy.subseteq(after.legacy) and after.lastSequence >= before.lastSequence
pure def sometimesMerged(j: Journal): bool = j.records.some(r => r.parents.size() > 1)
pure def sometimesSecondRoot(j: Journal): bool = liveRecords(j).length() > 1
pure def sometimesLegacyThenJoint(j: Journal): bool = j.records.some(r => r.sources.intersect(j.legacy).size() > 0)
pure val claimOne: Claim = { id: 1, carriers: Set(1), credit: 1 }
pure val claimTwo: Claim = { id: 2, carriers: Set(1, 2), credit: 1 }
pure val claimThree: Claim = { id: 3, carriers: Set(2), credit: 2 }
pure val evidenceOne: Evidence = { project: 1, sources: Set(1), claims: List(claimOne), limitations: false }
pure val evidenceTwo: Evidence = { project: 1, sources: Set(2), claims: List(claimThree), limitations: false }
pure val evidenceJoint: Evidence = { project: 1, sources: Set(1, 2), claims: List(claimOne, claimTwo, claimThree), limitations: false }
pure val eValues = Set(evidenceOne, evidenceTwo, evidenceJoint, { ...evidenceJoint, limitations: true },
  { ...evidenceJoint, claims: List(claimOne, { ...claimTwo, credit: 3 }, claimThree) })
pure val rValues = Set(
  { digest: 1, assessmentKey: 1, project: 1, sources: Set(1), claims: Set(1), parents: Set(), sequence: 0 },
  { digest: 2, assessmentKey: 2, project: 1, sources: Set(2), claims: Set(3), parents: Set(), sequence: 0 },
  { digest: 3, assessmentKey: 3, project: 1, sources: Set(1, 2), claims: Set(1, 2, 3), parents: Set(1, 2), sequence: 0 },
  { digest: 4, assessmentKey: 4, project: 1, sources: Set(1, 2), claims: Set(1, 2, 3), parents: Set(1), sequence: 0 },
  { digest: 5, assessmentKey: 5, project: 1, sources: Set(1, 2), claims: Set(1, 2, 3), parents: Set(), sequence: 0 })
pure val unitsValues = Set(List(Set(1)), List(Set(3)), List(Set(1, 2), Set(3)), List(Set(1), Set(3)), List(Set(1, 2), Set(2, 3)))
pure val fenceValues = Set({ installationActive: true, registryCurrent: true }, { installationActive: false, registryCurrent: true })
pure val sourceValues = Set(1, 2)
pure val cValues = Set(claimOne, claimTwo, { ...claimTwo, credit: 3 })
pure val jValues = Set(initial)
pure val weight_appendJoint = 8
```
