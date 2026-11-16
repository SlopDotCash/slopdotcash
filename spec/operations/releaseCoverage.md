# Coverage selected for each release and verification run

PRD sections 9 and 12 at main `21663f12cd276dfc7b4c913e3b9fbe34c153f99a`
allow two independent options for an explicit manual release to main or
development. `skip_proofs` omits the state-model run and static proof run.
`skip_browser_tests` requires the browser smoke lane against the built bundle.
Both default to false. They are distinct from the two data options of a
manual main release: `use_published_data` retains the last published
snapshot, and `discussion_resume_run` resumes public PR discussion reads from
a recent trusted main release attempt; the two exclude each other. The exact
source is `scripts/ci-scope.mjs`,
`.github/workflows/{deploy,formal,lemmascript}.yml` and
`formal/models/release/ci_coverage.qnt`. Current Vibestack checked model and
Dafny stages fill the respective verification roles in the planned rebuild.
A release that omits any full lane supplies no evidence for that lane.

## Story: Resolve the exact coverage for a trusted release

### Only a manual release on the target branch can request either option

Deploying pushes require full browser, model and proof coverage. Each manual
option changes only its own lane selection. The common gates include both
inventories, build and code, data, integration, installer, sandbox,
environment, source and deployed-byte checks. Route and environment identity
remain separate release admission rules.

```quint
type RunKind = DeployingPush | ManualDispatch | PullRequest | ScheduledNightly
type Target = Main | Development | OtherBranch
type Requests = { kind: RunKind, target: Target, skipProofs: bool, skipBrowserTests: bool,
  resumeDiscussions: bool, usePublishedData: bool }
type ReleaseChecks = { eligible: bool, stateModels: bool, staticProofs: bool,
  browserSmoke: bool, browserComplete: bool, common: bool }
pure def releaseTarget(request: Requests): bool = request.target == Main or request.target == Development
pure def deploying(request: Requests): bool = releaseTarget(request) and
  (request.kind == DeployingPush or request.kind == ManualDispatch)
pure def explicitManual(request: Requests): bool = deploying(request) and request.kind == ManualDispatch
pure def dataOptionsAllowed(request: Requests): bool =
  ((request.resumeDiscussions or request.usePublishedData) implies explicitManual(request) and request.target == Main)
    and not(request.resumeDiscussions and request.usePublishedData)
pure def coverage(request: Requests): ReleaseChecks =
  val allowed = deploying(request) and dataOptionsAllowed(request)
  val manual = explicitManual(request)
  { eligible: allowed, stateModels: allowed and not(manual and request.skipProofs),
    staticProofs: allowed and not(manual and request.skipProofs),
    browserSmoke: manual and request.skipBrowserTests,
    browserComplete: allowed and not(manual and request.skipBrowserTests), common: allowed }
pure def lawPushRunsEverything(request: Requests): bool =
  (request.kind == DeployingPush and releaseTarget(request)) implies
    coverage(request).eligible and coverage(request).stateModels and coverage(request).staticProofs
      and coverage(request).browserComplete and not(coverage(request).browserSmoke) and coverage(request).common
pure def lawOnlyManualCanOmit(request: Requests): bool = coverage(request).eligible implies
  (not(coverage(request).staticProofs) implies explicitManual(request) and request.skipProofs)
    and (not(coverage(request).browserComplete) implies explicitManual(request) and request.skipBrowserTests and coverage(request).browserSmoke)
    and coverage(request).common
pure def lawSeparateOptions(request: Requests): bool = coverage(request).eligible implies
  coverage(request).browserComplete != coverage(request).browserSmoke and
  coverage(request).stateModels == coverage(request).staticProofs and coverage(request).common
```

### A resumed collection is a fresh manual main collection that revalidates every reused response

Only a manual main release that does not retain published data may resume
discussion reads. A reused response enters the ledger only after live
revalidation; a mismatch is read again live. Resuming changes no lane
selection: the registry sync, census, scoring inputs and every selected
check still run. A collection that stops at its checkpoint deadline is not
publishable whatever its receipts.

```quint
type CollectionOutcome = CollectionComplete | DeadlineStopped
type ReusedResponse = { matchesLive: bool, revalidated: bool }
pure def admittedResponses(responses: List[ReusedResponse]): List[ReusedResponse] =
  responses.select(x => x.revalidated and x.matchesLive)
pure def publishable(request: Requests, outcome: CollectionOutcome, receipts: CheckReceipts): bool =
  outcome == CollectionComplete and releaseReceiptsPass(request, receipts)
pure def lawResumeOnlyManualMain(request: Requests): bool =
  (coverage(request).eligible and request.resumeDiscussions) implies
    explicitManual(request) and request.target == Main and not(request.usePublishedData)
pure def lawPublishedDataOnlyManualMain(request: Requests): bool =
  (coverage(request).eligible and request.usePublishedData) implies explicitManual(request) and request.target == Main
pure def lawResumeKeepsChecks(request: Requests): bool =
  coverage({ ...request, resumeDiscussions: false }).eligible implies
    (coverage({ ...request, resumeDiscussions: true }).eligible implies
      coverage({ ...request, resumeDiscussions: true }) == coverage({ ...request, resumeDiscussions: false }))
pure def lawUnrevalidatedNeverAdmitted(responses: List[ReusedResponse]): bool =
  admittedResponses(responses).every(x => x.revalidated and x.matchesLive)
pure def lawDeadlineNeverPublishes(request: Requests, receipts: CheckReceipts): bool =
  not(publishable(request, DeadlineStopped, receipts))
```

### Source-bound receipts satisfy only the lanes they actually ran

The release machine checks the required receipts for its exact revision and
artifact. Each boolean passed to this helper represents only checked same-run
receipts. Common receipts include the independently checked model and proof
inventories even when the two verification lanes are omitted. A nightly or
prior run has its own evidence record and cannot fill a missing release receipt.

```quint
type CheckReceipts = { common: bool, modelInventory: bool, proofInventory: bool,
  stateModels: bool, staticProofs: bool, browserSmoke: bool, browserComplete: bool }
pure def releaseReceiptsPass(request: Requests, receipts: CheckReceipts): bool =
  val required = coverage(request)
  required.eligible and receipts.common and receipts.modelInventory and receipts.proofInventory
    and (required.stateModels implies receipts.stateModels) and (required.staticProofs implies receipts.staticProofs)
    and (required.browserSmoke implies receipts.browserSmoke) and (required.browserComplete implies receipts.browserComplete)
pure def fullFormalEvidence(receipts: CheckReceipts): bool =
  receipts.modelInventory and receipts.proofInventory and receipts.stateModels and receipts.staticProofs
pure def lawInventoriesNeverOmitted(request: Requests, receipts: CheckReceipts): bool =
  releaseReceiptsPass(request, receipts) implies receipts.common and receipts.modelInventory and receipts.proofInventory
pure def lawSmokeNeedsItsOwnReceipt(request: Requests, receipts: CheckReceipts): bool =
  (releaseReceiptsPass(request, receipts) and coverage(request).browserSmoke) implies receipts.browserSmoke
```

## Story: Retain independent verification coverage outside releases

### Pull requests select affected work and nightly verification always runs in full

A normal PR selects affected UI and API lanes, contract/sandbox/installer
checks, state models and static proofs. Coverage comes from reviewed Git
inputs and affected source dependencies. A workflow or model-tool change can
require every model. A same-repository development promotion into main runs
all state models and static proofs. The deploying push supplies full browser
and other release checks. A PR without a selected browser lane still runs
smoke. Both inventories always run. Independently scheduled checks run all
models and proofs on the configured default branch and do not block a release.

```quint
type Affected = { browserUI: bool, browserAPI: bool, rootSkill: bool, sandbox: bool, installer: bool,
  solanaFixture: bool, evmInputs: bool, modelInputs: bool, modelTooling: bool, proofInputs: bool }
type RequestChecks = { ui: bool, api: bool, pages: bool, smoke: bool, sandbox: bool, installer: bool,
  solana: bool, evm: bool, affectedModels: bool, allModels: bool, proofs: bool, inventories: bool }
pure def pullRequestChecks(affected: Affected, promotion: bool): RequestChecks =
  val ui = not(promotion) and affected.browserUI
  val api = not(promotion) and affected.browserAPI
  val pages = ui or affected.rootSkill
  { ui: ui, api: api, pages: pages, smoke: not(ui or api or pages), sandbox: not(promotion) and affected.sandbox,
    installer: not(promotion) and affected.installer, solana: not(promotion) and affected.solanaFixture, evm: not(promotion) and affected.evmInputs,
    affectedModels: promotion or affected.modelTooling or affected.modelInputs,
    allModels: promotion or affected.modelTooling, proofs: promotion or affected.proofInputs, inventories: true }
pure def nightlyRunsAll(request: Requests, defaultBranch: bool): bool = request.kind == ScheduledNightly and defaultBranch
pure def lawPromotionChecksBoth(affected: Affected): bool =
  val plan = pullRequestChecks(affected, true)
  plan.inventories and plan.allModels and plan.affectedModels and plan.proofs
pure def lawScopeAlwaysChecksInventories(affected: Affected, promotion: bool): bool = pullRequestChecks(affected, promotion).inventories
pure def lawNightlyIsIndependent(request: Requests, defaultBranch: bool): bool =
  nightlyRunsAll(request, defaultBranch) implies not(coverage(request).eligible)
```

### Simulation includes default, manual, pull request and nightly inputs

```quint
pure val defaultReleaseRequest: Requests = { kind: DeployingPush, target: Main, skipProofs: false, skipBrowserTests: false,
  resumeDiscussions: false, usePublishedData: false }
pure val requestValues = Set(defaultReleaseRequest,
  { ...defaultReleaseRequest, kind: ManualDispatch, target: Development, skipProofs: true },
  { ...defaultReleaseRequest, kind: ManualDispatch, skipBrowserTests: true },
  { ...defaultReleaseRequest, kind: ManualDispatch, target: OtherBranch, skipProofs: true, skipBrowserTests: true },
  { ...defaultReleaseRequest, kind: PullRequest, target: OtherBranch },
  { ...defaultReleaseRequest, kind: ScheduledNightly },
  { ...defaultReleaseRequest, kind: ManualDispatch, resumeDiscussions: true },
  { ...defaultReleaseRequest, kind: ManualDispatch, usePublishedData: true, skipProofs: true },
  { ...defaultReleaseRequest, kind: ManualDispatch, target: Development, resumeDiscussions: true },
  { ...defaultReleaseRequest, kind: ManualDispatch, resumeDiscussions: true, usePublishedData: true },
  { ...defaultReleaseRequest, resumeDiscussions: true })
pure val responsesValues = Set(List(), List({ matchesLive: true, revalidated: true }),
  List({ matchesLive: false, revalidated: true }, { matchesLive: true, revalidated: false }))
pure val fullReceipts: CheckReceipts = { common: true, modelInventory: true, proofInventory: true, stateModels: true,
  staticProofs: true, browserSmoke: true, browserComplete: true }
pure val receiptsValues = Set(fullReceipts, { ...fullReceipts, proofInventory: false },
  { ...fullReceipts, browserComplete: false }, { ...fullReceipts, stateModels: false, staticProofs: false })
pure val noAffected: Affected = { browserUI: false, browserAPI: false, rootSkill: false, sandbox: false,
  installer: false, solanaFixture: false, evmInputs: false, modelInputs: false, modelTooling: false, proofInputs: false }
pure val affectedValues = Set(noAffected, { ...noAffected, browserUI: true, modelInputs: true, proofInputs: true },
  { ...noAffected, browserAPI: true, solanaFixture: true, rootSkill: true },
  { ...noAffected, modelTooling: true, installer: true, sandbox: true })
```
