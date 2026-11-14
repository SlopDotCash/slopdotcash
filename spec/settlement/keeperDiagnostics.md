# Operator keeper diagnostic projection

Source is `operator_keeper_diagnostics.qnt`, `scripts/payment-keeper/keeper.ts`
and `workers/operator-keeper/index.ts` at Slop main
`8d14a9692b998ee3f4479725b6323125f11f11be`. The diagnostic describes unavailable
work. The keeper retains the durable attempts and the scheduled run fails.

## Story: Identify an unavailable stage without disclosing private data

### A failure projects to fixed operation, state, stage and cause labels

The adapter classifies known operation prefixes without retaining their
suffixes. It supplies a registry cause only for an exact local known error.
RPC failure classes come from trusted runtime type checks. Typed EVM or Solana
unavailability takes precedence over the generic EVM error. A spoofed error
name is the other class. Only unavailable deployment rows may carry a named
stage or RPC cause. Registry failures may carry an approved registry cause.
Raw error text, URL, credentials, transaction IDs, wallet and project IDs,
amounts, configuration and other private fields stay outside this projection.

```quint
type DiagnosticOperation = RegistryOp | DeploymentOp | MonthlyOp | AwardOp | OtherOp
type DiagnosticState = UnavailableWork | PublicationUnavailable | WaitingWork | OtherWork
type KeeperStage = Preflight | AuthorityRead | SignerRole | GasReconcile | PaymentScan | PaymentEvidence | PaymentIndex | MonthlyState | AwardState | OtherStage
type DiagnosticCause = RpcUnavailable | RpcError | ProjectUnavailable | DeploymentUnavailable | OtherCause
type ClassifiedError = EvmUnavailable | SolanaUnavailable | EvmFailure | RegistryProjectMissing | RegistryDeploymentMissing | UnrecognizedError
type DiagnosticResult = { operation: DiagnosticOperation, outcome: DiagnosticState, observedStage: KeeperStage,
  hasError: bool, classifiedError: ClassifiedError }
type DiagnosticKey = { operation: DiagnosticOperation, outcome: DiagnosticState, stage: KeeperStage, cause: DiagnosticCause }
pure def resultFailed(row: DiagnosticResult): bool = row.hasError or row.outcome == UnavailableWork or row.outcome == PublicationUnavailable
pure def deploymentUnavailable(row: DiagnosticResult): bool = row.operation == DeploymentOp and row.outcome == UnavailableWork
pure def rpcCause(error: ClassifiedError): DiagnosticCause =
  if (error == EvmUnavailable or error == SolanaUnavailable) RpcUnavailable
  else if (error == EvmFailure) RpcError else OtherCause
pure def diagnosticKey(row: DiagnosticResult): DiagnosticKey = {
  operation: row.operation, outcome: row.outcome,
  stage: if (deploymentUnavailable(row)) row.observedStage else OtherStage,
  cause: if (not(row.hasError)) OtherCause
    else if (row.operation == RegistryOp and row.classifiedError == RegistryProjectMissing) ProjectUnavailable
    else if (row.operation == RegistryOp and row.classifiedError == RegistryDeploymentMissing) DeploymentUnavailable
    else if (deploymentUnavailable(row)) rpcCause(row.classifiedError) else OtherCause
}
pure def lawForeignContextCannotBorrowStageOrRpcCause(row: DiagnosticResult): bool =
  not(deploymentUnavailable(row)) implies diagnosticKey(row).stage == OtherStage and
    diagnosticKey(row).cause != RpcUnavailable and diagnosticKey(row).cause != RpcError
pure def lawRegistryCauseOnlyFromRegistry(row: DiagnosticResult): bool =
  (diagnosticKey(row).cause == ProjectUnavailable or diagnosticKey(row).cause == DeploymentUnavailable)
    implies row.operation == RegistryOp and row.hasError
pure def lawTypedUnavailableIsNotGenericRpcError(row: DiagnosticResult): bool =
  (deploymentUnavailable(row) and row.hasError and (row.classifiedError == EvmUnavailable or row.classifiedError == SolanaUnavailable))
    implies diagnosticKey(row).cause == RpcUnavailable
```

### Failed results aggregate into positive counts with no output for healthy work

Identical projected labels produce one group. Every group counts exactly its
failed rows. The scheduled summary has the fixed event name and schema 2 when
there are failures. A successful, empty or waiting result with no error emits
nothing. The adapter sorts the fixed labels for stable JSON and records the
summary before propagating the existing sanitized scheduled failure. It does
not reset the journal or change financial state.

```quint
type Group = { key: DiagnosticKey, count: int }
type DiagnosticSummary = { emitted: bool, eventName: str, schemaVersion: int, failedResults: int,
  groups: List[Group], scheduledFailed: bool }
pure def addGroup(groups: List[Group], label: DiagnosticKey): List[Group] =
  if (groups.some(group => group.key == label))
    groups.listMap(group => if (group.key == label) { ...group, count: group.count + 1 } else group)
  else groups.append({ key: label, count: 1 })
pure def failedKeys(results: List[DiagnosticResult]): List[DiagnosticKey] =
  results.foldl(List(), (labels, row) => if (resultFailed(row)) labels.append(diagnosticKey(row)) else labels)
pure def positiveGroups(labels: List[DiagnosticKey]): List[Group] =
  labels.foldl(List(), (groups, label) => addGroup(groups, label))
pure def totalCounts(groups: List[Group]): int = groups.foldl(0, (total, group) => total + group.count)
pure def summarize(results: List[DiagnosticResult]): DiagnosticSummary =
  val labels = failedKeys(results)
  val hasFailures = labels.length() > 0
  { emitted: hasFailures, eventName: if (hasFailures) "operator_keeper_unavailable" else "",
    schemaVersion: if (hasFailures) 2 else 0, failedResults: labels.length(),
    groups: positiveGroups(labels), scheduledFailed: hasFailures }
pure def lawHealthyWorkStaysSilent(results: List[DiagnosticResult]): bool =
  results.every(row => not(resultFailed(row))) implies not(summarize(results).emitted) and
    summarize(results).groups.length() == 0 and not(summarize(results).scheduledFailed)
pure def lawDiagnosticNeverClearsFailure(results: List[DiagnosticResult]): bool =
  summarize(results).emitted == summarize(results).scheduledFailed and
    (summarize(results).failedResults > 0 iff summarize(results).scheduledFailed)
pure def lawPositiveCounts(results: List[DiagnosticResult]): bool =
  summarize(results).groups.every(group => group.count > 0)
pure def lawSummaryCountsMatchFailures(results: List[DiagnosticResult]): bool =
  totalCounts(summarize(results).groups) == summarize(results).failedResults
pure val healthyResult: DiagnosticResult = { operation: AwardOp, outcome: WaitingWork,
  observedStage: OtherStage, hasError: false, classifiedError: UnrecognizedError }
pure val unavailableResult: DiagnosticResult = { operation: DeploymentOp, outcome: UnavailableWork,
  observedStage: PaymentEvidence, hasError: true, classifiedError: EvmUnavailable }
pure val registryResult: DiagnosticResult = { operation: RegistryOp, outcome: UnavailableWork,
  observedStage: Preflight, hasError: true, classifiedError: RegistryDeploymentMissing }
pure val otherResult: DiagnosticResult = { operation: OtherOp, outcome: OtherWork,
  observedStage: PaymentIndex, hasError: true, classifiedError: EvmFailure }
pure val resultsValues = Set(List(), List(healthyResult), List(unavailableResult, unavailableResult),
  List(healthyResult, unavailableResult, registryResult, otherResult))
pure val rowValues = Set(healthyResult, unavailableResult, registryResult, otherResult)
```

### An invocation exception reports only a fixed failure response

The private Durable Object invocation returns status 503 and the fixed error
code if it throws before producing its results. The scheduled handler raises
its sanitized failure and retains the durable journal. The public Worker
endpoint returns 404.

```quint
type KeeperResponseStatus = { status: int, errorCode: str }
pure def invocationStatus(completed: bool): KeeperResponseStatus =
  if (completed) { status: 200, errorCode: "" } else { status: 503, errorCode: "keeper_run_failed" }
pure def lawFailedInvocationHasFixedStatus(completed: bool): bool =
  not(completed) implies invocationStatus(completed) == { status: 503, errorCode: "keeper_run_failed" }
```
