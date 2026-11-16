# Daily private backup, retention and exact restoration

PRD section 8 retains scanner recovery backups for thirty days and access
logs for one year; CLAUDE.md keeps successful bounded admission-scan evidence
permanently (owner decision, 27 October 2026). The pinned sources are
`workers/vetting-backup/{core.ts,README.md}` and the legacy
`vetting_backup_chain`, `vetting_retention` and `vetting_generation_retirement`
models. Raw evidence generations and their retirement markers belong to the
[evidence specification](../security/evidence.md); this machine owns the
daily backup cycle, its retention selection, access-log cleanup and the
restoration check that gates enabling retention.

Day values are UTC days from the D1 clock. The `by` sender is the
authenticated release workflow or operator. Page digests are SHA-256 values
the Worker computes from the bytes it actually read, and restore read-backs
come from the private destination bucket.

## Story: Complete one verifiable backup cycle at a time

### One cycle copies an ordered verified prefix and completes one manifest

The scheduled start opens a cycle for each UTC day, in its own day prefix,
only when no cycle is copying, queued as failed or cleaning up; a completed or
cleaned cycle never blocks the next day's snapshot. A later cron resumes the
open cycle instead of starting an overlapping snapshot. The machine follows
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
type EvidenceObject = { id: int, closedDay: int, admission: bool, generation: Generation, declared: int, stored: int,
  marker: bool, copy: Copy, receiptDay: int, receiptDigest: int, retention: Retention }
type Backup = { phase: BackupPhase, cycleDay: int, clockDay: int, expectedPages: int, pageDigests: List[int], verifiedPages: int,
  failures: int, manifestDigest: int, completeDigest: int, restore: RestorePhase, restoreSource: int, destinationDigest: int,
  restorePrefix: Prefix, chainChecked: bool, restoredCycles: List[int], completedDays: List[int], retentionEnabled: bool,
  objects: List[EvidenceObject], accessLog: List[AuditEntry] }
pure val initial: Backup = { phase: NotStarted, cycleDay: 0, clockDay: 0, expectedPages: 0, pageDigests: List(), verifiedPages: 0,
  failures: 0, manifestDigest: 0, completeDigest: 0, restore: NoRestore, restoreSource: 0, destinationDigest: 0,
  restorePrefix: RestoreCheckPrefix, chainChecked: false, restoredCycles: List(), completedDays: List(), retentionEnabled: false,
  objects: List({ ...unclassified, id: 1, declared: 7, stored: 7 },
    { ...unclassified, id: 2, admission: true, declared: 7, stored: 7 },
    { ...unclassified, id: 3, generation: LegacyNullGeneration, declared: 7, stored: 7 },
    { ...unclassified, id: 4, declared: 7, stored: 8 },
    { ...unclassified, id: 5, declared: 7, stored: 0 }),
  accessLog: List({ day: 0, removed: false }, { day: 200, removed: false }) }
pure val unclassified: EvidenceObject = { id: 0, closedDay: 0, admission: false, generation: Generational, declared: 0, stored: 0,
  marker: false, copy: Unclassified, receiptDay: 0, receiptDigest: 0, retention: Kept }
pure def cycleOpen(b: Backup): bool = b.phase == Copying or b.phase == FailedQueue or b.phase == CleanupPending
pure def restoreInFlight(b: Backup): bool = b.restore == CheckingChain or b.restore == WritingDestination or b.restore == RestoreUncertain
pure def canStart(b: Backup, pages: int, digest: int): bool = not(cycleOpen(b)) and not(restoreInFlight(b))
  and pages >= 0 and digest > 0 and b.clockDay > b.cycleDay
pure def start(b: Backup, pages: int, digest: int): Backup = { ...b, phase: Copying, cycleDay: b.clockDay, expectedPages: pages,
  manifestDigest: digest, pageDigests: List(), verifiedPages: 0, failures: 0, completeDigest: 0, restore: NoRestore,
  restoreSource: 0, destinationDigest: 0, chainChecked: false }
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
```
