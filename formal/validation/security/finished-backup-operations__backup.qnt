module operations__backup { // # Daily private backup and exact restoration

// PRD section 8 retains scanner recovery backups for thirty days and access
// logs for one year. Original `vetting_backup_chain` scenarios cover committed
// writes with lost responses, duplicate queue deliveries, incomplete manifests,
// corruption and destination conflicts. This machine represents one backup day.

// ## Story: Complete a verifiable backup before restoring private evidence

// ### Backup pages retain an ordered verified prefix and one complete manifest

// ```quint
type BackupPhase = NotStarted | Copying | BackupInterrupted | BackupComplete | BackupExpired
type RestorePhase = NoRestore | CheckingChain | WritingDestination | RestoreUncertain | Restored | RestoreRefused
type Backup = { phase: BackupPhase, expectedPages: int, sourceDigests: Set[int], pageDigests: int -> int, copiedPages: int, verifiedPages: int, manifestDigest: int, completeDigest: int, clockDay: int, backupDay: int, restore: RestorePhase, destinationDigest: int, sourceDigest: int, chainChecked: bool, destinationVerified: bool }
pure val initial: Backup = { phase: NotStarted, expectedPages: 0, sourceDigests: Set(), pageDigests: Map(), copiedPages: 0, verifiedPages: 0, manifestDigest: 0, completeDigest: 0, clockDay: 0, backupDay: 0, restore: NoRestore, destinationDigest: 0, sourceDigest: 0, chainChecked: false, destinationVerified: false }
pure def canStart(b: Backup, pages: int, digest: int): bool = b.phase == NotStarted and pages >= 0 and digest > 0
pure def start(b: Backup, pages: int, digest: int): Backup = { ...b, phase: Copying, expectedPages: pages, manifestDigest: digest, backupDay: b.clockDay }
pure val pagesValues = Set(0, 1, 2)
pure def canCopyPage(b: Backup, page: int, digest: int): bool = digest > 0 and b.phase == Copying and page == b.copiedPages and b.copiedPages < b.expectedPages and b.copiedPages == b.verifiedPages
pure def copyPage(b: Backup, page: int, digest: int): Backup = { ...b, copiedPages: b.copiedPages + 1, sourceDigests: b.sourceDigests.union(Set(digest)), pageDigests: b.pageDigests.put(page, digest) }
pure def canVerifyPage(b: Backup, page: int, observedDigest: int): bool = b.phase == Copying and observedDigest > 0 and observedDigest == b.pageDigests.std_getOr_operations__backup(page, 0) and page == b.verifiedPages and b.verifiedPages < b.copiedPages
pure def verifyPage(b: Backup, page: int, observedDigest: int): Backup = { ...b, verifiedPages: b.verifiedPages + 1 }
pure def canInterrupt(b: Backup): bool = b.phase == Copying
pure def interrupt(b: Backup): Backup = { ...b, phase: BackupInterrupted }
pure def canResume(b: Backup, digest: int): bool = b.phase == BackupInterrupted and digest == b.manifestDigest
pure def resume(b: Backup, digest: int): Backup = { ...b, phase: Copying }
pure def canFinish(b: Backup, digest: int): bool = b.phase == Copying and b.verifiedPages == b.expectedPages and b.copiedPages == b.expectedPages and digest == b.manifestDigest
pure def finish(b: Backup, digest: int): Backup = { ...b, phase: BackupComplete, completeDigest: digest }
pure def alwaysNotStartedEmpty(b: Backup): bool = b.phase == NotStarted implies b.expectedPages == 0 and b.copiedPages == 0 and b.verifiedPages == 0
pure def alwaysRestorePrepared(b: Backup): bool = (b.restore == WritingDestination or b.restore == RestoreUncertain or b.restore == Restored) implies b.chainChecked
pure def alwaysBackupPrefix(b: Backup): bool = b.verifiedPages >= 0 and b.verifiedPages <= b.copiedPages and b.copiedPages <= b.expectedPages
pure def alwaysCompleteManifest(b: Backup): bool = b.phase == BackupComplete implies b.completeDigest == b.manifestDigest and b.verifiedPages == b.expectedPages
// ```

// ### Restoration verifies the complete chain and observes the exact destination bytes

// Discovered by the proof. A backup starts with no copied or verified pages, and
// a destination write already has a verified source chain before readback.

// A create-only destination write may commit before its response is lost. A
// later readback must compare the expected digest. A conflicting preexisting
// object is refused and preserved. Duplicate deliveries reuse the same manifest.

// ```quint
pure def canBeginRestore(b: Backup, sourceDigest: int): bool = b.phase == BackupComplete and sourceDigest > 0 and b.sourceDigests.contains(sourceDigest) and (b.restore == NoRestore or b.restore == RestoreRefused)
pure def beginRestore(b: Backup, sourceDigest: int): Backup = { ...b, restore: CheckingChain, sourceDigest: sourceDigest, chainChecked: false, destinationVerified: false }
pure def canCheckChain(b: Backup, completeDigest: int, pagesMatch: bool): bool = b.restore == CheckingChain and completeDigest == b.completeDigest and pagesMatch
pure def checkChain(b: Backup, completeDigest: int, pagesMatch: bool): Backup = { ...b, restore: WritingDestination, chainChecked: true }
pure def canRefuseRestore(b: Backup): bool = b.restore == CheckingChain or b.restore == WritingDestination or b.restore == RestoreUncertain
pure def refuseRestore(b: Backup): Backup = { ...b, restore: RestoreRefused }
pure def canWriteDestination(b: Backup, digest: int): bool = b.restore == WritingDestination and b.chainChecked and digest == b.sourceDigest and (b.destinationDigest == 0 or b.destinationDigest == digest)
pure def writeDestination(b: Backup, digest: int): Backup = { ...b, destinationDigest: digest, restore: RestoreUncertain }
pure def canReadDestination(b: Backup, digest: int): bool = b.restore == RestoreUncertain and digest == b.sourceDigest and digest == b.destinationDigest
pure def readDestination(b: Backup, digest: int): Backup = { ...b, restore: Restored, destinationVerified: true }
pure def alwaysRestoredExact(b: Backup): bool = b.restore == Restored implies b.chainChecked and b.destinationVerified and b.destinationDigest == b.sourceDigest
pure def sometimesBackupComplete(b: Backup): bool = b.phase == BackupComplete
pure def sometimesRestored(b: Backup): bool = b.restore == Restored
pure def sometimesInterrupted(b: Backup): bool = b.phase == BackupInterrupted
// ```

// ### Backup expiry observes its own thirty-day retention

// ```quint
pure def canAdvanceDay(b: Backup, day: int): bool = day >= b.clockDay
pure def advanceDay(b: Backup, day: int): Backup = { ...b, clockDay: day }
pure val dayValues = Set(0, 29, 30, 31, 365)
pure def canExpireBackup(b: Backup): bool = b.phase == BackupComplete and b.clockDay - b.backupDay >= 30 and (b.restore == NoRestore or b.restore == Restored or b.restore == RestoreRefused)
pure def expireBackup(b: Backup): Backup = { ...b, phase: BackupExpired }
pure def retainAccessLog(ageDays: int): bool = ageDays >= 0 and ageDays < 365
// ```

// Expiry of a backup does not expire successful-admission source evidence or
// private case obligations. Restoration never activates a service by itself.

// ### Simulation samples exercise missing, matching and conflicting evidence

// These input sets bound simulation only. The generated guards accept every
// value allowed by their declared types and product rules.

// ```quint
pure val ageDaysValues = Set(0, 1, 2)
pure val completeDigestValues = Set(0, 1, 2)
pure val digestValues = Set(0, 1, 2)
pure val observedDigestValues = Set(0, 1, 2)
pure val pageValues = Set(0, 1, 2)
pure val sourceDigestValues = Set(0, 1, 2)
// ```

pure def std_getOr_operations__backup(std_m: a -> b, std_k: a, std_d: b): b = if (std_m.keys().contains(std_k)) std_m.get(std_k) else std_d
}
