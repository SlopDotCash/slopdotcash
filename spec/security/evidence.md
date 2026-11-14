# Shared evidence retention and cleanup

PRD section 8 requires content-addressed private objects, permanent successful
admission evidence, reference-aware cleanup and verified recovery. One machine
represents one SHA-256 object shared by any number of scan runs. Its integer
digest is a symbolic identity whose bytes are checked by the storage adapter.

## Story: Preserve every retained reference to shared evidence

### References, permanent admission and pending uploads are separate

```quint
type Cleanup = Idle | DeleteClaimed | DeleteUncertain | AbsenceVerified | CleanupRecorded | CleanupHeld
type ScanResult = CleanScan | IncompleteScan | FailedScan | MaliciousScan
type WriterFence = Fenced | LegacyUnfenced
type Evidence = { refs: Set[int], permanent: Set[int], expired: Set[int], closeDays: int -> int, clockDay: int, uploads: int, digest: int, present: bool, verified: bool, backupDigest: int, backupVerified: bool, cleanup: Cleanup, safeDeletion: bool, generation: int, incident: bool }
pure val initial: Evidence = { refs: Set(), permanent: Set(), expired: Set(), closeDays: Map(), clockDay: 0, uploads: 0, digest: 1, present: false, verified: false, backupDigest: 0, backupVerified: false, cleanup: Idle, safeDeletion: true, generation: 1, incident: false }
pure val policyOwner = 18633264
pure def activeReferences(e: Evidence): Set[int] = e.refs.exclude(e.expired)
pure def allReferencesExpired(e: Evidence): bool = e.refs.forall(ref => e.expired.contains(ref))
pure def canRegisterReference(e: Evidence, ref: int): bool = ref > 0 and not(e.refs.contains(ref)) and e.cleanup == Idle
pure def registerReference(e: Evidence, ref: int): Evidence = { ...e, refs: e.refs.union(Set(ref)) }
pure def canStartUpload(e: Evidence): bool = e.cleanup == Idle and not(allReferencesExpired(e))
pure def startUpload(e: Evidence): Evidence = { ...e, uploads: e.uploads + 1 }
pure def canFinishUpload(e: Evidence, observedDigest: int): bool = e.uploads > 0 and observedDigest == e.digest
pure def finishUpload(e: Evidence, observedDigest: int): Evidence = { ...e, uploads: e.uploads - 1, present: true, verified: true }
pure def canFailUpload(e: Evidence, terminalNoncommit: bool): bool = e.uploads > 0 and terminalNoncommit
pure def failUpload(e: Evidence, terminalNoncommit: bool): Evidence = { ...e, uploads: e.uploads - 1 }
```

### Successful admission stays permanent and ordinary evidence waits ninety days

```quint
pure def canMarkPermanent(e: Evidence, ref: int): bool = e.refs.contains(ref) and not(e.expired.contains(ref)) and e.verified and e.cleanup == Idle and not(e.incident)
pure def markPermanent(e: Evidence, ref: int): Evidence = { ...e, permanent: e.permanent.union(Set(ref)) }
pure def canCloseReference(e: Evidence, ref: int, by: int, result: ScanResult): bool = e.refs.contains(ref) and not(e.closeDays.keys().contains(ref))
  and (if (result == CleanScan) by == 0 else by == policyOwner)
pure def closeReference(e: Evidence, ref: int, by: int, result: ScanResult): Evidence = { ...e, closeDays: e.closeDays.put(ref, e.clockDay) }
pure def canAdvanceDay(e: Evidence, day: int): bool = day >= e.clockDay
pure def advanceDay(e: Evidence, day: int): Evidence = { ...e, clockDay: day }
pure val dayValues = Set(0, 89, 90, 91, 180)
pure def canExpireReference(e: Evidence, ref: int): bool = e.refs.contains(ref) and not(e.permanent.contains(ref)) and e.closeDays.keys().contains(ref) and e.clockDay - e.closeDays.getOr(ref, e.clockDay) >= 90
pure def expireReference(e: Evidence, ref: int): Evidence = { ...e, expired: e.expired.union(Set(ref)) }
pure def alwaysPermanentRetained(e: Evidence): bool = e.permanent.forall(ref => not(e.expired.contains(ref)) and e.refs.contains(ref))
pure def alwaysReferenceHistory(e: Evidence): bool = e.expired.subseteq(e.refs) and e.uploads >= 0
```

### Last-reference cleanup excludes new references and waits for all admitted uploads

The cleanup claim is durable and fenced in D1. The implementation must preserve
legacy objects whose historical uploader cannot be fenced: the storage adapter
reports that writer fence, and an unfenced legacy writer turns the claim into
a held cleanup outcome rather than pretending an old writer cannot recreate
bytes. A missing source object is an incident that blocks cleanup and new
permanent marks until the exact bytes are restored from a verified backup.
After a recorded cleanup, identical bytes uploaded again start a new physical
generation with new references; earlier references stay expired history.
A clean scan closes its evidence automatically (system actor 0); failed,
incomplete and malicious cases need `lalalune` to close them.

```quint
pure def canVerifyBackup(e: Evidence, observedDigest: int): bool = e.present and e.verified and observedDigest == e.digest
pure def verifyBackup(e: Evidence, observedDigest: int): Evidence = { ...e, backupDigest: observedDigest, backupVerified: true }
pure def canClaimDelete(e: Evidence, fence: WriterFence): bool = e.cleanup == Idle and not(e.incident) and e.refs.size() > 0 and allReferencesExpired(e) and e.uploads == 0 and e.backupVerified and e.backupDigest == e.digest
pure def claimDelete(e: Evidence, fence: WriterFence): Evidence = { ...e, cleanup: if (fence == Fenced) DeleteClaimed else CleanupHeld }
pure def canReportMissingSource(e: Evidence, observedPresent: bool): bool = e.present and e.verified and not(observedPresent) and e.cleanup == Idle and not(e.incident)
pure def reportMissingSource(e: Evidence, observedPresent: bool): Evidence = { ...e, incident: true }
pure def canRecoverSource(e: Evidence, observedDigest: int): bool = e.incident and observedDigest == e.digest and e.backupVerified and e.backupDigest == e.digest
pure def recoverSource(e: Evidence, observedDigest: int): Evidence = { ...e, incident: false }
pure def canStartGeneration(e: Evidence): bool = e.cleanup == CleanupRecorded
pure def startGeneration(e: Evidence): Evidence = { ...e, cleanup: Idle, generation: e.generation + 1, backupVerified: false, backupDigest: 0 }
pure def canDeleteBytes(e: Evidence): bool = e.cleanup == DeleteClaimed and e.uploads == 0 and allReferencesExpired(e) and e.backupVerified and e.backupDigest == e.digest
pure def deleteBytes(e: Evidence): Evidence = { ...e, present: false, verified: false, cleanup: DeleteUncertain, safeDeletion: e.safeDeletion and allReferencesExpired(e) and e.permanent.size() == 0 }
pure def canObserveAbsence(e: Evidence, absent: bool): bool = e.cleanup == DeleteUncertain and absent and not(e.present)
pure def observeAbsence(e: Evidence, absent: bool): Evidence = { ...e, cleanup: AbsenceVerified }
pure def canRecordCleanup(e: Evidence): bool = e.cleanup == AbsenceVerified
pure def recordCleanup(e: Evidence): Evidence = { ...e, cleanup: CleanupRecorded }
pure def alwaysDeletionAuthorized(e: Evidence): bool = e.safeDeletion
pure def stepRetainsReferences(before: Evidence, after: Evidence): bool = before.refs.subseteq(after.refs) and before.permanent.subseteq(after.permanent)
pure def sometimesPermanent(e: Evidence): bool = e.permanent.size() > 0
pure def sometimesCleaned(e: Evidence): bool = e.cleanup == CleanupRecorded
pure def sometimesShared(e: Evidence): bool = activeReferences(e).size() > 1
pure def sometimesHeld(e: Evidence): bool = e.cleanup == CleanupHeld
pure def sometimesIncident(e: Evidence): bool = e.incident
pure def sometimesRegeneration(e: Evidence): bool = e.generation > 1 and activeReferences(e).size() > 0
```

A missing source object is an incident requiring recovery, not evidence of
successful cleanup. Partial multipart deletion retains the claim and per-part
observations. Backup corruption, unavailable reads and source digest mismatch
block cleanup. No timeout creates a deletion receipt.

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val observedDigestValues = Set(0, 1, 2)
pure val refValues = Set(0, 1, 2, 3)
pure val byValues = Set(0, 18633264, 7)
```
