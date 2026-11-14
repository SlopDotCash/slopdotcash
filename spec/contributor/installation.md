# Immutable skill installation

This model covers PRD section 4 and legacy `skill_installation`,
`skill_install_process`, `skill_source_authority`, and `skill_validation_runtime`.
The [source authority component](./skillAuthority.md) verifies the immutable
GitHub commit, complete tree, D1 digest and deterministic rendering. This
unit owns one installed skill and each process-bound installation attempt.
The exact source for invocation and cleanup is `src/lib/install-command.ts`
at `6b3b9d0b979f0608d87941f1146056a98513ffcf`. Atomic filesystem operations
and verified GitHub bytes require shell conformance.

## Story: Install, update, and roll back a verified project skill

A contributor receives exact canonical bytes, keeps prior verified versions,
and authorizes installed skills locally without a live authorization request.

### Installation tracks verification, activation, and readback separately

The installation owns the finished version and the current process's files.
An invocation that fails cleanup can leave its own files for diagnosis. A
later invocation gets a different identity and may clean only its own paths.

```quint
type Version = { template: int, revision: int }
type InstallPhase = Idle | Downloading | Verifying | VerifiedBytes | Retained | LinkReady | Committed | ReadBack | Cleaning | Closing | Complete | Failed
type InstallOutput = NoOutput | Unchanged | Activated
type InstallError = NoError | BeforeCommitError | ReadbackError | CleanupError | LockReleaseError | Interrupted
type Installation = { phase: InstallPhase, locked: bool, processAlive: bool, attempt: int,
  template: int, revision: int, activeTemplate: int, activeRevision: int,
  oldTemplate: int, oldRevision: int, versions: List[Version], explicitRollback: bool, canonicalTree: bool,
  digestMatches: bool, permitted: bool, readback: bool, committed: bool, sameBytes: bool,
  workRoots: List[int], stagedCandidates: List[int], temporaryLinks: List[int],
  primary: InstallError, cleanupFailed: bool, localAuthorized: bool, output: InstallOutput }
pure val initial: Installation = { phase: Idle, locked: false, processAlive: true, attempt: 0,
  template: 0, revision: 0, activeTemplate: 0, activeRevision: 0,
  oldTemplate: 0, oldRevision: 0, versions: List(), explicitRollback: false, canonicalTree: false,
  digestMatches: false, permitted: false, readback: false, committed: false, sameBytes: false,
  workRoots: List(), stagedCandidates: List(), temporaryLinks: List(), primary: NoError,
  cleanupFailed: false, localAuthorized: false, output: NoOutput }
pure def openAttempt(i: Installation): bool = i.phase != Idle and i.phase != Complete and i.phase != Failed
pure def alwaysIdentities(i: Installation): bool = i.revision >= 0 and i.activeRevision >= 0 and i.attempt >= 0
  and i.versions.every(v => v.template > 0 and v.revision > 0)
  and (openAttempt(i) implies i.template > 0 and i.revision > 0 and i.attempt > 0 and i.locked)
```

### A living process acquires the lock before staging an admissible revision

Ordinary updates preserve or increase the approved D1 revision. Explicit
rollback selects a retained version and rechecks both sources and current
clearance. Template selection permits older or divergent committed content.
Unverified archive bytes do not create a work root. The checksum catches
corruption before staging and carries no source authority.

```quint
pure def retainedPair(i: Installation, template: int, revision: int): bool =
  i.versions.some(v => v.template == template and v.revision == revision)
pure def canBegin(i: Installation, template: int, revision: int, rollback: bool, permitted: bool): bool =
  not(i.locked) and i.processAlive and not(openAttempt(i)) and i.attempt < 9007199254740991
    and template > 0 and revision > 0 and permitted and
    (if (rollback) i.activeRevision > 0 and retainedPair(i, template, revision) else revision >= i.activeRevision)
pure def begin(i: Installation, template: int, revision: int, rollback: bool, permitted: bool): Installation =
  { ...i, phase: Downloading, locked: true, attempt: i.attempt + 1, template: template, revision: revision,
    explicitRollback: rollback, permitted: permitted, oldTemplate: i.activeTemplate,
    oldRevision: i.activeRevision, canonicalTree: false, digestMatches: false, readback: false,
    committed: false, sameBytes: false, primary: NoError, cleanupFailed: false, localAuthorized: false, output: NoOutput }
pure def canDownload(i: Installation, immutableUrl: bool, completeTree: bool): bool =
  i.phase == Downloading and i.locked and i.processAlive and immutableUrl and completeTree
pure def download(i: Installation, immutableUrl: bool, completeTree: bool): Installation =
  { ...i, phase: Verifying,
    workRoots: if (i.explicitRollback) i.workRoots else i.workRoots.append(i.attempt),
    stagedCandidates: if (i.explicitRollback) i.stagedCandidates else i.stagedCandidates.append(i.attempt) }
```

### An exact unchanged release keeps the installed identity

The existing target is verified before comparison. Rechecking the same pair,
or finding identical canonical rendering at the same D1 revision on an
ordinary update, leaves the active link and its recorded identity as found.
Rollback to a different retained pair is explicit and still activates that
pair even when the rendered bytes agree. A new candidate moves into the
immutable version store only if the verified pair is absent. Reusing an
existing version leaves the staged copy for cleanup.

```quint
pure def canVerify(i: Installation, canonicalTree: bool, approvedDigest: bool, sameRenderedBytes: bool, permitted: bool, sameBytes: bool): bool =
  i.phase == Verifying and i.locked and i.processAlive and canonicalTree and approvedDigest and sameRenderedBytes and permitted
    and (not(sameBytes) or (i.activeRevision > 0 and i.revision == i.activeRevision))
pure def verify(i: Installation, canonicalTree: bool, approvedDigest: bool, sameRenderedBytes: bool, permitted: bool, sameBytes: bool): Installation =
  { ...i, phase: VerifiedBytes, canonicalTree: true, digestMatches: true, permitted: true, sameBytes: sameBytes }
pure def unchanged(i: Installation): bool = (i.template == i.activeTemplate and i.revision == i.activeRevision)
  or (not(i.explicitRollback) and i.sameBytes)
pure def afterWork(i: Installation): InstallPhase = if (i.workRoots.includes(i.attempt)) Cleaning else Closing
pure def canRecordUnchanged(i: Installation): bool = i.phase == VerifiedBytes and i.processAlive and unchanged(i)
pure def recordUnchanged(i: Installation): Installation = { ...i, phase: afterWork(i), readback: true, output: Unchanged }
pure def canRetain(i: Installation): bool = i.phase == VerifiedBytes and i.processAlive and not(unchanged(i))
  and (not(i.explicitRollback) or retainedPair(i, i.template, i.revision))
pure def retain(i: Installation): Installation =
  if (retainedPair(i, i.template, i.revision)) { ...i, phase: Retained }
  else { ...i, phase: Retained, versions: i.versions.append({ template: i.template, revision: i.revision }),
    stagedCandidates: i.stagedCandidates.select(id => id != i.attempt) }
```

### Atomic publication keeps the committed target through cleanup and readback failure

The process builds a temporary relative symlink, then replaces the active link
atomically. Once that happens, a readback or cleanup failure reports the
committed target with its observed verification state. A prepared link that
could not be activated is removed if possible. Failure to remove it does not
allow deleting another attempt's temporary path. A successful readback emits
an activation result before cleanup and lock release.

```quint
pure def canPrepareLink(i: Installation): bool = i.phase == Retained and i.locked and i.processAlive
pure def prepareLink(i: Installation): Installation = { ...i, phase: LinkReady, temporaryLinks: i.temporaryLinks.append(i.attempt) }
pure def canCommit(i: Installation, relativeLink: bool, atomicRename: bool): bool =
  i.phase == LinkReady and i.locked and i.processAlive and i.canonicalTree and i.digestMatches and
  i.permitted and relativeLink and atomicRename
pure def commit(i: Installation, relativeLink: bool, atomicRename: bool): Installation =
  { ...i, phase: Committed, committed: true, activeTemplate: i.template, activeRevision: i.revision,
    temporaryLinks: i.temporaryLinks.select(id => id != i.attempt) }
pure def canConfirm(i: Installation, exactReadback: bool): bool = i.phase == Committed and i.processAlive and i.locked and exactReadback
pure def confirm(i: Installation, exactReadback: bool): Installation = { ...i, phase: ReadBack, readback: true }
pure def canEmitActivation(i: Installation): bool = i.phase == ReadBack and i.processAlive
pure def emitActivation(i: Installation): Installation = { ...i, phase: afterWork(i), output: Activated }
pure def canRecordFailure(i: Installation): bool = i.processAlive and
  (i.phase == Downloading or i.phase == Verifying or i.phase == VerifiedBytes or i.phase == Retained or i.phase == LinkReady or i.phase == Committed)
pure def recordFailure(i: Installation, temporaryLinkRemoved: bool): Installation =
  { ...i, phase: afterWork(i), primary: if (i.committed) ReadbackError else BeforeCommitError,
    cleanupFailed: i.phase == LinkReady and not(temporaryLinkRemoved),
    temporaryLinks: if (i.phase == LinkReady and temporaryLinkRemoved) i.temporaryLinks.select(id => id != i.attempt) else i.temporaryLinks }
```

### Finish reports its first failure and leaves unrelated attempt artifacts alone

Cleanup runs for the captured work root, then the kernel lock closes. When
another error already exists, a cleanup or lock error has secondary diagnostic
status. A process can die while holding the lock. Kernel recovery requires
confirmed death and leaves the selected committed version available for the
next invocation. Local authorization uses the fully verified installed files
and does not require a live GitHub or registry authorization request.

```quint
pure def canCleanup(i: Installation): bool = i.phase == Cleaning and i.processAlive and i.workRoots.includes(i.attempt)
pure def cleanup(i: Installation, succeeds: bool): Installation = { ...i, phase: Closing,
  primary: if (not(succeeds) and i.primary == NoError) CleanupError else i.primary,
  cleanupFailed: i.cleanupFailed or not(succeeds),
  workRoots: if (succeeds) i.workRoots.select(id => id != i.attempt) else i.workRoots,
  stagedCandidates: if (succeeds) i.stagedCandidates.select(id => id != i.attempt) else i.stagedCandidates }
pure def canFinish(i: Installation): bool = i.phase == Closing and i.processAlive
pure def finish(i: Installation, succeeds: bool): Installation =
  { ...i, phase: if (succeeds and i.primary == NoError) Complete else Failed,
    locked: false, primary: if (not(succeeds) and i.primary == NoError) LockReleaseError else i.primary }
pure def canProcessDies(i: Installation): bool = i.processAlive and i.locked
pure def processDies(i: Installation): Installation = { ...i, processAlive: false }
pure def canRecoverProcess(i: Installation): bool = not(i.processAlive)
pure def recoverProcess(i: Installation): Installation =
  { ...i, processAlive: true, locked: false, phase: Failed, primary: if (i.primary == NoError) Interrupted else i.primary }
pure def canAuthorizeLocal(i: Installation, completeLocalTree: bool, provenanceMatches: bool, schemaValid: bool): bool =
  i.activeRevision > 0 and completeLocalTree and provenanceMatches and schemaValid
pure def authorizeLocal(i: Installation, completeLocalTree: bool, provenanceMatches: bool, schemaValid: bool): Installation =
  { ...i, localAuthorized: true }
pure def alwaysSuccessHasReadback(i: Installation): bool = i.phase == Complete implies i.readback and i.primary == NoError
pure def alwaysActiveRetained(i: Installation): bool = i.activeRevision > 0 implies retainedPair(i, i.activeTemplate, i.activeRevision)
pure def alwaysCandidateVerified(i: Installation): bool =
  (i.phase == VerifiedBytes or i.phase == Retained or i.phase == LinkReady or i.phase == Committed or i.phase == ReadBack) implies
    i.canonicalTree and i.digestMatches and i.permitted
pure def alwaysCandidateRetained(i: Installation): bool =
  (i.phase == Retained or i.phase == LinkReady or i.phase == Committed or i.phase == ReadBack) implies retainedPair(i, i.template, i.revision)
pure def alwaysUncommittedRetainsActive(i: Installation): bool = (openAttempt(i) and not(i.committed)) implies
  i.activeTemplate == i.oldTemplate and i.activeRevision == i.oldRevision
pure def alwaysCleanupFacts(i: Installation): bool = i.stagedCandidates.every(id => i.workRoots.includes(id)) and
  (i.phase == Cleaning implies i.workRoots.includes(i.attempt)) and
  ((i.phase == Cleaning or i.phase == Closing) and i.primary == NoError implies i.readback)
pure def alwaysActivationOutput(i: Installation): bool = i.output == Activated implies i.committed and i.readback
pure def alwaysPublishedStage(i: Installation): bool =
  ((i.phase == Committed or i.phase == ReadBack) implies i.committed) and (i.phase == ReadBack implies i.readback)
pure def stepCommittedTarget(before: Installation, via: str, after: Installation): bool =
  via != "commit" implies before.activeTemplate == after.activeTemplate and before.activeRevision == after.activeRevision
pure def sometimesInstalled(i: Installation): bool = i.phase == Complete and i.output == Activated and i.activeRevision > 0
pure def sometimesLocalAuthorized(i: Installation): bool = i.localAuthorized
pure def sometimesRecovered(i: Installation): bool = i.phase == Failed and i.primary == Interrupted
pure def sometimesUnchanged(i: Installation): bool = i.phase == Complete and i.output == Unchanged
pure def sometimesCommittedAndUnverified(i: Installation): bool = i.phase == Failed and i.committed and not(i.readback)
```

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val revisionValues = Set(0, 1, 2)
pure val templateValues = Set(0, 1, 2)
pure val viaValues = Set("", "commit")
pure val weight_begin = 9
pure val weight_download = 10
pure val weight_verify = 20
pure val weight_retain = 10
pure val weight_commit = 13
pure val weight_confirm = 11
pure val weight_finish = 10
```
