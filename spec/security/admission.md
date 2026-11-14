# Repository admission scan

PRD section 8 requires complete review of one immutable repository commit.
The model counts inventory entries and reviewed entries without imposing a
repository-size refusal. Counts represent exact manifest cardinalities.
Every chunk's digest, source path and source range must be retained by the
implementation. A count alone is insufficient evidence of actual coverage.

## Story: Review every acquired item before granting admission

A maintainer can receive clearance only for the exact fetched revision after
all deterministic checks, contextual review and repository synthesis finish.

### A scan records acquisition, coverage, synthesis and retention separately

```quint
type ScanPhase = Unrequested | Acquiring | Reviewing | Interrupted | Incomplete | Clean | Malicious
type Scan = { phase: ScanPhase, repository: int, commit: int, inventory: int, reviewed: int, fetched: bool, deterministic: bool, synthesis: bool, retained: bool, permanent: bool }
pure val initial: Scan = { phase: Unrequested, repository: 0, commit: 0, inventory: 0, reviewed: 0, fetched: false, deterministic: false, synthesis: false, retained: false, permanent: false }
```

### Acquisition binds one shallow fetch to the requested repository and commit

```quint
pure def canRequest(s: Scan, repository: int, commit: int): bool = s.phase == Unrequested and repository > 0 and commit > 0
pure def request(s: Scan, repository: int, commit: int): Scan = { ...s, phase: Acquiring, repository: repository, commit: commit }
pure def canAcquire(s: Scan, repository: int, commit: int, entries: int): bool = s.phase == Acquiring and repository == s.repository and commit == s.commit and entries >= 0
pure def acquire(s: Scan, repository: int, commit: int, entries: int): Scan = { ...s, phase: Reviewing, inventory: entries, fetched: true }
pure val entriesValues = Set(0, 1, 2, 1000000)
```

### Every reviewed batch covers distinct inventory entries

The adapter proves that a batch names previously unreviewed manifest entries.
The `distinct` input is the result of that set-membership check, never a model
judgment. Batch size is determined by the provider token budget. Files and
repositories exceeding one batch remain admissible.

```quint
pure def canReviewBatch(s: Scan, count: int, distinct: bool): bool = s.phase == Reviewing and distinct and count > 0 and count <= s.inventory - s.reviewed
pure def reviewBatch(s: Scan, count: int, distinct: bool): Scan = { ...s, reviewed: s.reviewed + count }
pure val countValues = Set(1, 2, 1000000)
pure def canCheckDeterministically(s: Scan): bool = s.phase == Reviewing
pure def checkDeterministically(s: Scan): Scan = { ...s, deterministic: true }
pure def canSynthesize(s: Scan): bool = s.phase == Reviewing and s.reviewed == s.inventory and s.deterministic
pure def synthesize(s: Scan): Scan = { ...s, synthesis: true }
```

### Evidence durability precedes a clean result

Objects use SHA-256 identities, 8 MiB upload parts and a complete private R2
manifest. Successful admission and any original evidence used by a reused
result are retained permanently. The adapter verifies every referenced object.

```quint
pure def canRetain(s: Scan, verifiedObjects: bool): bool = s.phase == Reviewing and verifiedObjects
pure def retain(s: Scan, verifiedObjects: bool): Scan = { ...s, retained: true }
pure def canPass(s: Scan): bool = s.phase == Reviewing and s.fetched and s.reviewed == s.inventory and s.deterministic and s.synthesis and s.retained
pure def pass(s: Scan): Scan = { ...s, phase: Clean, permanent: true }
pure def alwaysCompleteClean(s: Scan): bool = s.phase == Clean implies s.fetched and s.reviewed == s.inventory and s.deterministic and s.synthesis and s.retained and s.permanent
pure def alwaysCoverageBounds(s: Scan): bool = s.inventory >= 0 and s.reviewed >= 0 and s.reviewed <= s.inventory
```

### Permanent evidence stays retained and acquisition starts without reviewed entries

Discovered by the proof. A saved state that marks evidence permanent while
dropping its retained objects cannot represent a completed admission. Before
acquisition supplies the manifest, both inventory and reviewed counts are zero.
These facts let every transition preserve the coverage and retention rules.

```quint
pure def alwaysPermanentRetained(s: Scan): bool = s.permanent implies s.retained
pure def alwaysBeforeAcquisitionCoverage(s: Scan): bool =
  (s.phase == Unrequested or s.phase == Acquiring) implies s.inventory == 0 and s.reviewed == 0
```

### Interrupted and incomplete review can resume without granting admission

```quint
pure def canInterrupt(s: Scan): bool = s.phase == Reviewing
pure def interrupt(s: Scan): Scan = { ...s, phase: Interrupted }
pure def canMarkIncomplete(s: Scan): bool = s.phase == Reviewing
pure def markIncomplete(s: Scan): Scan = { ...s, phase: Incomplete }
pure def canResume(s: Scan): bool = s.phase == Interrupted or s.phase == Incomplete
pure def resume(s: Scan): Scan = { ...s, phase: Reviewing }
pure def canRecordMalice(s: Scan): bool = s.phase == Reviewing
pure def recordMalice(s: Scan): Scan = { ...s, phase: Malicious }
pure def stepPreservesPermanentEvidence(before: Scan, after: Scan): bool = before.permanent implies after.permanent and after.retained
pure def sometimesClean(s: Scan): bool = s.phase == Clean
pure def sometimesIncomplete(s: Scan): bool = s.phase == Incomplete
pure def sometimesMalicious(s: Scan): bool = s.phase == Malicious
```

A clean assessment records only the evaluated commit. Routine later changes
retain admission under policy, without claiming the changed bytes were scanned.
A different immutable repository identity must obtain its own admission.
Risky artifacts use one disposable sandbox each with internet disabled and no
secrets. Deterministic matches require contextual model review. Uncovered
executable content prevents a pass.

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val commitValues = Set(0, 1, 2)
pure val repositoryValues = Set(0, 1, 2)
```
