# Environment-scoped source-bound release

PRD sections 11 and 12 and CLAUDE.md "Deployment" require reviewed
development changes, trusted quality checks, source equivalence and
independent deployed-byte verification. Each machine owns one release run
for one environment. Production publishes `main` through the main-only
`slop-production` GitHub environment. Staging publishes `development` with
independent identity, storage and secrets. The pinned source is
`.github/workflows/deploy.yml` and the legacy `release/*` models.

The `by` sender is the authenticated run identity GitHub supplies to the
checked-in workflow. A `RunRef` is GitHub's own event description of that
run. Check receipts are verified by the workflow before `recordGate`.
Deployment and served-byte observations come from the provider read-back.

## Story: Admit only a trusted run of the exact environment branch

### A release starts from a push or manual dispatch of the environment's branch in the canonical repository

A package script, local working tree, pull request, feature branch, fork head
or tag never publishes. Pull request runs never see publication credentials.
Production uses the `slop-production` environment, which allows only `main`.

```quint
import releaseCoverage as Coverage from "./releaseCoverage"
import runtime as F from "../fees/runtime"
type Environment = Production | Staging
type RefKind = BranchPush | WorkflowDispatch | PullRequestRef | ForkHead | TagRef | LocalTree | ScheduledRef
type Actor = TrustedWorkflow | HealthJob | Contributor
type RunRef = { kind: RefKind, branch: str, repository: str, githubEnvironment: str }
type Comparison = Identical | Ahead | Behind | Diverged
type ReleasePhase = Candidate | Built | Checked | Publishing | PublicationUncertain | Published | Verified
  | Superseded | Refused | PartiallyPublished
type DataKind = NoData | FreshCollection | RetainedSnapshot
type QualityGate = Types | Models | Proofs | ModelInventory | ProofInventory | Unit | Browser | BrowserSmoke | Isolation | Identity
type Service = FeeConverter | Notify | VettingBackup | VettingRetention | Slopbot | PaymentAttesters | IdentityWorker
type ServicePhase = ServiceSkipped | ServicePending | ServiceBound | ServiceFailed
type ServiceRow = { service: Service, enabled: bool, phase: ServicePhase }
type GateReceipt = { gate: QualityGate, source: int, artifact: int }
type Release = { phase: ReleasePhase, configured: bool, environment: Environment, ref: RunRef, source: int, branchHead: int,
  headAhead: bool, checkedSource: int, artifactDigest: int, servedDigest: int, passed: List[GateReceipt],
  dataKind: DataKind, registryDigest: int, githubDigest: int, snapshotDigest: int, dataEnvironment: Environment, dataRecordedAt: int,
  manualRun: bool, skipProofs: bool, skipBrowserTests: bool, bootstrapData: bool, lockHeld: bool, services: List[ServiceRow],
  deployment: int, attempt: int }
pure val noRef: RunRef = { kind: LocalTree, branch: "", repository: "", githubEnvironment: "" }
pure val canonicalRepository = "SlopDotCash/slopdotcash"
pure val initial: Release = { phase: Candidate, configured: false, environment: Production, ref: noRef, source: 1, branchHead: 1,
  headAhead: true, checkedSource: 0, artifactDigest: 0, servedDigest: 0, passed: List(), dataKind: NoData, registryDigest: 0,
  githubDigest: 0, snapshotDigest: 0, dataEnvironment: Production, dataRecordedAt: 0, manualRun: false, skipProofs: false,
  skipBrowserTests: false, bootstrapData: false, lockHeld: false, services: List(), deployment: 0, attempt: 0 }
pure def requiredBranch(environment: Environment): str = if (environment == Production) "main" else "development"
pure def requiredGithubEnvironment(environment: Environment): str = if (environment == Production) "slop-production" else "slop-staging"
pure def admissibleRef(environment: Environment, ref: RunRef): bool =
  (ref.kind == BranchPush or ref.kind == WorkflowDispatch) and ref.repository == canonicalRepository
    and ref.branch == requiredBranch(environment) and ref.githubEnvironment == requiredGithubEnvironment(environment)
pure def canConfigure(r: Release, environment: Environment, ref: RunRef, by: Actor): bool =
  r.phase == Candidate and not(r.configured) and by == TrustedWorkflow and admissibleRef(environment, ref)
pure def configure(r: Release, environment: Environment, ref: RunRef, by: Actor): Release =
  { ...r, configured: true, environment: environment, ref: ref, manualRun: ref.kind == WorkflowDispatch }
pure def alwaysAdmittedRef(r: Release): bool = (r.configured or r.phase != Candidate) implies admissibleRef(r.environment, r.ref)
pure def alwaysConfiguredBeforeProgress(r: Release): bool = (r.phase != Candidate implies r.configured)
  and ((r.phase != Candidate and r.phase != Refused) implies r.artifactDigest > 0)
  and (not(r.headAhead) implies r.configured)
  and (not(r.configured) implies not(r.skipProofs or r.skipBrowserTests) and not(r.manualRun))
  and (r.phase == Candidate implies r.passed == List() and r.services == List())
pure def lawPullRequestsNeverPublish(environment: Environment, ref: RunRef, by: Actor): bool =
  (ref.kind == PullRequestRef or ref.kind == ForkHead or ref.kind == TagRef or ref.kind == LocalTree or ref.kind == ScheduledRef)
    implies not(canConfigure(initial, environment, ref, by))
pure def canSelectManualCoverage(r: Release, skipProofs: bool, skipBrowserTests: bool, by: Actor): bool =
  r.phase == Candidate and r.configured and r.manualRun and by == TrustedWorkflow and r.passed.length() == 0
    and not(r.skipProofs or r.skipBrowserTests)
pure def selectManualCoverage(r: Release, skipProofs: bool, skipBrowserTests: bool, by: Actor): Release =
  { ...r, skipProofs: skipProofs, skipBrowserTests: skipBrowserTests }
pure def coverageRequest(r: Release): Coverage::Requests = {
  kind: if (r.manualRun) Coverage::ManualDispatch else Coverage::DeployingPush,
  target: if (r.environment == Production) Coverage::Main else Coverage::Development,
  skipProofs: r.skipProofs, skipBrowserTests: r.skipBrowserTests }
pure def alwaysOptionsOnlyManual(r: Release): bool = (r.skipProofs or r.skipBrowserTests) implies r.manualRun
```

### Normal releases need verified registry and GitHub collections for this environment

The storage adapter supplies digests only after validating complete
collection, source counts, immutable identities and source-specific
timestamps. An explicit manual release may instead retain its own verified
published snapshot with original history, timestamps and record counts. A
snapshot from another environment or bootstrap data never qualifies.

```quint
pure def canCollectData(r: Release, environment: Environment, registryDigest: int, githubDigest: int, recordedAt: int): bool =
  r.phase == Candidate and r.configured and environment == r.environment and registryDigest > 0 and githubDigest > 0 and recordedAt > 0
pure def collectData(r: Release, environment: Environment, registryDigest: int, githubDigest: int, recordedAt: int): Release =
  { ...r, dataKind: FreshCollection, registryDigest: registryDigest, githubDigest: githubDigest, dataEnvironment: environment,
    dataRecordedAt: recordedAt, snapshotDigest: 0, bootstrapData: false }
pure def canRetainSnapshot(r: Release, environment: Environment, digest: int, originalRecordedAt: int, bootstrap: bool): bool =
  r.phase == Candidate and r.configured and environment == r.environment and digest > 0 and originalRecordedAt > 0
    and r.manualRun and not(bootstrap)
pure def retainSnapshot(r: Release, environment: Environment, digest: int, originalRecordedAt: int, bootstrap: bool): Release =
  { ...r, dataKind: RetainedSnapshot, snapshotDigest: digest, dataEnvironment: environment, dataRecordedAt: originalRecordedAt,
    bootstrapData: bootstrap, registryDigest: 0, githubDigest: 0 }
pure def validData(r: Release): bool = r.dataEnvironment == r.environment and r.dataRecordedAt > 0
  and (if (r.dataKind == FreshCollection) r.registryDigest > 0 and r.githubDigest > 0
    else r.dataKind == RetainedSnapshot and r.snapshotDigest > 0 and r.manualRun and not(r.bootstrapData))
pure def stepPreservesDataTimestamps(before: Release, via: str, after: Release): bool =
  (via != "collectData" and via != "retainSnapshot") implies before.dataRecordedAt == after.dataRecordedAt
```

### Every required check binds the same source and built artifact

The artifact is built from the run's source before any gate is recorded, and
each gate receipt names that source and artifact. The workflow records the
verified receipts of one quality job together. Passed quality cannot be
inferred from a deployment, a prior revision or an absent result.
Exhaustive verification timeouts retain their exact warning under STATE-05.
A proof omission records no proof result, and browser smoke records no full
browser pass. Both inventory receipts are always required.

```quint
pure def canBuild(r: Release, artifactDigest: int): bool = r.phase == Candidate and r.configured and artifactDigest > 0
pure def build(r: Release, artifactDigest: int): Release = { ...r, phase: Built, artifactDigest: artifactDigest }
pure def canRecordGates(r: Release, gates: Set[QualityGate], source: int, artifactDigest: int): bool =
  r.phase == Built and source == r.source and artifactDigest == r.artifactDigest and gates.size() > 0
pure def recordGates(r: Release, gates: Set[QualityGate], source: int, artifactDigest: int): Release =
  { ...r, passed: r.passed.concat(allGates.select(g => gates.contains(g)).listMap(g => { gate: g, source: source, artifact: artifactDigest })) }
pure val allGates: List[QualityGate] = List(Types, Models, Proofs, ModelInventory, ProofInventory, Unit, Browser, BrowserSmoke, Isolation, Identity)
pure def hasGate(r: Release, gate: QualityGate): bool = r.passed.some(p => p.gate == gate and p.source == r.source and p.artifact == r.artifactDigest)
pure def allGatesPassed(r: Release): bool =
  Coverage::releaseReceiptsPass(coverageRequest(r), {
    common: hasGate(r, Types) and hasGate(r, Unit) and hasGate(r, Isolation) and hasGate(r, Identity),
    modelInventory: hasGate(r, ModelInventory), proofInventory: hasGate(r, ProofInventory),
    stateModels: hasGate(r, Models), staticProofs: hasGate(r, Proofs),
    browserSmoke: hasGate(r, BrowserSmoke), browserComplete: hasGate(r, Browser) })
pure def canCheck(r: Release): bool = r.phase == Built and validData(r) and allGatesPassed(r)
pure def check(r: Release): Release = { ...r, phase: Checked, checkedSource: r.source }
pure def alwaysGatesBindArtifact(r: Release): bool = r.passed.every(p => p.source == r.source and p.artifact == r.artifactDigest)
pure def alwaysCheckedComplete(r: Release): bool =
  (r.phase != Candidate and r.phase != Built and r.phase != Refused) implies
    r.checkedSource == r.source and r.artifactDigest > 0 and validData(r) and allGatesPassed(r) and admissibleRef(r.environment, r.ref)
```

## Story: Publish under the environment lock only while the tested source is still current

### A newer fast-forward supersedes the run; a rewritten branch refuses it

Immediately before publication the run reads the live branch head. A newer
fast-forward owns publication: this run stops without publishing and records
itself as superseded. Any branch head that is not a fast-forward of the
tested source fails closed. The lock is the environment's publication
concurrency group. This machine records only its own holding; the
[lock machine](./publicationLock.md) states that at most one run of an
environment holds the lock, and `acquireLock` here must be that machine's
grant to this run (a composition obligation).

```quint
pure def canObserveBranchHead(r: Release, liveHead: int, comparison: Comparison): bool =
  r.configured and liveHead > 0 and (comparison == Identical iff liveHead == r.source)
pure def observeBranchHead(r: Release, liveHead: int, comparison: Comparison): Release =
  { ...r, branchHead: liveHead, headAhead: comparison == Identical or comparison == Ahead }
pure def canAcquireLock(r: Release): bool = r.phase == Checked and not(r.lockHeld)
pure def acquireLock(r: Release): Release = { ...r, lockHeld: true }
pure def canSupersede(r: Release): bool = r.phase == Checked and r.branchHead != r.checkedSource and r.headAhead
pure def supersede(r: Release): Release = { ...r, phase: Superseded, lockHeld: false }
pure def canRefuseRewrite(r: Release): bool = (r.phase == Checked or r.phase == Built or r.phase == Candidate) and not(r.headAhead)
pure def refuseRewrite(r: Release): Release = { ...r, phase: Refused, lockHeld: false }
pure def sometimesSuperseded(r: Release): bool = r.phase == Superseded
pure def sometimesRewriteRefused(r: Release): bool = r.phase == Refused
```

### Workers publish before the static site, each only when its own release variable is enabled

Each service has a repository release variable read once for the run. A
disabled service is skipped and its deployed version is unchanged. An
enabled service uploads a version tagged with the tested source, deploys it
to all traffic and reads back that exact tag; `publishService` records the
read-back of the tested source's tag on the version serving all traffic. The fee converter additionally
passes the [runtime preflight](../fees/runtime.md) for its reviewed
configuration. A failed service publication leaves the release partially
published: earlier services stay published, nothing is rolled back, and the
static site is not published.

```quint
type ServiceVariables = { feeConverter: bool, notify: bool, vettingBackup: bool, vettingRetention: bool, slopbot: bool }
pure def serviceRows(v: ServiceVariables): List[ServiceRow] = List(
  { service: FeeConverter, enabled: v.feeConverter, phase: if (v.feeConverter) ServicePending else ServiceSkipped },
  { service: Notify, enabled: v.notify, phase: if (v.notify) ServicePending else ServiceSkipped },
  { service: VettingBackup, enabled: v.vettingBackup, phase: if (v.vettingBackup) ServicePending else ServiceSkipped },
  { service: VettingRetention, enabled: v.vettingRetention and v.vettingBackup, phase: if (v.vettingRetention and v.vettingBackup) ServicePending else ServiceSkipped },
  { service: Slopbot, enabled: v.slopbot and v.notify, phase: if (v.slopbot and v.notify) ServicePending else ServiceSkipped },
  { service: PaymentAttesters, enabled: true, phase: ServicePending },
  { service: IdentityWorker, enabled: true, phase: ServicePending })
pure def serviceAt(r: Release, service: Service): ServiceRow =
  r.services.foldl({ service: service, enabled: false, phase: ServiceSkipped }, (found, s) => if (s.service == service) s else found)
pure def setService(r: Release, service: Service, phase: ServicePhase): List[ServiceRow] =
  r.services.listMap(s => if (s.service == service and s.phase == ServicePending) { ...s, phase: phase } else s)
pure def canBeginPublication(r: Release, variables: ServiceVariables): bool =
  r.phase == Checked and r.lockHeld and r.checkedSource == r.branchHead and validData(r)
pure def beginPublication(r: Release, variables: ServiceVariables): Release =
  { ...r, phase: Publishing, services: serviceRows(variables), attempt: r.attempt + 1 }
pure def canPublishService(r: Release, service: Service, feeConfig: F::WorkerConfig, taggedSource: int): bool =
  r.phase == Publishing and r.lockHeld and serviceAt(r, service).phase == ServicePending and taggedSource == r.source
    and (service == FeeConverter implies F::preflightPasses(if (r.environment == Production) F::Production else F::Staging, feeConfig)
      and feeConfig.source == r.source)
pure def publishService(r: Release, service: Service, feeConfig: F::WorkerConfig, taggedSource: int): Release =
  { ...r, services: setService(r, service, ServiceBound) }
pure def canFailService(r: Release, service: Service): bool =
  r.phase == Publishing and serviceAt(r, service).phase == ServicePending
pure def failService(r: Release, service: Service): Release =
  { ...r, phase: PartiallyPublished, services: setService(r, service, ServiceFailed), lockHeld: false }
pure def servicesDone(r: Release): bool = r.services.length() > 0
  and r.services.every(s => s.phase == ServiceBound or s.phase == ServiceSkipped)
pure def alwaysSkippedServicesDisabled(r: Release): bool = r.services.every(s => (s.phase == ServiceSkipped) iff not(s.enabled))
pure def sometimesFeeConverterBound(r: Release): bool = serviceAt(r, FeeConverter).phase == ServiceBound
pure def sometimesFeeConverterSkipped(r: Release): bool = r.phase == Verified and serviceAt(r, FeeConverter).phase == ServiceSkipped
pure def sometimesPartial(r: Release): bool = r.phase == PartiallyPublished
```

### The static site publishes last and a lost response is reconciled from the provider

The final live-branch check repeats before the static deployment. A lost
response leaves publication uncertain until the provider read-back shows the
exact artifact or proves that nothing was published. Proven non-publication
returns the run to its checked state without the lock.

```quint
pure def canPublishSite(r: Release): bool = r.phase == Publishing and r.lockHeld and servicesDone(r) and r.branchHead == r.checkedSource
pure def publishSite(r: Release): Release = { ...r, phase: PublicationUncertain }
pure def canReconcilePublication(r: Release, deployment: int, observedDigest: int, environment: Environment): bool =
  r.phase == PublicationUncertain and deployment > 0 and observedDigest == r.artifactDigest and environment == r.environment
pure def reconcilePublication(r: Release, deployment: int, observedDigest: int, environment: Environment): Release =
  { ...r, phase: Published, deployment: deployment, lockHeld: false }
pure def canProveUnpublished(r: Release, observedDigest: int): bool = r.phase == PublicationUncertain and observedDigest != r.artifactDigest
pure def proveUnpublished(r: Release, observedDigest: int): Release = { ...r, phase: Checked, lockHeld: false, services: List() }
pure def alwaysPublishingHoldsLock(r: Release): bool =
  ((r.phase == Publishing or r.phase == PublicationUncertain) implies r.lockHeld and r.services.length() > 0)
    and (r.phase == PublicationUncertain implies servicesDone(r))
pure def alwaysTerminalReleasedLock(r: Release): bool =
  (r.phase == Published or r.phase == Verified or r.phase == Superseded or r.phase == Refused or r.phase == PartiallyPublished)
    implies not(r.lockHeld)
pure def sometimesUncertain(r: Release): bool = r.phase == PublicationUncertain
pure def sometimesRecoveredUnpublished(r: Release): bool = r.phase == Checked and r.attempt > 0 and not(r.lockHeld)
```

### Served bytes are verified against the deployment's own source

Verification compares the deployment identity and served bytes with the
artifact of this run's checked source, not with a branch head that may have
advanced since. DNS, TLS, redirects and headers are separate provider
observations. A static deployment that serves other bytes is not verified.

```quint
type ServedObservation = { deployment: int, digest: int, environment: Environment, dnsTlsHeaders: bool }
pure def canVerifyServed(r: Release, served: ServedObservation): bool = r.phase == Published and served.deployment == r.deployment
  and served.digest == r.artifactDigest and served.environment == r.environment and served.dnsTlsHeaders
pure def verifyServed(r: Release, served: ServedObservation): Release = { ...r, phase: Verified, servedDigest: served.digest }
pure def alwaysPublishedDeployment(r: Release): bool = (r.phase == Published or r.phase == Verified) implies r.deployment > 0 and servicesDone(r)
pure def alwaysVerifiedBytes(r: Release): bool = r.phase == Verified implies r.deployment > 0 and r.servedDigest == r.artifactDigest
pure def stepTerminalPhases(before: Release, after: Release): bool =
  (before.phase == Superseded or before.phase == Refused or before.phase == PartiallyPublished or before.phase == Verified)
    implies after.phase == before.phase
pure def sometimesVerified(r: Release): bool = r.phase == Verified
pure def sometimesStaging(r: Release): bool = r.environment == Staging and r.phase == Verified
pure def sometimesVerifiedAfterAdvance(r: Release): bool = r.phase == Verified and r.branchHead != r.checkedSource
```

Pinned publication tooling installs without lifecycle scripts or dependency
cache. The pull request data adapter never substitutes for normal collection
or validated environment-local snapshots. The hourly health jobs neither
publish code nor hold the publication lock ([intake health](./intakeHealth.md)).
The [mainnet escrow qualification ledger](./escrowQualification.md) governs
Base, Solana and Robinhood qualification and the recorded Ethereum waiver.

### Simulation samples exercise admitted and refused runs and conflicting evidence

These sets bound simulation only.

```quint
pure val goodRef: RunRef = { kind: BranchPush, branch: "main", repository: canonicalRepository, githubEnvironment: "slop-production" }
pure val refValues = Set(goodRef, { ...goodRef, kind: WorkflowDispatch },
  { kind: BranchPush, branch: "development", repository: canonicalRepository, githubEnvironment: "slop-staging" },
  { ...goodRef, kind: PullRequestRef }, { ...goodRef, kind: TagRef }, { ...goodRef, branch: "develop" },
  { ...goodRef, repository: "fork/slopdotcash" })
pure val environmentValues = Set(Production, Staging)
pure val byValues = Set(TrustedWorkflow, HealthJob)
pure val artifactDigestValues = Set(0, 7)
pure val deploymentValues = Set(0, 1)
pure val observedDigestValues = Set(7, 8)
pure val githubDigestValues = Set(0, 1)
pure val registryDigestValues = Set(0, 1)
pure val digestValues = Set(0, 1)
pure val originalRecordedAtValues = Set(1)
pure val recordedAtValues = Set(1)
pure val sourceValues = Set(1, 2)
pure val taggedSourceValues = Set(1, 2)
pure val liveHeadValues = Set(1, 2)
pure val comparisonValues = Set(Identical, Ahead, Diverged)
pure val servedValues = Set({ deployment: 1, digest: 7, environment: Production, dnsTlsHeaders: true },
  { deployment: 1, digest: 7, environment: Staging, dnsTlsHeaders: true },
  { deployment: 1, digest: 8, environment: Production, dnsTlsHeaders: true })
pure val variablesValues = Set({ feeConverter: true, notify: true, vettingBackup: false, vettingRetention: true, slopbot: true },
  { feeConverter: false, notify: false, vettingBackup: false, vettingRetention: false, slopbot: false })
pure val feeConfigValues = Set({ ...F::liveAll, buybackMode: F::Off }, { ...F::liveAll, keys: List(F::Base), buybackMode: F::Off })
pure val weight_configure = 6
pure val weight_build = 6
pure val gatesValues = Set(Set(Types, Unit, Isolation, Identity, ModelInventory, ProofInventory, Models, Proofs, Browser),
  Set(Types, Unit, Isolation, Identity, ModelInventory, ProofInventory, BrowserSmoke), Set(Types, Unit))
pure val skipProofsValues = Set(true, false)
pure val skipBrowserTestsValues = Set(true, false)
pure val weight_recordGates = 10
pure val weight_check = 10
pure val weight_acquireLock = 10
pure val weight_beginPublication = 10
pure val weight_publishService = 20
pure val weight_publishSite = 10
pure val weight_reconcilePublication = 10
pure val weight_verifyServed = 10
```
