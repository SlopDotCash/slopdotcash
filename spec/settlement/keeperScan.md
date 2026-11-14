# Operator keeper reconciliation stages

Source is `operator_keeper_diagnostics.qnt` and `scripts/payment-keeper/keeper.ts`
at Slop main `8d14a9692b998ee3f4479725b6323125f11f11be`. One instance owns the
stage of a reconciliation run for a reviewed deployment. The existing evidence
and financial machines own receipt verification, journals and money.

## Story: Preserve the operation that failed during a keeper run

### A deployment progresses through preflight, authority, gas, scanning and local state checks

Advancing means the current external check completed successfully. The chain
and deployment are verified before work. Current authority and forbidden
signer role checks precede gas reconciliation. Payment scanning completes before
monthly and award state are examined. The shell supplies exact observed facts.
A successful preflight uses the current endpoint and exact network identity
from the [RPC selection model](./keeperRpc.md), plus the reviewed deployment
check. Each run starts with the durable object, journal and selected endpoint
identities from the same immutable configuration.

```quint
import keeperDiagnostics as D from "./keeperDiagnostics"
import keeperRpc as R from "./keeperRpc"
type ScanPhase = NotRunning | RunningScan | FinishedScan | FailedScan
type KeeperScan = { phase: ScanPhase, stage: D::KeeperStage, identity: R::KeeperIdentity,
  endpoint: int, selection: int, failure: D::DiagnosticResult }
pure val noFailure: D::DiagnosticResult = { operation: D::OtherOp, outcome: D::OtherWork,
  observedStage: D::OtherStage, hasError: false, classifiedError: D::UnrecognizedError }
pure val initial: KeeperScan = { phase: NotRunning, stage: D::Preflight, identity: R::defaultKeeperIdentity,
  endpoint: R::initial.originalEndpoint, selection: 0, failure: noFailure }
pure def canBegin(k: KeeperScan, identity: R::KeeperIdentity, endpoint: int, selection: int): bool =
  k.phase == NotRunning and endpoint > 0 and selection >= 0
pure def begin(k: KeeperScan, identity: R::KeeperIdentity, endpoint: int, selection: int): KeeperScan =
  { ...k, phase: RunningScan, identity: identity, endpoint: endpoint, selection: selection }
pure def canConfirmPreflight(k: KeeperScan, rpc: R::KeeperRpc, deploymentVerified: bool): bool =
  k.phase == RunningScan and k.stage == D::Preflight and deploymentVerified and
  rpc.identity == k.identity and rpc.endpoint == k.endpoint and rpc.selection == k.selection and
  rpc.observed == k.identity.network and R::keeperWorkMayProceed(rpc)
pure def confirmPreflight(k: KeeperScan, rpc: R::KeeperRpc, deploymentVerified: bool): KeeperScan =
  { ...k, stage: D::AuthorityRead }
pure def canAdvance(k: KeeperScan, checkPassed: bool): bool = k.phase == RunningScan and checkPassed and
  k.stage != D::Preflight and k.stage != D::PaymentEvidence and k.stage != D::PaymentIndex and k.stage != D::OtherStage
pure def nextStage(stage: D::KeeperStage): D::KeeperStage =
  if (stage == D::Preflight) D::AuthorityRead
  else if (stage == D::AuthorityRead) D::SignerRole
  else if (stage == D::SignerRole) D::GasReconcile
  else if (stage == D::GasReconcile) D::PaymentScan
  else if (stage == D::PaymentScan) D::MonthlyState
  else if (stage == D::MonthlyState) D::AwardState else D::OtherStage
pure def advance(k: KeeperScan, checkPassed: bool): KeeperScan =
  { ...k, stage: nextStage(k.stage), phase: if (k.stage == D::AwardState) FinishedScan else RunningScan }
```

### Returning to scanning requires successful receipt verification and indexing

The scanner enters payment evidence when its receipt callback starts. Only a
successful verifier moves it to payment indexing. Only a successful index
write returns to scanning. Each callback repeats those states for its own
receipt. A verifier, index or scanner failure remains at that stage. The exact normalized
result from that transition flows into the [summary](./keeperDiagnostics.md),
which groups its projected labels with other failed results.

```quint
pure def canBeginReceipt(k: KeeperScan): bool = k.phase == RunningScan and k.stage == D::PaymentScan
pure def beginReceipt(k: KeeperScan): KeeperScan = { ...k, stage: D::PaymentEvidence }
pure def canVerifyReceipt(k: KeeperScan, verified: bool): bool = k.phase == RunningScan and k.stage == D::PaymentEvidence and verified
pure def verifyReceipt(k: KeeperScan, verified: bool): KeeperScan = { ...k, stage: D::PaymentIndex }
pure def canIndexReceipt(k: KeeperScan, indexed: bool): bool = k.phase == RunningScan and k.stage == D::PaymentIndex and indexed
pure def indexReceipt(k: KeeperScan, indexed: bool): KeeperScan = { ...k, stage: D::PaymentScan }
pure def canRecordFailure(k: KeeperScan): bool = k.phase == RunningScan and k.stage != D::OtherStage
pure def recordFailure(k: KeeperScan, classifiedError: D::ClassifiedError): KeeperScan =
  { ...k, phase: FailedScan, failure: { operation: D::DeploymentOp,
    outcome: D::UnavailableWork, observedStage: k.stage, hasError: true, classifiedError: classifiedError } }
pure def failureResult(k: KeeperScan): List[D::DiagnosticResult] =
  if (k.phase == FailedScan) List(k.failure) else List()
pure def failureKey(k: KeeperScan): D::DiagnosticKey = D::diagnosticKey(k.failure)
pure def alwaysFailureKeepsStage(k: KeeperScan): bool =
  if (k.phase == FailedScan) k.failure.operation == D::DeploymentOp and
    k.failure.outcome == D::UnavailableWork and k.failure.observedStage == k.stage and
    k.failure.hasError and k.stage != D::OtherStage
  else k.failure == noFailure
pure def alwaysOnlyFinishedLeavesStages(k: KeeperScan): bool = (k.phase == FinishedScan) == (k.stage == D::OtherStage)
pure def sometimesEvidenceFailure(k: KeeperScan): bool = k.phase == FailedScan and k.stage == D::PaymentEvidence
pure def sometimesIndexFailure(k: KeeperScan): bool = k.phase == FailedScan and k.stage == D::PaymentIndex
pure def sometimesFinished(k: KeeperScan): bool = k.phase == FinishedScan
pure val checkedRpc = R::preflight(R::resolve(R::initial), 1, 0, R::BaseMainnet, true)
pure val wrongRpc = R::preflight(R::resolve(R::initial), 1, 0, R::BaseSepolia, true)
pure val rotatedRpc = R::preflight(R::resolve(R::chooseOverride(R::initial, R::HttpsOverride, 2, 1)), 2, 1, R::BaseMainnet, true)
pure val rpcValues = Set(R::initial, checkedRpc, wrongRpc, rotatedRpc)
pure val identityValues = Set(R::defaultKeeperIdentity, { ...R::defaultKeeperIdentity, objectId: 9 })
pure val endpointValues = Set(0, 1, 2)
pure val selectionValues = Set(0, 1)
pure val weight_begin = 8
pure val weight_confirmPreflight = 12
pure val weight_advance = 12
pure val weight_beginReceipt = 4
pure val weight_verifyReceipt = 8
pure val weight_indexReceipt = 8
```
