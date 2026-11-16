# Daily private backup, retention and exact restoration

PRD section 8 retains scanner recovery backups for thirty days and access
logs for one year; CLAUDE.md keeps successful bounded admission-scan evidence
permanently (owner decision, 27 October 2026). The pinned sources are
`workers/vetting-backup/{core.ts,README.md}` and the legacy
`vetting_backup_chain`, `vetting_retention` and `vetting_generation_retirement`
models. The [evidence specification](../security/evidence.md) owns the
references to shared evidence; this machine owns the daily backup cycle, the
storage generations and their retirement, retention selection, access-log
cleanup and the restoration check that gates enabling retention. Its queue
is single-consumer (`max_concurrency = 1`, `max_batch_size = 1`,
`max_retries = 5`, dead-letter queue `slop-vetting-backup-failed`), and no
other service calls the backup or cleanup routines, so the queue's messages
are the only writers of the cycle and run one at a time.

Day values are UTC days from the D1 clock. The `by` sender is the
authenticated release workflow or operator. Page digests are SHA-256 values
the Worker computes from the bytes it actually read, and restore read-backs
come from the private destination bucket.

## Story: Complete one verifiable backup cycle at a time

### One cycle copies an ordered verified prefix and completes one manifest

The scheduled start records a cycle row for each UTC day, in its own day
prefix, and opens the earliest recorded cycle only when no cycle is copying,
queued as failed or cleaning up; a completed or cleaned cycle never blocks the
next day's snapshot. A later cron resumes the open cycle instead of starting
an overlapping snapshot, and a day recorded meanwhile waits behind it: a
cycle with a failure queue entry or without its `complete.json` blocks every
later cycle, its cleanup included. At most one page message is in flight. The machine follows
the latest cycle; earlier cycles' copies expire under the bucket's 30-day
lifecycle rule, an external storage obligation. Pages are copied and verified in order. A duplicate delivery of a
copied page changes nothing. A page that fails five times moves to the
private failure queue; neither a failure queue entry nor a missing completion
receipt is a successful backup. Replaying the failed work resumes at the same
cursor.

```quint
type BackupPhase = NotStarted | Copying | FailedQueue | BackupComplete | CleanupPending | Cleaned | BackupExpired
type RestorePhase = NoRestore | CheckingChain | WritingDestination | RestoreUncertain | Restored | RestoreRefused
type Prefix = RestoreCheckPrefix | LiveEvidencePrefix
type Generation = LegacyNullGeneration | Generational
type Copy = Unclassified | Backed | Changed | Missing
type Retention = Kept | PermanentAdmission | Deleted | RetentionHeld | RetentionMissing
type AuditEntry = { day: int, removed: bool }
type GenerationState = GenerationOpen | GenerationFrozen | GenerationRetired
type StorageGeneration = { id: int, lifecycle: GenerationState, referencesEligible: bool }
type Target = { key: int, generation: int, written: bool, published: bool, marker: bool, recorded: bool, copy: Copy }
type EvidenceObject = { id: int, closedDay: int, admission: bool, generation: Generation, declared: int, stored: int,
  marker: bool, copy: Copy, receiptDay: int, receiptDigest: int, retention: Retention }
type Backup = { phase: BackupPhase, cycleDay: int, clockDay: int, expectedPages: int, pageDigests: List[int], verifiedPages: int,
  failures: int, manifestDigest: int, completeDigest: int, restore: RestorePhase, restoreSource: int, destinationDigest: int,
  restorePrefix: Prefix, chainChecked: bool, restoredCycles: List[int], completedDays: List[int], retentionEnabled: bool,
  objects: List[EvidenceObject], accessLog: List[AuditEntry], startedDays: List[int], waitingDays: List[int],
  generations: List[StorageGeneration], targets: List[Target], retirementReleased: bool,
  deletionReceipts: List[int], retentionMissingTargets: List[int] }
pure val initial: Backup = { phase: NotStarted, cycleDay: 0, clockDay: 0, expectedPages: 0, pageDigests: List(), verifiedPages: 0,
  failures: 0, manifestDigest: 0, completeDigest: 0, restore: NoRestore, restoreSource: 0, destinationDigest: 0,
  restorePrefix: RestoreCheckPrefix, chainChecked: false, restoredCycles: List(), completedDays: List(), retentionEnabled: false,
  objects: List({ ...unclassified, id: 1, declared: 7, stored: 7 },
    { ...unclassified, id: 2, admission: true, declared: 7, stored: 7 },
    { ...unclassified, id: 3, generation: LegacyNullGeneration, declared: 7, stored: 7 },
    { ...unclassified, id: 4, declared: 7, stored: 8 },
    { ...unclassified, id: 5, declared: 7, stored: 0 }),
  accessLog: List({ day: 0, removed: false }, { day: 200, removed: false }), startedDays: List(), waitingDays: List(),
  generations: List({ id: 1, lifecycle: GenerationOpen, referencesEligible: false }, { id: 2, lifecycle: GenerationOpen, referencesEligible: false }),
  targets: List(), retirementReleased: false, deletionReceipts: List(), retentionMissingTargets: List() }
pure val unclassified: EvidenceObject = { id: 0, closedDay: 0, admission: false, generation: Generational, declared: 0, stored: 0,
  marker: false, copy: Unclassified, receiptDay: 0, receiptDigest: 0, retention: Kept }
pure def cycleOpen(b: Backup): bool = b.phase == Copying or b.phase == FailedQueue or b.phase == CleanupPending
pure def restoreInFlight(b: Backup): bool = b.restore == CheckingChain or b.restore == WritingDestination or b.restore == RestoreUncertain
pure def nextCycleDay(b: Backup): int = if (b.waitingDays.length() > 0) b.waitingDays.nthOr(0, 0) else b.clockDay
pure def canQueueDay(b: Backup): bool = cycleOpen(b) and b.clockDay > b.cycleDay and not(b.waitingDays.includes(b.clockDay))
pure def queueDay(b: Backup): Backup = { ...b, waitingDays: b.waitingDays.append(b.clockDay) }
pure def canStart(b: Backup, pages: int, digest: int): bool = not(cycleOpen(b)) and not(restoreInFlight(b))
  and pages >= 0 and digest > 0 and nextCycleDay(b) > b.cycleDay
pure def start(b: Backup, pages: int, digest: int): Backup = { ...b, phase: Copying, cycleDay: nextCycleDay(b), expectedPages: pages,
  manifestDigest: digest, pageDigests: List(), verifiedPages: 0, failures: 0, completeDigest: 0, restore: NoRestore,
  restoreSource: 0, destinationDigest: 0, chainChecked: false, startedDays: b.startedDays.append(nextCycleDay(b)),
  waitingDays: b.waitingDays.select(d => d != nextCycleDay(b)) }
pure def earlierCyclesComplete(b: Backup): bool = b.startedDays.every(d => d >= b.cycleDay or b.completedDays.includes(d))
pure def cleanupBlocked(b: Backup): bool = b.waitingDays.length() > 0 and (b.phase == Copying or b.phase == FailedQueue)
pure def canCopyPage(b: Backup, digest: int): bool = b.phase == Copying and digest > 0
  and b.pageDigests.length() < b.expectedPages and b.pageDigests.length() == b.verifiedPages
pure def copyPage(b: Backup, digest: int): Backup = { ...b, pageDigests: b.pageDigests.append(digest), failures: 0 }
pure def canVerifyPage(b: Backup, observedDigest: int): bool = b.phase == Copying and b.verifiedPages < b.pageDigests.length()
  and observedDigest == b.pageDigests.nthOr(b.verifiedPages, 0)
pure def verifyPage(b: Backup, observedDigest: int): Backup = { ...b, verifiedPages: b.verifiedPages + 1 }
pure def canFailPage(b: Backup): bool = b.phase == Copying and b.verifiedPages < b.expectedPages
pure def failPage(b: Backup): Backup =
  if (b.failures + 1 >= 5) { ...b, phase: FailedQueue, failures: b.failures + 1 } else { ...b, failures: b.failures + 1 }
pure def canReplayFailed(b: Backup, by: str): bool = b.phase == FailedQueue and by == "operator"
pure def replayFailed(b: Backup, by: str): Backup = { ...b, phase: Copying, failures: 0 }
pure def canFinish(b: Backup, digest: int): bool = b.phase == Copying and b.verifiedPages == b.expectedPages
  and b.pageDigests.length() == b.expectedPages and digest == b.manifestDigest
pure def finish(b: Backup, digest: int): Backup = { ...b, phase: BackupComplete, completeDigest: digest,
  completedDays: b.completedDays.append(b.cycleDay) }
pure def alwaysBackupPrefix(b: Backup): bool = b.verifiedPages >= 0 and b.verifiedPages <= b.pageDigests.length()
  and b.pageDigests.length() <= b.expectedPages and b.pageDigests.every(d => d > 0) and b.failures >= 0 and b.failures <= 5
  and (b.phase != FailedQueue implies b.failures < 5) and (b.phase != NotStarted implies b.manifestDigest > 0)
  and ((b.phase == NotStarted or b.phase == Copying or b.phase == FailedQueue) implies b.completeDigest == 0)
  and b.objects.every(o => o.retention != Kept implies o.closedDay > 0)
pure def alwaysCompleteManifest(b: Backup): bool =
  (b.phase == BackupComplete or b.phase == CleanupPending or b.phase == Cleaned or b.phase == BackupExpired) implies
    b.completeDigest == b.manifestDigest and b.completeDigest > 0 and b.verifiedPages == b.expectedPages
pure def alwaysFailedQueueIsNotComplete(b: Backup): bool = b.phase == FailedQueue implies b.completeDigest == 0 and b.failures == 5
pure def alwaysOneMessageInFlight(b: Backup): bool = b.pageDigests.length() <= b.verifiedPages + 1
  and ((b.phase == BackupComplete or b.phase == CleanupPending) implies b.pageDigests.length() == b.verifiedPages)
pure def alwaysCyclesInOrder(b: Backup): bool = earlierCyclesComplete(b)
  and b.startedDays.every(d => d > 0 and d <= b.cycleDay) and b.waitingDays.every(d => d > 0 and d <= b.clockDay)
  and (b.phase != NotStarted implies b.startedDays.includes(b.cycleDay))
  and (b.phase == NotStarted implies b.startedDays == List() and b.cycleDay == 0)
  and b.completedDays.every(d => b.startedDays.includes(d))
  and ((b.phase == BackupComplete or b.phase == CleanupPending or b.phase == Cleaned or b.phase == BackupExpired)
    implies b.completedDays.includes(b.cycleDay))
pure def stepCleanupNeverWhileBlocked(before: Backup, via: str, after: Backup): bool =
  (via == "beginCleanup" or via == "classify" or via == "writeMissingMarker" or via == "retain" or via == "freezeGeneration"
    or via == "markTarget" or via == "retireGeneration") implies (earlierCyclesComplete(before) and not(cleanupBlocked(before)))
pure def sometimesLaterDayBlocked(b: Backup): bool = b.phase == FailedQueue and cleanupBlocked(b)
pure def sometimesWaitingDayStarted(b: Backup): bool = b.startedDays.length() >= 2 and b.completedDays.length() >= 1
  and b.phase == Copying and b.cycleDay < b.clockDay
pure def stepReplayKeepsCursor(before: Backup, via: str, after: Backup): bool =
  via == "replayFailed" implies after.pageDigests == before.pageDigests and after.verifiedPages == before.verifiedPages
pure def sometimesFailedQueue(b: Backup): bool = b.phase == FailedQueue
pure def sometimesBackupComplete(b: Backup): bool = b.phase == BackupComplete
pure def sometimesConsecutiveDailyCycles(b: Backup): bool = b.completedDays.length() >= 2 and not(b.retentionEnabled)
pure def stepCycleDaysAdvance(before: Backup, after: Backup): bool = after.cycleDay >= before.cycleDay
  and after.completedDays.length() >= before.completedDays.length()
```

## Story: Restore only from a complete chain into an isolated prefix

### Restoration verifies the whole chain and reads back the exact bytes, never over live evidence

The check verifies the completion receipt and every page hash against the
retained chain, then writes create-only under the separate restore-check
prefix and reads the restored bytes back. It cannot replace a live evidence
key. A create-only write may commit before its response is lost; a later
readback compares the expected digest. A conflicting preexisting object is
refused and preserved.

```quint
pure def canBeginRestore(b: Backup, sourceDigest: int): bool =
  (b.phase == BackupComplete or b.phase == CleanupPending or b.phase == Cleaned)
    and b.pageDigests.includes(sourceDigest) and (b.restore == NoRestore or b.restore == RestoreRefused)
pure def beginRestore(b: Backup, sourceDigest: int): Backup =
  { ...b, restore: CheckingChain, restoreSource: sourceDigest, chainChecked: false, destinationDigest: 0 }
pure def canCheckChain(b: Backup, completeDigest: int, observedPages: List[int]): bool =
  b.restore == CheckingChain and completeDigest == b.completeDigest and observedPages == b.pageDigests
pure def checkChain(b: Backup, completeDigest: int, observedPages: List[int]): Backup = { ...b, restore: WritingDestination, chainChecked: true }
pure def canRefuseRestore(b: Backup): bool = b.restore == CheckingChain or b.restore == WritingDestination or b.restore == RestoreUncertain
pure def refuseRestore(b: Backup): Backup = { ...b, restore: RestoreRefused }
pure def canWriteDestination(b: Backup, prefix: Prefix, existingDigest: int): bool = b.restore == WritingDestination and b.chainChecked
  and prefix == RestoreCheckPrefix and (existingDigest == 0 or existingDigest == b.restoreSource)
pure def writeDestination(b: Backup, prefix: Prefix, existingDigest: int): Backup =
  { ...b, destinationDigest: b.restoreSource, restorePrefix: prefix, restore: RestoreUncertain }
pure def canReadDestination(b: Backup, digest: int): bool = b.restore == RestoreUncertain and digest == b.restoreSource and digest == b.destinationDigest
pure def readDestination(b: Backup, digest: int): Backup =
  { ...b, restore: Restored, restoredCycles: if (b.restoredCycles.includes(b.cycleDay)) b.restoredCycles else b.restoredCycles.append(b.cycleDay) }
pure def alwaysRestorePrepared(b: Backup): bool = (b.restore == WritingDestination or b.restore == RestoreUncertain or b.restore == Restored) implies b.chainChecked
pure def alwaysRestoredExact(b: Backup): bool = b.restore == Restored implies b.chainChecked and b.destinationDigest == b.restoreSource
  and b.restorePrefix == RestoreCheckPrefix
pure def alwaysNeverLivePrefix(b: Backup): bool = b.restorePrefix == RestoreCheckPrefix
pure def sometimesRestored(b: Backup): bool = b.restore == Restored
```

## Story: Delete raw evidence only under the enabled retention policy

### Retention needs a proven restoration, and never deletes admission evidence or unbacked bytes

Raw deletion stays disabled until the retention release variable is enabled
through the reviewed release, and enabling it requires a proven restoration
of a completed cycle. After a complete snapshot, cleanup selects only objects
whose case closed at least 90 days earlier. Successful admission-scan
evidence is permanent. Each cleanup classifies the selected generational
object against the current cycle: bytes whose digest the Worker read equal
the declared digest are `backed`, different bytes are `changed`, and an
absent target is `missing` only after a verified create-only missing marker.
The receipt is bound to the cycle day and its completion digest; a receipt of
an earlier cycle never qualifies a deletion. An earlier admitted write
either lands before the marker and is classified from its bytes, or loses
to the marker. A backed object may be deleted with a receipt; changed or
missing bytes record `retention-missing`; a legacy null-generation reference
records `retention-held`. A cycle with cleanup pending blocks the next
snapshot. That every writer follows the create-only protocol is an external
obligation of the evidence writers.

```quint
pure def canSetRetention(b: Backup, retention: bool, by: str): bool = by == "releaseWorkflow" and retention != b.retentionEnabled
  and (retention implies b.restoredCycles.length() > 0)
pure def setRetention(b: Backup, retention: bool, by: str): Backup = { ...b, retentionEnabled: retention }
pure def canCloseCase(b: Backup, id: int): bool = b.objects.some(o => o.id == id and o.closedDay == 0) and b.clockDay > 0
pure def closeCase(b: Backup, id: int): Backup =
  { ...b, objects: b.objects.listMap(o => if (o.id == id and o.closedDay == 0) { ...o, closedDay: b.clockDay } else o) }
pure def eligible(b: Backup, o: EvidenceObject): bool = o.closedDay > 0 and b.clockDay - o.closedDay >= 90 and o.retention == Kept
pure def retentionOutcome(o: EvidenceObject): Retention =
  if (o.admission) PermanentAdmission else if (o.generation == LegacyNullGeneration) RetentionHeld
  else if (o.copy == Backed) Deleted else RetentionMissing
pure def needsReceipt(o: EvidenceObject): bool = not(o.admission) and o.generation == Generational
pure def receiptCurrent(b: Backup, o: EvidenceObject): bool =
  o.copy != Unclassified and o.receiptDay == b.cycleDay and o.receiptDigest == b.completeDigest
pure def classification(o: EvidenceObject): Copy =
  if (o.stored == 0) Missing else if (o.stored == o.declared) Backed else Changed
pure def canLateWrite(b: Backup, id: int, digest: int): bool =
  digest > 0 and b.objects.some(o => o.id == id and o.stored == 0 and not(o.marker) and o.retention == Kept)
pure def lateWrite(b: Backup, id: int, digest: int): Backup =
  { ...b, objects: b.objects.listMap(o => if (o.id == id and o.stored == 0 and not(o.marker)) { ...o, stored: digest } else o) }
pure def canWriteMissingMarker(b: Backup, id: int): bool = b.phase == CleanupPending
  and b.objects.some(o => o.id == id and eligible(b, o) and needsReceipt(o) and o.stored == 0 and not(o.marker))
pure def writeMissingMarker(b: Backup, id: int): Backup =
  { ...b, objects: b.objects.listMap(o => if (o.id == id and o.stored == 0) { ...o, marker: true } else o) }
pure def canClassify(b: Backup, id: int): bool = b.phase == CleanupPending
  and b.objects.some(o => o.id == id and eligible(b, o) and needsReceipt(o) and not(receiptCurrent(b, o))
    and (o.stored > 0 or o.marker))
pure def classify(b: Backup, id: int): Backup =
  { ...b, objects: b.objects.listMap(o => if (o.id == id and eligible(b, o) and needsReceipt(o))
      { ...o, copy: classification(o), receiptDay: b.cycleDay, receiptDigest: b.completeDigest } else o) }
pure def canBeginCleanup(b: Backup): bool = b.phase == BackupComplete and b.retentionEnabled
pure def beginCleanup(b: Backup): Backup = { ...b, phase: CleanupPending }
pure def canRetain(b: Backup, id: int): bool = b.phase == CleanupPending and b.retentionEnabled
  and b.objects.some(o => o.id == id and eligible(b, o) and (needsReceipt(o) implies receiptCurrent(b, o)))
pure def retain(b: Backup, id: int): Backup =
  { ...b, objects: b.objects.listMap(o => if (o.id == id and eligible(b, o)) { ...o, retention: retentionOutcome(o) } else o) }
pure def canFinishCleanup(b: Backup): bool = b.phase == CleanupPending
pure def finishCleanup(b: Backup): Backup = { ...b, phase: Cleaned }
pure def alwaysAdmissionEvidencePermanent(b: Backup): bool = b.objects.every(o => o.admission implies o.retention != Deleted)
pure def alwaysDeletionOnlyBacked(b: Backup): bool = b.objects.every(o => o.retention == Deleted implies
  o.copy == Backed and o.stored == o.declared and o.stored > 0 and o.receiptDay > 0 and o.receiptDigest > 0
    and o.generation == Generational and o.closedDay > 0 and b.clockDay - o.closedDay >= 90)
pure def alwaysReceiptsMatchBytes(b: Backup): bool = b.objects.every(o =>
  (o.copy == Backed implies o.stored > 0 and o.stored == o.declared)
    and (o.copy == Changed implies o.stored > 0 and o.stored != o.declared)
    and (o.copy == Missing implies o.marker and o.stored == 0)
    and (o.marker implies o.stored == 0)
    and (o.copy != Unclassified implies o.receiptDay > 0 and o.receiptDigest > 0 and o.receiptDay <= b.cycleDay))
pure def stepStoredBytesCreateOnly(before: Backup, after: Backup): bool =
  before.objects.every(o => after.objects.some(a => a.id == o.id and a.declared == o.declared
    and (o.stored > 0 implies a.stored == o.stored) and (o.marker implies a.marker)))
pure def alwaysRetentionNeedsRestoration(b: Backup): bool = b.retentionEnabled implies b.restoredCycles.length() > 0
pure def stepRetentionFinal(before: Backup, after: Backup): bool =
  before.objects.every(o => o.retention != Kept implies after.objects.includes(o))
pure def sometimesDeleted(b: Backup): bool = b.objects.some(o => o.retention == Deleted)
pure def sometimesHeld(b: Backup): bool = b.objects.some(o => o.retention == RetentionHeld)
pure def sometimesMissingRecorded(b: Backup): bool = b.objects.some(o => o.retention == RetentionMissing)
pure def sometimesMissingAfterMarker(b: Backup): bool = b.objects.some(o => o.copy == Missing and o.retention == RetentionMissing)
pure def sometimesLateWriteBacked(b: Backup): bool = b.objects.some(o => o.id == 5 and o.copy == Backed)
pure def sometimesAdmissionKept(b: Backup): bool = b.objects.some(o => o.retention == PermanentAdmission)
```

## Story: Retire a storage generation only after every reserved target is marked and recorded

### Writers reserve a fresh target, and a frozen generation refuses reservations and pointer publication

Every writer reserves a fresh physical target in an open generation before
its create-only write; a repair publishes a new target through a pointer
compare-and-set and never overwrites an old one. A new reservation is a new
reference, so the generation no longer meets the retention predicate until
its references are closed again. Cleanup freezes a generation only when all
its remaining references meet the retention predicate, after a complete
snapshot, with no earlier cycle incomplete and retirement released. A frozen
or retired generation refuses new references, reservations and pointer
publication. An earlier admitted write to a reserved target still lands when
it precedes the target's marker.

```quint
pure val noTarget: Target = { key: 0, generation: 0, written: false, published: false, marker: false, recorded: false, copy: Unclassified }
pure val noGeneration: StorageGeneration = { id: 0, lifecycle: GenerationRetired, referencesEligible: false }
pure def generationOf(b: Backup, generation: int): StorageGeneration = b.generations.nthOr(generation - 1, noGeneration)
pure def targetOf(b: Backup, key: int): Target = b.targets.nthOr(key - 1, noTarget)
pure def withGeneration(b: Backup, generation: int, lifecycle: GenerationState, eligibleRefs: bool): List[StorageGeneration] =
  b.generations.listMap(g => if (g.id == generation) { ...g, lifecycle: lifecycle, referencesEligible: eligibleRefs } else g)
pure def withTarget(b: Backup, key: int, t: Target): List[Target] = b.targets.listMap(x => if (x.key == key) t else x)
pure def canReserveTarget(b: Backup, generation: int): bool = generationOf(b, generation).id == generation
  and generationOf(b, generation).lifecycle == GenerationOpen
pure def reserveTarget(b: Backup, generation: int): Backup =
  { ...b, targets: b.targets.append({ ...noTarget, key: b.targets.length() + 1, generation: generation }),
    generations: withGeneration(b, generation, GenerationOpen, false) }
pure def canWriteTarget(b: Backup, key: int): bool = targetOf(b, key).key == key and not(targetOf(b, key).written)
  and not(targetOf(b, key).marker)
pure def writeTarget(b: Backup, key: int): Backup = { ...b, targets: withTarget(b, key, { ...targetOf(b, key), written: true }) }
pure def canPublishPointer(b: Backup, key: int): bool = targetOf(b, key).key == key and targetOf(b, key).written
  and not(targetOf(b, key).published) and generationOf(b, targetOf(b, key).generation).lifecycle == GenerationOpen
pure def publishPointer(b: Backup, key: int): Backup = { ...b, targets: withTarget(b, key, { ...targetOf(b, key), published: true }) }
pure def canCloseReferences(b: Backup, generation: int): bool = generationOf(b, generation).id == generation
  and generationOf(b, generation).lifecycle == GenerationOpen and not(generationOf(b, generation).referencesEligible)
pure def closeReferences(b: Backup, generation: int): Backup = { ...b, generations: withGeneration(b, generation, GenerationOpen, true) }
pure def canSetRetirementRelease(b: Backup, released: bool, by: str): bool = by == "releaseWorkflow"
  and released != b.retirementReleased and (released implies b.restoredCycles.length() > 0)
pure def setRetirementRelease(b: Backup, released: bool, by: str): Backup = { ...b, retirementReleased: released }
pure def canFreezeGeneration(b: Backup, generation: int): bool = b.phase == CleanupPending and b.retentionEnabled
  and b.retirementReleased and earlierCyclesComplete(b) and generationOf(b, generation).id == generation
  and generationOf(b, generation).lifecycle == GenerationOpen and generationOf(b, generation).referencesEligible
pure def freezeGeneration(b: Backup, generation: int): Backup =
  { ...b, generations: withGeneration(b, generation, GenerationFrozen, true) }
pure def alwaysTargetsReservedFresh(b: Backup): bool = b.targets.every(t => t.key > 0 and targetOf(b, t.key) == t
  and generationOf(b, t.generation).id == t.generation)
  and b.generations.every(g => g.id > 0 and generationOf(b, g.id) == g)
pure def stepFrozenRefusesNewWork(before: Backup, after: Backup): bool =
  after.targets.every(t => generationOf(before, t.generation).lifecycle != GenerationOpen implies
    (targetOf(before, t.key).key == t.key and (t.published implies targetOf(before, t.key).published)))
  and before.generations.every(g => g.lifecycle != GenerationOpen implies generationOf(after, g.id).lifecycle != GenerationOpen)
pure def stepTargetsNeverRemoved(before: Backup, after: Backup): bool = after.targets.length() >= before.targets.length()
  and before.targets.every(t => targetOf(after, t.key).key == t.key and targetOf(after, t.key).generation == t.generation
    and (t.written implies targetOf(after, t.key).written) and (t.marker implies targetOf(after, t.key).marker)
    and (t.published implies targetOf(after, t.key).published))
pure def sometimesFrozenWithLateWrite(b: Backup): bool =
  b.targets.some(t => t.written and not(t.published) and generationOf(b, t.generation).lifecycle == GenerationFrozen)
```

### A generation retires only with a verified marker and a D1 record for every reserved target

The single consumer processes each reserved target of a frozen generation,
unpublished writes included. Existing bytes are copied and verified before a
permanent, non-evidence marker replaces them: an exact copy is `backed`,
different bytes `changed`, and an absent target `missing` behind its marker.
The D1 retirement record follows the verified marker. Retirement stays
disabled until the release variable is set after a proven restoration. A
retired generation's reference receives a deletion receipt only when its
target is backed; a changed or missing target records `retention-missing`.
Markers, receipts and records are permanent.

```quint
pure def canMarkTarget(b: Backup, key: int, exact: bool): bool = b.phase == CleanupPending and b.retirementReleased
  and earlierCyclesComplete(b) and targetOf(b, key).key == key and not(targetOf(b, key).marker)
  and generationOf(b, targetOf(b, key).generation).lifecycle == GenerationFrozen
pure def markTarget(b: Backup, key: int, exact: bool): Backup = { ...b, targets: withTarget(b, key, { ...targetOf(b, key), marker: true,
  copy: if (not(targetOf(b, key).written)) Missing else if (exact) Backed else Changed }) }
pure def canRecordRetirement(b: Backup, key: int): bool = targetOf(b, key).key == key and targetOf(b, key).marker
  and not(targetOf(b, key).recorded)
pure def recordRetirement(b: Backup, key: int): Backup = { ...b, targets: withTarget(b, key, { ...targetOf(b, key), recorded: true }) }
pure def generationMarked(b: Backup, generation: int): bool = b.targets.every(t => t.generation == generation implies t.marker and t.recorded)
pure def canRetireGeneration(b: Backup, generation: int): bool = b.phase == CleanupPending and b.retirementReleased
  and earlierCyclesComplete(b) and generationOf(b, generation).id == generation
  and generationOf(b, generation).lifecycle == GenerationFrozen and generationMarked(b, generation)
pure def retireGeneration(b: Backup, generation: int): Backup =
  { ...b, generations: withGeneration(b, generation, GenerationRetired, true) }
pure def referenceSettled(b: Backup, key: int): bool = b.deletionReceipts.includes(key) or b.retentionMissingTargets.includes(key)
pure def canSettleReference(b: Backup, key: int): bool = targetOf(b, key).key == key and not(referenceSettled(b, key))
  and generationOf(b, targetOf(b, key).generation).lifecycle == GenerationRetired
pure def settleReference(b: Backup, key: int): Backup =
  if (targetOf(b, key).copy == Backed) { ...b, deletionReceipts: b.deletionReceipts.append(key) }
  else { ...b, retentionMissingTargets: b.retentionMissingTargets.append(key) }
pure def alwaysRetiredFullyMarked(b: Backup): bool = b.generations.every(g => g.lifecycle == GenerationRetired implies generationMarked(b, g.id))
  and b.targets.every(t => (t.recorded implies t.marker) and (t.marker iff t.copy != Unclassified)
    and (t.copy == Missing implies not(t.written)) and (t.published implies t.written)
    and (t.marker implies generationOf(b, t.generation).lifecycle != GenerationOpen))
pure def alwaysReceiptsNeedBackedRetiredTargets(b: Backup): bool =
  b.deletionReceipts.every(k => targetOf(b, k).key == k and targetOf(b, k).copy == Backed
    and generationOf(b, targetOf(b, k).generation).lifecycle == GenerationRetired)
  and b.retentionMissingTargets.every(k => targetOf(b, k).key == k and targetOf(b, k).copy != Backed
    and generationOf(b, targetOf(b, k).generation).lifecycle == GenerationRetired)
pure def stepRetirementNeedsRelease(before: Backup, after: Backup): bool =
  after.generations.every(g => (g.lifecycle != GenerationOpen and generationOf(before, g.id).lifecycle == GenerationOpen)
    implies before.retirementReleased)
pure def stepSettlementsPermanent(before: Backup, after: Backup): bool =
  before.deletionReceipts.every(k => after.deletionReceipts.includes(k))
    and before.retentionMissingTargets.every(k => after.retentionMissingTargets.includes(k))
pure def sometimesGenerationRetired(b: Backup): bool = b.generations.some(g => g.lifecycle == GenerationRetired)
pure def sometimesDeletionReceipt(b: Backup): bool = b.deletionReceipts.length() > 0
pure def sometimesTargetMissingRecorded(b: Backup): bool = b.targets.some(t => t.copy == Missing and b.retentionMissingTargets.includes(t.key))
```

## Story: Expire backups and access logs on their own schedules

### Backups expire after thirty days and access-log entries after one year

The backup bucket's 30-day lifecycle expires a completed cycle. Expiry of a
backup never expires admission evidence, private case obligations or the
retained hash receipts. The daily invocation removes scanner access audit
entries older than one calendar year and nothing newer.

```quint
pure def canAdvanceDay(b: Backup, day: int): bool = day > b.clockDay
pure def advanceDay(b: Backup, day: int): Backup = { ...b, clockDay: day }
pure def canExpireBackup(b: Backup): bool = (b.phase == BackupComplete or b.phase == Cleaned) and b.clockDay - b.cycleDay >= 30
  and (b.restore == NoRestore or b.restore == Restored or b.restore == RestoreRefused)
pure def expireBackup(b: Backup): Backup = { ...b, phase: BackupExpired }
pure def canCleanAccessLog(b: Backup): bool = b.accessLog.some(e => not(e.removed) and b.clockDay - e.day > 365)
pure def cleanAccessLog(b: Backup): Backup =
  { ...b, accessLog: b.accessLog.listMap(e => if (b.clockDay - e.day > 365) { ...e, removed: true } else e) }
pure def stepAccessLogKeepsYear(before: Backup, after: Backup): bool = after.accessLog.length() == before.accessLog.length()
  and after.accessLog.every(e => e.removed or after.clockDay - e.day <= 365 or before.accessLog.includes(e))
pure def alwaysOnlyOldEntriesRemoved(b: Backup): bool = b.accessLog.every(e => e.removed implies b.clockDay - e.day > 365)
pure def sometimesExpired(b: Backup): bool = b.phase == BackupExpired
pure def sometimesAccessLogCleaned(b: Backup): bool = b.accessLog.some(e => e.removed) and b.accessLog.some(e => not(e.removed))
```

### Simulation samples exercise missing, matching and conflicting evidence

These sets bound simulation only.

```quint
pure val pagesValues = Set(0, 1, 2)
pure val digestValues = Set(0, 5, 6, 7)
pure val observedDigestValues = Set(5, 6)
pure val sourceDigestValues = Set(5, 6)
pure val completeDigestValues = Set(5, 6)
pure val observedPagesValues = Set(List(), List(5), List(5, 6), List(6))
pure val existingDigestValues = Set(0, 5, 6)
pure val prefixValues = Set(RestoreCheckPrefix, LiveEvidencePrefix)
pure val dayValues = Set(1, 31, 95, 400)
pure val idValues = Set(1, 2, 3, 4, 5)
pure val retentionValues = Set(true, false)
pure val byValues = Set("releaseWorkflow", "operator", "other")
pure val weight_copyPage = 6
pure val weight_verifyPage = 6
pure val weight_finish = 6
pure val weight_beginRestore = 5
pure val weight_checkChain = 5
pure val weight_writeDestination = 5
pure val weight_readDestination = 5
pure val weight_retain = 5
pure val weight_failPage = 12
pure val weight_replayFailed = 6
pure val weight_start = 6
pure val weight_classify = 6
pure val weight_writeMissingMarker = 4
pure val weight_beginCleanup = 4
pure val generationValues = Set(1, 2)
pure val keyValues = Set(1, 2)
pure val exactValues = Set(true, false)
pure val releasedValues = Set(true, false)
pure val weight_reserveTarget = 3
pure val weight_freezeGeneration = 8
pure val weight_markTarget = 8
pure val weight_recordRetirement = 8
pure val weight_retireGeneration = 8
pure val weight_settleReference = 8
pure val weight_setRetirementRelease = 4
```
