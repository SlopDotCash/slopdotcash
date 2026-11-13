# Immutable skill installation

This model covers PRD section 4 and legacy `skill_installation`,
`skill_install_process`, `skill_source_authority`, and `skill_validation_runtime`.
The external verifier resolves a full 40-character canonical commit, complete
immutable tree, D1 digest, and deterministic rendering. These observations
require real GitHub and filesystem tests. No claim about template freshness,
main ancestry, release labels, or revocation is inferred.

## Story: Install, update, and roll back a verified project skill

A contributor receives exact canonical bytes, keeps prior verified versions,
and authorizes installed skills locally without a live authorization request.

### Installation tracks verification, activation, and readback separately

```quint
type Version = { template: int, revision: int }
type InstallPhase = Idle | Downloading | Verifying | Retained | LinkReady | Committed | Complete | Failed
type Installation = { phase: InstallPhase, locked: bool, processAlive: bool,
  template: int, revision: int, activeTemplate: int, activeRevision: int,
  oldTemplate: int, oldRevision: int, versions: List[Version], explicitRollback: bool, canonicalTree: bool,
  digestMatches: bool, permitted: bool, temporaryLink: bool, readback: bool,
  cleanupFailed: bool, localAuthorized: bool }
pure val initial: Installation = { phase: Idle, locked: false, processAlive: true,
  template: 0, revision: 0, activeTemplate: 0, activeRevision: 0,
  oldTemplate: 0, oldRevision: 0, versions: List(),
  explicitRollback: false, canonicalTree: false, digestMatches: false,
  permitted: false, temporaryLink: false, readback: false, cleanupFailed: false,
  localAuthorized: false }
pure def alwaysRevisionNonnegative(i: Installation): bool = i.revision >= 0 and i.activeRevision >= 0
pure def alwaysRetainedVersions(i: Installation): bool = i.versions.every(v => v.template > 0 and v.revision > 0)
```

### Only one living process can stage an allowed revision

Ordinary updates never decrease the D1 revision. Explicit rollback selects a
retained pair and re-verifies it. Template identity can move backward.

```quint
pure def retainedPair(i: Installation, template: int, revision: int): bool =
  i.versions.some(v => v.template == template and v.revision == revision)
pure def canBegin(i: Installation, template: int, revision: int, rollback: bool, permitted: bool): bool =
  not(i.locked) and i.processAlive and template > 0 and revision > 0 and permitted and
  (if (rollback) retainedPair(i, template, revision) else revision >= i.activeRevision) and
  (i.phase == Idle or i.phase == Complete or i.phase == Failed)
pure def begin(i: Installation, template: int, revision: int, rollback: bool, permitted: bool): Installation =
  { ...i, phase: Downloading, locked: true, template: template, revision: revision,
    explicitRollback: rollback, permitted: permitted, oldTemplate: i.activeTemplate,
    oldRevision: i.activeRevision, canonicalTree: false, digestMatches: false,
    temporaryLink: false, readback: false, cleanupFailed: false, localAuthorized: false }
pure def canDownload(i: Installation, immutableUrl: bool, completeTree: bool): bool =
  i.phase == Downloading and i.locked and i.processAlive and immutableUrl and completeTree
pure def download(i: Installation, immutableUrl: bool, completeTree: bool): Installation =
  { ...i, phase: Verifying }
```

### Canonical bytes and approved D1 rendering must both match before retention

No missing or extra file is accepted. A checksum alone cannot authorize bytes.
A retained pair identifies one complete immutable version directory.

```quint
pure def canVerify(i: Installation, canonicalTree: bool, approvedDigest: bool, sameRenderedBytes: bool, permitted: bool): bool =
  i.phase == Verifying and i.locked and i.processAlive and canonicalTree and
  approvedDigest and sameRenderedBytes and permitted
pure def verify(i: Installation, canonicalTree: bool, approvedDigest: bool, sameRenderedBytes: bool, permitted: bool): Installation =
  { ...i, phase: Retained, canonicalTree: true, digestMatches: true, permitted: true,
    versions: i.versions.append({ template: i.template, revision: i.revision }) }
pure def canPrepareLink(i: Installation): bool = i.phase == Retained and i.locked and i.processAlive
pure def prepareLink(i: Installation): Installation = { ...i, phase: LinkReady, temporaryLink: true }
pure def canCommit(i: Installation, relativeLink: bool, atomicRename: bool): bool =
  i.phase == LinkReady and i.locked and i.processAlive and i.canonicalTree and i.digestMatches and
  i.permitted and relativeLink and atomicRename
pure def commit(i: Installation, relativeLink: bool, atomicRename: bool): Installation =
  { ...i, phase: Committed, activeTemplate: i.template, activeRevision: i.revision, temporaryLink: false }
pure def canConfirm(i: Installation, exactReadback: bool): bool = i.phase == Committed and i.processAlive and i.locked and exactReadback
pure def confirm(i: Installation, exactReadback: bool): Installation =
  { ...i, phase: Complete, readback: true, locked: false }
pure def alwaysSuccessHasReadback(i: Installation): bool = i.phase == Complete implies i.readback
pure def alwaysActiveRetained(i: Installation): bool = i.activeRevision > 0 implies
  retainedPair(i, i.activeTemplate, i.activeRevision)
```

### Failure, process death, and cleanup retain the committed version

A readback failure can happen after atomic publication. It cannot claim that
publication was rolled back. Kernel lock recovery requires the previous
process to be dead.

```quint
pure def canRecordFailure(i: Installation, cleanupFailed: bool): bool =
  i.processAlive and i.phase != Idle and i.phase != Complete and i.phase != Failed
pure def recordFailure(i: Installation, cleanupFailed: bool): Installation =
  { ...i, phase: Failed, locked: false, cleanupFailed: cleanupFailed }
pure def canProcessDies(i: Installation): bool = i.processAlive and i.locked
pure def processDies(i: Installation): Installation = { ...i, processAlive: false }
pure def canRecoverProcess(i: Installation): bool = not(i.processAlive)
pure def recoverProcess(i: Installation): Installation =
  { ...i, processAlive: true, locked: false, phase: Failed }
pure def canAuthorizeLocal(i: Installation, completeLocalTree: bool, provenanceMatches: bool, schemaValid: bool): bool =
  i.activeRevision > 0 and completeLocalTree and provenanceMatches and schemaValid
pure def authorizeLocal(i: Installation, completeLocalTree: bool, provenanceMatches: bool, schemaValid: bool): Installation =
  { ...i, localAuthorized: true }
pure def alwaysUncommittedRetainsActive(i: Installation): bool =
  (i.phase == Downloading or i.phase == Verifying or i.phase == Retained or i.phase == LinkReady) implies
  i.activeTemplate == i.oldTemplate and i.activeRevision == i.oldRevision
pure def sometimesInstalled(i: Installation): bool = i.phase == Complete and i.activeRevision > 0
pure def sometimesLocalAuthorized(i: Installation): bool = i.localAuthorized
pure def sometimesRecovered(i: Installation): bool = i.phase == Failed and i.processAlive and not(i.locked)
```

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val revisionValues = Set(0, 1, 2)
pure val templateValues = Set(0, 1, 2)
```
