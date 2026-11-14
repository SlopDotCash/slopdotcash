# Immutable skill installation

This model covers PRD section 4, CLAUDE.md "Installer and attribution" and
legacy `skill_installation`, `skill_install_process`, `skill_source_authority`
and `skill_validation_runtime`. The [source authority component](./skillAuthority.md)
admits the immutable GitHub commit, complete tree, D1 digest and deterministic
rendering; this unit stages only bytes from an admitted read of exactly the
requested pair, and rechecks current project clearance
(`frontend/projections.md` `installable`) before it begins, before it
verifies, and before every rollback. This unit owns one installed skill and
each process-bound installation attempt. The exact source for invocation and
cleanup is `src/lib/install-command.ts` at
`6b3b9d0b979f0608d87941f1146056a98513ffcf`. A version is named
`<commit>-r<revision>` and its provenance records `revisionStatus:
committed`, the file manifest and the registry binding (project, revision,
manifest digest). Atomic filesystem operations and verified GitHub bytes
require shell conformance.

## Story: Install, update, and roll back a verified project skill

A contributor receives exact canonical bytes, keeps prior verified versions,
and authorizes installed skills locally without a live authorization request.

### Installation tracks verification, activation, and readback separately

The installation owns the finished version and the current process's files.
The Python process owns the kernel lock; killing only its shell wrapper loses
the wrapper's output but neither stops the Python process nor releases the
lock. An invocation that fails cleanup can leave its own files for diagnosis.
A later invocation gets a different identity and may clean only its own
paths: artifacts of a dead earlier attempt are retained permanently for
diagnosis and no transition removes them.

```quint
import skillAuthority as SA from "./skillAuthority"
import projections as F from "../frontend/projections"
type Version = { template: str, revision: int, digest: str }
type InstallPhase = Idle | Downloading | Verifying | VerifiedBytes | Retained | LinkReady | Committed | ReadBack | Cleaning | Closing | Complete | Failed
type InstallOutput = NoOutput | Unchanged | Activated
type InstallError = NoError | BeforeCommitError | ReadbackError | CleanupError | LockReleaseError | Interrupted
type LocalAuthorization = NotChecked | LocalAuthorized | LocalRefused
type LocalCheck = { version: Version, provenance: SA::Provenance, completeTree: bool, schemaValid: bool }
type Installation = { phase: InstallPhase, locked: bool, processAlive: bool, wrapperAlive: bool, attempt: int,
  target: Version, active: Version, old: Version, versions: List[Version], explicitRollback: bool, explicitTemplate: bool,
  admitted: bool, cleared: bool, readback: bool, committed: bool, sameBytes: bool,
  workRoots: List[int], stagedCandidates: List[int], temporaryLinks: List[int],
  primary: InstallError, cleanupFailed: bool, local: LocalAuthorization, output: InstallOutput, delivered: bool }
pure val noVersion: Version = { template: "", revision: 0, digest: "" }
pure val initial: Installation = { phase: Idle, locked: false, processAlive: true, wrapperAlive: true, attempt: 0,
  target: noVersion, active: noVersion, old: noVersion, versions: List(), explicitRollback: false, explicitTemplate: false,
  admitted: false, cleared: false, readback: false, committed: false, sameBytes: false,
  workRoots: List(), stagedCandidates: List(), temporaryLinks: List(), primary: NoError,
  cleanupFailed: false, local: NotChecked, output: NoOutput, delivered: false }
pure def validVersion(v: Version): bool = v.template != "" and v.revision > 0 and v.digest != ""
pure def openAttempt(i: Installation): bool = i.phase != Idle and i.phase != Complete and i.phase != Failed
pure def alwaysIdentities(i: Installation): bool = i.attempt >= 0 and i.active.revision >= 0
  and i.versions.every(v => validVersion(v))
  and (i.active.revision > 0 implies validVersion(i.active))
  and (openAttempt(i) implies validVersion(i.target) and i.attempt > 0 and i.locked)
  and i.workRoots.every(id => 0 < id and id <= i.attempt) and i.temporaryLinks.every(id => 0 < id and id <= i.attempt)
```

### A living process acquires the lock before staging an admitted revision

Ordinary updates preserve or increase the approved D1 revision. Explicit
rollback selects a retained version and rechecks both sources and current
clearance. Template selection permits older, divergent or previously revoked
committed content; there is no freshness, ancestry, release-label or
revocation gate. Only bytes from an admitted authority read of exactly the
requested commit, D1 revision and registry digest are staged. Unverified
archive bytes do not create a work root.

```quint
pure def retainedVersion(i: Installation, v: Version): bool = i.versions.includes(v)
pure def canBegin(i: Installation, version: Version, rollback: bool, explicitTemplate: bool, view: F::ProjectView): bool =
  not(i.locked) and i.processAlive and not(openAttempt(i)) and i.attempt < 9007199254740991
    and validVersion(version) and F::installable(view) and
    (if (rollback) i.active.revision > 0 and retainedVersion(i, version) else version.revision >= i.active.revision)
pure def begin(i: Installation, version: Version, rollback: bool, explicitTemplate: bool, view: F::ProjectView): Installation =
  { ...i, phase: Downloading, locked: true, wrapperAlive: true, attempt: i.attempt + 1, target: version,
    explicitRollback: rollback, explicitTemplate: explicitTemplate, old: i.active, admitted: false, cleared: true,
    readback: false, committed: false, sameBytes: false, primary: NoError, cleanupFailed: false, output: NoOutput, delivered: false }
pure def readMatches(i: Installation, read: SA::SkillRead): bool = read.transport == SA::Admitted
  and read.selection.role != SA::StaticSkill and read.selection.commit == i.target.template
  and read.selection.registryRevision == i.target.revision and read.selection.registryDigest == i.target.digest
pure def canDownload(i: Installation, read: SA::SkillRead): bool =
  i.phase == Downloading and i.locked and i.processAlive and readMatches(i, read)
pure def download(i: Installation, read: SA::SkillRead): Installation =
  { ...i, phase: Verifying, admitted: true,
    workRoots: if (i.explicitRollback) i.workRoots else i.workRoots.append(i.attempt),
    stagedCandidates: if (i.explicitRollback) i.stagedCandidates else i.stagedCandidates.append(i.attempt) }
```

### An exact unchanged release keeps the installed identity

The existing target is verified before comparison, and current clearance is
read again. Rechecking the same pair, or finding identical canonical
rendering at the same D1 revision on an ordinary update, leaves the active
link and its recorded identity as found. An explicit template selection of a
different commit, and rollback to a different retained pair, still activate
the requested pair even when the rendered bytes agree, so the recorded
provenance names what was selected. A new candidate moves into the immutable
version store only if the verified pair is absent. Reusing an existing
version leaves the staged copy for cleanup.

```quint
pure def canVerify(i: Installation, view: F::ProjectView, sameBytes: bool): bool =
  i.phase == Verifying and i.locked and i.processAlive and i.admitted and F::installable(view)
    and (not(sameBytes) or (i.active.revision > 0 and i.target.revision == i.active.revision))
pure def verify(i: Installation, view: F::ProjectView, sameBytes: bool): Installation =
  { ...i, phase: VerifiedBytes, cleared: true, sameBytes: sameBytes }
pure def canRefuseClearance(i: Installation, view: F::ProjectView): bool =
  i.phase == Verifying and i.processAlive and not(F::installable(view))
pure def refuseClearance(i: Installation, view: F::ProjectView): Installation =
  { ...i, phase: if (i.workRoots.includes(i.attempt)) Cleaning else Closing, cleared: false, primary: BeforeCommitError }
pure def unchanged(i: Installation): bool = i.target == i.active
  or (not(i.explicitRollback) and not(i.explicitTemplate) and i.sameBytes)
pure def afterWork(i: Installation): InstallPhase = if (i.workRoots.includes(i.attempt)) Cleaning else Closing
pure def canRecordUnchanged(i: Installation): bool = i.phase == VerifiedBytes and i.processAlive and unchanged(i)
pure def recordUnchanged(i: Installation): Installation = { ...i, phase: afterWork(i), readback: true, output: Unchanged,
  delivered: i.wrapperAlive }
pure def canRetain(i: Installation): bool = i.phase == VerifiedBytes and i.processAlive and not(unchanged(i))
  and (not(i.explicitRollback) or retainedVersion(i, i.target))
pure def retain(i: Installation): Installation =
  if (retainedVersion(i, i.target)) { ...i, phase: Retained }
  else { ...i, phase: Retained, versions: i.versions.append(i.target),
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
  i.phase == LinkReady and i.locked and i.processAlive and i.admitted and i.cleared and relativeLink and atomicRename
pure def commit(i: Installation, relativeLink: bool, atomicRename: bool): Installation =
  { ...i, phase: Committed, committed: true, active: i.target,
    temporaryLinks: i.temporaryLinks.select(id => id != i.attempt) }
pure def canConfirm(i: Installation, exactReadback: bool): bool = i.phase == Committed and i.processAlive and i.locked and exactReadback
pure def confirm(i: Installation, exactReadback: bool): Installation = { ...i, phase: ReadBack, readback: true }
pure def canEmitActivation(i: Installation): bool = i.phase == ReadBack and i.processAlive
pure def emitActivation(i: Installation): Installation = { ...i, phase: afterWork(i), output: Activated, delivered: i.wrapperAlive }
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
status. The Python process can die while holding the lock; the kernel then
releases it, and the committed version stays available for the next
invocation.

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
pure def canWrapperDies(i: Installation): bool = i.wrapperAlive and openAttempt(i)
pure def wrapperDies(i: Installation): Installation = { ...i, wrapperAlive: false }
pure def canProcessDies(i: Installation): bool = i.processAlive and i.locked
pure def processDies(i: Installation): Installation = { ...i, processAlive: false }
pure def canRecoverProcess(i: Installation): bool = not(i.processAlive)
pure def recoverProcess(i: Installation): Installation =
  { ...i, processAlive: true, locked: false, phase: Failed, primary: if (i.primary == NoError) Interrupted else i.primary }
```

### Local authorization uses only the verified installed files

Installed `authorize` and `start` validate local provenance, complete hashes
and receipt schema without a live GitHub or registry authorization call. A
local checkout is not an installation: working-tree or missing provenance is
refused, and so is any version other than the active verified one. The
result is recorded, including refusal.

```quint
pure def canAuthorizeLocal(i: Installation, check: LocalCheck): bool = not(openAttempt(i))
pure def authorizeLocal(i: Installation, check: LocalCheck): Installation =
  { ...i, local: if (i.active.revision > 0 and check.version == i.active and check.provenance == SA::Committed
      and check.completeTree and check.schemaValid) LocalAuthorized else LocalRefused }
pure def alwaysSuccessHasReadback(i: Installation): bool = i.phase == Complete implies i.readback and i.primary == NoError
pure def alwaysActiveRetained(i: Installation): bool = i.active.revision > 0 implies retainedVersion(i, i.active)
pure def alwaysCandidateVerified(i: Installation): bool =
  (i.phase == Verifying or i.phase == VerifiedBytes or i.phase == Retained or i.phase == LinkReady or i.phase == Committed or i.phase == ReadBack) implies i.admitted
  and ((i.phase == VerifiedBytes or i.phase == Retained or i.phase == LinkReady or i.phase == Committed or i.phase == ReadBack) implies i.cleared)
pure def alwaysCandidateRetained(i: Installation): bool =
  (i.phase == Retained or i.phase == LinkReady or i.phase == Committed or i.phase == ReadBack) implies retainedVersion(i, i.target)
pure def alwaysUncommittedRetainsActive(i: Installation): bool = (openAttempt(i) and not(i.committed)) implies i.active == i.old
pure def alwaysCleanupFacts(i: Installation): bool = i.stagedCandidates.every(id => i.workRoots.includes(id)) and
  (i.phase == Cleaning implies i.workRoots.includes(i.attempt)) and
  ((i.phase == Cleaning or i.phase == Closing) and i.primary == NoError implies i.readback)
pure def alwaysActivationOutput(i: Installation): bool = i.output == Activated implies i.committed and i.readback
pure def alwaysPublishedStage(i: Installation): bool =
  ((i.phase == Committed or i.phase == ReadBack) implies i.committed) and (i.phase == ReadBack implies i.readback)
pure def stepCommittedTarget(before: Installation, via: str, after: Installation): bool =
  via != "commit" implies before.active == after.active
pure def stepOtherAttemptsUntouched(before: Installation, after: Installation): bool =
  before.workRoots.every(id => id != after.attempt implies after.workRoots.includes(id))
  and before.temporaryLinks.every(id => id != after.attempt implies after.temporaryLinks.includes(id))
pure def stepWrapperDeathKeepsLock(before: Installation, via: str, after: Installation): bool =
  via == "wrapperDies" implies after.locked == before.locked and after.processAlive == before.processAlive
pure def sometimesInstalled(i: Installation): bool = i.phase == Complete and i.output == Activated and i.active.revision > 0
pure def sometimesLocalAuthorized(i: Installation): bool = i.local == LocalAuthorized
pure def sometimesLocalCheckoutRefused(i: Installation): bool = i.local == LocalRefused and i.active.revision > 0
pure def sometimesRecovered(i: Installation): bool = i.phase == Failed and i.primary == Interrupted
pure def sometimesUnchanged(i: Installation): bool = i.phase == Complete and i.output == Unchanged
pure def sometimesCommittedAndUnverified(i: Installation): bool = i.phase == Failed and i.committed and not(i.readback)
pure def sometimesWrapperDeathKeepsLock(i: Installation): bool = not(i.wrapperAlive) and i.locked and i.processAlive
pure def sometimesClearanceLostRefused(i: Installation): bool = i.phase == Failed and not(i.cleared) and i.primary == BeforeCommitError
```

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val v1: Version = { template: "0123456789abcdef0123456789abcdef01234567", revision: 1, digest: "m1" }
pure val versionValues = Set(v1, { ...v1, revision: 2, digest: "m2" }, { ...v1, template: "fedcba9876543210fedcba9876543210fedcba98" })
pure val admittedRead: SA::SkillRead = { ...SA::initial, transport: SA::Admitted, source: SA::CanonicalApi,
  selection: { role: SA::ContributorSkill, project: 1, commit: v1.template, registryRevision: 1, registryDigest: "m1" } }
pure val readValues = Set(admittedRead,
  { ...admittedRead, selection: { role: SA::ContributorSkill, project: 1, commit: v1.template, registryRevision: 2, registryDigest: "m2" } },
  { ...admittedRead, transport: SA::Downloaded })
pure val openView: F::ProjectView = { registered: true, retired: false, legacy: false, paused: false, flagged: false,
  quarantined: false, cleared: true, skillFields: true }
pure val viewValues = Set(openView, { ...openView, flagged: true })
pure val checkValues = Set({ version: v1, provenance: SA::Committed, completeTree: true, schemaValid: true },
  { version: v1, provenance: SA::WorkingTree, completeTree: true, schemaValid: true })
pure val viaValues = Set("", "commit", "wrapperDies")
pure val weight_begin = 9
pure val weight_download = 10
pure val weight_verify = 20
pure val weight_retain = 10
pure val weight_commit = 13
pure val weight_confirm = 11
pure val weight_finish = 10
```
