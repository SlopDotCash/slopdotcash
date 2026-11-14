// @source scripts/payment-keeper/keeper.ts
// @source workers/operator-keeper/index.ts
// @conformance scripts/payment-keeper/keeper.test.ts
// @conformance workers/operator-keeper/index.test.ts
// Diagnostic projection only: one deployment, at most one receipt callback,
// and two result rows. Unknown strings and secret-bearing errors are quotient
// representatives, not an enumeration of byte strings. The stage transitions
// abstract awaited calls and SQLite operations. They do not prove RPC, storage,
// transaction execution, finality, or mechanical source refinement. Group order,
// JSON encoding, and JavaScript integer overflow are outside this finite model.
module operator_keeper_diagnostics {
  val stages = Set("preflight", "authority-read", "signer-role", "gas-reconcile",
    "payment-scan", "payment-evidence", "payment-index", "monthly-state", "award-state")
  val operations = Set("registry", "deployment", "monthly", "award", "other")
  val states = Set("unavailable", "publication-unavailable", "waiting", "other")
  val causes = Set("rpc-unavailable", "rpc-error", "project-unavailable", "deployment-unavailable", "other")
  val ids = Set(1, 2)
  type Row = { operation: str, state: str, stage: str, cause: str,
    error: bool, errorKind: str, privateValue: int }
  type Key = { operation: str, state: str, stage: str, cause: str }
  type Group = { key: Key, count: int }
  val empty: Row = { operation: "deployment", state: "checked", stage: "", cause: "",
    error: false, errorKind: "none", privateValue: 0 }
  var s: { phase: str, stage: str, callbackUsed: bool, count: int, rows: int -> Row,
    published: bool, emitted: bool, schema: int, failedResults: int,
    groups: Set[Group], threw: bool }

  action init = s' = { phase: "collecting", stage: "preflight", callbackUsed: false,
    count: 0, rows: ids.mapBy(_ => empty), published: false, emitted: false,
    schema: 0, failedResults: 0, groups: Set(), threw: false }

  def failed(row: Row): bool = row.error or
    Set("unavailable", "publication-unavailable").contains(row.state)
  def typedCause(kind: str): str =
    if (Set("evm-unavailable", "solana-unavailable").contains(kind)) "rpc-unavailable"
    else if (kind == "evm-error") "rpc-error" else "other"
  def projected(row: Row): Key = {
    val deployment = row.operation == "deployment" and row.state == "unavailable"
    val operation = if (Set("registry", "deployment", "monthly", "award").contains(row.operation))
      row.operation else "other"
    val state = if (states.contains(row.state)) row.state else "other"
    val stage = if (deployment and stages.contains(row.stage)) row.stage else "other"
    val cause = if (row.operation == "registry" and row.errorKind == "project-unavailable")
      "project-unavailable"
      else if (row.operation == "registry" and row.errorKind == "deployment-unavailable")
        "deployment-unavailable"
      else if (deployment and Set("rpc-unavailable", "rpc-error").contains(row.cause))
        row.cause else "other"
    { operation: operation, state: state, stage: stage, cause: cause }
  }
  def nextStage(stage: str): str =
    if (stage == "preflight") "authority-read"
    else if (stage == "authority-read") "signer-role"
    else if (stage == "signer-role") "gas-reconcile"
    else if (stage == "gas-reconcile") "payment-scan"
    else if (stage == "payment-scan") "monthly-state"
    else if (stage == "monthly-state") "award-state" else "done"

  action begin = all { s.phase == "collecting", s.count == 0, not(s.published),
    s' = s.with("phase", "running").with("stage", "preflight") }
  action advance = all { s.phase == "running",
    not(Set("payment-evidence", "payment-index", "done").contains(s.stage)),
    s' = s.with("stage", nextStage(s.stage)) }
  action beginReceipt = all { s.phase == "running", s.stage == "payment-scan", not(s.callbackUsed),
    s' = s.with("stage", "payment-evidence").with("callbackUsed", true) }
  action verifiedReceipt = all { s.phase == "running", s.stage == "payment-evidence",
    s' = s.with("stage", "payment-index") }
  // Reset only after the callback succeeds. A thrown verifier or index write
  // proceeds directly to fail and retains that phase in the result row.
  action indexedReceipt = all { s.phase == "running", s.stage == "payment-index",
    s' = s.with("stage", "payment-scan") }
  action recordFailure(kind: str): bool = all { s.phase == "running", stages.contains(s.stage),
    Set("evm-unavailable", "solana-unavailable", "evm-error", "spoofed-rpc-name", "private-error").contains(kind),
    s' = s.with("phase", "collecting").with("count", 1)
      .with("rows", s.rows.set(1, { operation: "deployment", state: "unavailable",
        stage: s.stage, cause: typedCause(kind), error: true, errorKind: kind, privateValue: 1 })) }
  action complete = all { s.phase == "running", s.stage == "done",
    s' = s.with("phase", "collecting").with("count", 1).with("rows", s.rows.set(1, empty)) }

  // These rows represent the worker's normalization boundaries. Registry
  // causes come from exact local messages. Monthly and award suffixes have
  // already collapsed to their prefix; arbitrary text is the other class.
  def fixture(kind: int): Row =
    if (kind == 1) empty
    else if (kind == 2) empty.with("operation", "registry").with("state", "unavailable")
      .with("error", true).with("errorKind", "project-unavailable")
    else if (kind == 3) empty.with("operation", "registry").with("state", "unavailable")
      .with("error", true).with("errorKind", "deployment-unavailable")
    else if (kind == 4) empty.with("operation", "monthly").with("state", "publication-unavailable")
      .with("stage", "preflight").with("cause", "rpc-error").with("error", true).with("privateValue", 1)
    else if (kind == 5) empty.with("operation", "award").with("state", "waiting")
      .with("stage", "payment-index").with("cause", "rpc-unavailable").with("error", true).with("privateValue", 1)
    else if (kind == 6) empty.with("operation", "private-operation").with("state", "private-state")
      .with("stage", "private-stage").with("cause", "private-cause").with("error", true).with("privateValue", 2)
    else if (kind == 7) empty.with("state", "unavailable").with("stage", "private-stage")
      .with("cause", "private-cause").with("error", true).with("privateValue", 1)
    else if (kind == 8) empty.with("state", "unavailable").with("stage", "preflight")
      .with("cause", "rpc-unavailable").with("error", true)
    else empty.with("operation", "award").with("state", "waiting")
  action addFixture(kind: int): bool = all { s.phase == "collecting", not(s.published), s.count < 2,
    Set(1, 2, 3, 4, 5, 6, 7, 8, 9).contains(kind),
    s' = s.with("count", s.count + 1).with("rows", s.rows.set(s.count + 1, fixture(kind))) }
  action publish = {
    val failedIds = ids.filter(id => id <= s.count and failed(s.rows.get(id)))
    val groupKeys = failedIds.map(id => projected(s.rows.get(id)))
    val groups = groupKeys.map(key => { key: key,
      count: failedIds.filter(id => projected(s.rows.get(id)) == key).size() })
    all { s.phase == "collecting", not(s.published),
      s' = s.with("published", true).with("emitted", failedIds.size() > 0)
        .with("schema", if (failedIds.size() > 0) 2 else 0)
        .with("failedResults", failedIds.size()).with("groups", groups)
        .with("threw", failedIds.size() > 0) }
  }
  action step = any { begin, advance, beginReceipt, verifiedReceipt, indexedReceipt, complete,
    { nondet kind = Set("evm-unavailable", "solana-unavailable", "evm-error", "spoofed-rpc-name", "private-error").oneOf()
      recordFailure(kind) },
    { nondet kind = Set(1, 2, 3, 4, 5, 6, 7, 8, 9).oneOf() addFixture(kind) },
    publish, s' = s }

  val invariant = all {
    s.count >= 0 and s.count <= 2,
    s.failedResults >= 0 and s.failedResults <= s.count,
    s.groups.forall(group => group.count > 0 and group.count <= 2
      and operations.contains(group.key.operation) and states.contains(group.key.state)
      and (stages.contains(group.key.stage) or group.key.stage == "other")
      and causes.contains(group.key.cause)),
    s.groups.fold(0, (total, group) => total + group.count) == s.failedResults,
    s.emitted implies (s.schema == 2 and s.failedResults > 0 and s.groups.size() > 0 and s.threw),
    s.published implies (s.threw == (s.failedResults > 0) and s.emitted == s.threw),
    not(s.emitted) implies (s.schema == 0 and s.groups == Set())
  }

  run successfulAndEmptyResultsStaySilentTest = init.then(addFixture(1)).then(publish)
    .expect(not(s.emitted) and not(s.threw) and invariant)
  run emptyRunStaysSilentTest = init.then(publish).expect(not(s.emitted) and invariant)
  run unknownValuesCollapseWithoutPrivateDataTest = init.then(addFixture(6)).then(addFixture(7)).then(publish)
    .expect(s.failedResults == 2 and s.groups.forall(group => group.key.stage == "other"
      and group.key.cause == "other") and invariant)
  run identicalFailuresAggregatePositiveCountsTest = init.then(addFixture(8)).then(addFixture(8)).then(publish)
    .expect(s.groups.size() == 1 and s.groups.forall(group => group.count == 2) and invariant)
  run nondeploymentCannotBorrowStageOrRpcCauseTest = init.then(addFixture(4)).then(addFixture(5)).then(publish)
    .expect(s.groups.forall(group => group.key.stage == "other" and group.key.cause == "other") and invariant)
  run waitingWithoutErrorDoesNotTriggerFailureTest = init.then(addFixture(9)).then(publish)
    .expect(not(s.emitted) and not(s.threw) and invariant)
  run spoofedRpcNameRemainsOtherTest = init.then(begin).then(recordFailure("spoofed-rpc-name")).then(publish)
    .expect(s.groups.forall(group => group.key.cause == "other") and invariant)
  run unavailableSubclassHasPriorityTest = init.then(begin).then(recordFailure("evm-unavailable")).then(publish)
    .expect(s.groups.forall(group => group.key.cause == "rpc-unavailable") and invariant)
  run verifierFailureRetainsEvidenceStageTest = init.then(begin).then(advance).then(advance)
    .then(advance).then(advance).then(beginReceipt).then(recordFailure("private-error")).then(publish)
    .expect(s.groups.forall(group => group.key.stage == "payment-evidence") and invariant)
  run indexFailureRetainsIndexStageTest = init.then(begin).then(advance).then(advance)
    .then(advance).then(advance).then(beginReceipt).then(verifiedReceipt)
    .then(recordFailure("private-error")).then(publish)
    .expect(s.groups.forall(group => group.key.stage == "payment-index") and invariant)
  run successfulCallbackRestoresScannerStageTest = init.then(begin).then(advance).then(advance)
    .then(advance).then(advance).then(beginReceipt).then(verifiedReceipt).then(indexedReceipt)
    .then(recordFailure("private-error")).then(publish)
    .expect(s.groups.forall(group => group.key.stage == "payment-scan") and invariant)
  run diagnosticDoesNotEraseExistingFailureTest = init.then(begin).then(recordFailure("evm-error")).then(publish)
    .expect(s.threw and s.failedResults == 1 and s.groups.forall(group => group.key.cause == "rpc-error") and invariant)
}
