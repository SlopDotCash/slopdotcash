# Environment-scoped source-bound release

PRD section 11 requires reviewed development changes, trusted quality checks,
source equivalence and independent deployed-byte verification. Each machine
owns one release candidate and one environment. Production publishes main.
Staging publishes development with independent identity, storage and secrets.

## Story: Publish the exact checked source and data to its own environment

### Source identity, checks, data and delivery remain separate evidence

```quint
import releaseCoverage as Coverage from "./releaseCoverage"
type Environment = Production | Staging
type ReleasePhase = Candidate | Checked | Publishing | PublicationUncertain | Published | Verified
type DataKind = NoData | FreshCollection | RetainedSnapshot
type QualityGate = Types | Models | Proofs | ModelInventory | ProofInventory | Unit | Browser | BrowserSmoke | Isolation | Identity
type Release = { phase: ReleasePhase, environment: Environment, source: int, branchHead: int, checkedSource: int, artifactDigest: int, servedDigest: int, trustedWorkflow: bool, isolatedSecrets: bool, publicationLock: bool, passed: Set[QualityGate], dataKind: DataKind, registryDigest: int, githubDigest: int, snapshotDigest: int, dataEnvironment: Environment, dataRecordedAt: int, manualRun: bool, skipProofs: bool, skipBrowserTests: bool, explicitManual: bool, bootstrapData: bool, deployment: int, attempt: int }
pure val initial: Release = { phase: Candidate, environment: Production, source: 1, branchHead: 1, checkedSource: 0, artifactDigest: 0, servedDigest: 0, trustedWorkflow: false, isolatedSecrets: false, publicationLock: false, passed: Set(), dataKind: NoData, registryDigest: 0, githubDigest: 0, snapshotDigest: 0, dataEnvironment: Production, dataRecordedAt: 0, manualRun: false, skipProofs: false, skipBrowserTests: false, explicitManual: false, bootstrapData: false, deployment: 0, attempt: 0 }
pure def canConfigure(r: Release): bool = r.phase == Candidate
pure def configure(r: Release, environment: Environment, trustedWorkflow: bool, isolatedSecrets: bool): Release = { ...r, environment: environment, trustedWorkflow: trustedWorkflow, isolatedSecrets: isolatedSecrets, dataKind: NoData, manualRun: false, skipProofs: false, skipBrowserTests: false, passed: Set() }
pure def canObserveBranchHead(r: Release, sourceHead: int): bool = sourceHead > 0
pure def observeBranchHead(r: Release, sourceHead: int): Release = { ...r, branchHead: sourceHead }
pure def requiredBranch(environment: Environment): str = if (environment == Production) "main" else "development"
pure def coverageRequest(r: Release): Coverage::Requests = {
  kind: if (r.manualRun) Coverage::ManualDispatch else Coverage::DeployingPush,
  target: if (r.environment == Production) Coverage::Main else Coverage::Development,
  skipProofs: r.skipProofs, skipBrowserTests: r.skipBrowserTests }
pure def canSelectManualCoverage(r: Release, authenticatedDispatch: bool): bool = r.phase == Candidate
  and r.trustedWorkflow and authenticatedDispatch and not(r.manualRun)
pure def selectManualCoverage(r: Release, authenticatedDispatch: bool, skipProofs: bool, skipBrowserTests: bool): Release =
  { ...r, manualRun: true, skipProofs: skipProofs, skipBrowserTests: skipBrowserTests }
```

### Normal releases need verified registry and GitHub collections for this environment

The storage adapter supplies digests only after validating complete collection,
source counts, immutable identities and the source-specific timestamps.

```quint
pure def canCollectData(r: Release, environment: Environment, registryDigest: int, githubDigest: int, recordedAt: int): bool = r.phase == Candidate and environment == r.environment and registryDigest > 0 and githubDigest > 0 and recordedAt > 0
pure def collectData(r: Release, environment: Environment, registryDigest: int, githubDigest: int, recordedAt: int): Release = { ...r, dataKind: FreshCollection, registryDigest: registryDigest, githubDigest: githubDigest, dataEnvironment: environment, dataRecordedAt: recordedAt, snapshotDigest: 0 }
```

### An explicit manual release may retain its own verified published snapshot

The snapshot includes original history, timestamps and record counts. An
authenticated workflow dispatch is required before retaining it. Its
adapter validates its digest and all rows before this event. A snapshot from
another environment or bootstrap data never qualifies.

```quint
pure def canRetainSnapshot(r: Release, environment: Environment, digest: int, originalRecordedAt: int, explicitManual: bool, bootstrap: bool): bool = r.phase == Candidate and environment == r.environment and digest > 0 and originalRecordedAt > 0 and r.manualRun and explicitManual and not(bootstrap)
pure def retainSnapshot(r: Release, environment: Environment, digest: int, originalRecordedAt: int, explicitManual: bool, bootstrap: bool): Release = { ...r, dataKind: RetainedSnapshot, snapshotDigest: digest, dataEnvironment: environment, dataRecordedAt: originalRecordedAt, explicitManual: explicitManual, bootstrapData: bootstrap, registryDigest: 0, githubDigest: 0 }
pure def validData(r: Release): bool = r.dataEnvironment == r.environment and r.dataRecordedAt > 0 and (if (r.dataKind == FreshCollection) r.registryDigest > 0 and r.githubDigest > 0 else r.dataKind == RetainedSnapshot and r.snapshotDigest > 0 and r.manualRun and r.explicitManual and not(r.bootstrapData))
pure def stepPreservesDataTimestamps(before: Release, via: str, after: Release): bool = (via != "collectData" and via != "retainSnapshot") implies before.dataRecordedAt == after.dataRecordedAt
```

### Every required check binds the same candidate and artifact

Actual check receipts are verified before `recordGate`. Passed quality cannot
be inferred from a deployment, a prior revision or an absent result. Exhaustive
verification timeouts retain their exact warning under STATE-05. Broken models,
counterexamples, crashes, unstable inputs and failed scenarios remain failures. Authenticated
manual dispatch may select the [independent coverage options](./releaseCoverage.md).
A proof omission records no proof result, and browser smoke records no full
browser pass. Both inventory receipts are always required.

```quint
pure def canRecordGate(r: Release, gate: QualityGate, source: int): bool = r.phase == Candidate and source == r.source and r.branchHead == r.source
pure def recordGate(r: Release, gate: QualityGate, source: int): Release = { ...r, passed: r.passed.union(Set(gate)) }
pure def allGatesPassed(r: Release): bool =
  Coverage::releaseReceiptsPass(coverageRequest(r), {
    common: r.passed.exists(gate => gate == Types) and r.passed.exists(gate => gate == Unit) and r.passed.exists(gate => gate == Isolation) and r.passed.exists(gate => gate == Identity),
    modelInventory: r.passed.exists(gate => gate == ModelInventory), proofInventory: r.passed.exists(gate => gate == ProofInventory),
    stateModels: r.passed.exists(gate => gate == Models), staticProofs: r.passed.exists(gate => gate == Proofs),
    browserSmoke: r.passed.exists(gate => gate == BrowserSmoke), browserComplete: r.passed.exists(gate => gate == Browser) })
pure def canCheck(r: Release, artifactDigest: int): bool = r.phase == Candidate and validData(r) and r.isolatedSecrets and r.trustedWorkflow and r.branchHead == r.source and artifactDigest > 0 and allGatesPassed(r)
pure def check(r: Release, artifactDigest: int): Release = { ...r, phase: Checked, checkedSource: r.source, artifactDigest: artifactDigest }
```

### The shared publication lock and unchanged branch sourceHead gate every send

```quint
pure def canAcquireLock(r: Release): bool = r.phase == Checked and r.trustedWorkflow and r.checkedSource == r.source and r.branchHead == r.source
pure def acquireLock(r: Release): Release = { ...r, publicationLock: true }
pure def canPublish(r: Release): bool = r.phase == Checked and r.publicationLock and r.checkedSource == r.branchHead and validData(r)
pure def publish(r: Release): Release = { ...r, phase: Publishing, attempt: r.attempt + 1 }
pure def canLoseResponse(r: Release): bool = r.phase == Publishing
pure def loseResponse(r: Release): Release = { ...r, phase: PublicationUncertain }
pure def canReconcilePublication(r: Release, deployment: int, observedDigest: int, environment: Environment): bool = (r.phase == Publishing or r.phase == PublicationUncertain) and deployment > 0 and observedDigest == r.artifactDigest and environment == r.environment
pure def reconcilePublication(r: Release, deployment: int, observedDigest: int, environment: Environment): Release = { ...r, phase: Published, deployment: deployment, publicationLock: false }
pure def canProveUnpublished(r: Release, confirmedUnpublished: bool): bool = confirmedUnpublished and (r.phase == Publishing or r.phase == PublicationUncertain)
pure def proveUnpublished(r: Release, confirmedUnpublished: bool): Release = { ...r, phase: Checked, publicationLock: false }
```

### Served bytes require exact deployment identity and current branch equivalence

Discovered by the proof. A checked candidate already has its source, artifact
and complete quality receipts. A published deployment retains a positive
deployment identity before its served bytes can be accepted.

```quint
pure def canVerifyServed(r: Release, deployment: int, digest: int, environment: Environment, dnsTlsHeaders: bool): bool = r.phase == Published and deployment == r.deployment and digest == r.artifactDigest and environment == r.environment and dnsTlsHeaders and r.branchHead == r.checkedSource
pure def verifyServed(r: Release, deployment: int, digest: int, environment: Environment, dnsTlsHeaders: bool): Release = { ...r, phase: Verified, servedDigest: digest }
pure def alwaysPublicationChecked(r: Release): bool = r.phase != Candidate implies r.checkedSource == r.source and r.trustedWorkflow and r.isolatedSecrets and validData(r) and r.artifactDigest > 0 and allGatesPassed(r)
pure def alwaysPublishedDeployment(r: Release): bool = (r.phase == Published or r.phase == Verified) implies r.deployment > 0
pure def alwaysVerifiedBytes(r: Release): bool = r.phase == Verified implies r.deployment > 0 and r.servedDigest == r.artifactDigest
pure def sometimesVerified(r: Release): bool = r.phase == Verified
pure def sometimesUncertain(r: Release): bool = r.phase == PublicationUncertain
pure def sometimesStaging(r: Release): bool = r.environment == Staging and r.phase == Verified
pure def sometimesRecoveredUnpublished(r: Release): bool = r.phase == Checked and r.attempt > 0 and not(r.publicationLock)
```

Pinned publication tooling installs without lifecycle scripts or dependency
cache. Check deployment identity, current source equivalence, served bytes,
DNS, TLS, redirects and headers separately. The PR adapter never substitutes
for normal collection or validated environment-local snapshots.

## Story: Keep operational readiness distinct from source approval

### Expired reporting health restricts only optional trace collection

```quint
pure def traceCollectionReady(ageHours: int, renewed: bool): bool = renewed and ageHours >= 0 and ageHours <= 24
pure def contributionAvailable(reportingHealthFresh: bool): bool = true
pure def lawHealthNeverBlocksContribution(reportingHealthFresh: bool): bool = contributionAvailable(reportingHealthFresh)
```

The hourly health job neither publishes code nor holds the publication lock.
Mainnet activation proceeds through Base, Solana and Robinhood qualification,
with the recorded Ethereum waiver. Native assets and Token-2022 implementation
approval do not authorize an upgrade or funding. Existing completed setup and
gas top-up steps are never repeated merely to fill an evidence row. Full-award
payments and closure retain their separate release and qualification gates.

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val ageHoursValues = Set(0, 1, 2)
pure val artifactDigestValues = Set(0, 1)
pure val deploymentValues = Set(0, 1)
pure val digestValues = Set(0, 1)
pure val githubDigestValues = Set(0, 1)
pure val observedDigestValues = Set(0, 1)
pure val originalRecordedAtValues = Set(1)
pure val recordedAtValues = Set(1)
pure val registryDigestValues = Set(0, 1)
pure val sourceValues = Set(1, 2)
pure val sourceHeadValues = Set(1, 2)
pure val viaValues = Set("", "a", "b")
pure val weight_selectManualCoverage = 4
pure val weight_recordGate = 18
pure val weight_check = 10
pure val weight_acquireLock = 10
pure val weight_publish = 10
pure val weight_loseResponse = 10
pure val weight_proveUnpublished = 10
pure val weight_reconcilePublication = 10
pure val weight_verifyServed = 10
```
