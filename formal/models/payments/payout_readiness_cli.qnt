// @source scripts/check-payout-readiness.ts
// @source scripts/sync-project-registry.mjs
// @source workers/payments/registry-database.mjs
// @evidence scripts/payout-readiness-proof.test.ts
// One CLI process, at most one explicit rerun, two config reads, two RPC-map
// entries and two representative report rows. Modules have already loaded.
// Argument profiles bound raw tokens; duplicate --probe/--config/--require are
// accepted, while registry origin is unique. Grammar consumes values before
// validating required network names and --require's --probe prerequisite.
//
// The local registry is already imported; the live registry await precedes
// every config read. Promise.all starts all config reads, but one rejection
// advances the catch path without cancelling its siblings. Config reads have
// no publication effect. Optional RPC probes are sequential in map entry
// order, skip unknown/non-string entries and continue after returned refusal.
// Probe results and per-network readiness are supplied by payout_rpc_probe
// and payout_readiness. No action accesses a provider, signer or wallet.
//
// Registry database loading precedes parsing PAYMENT_SOLANA_GENESIS. Report
// validation completes before any human/JSON output. --require is evaluated
// after the complete JSON write: a complete NOT READY report may exit 0 with
// no requirements, or exit 1 when a required row is not ready. Backpressure
// false is ignored by the source; write acceptance is not delivery proof.
// Synchronous output errors may leave a prefix. Native asynchronous stream
// errors/process termination are outside this bound. No rollback or atomic
// stdout publication is claimed. All scenarios are authored, not executed.
module payout_readiness_cli {
  val ids = Set(1, 2)
  val flags = Set("--probe", "--config", "--require", "--registry-origin", "--unknown")
  val probeResults = Set("finalized", "wrong-chain", "no-finalized-head", "unreachable")
  type State = { phase: str, invocation: int, args: List[str], cursor: int, origin: int,
    fileCount: int, required: Set[int], requireCount: int, probe: bool,
    registrySource: str, configs: int -> str, configBarrier: bool,
    entries: int, entryKinds: int -> str, entry: int, probeOrder: List[int], results: int -> str,
    ready: Set[int], row: int, writtenRows: Set[int], json: bool, partial: bool,
    error: str, stderr: str, exitCode: int }
  var s: State
  action init = s' = { phase: "input", invocation: 0, args: List(), cursor: 0, origin: 0,
    fileCount: 0, required: Set(), requireCount: 0, probe: false, registrySource: "none",
    configs: ids.mapBy(_ => "unused"), configBarrier: false, entries: 0,
    entryKinds: ids.mapBy(_ => "eligible"), entry: 1, probeOrder: List(), results: ids.mapBy(_ => "none"),
    ready: Set(), row: 1, writtenRows: Set(), json: false, partial: false, error: "none", stderr: "none", exitCode: -1 }
  def refuse(reason: str): State = s.with("phase", "catch-write").with("error", reason)
  action arguments(kind: int): bool = {
    val args = if (kind == 1) List("--probe")
      else if (kind == 2) List("--require", "net1")
      else if (kind == 3) List("--probe", "--require", "badnet")
      else if (kind == 4) List("--unknown")
      else if (kind == 5) List("--config")
      else if (kind == 6) List("--config", "--probe")
      else if (kind == 7) List("--registry-origin", "url1", "--registry-origin", "url2")
      else if (kind == 8) List("--config", "file1", "--config", "file2", "--probe")
      else if (kind == 9) List("--probe", "--probe", "--require", "net1", "--require", "net1")
      else if (kind == 10) List("--registry-origin", "url1", "--probe")
      else if (kind == 11) List("--probe", "--require", "net1") else List()
    all { s.phase == "input", kind >= 0, kind <= 11, s' = s.with("args", args) }
  }
  action begin = all { s.phase == "input", s.invocation < 2,
    s' = s.with("phase", "args").with("invocation", s.invocation + 1).with("cursor", 0)
      .with("origin", 0).with("fileCount", 0).with("required", Set()).with("requireCount", 0).with("probe", false)
      .with("registrySource", "none").with("configs", ids.mapBy(_ => "unused")).with("configBarrier", false)
      .with("entries", 0).with("entry", 1).with("probeOrder", List()).with("results", ids.mapBy(_ => "none"))
      .with("ready", Set()).with("row", 1).with("writtenRows", Set()).with("json", false).with("partial", false)
      .with("error", "none").with("stderr", "none").with("exitCode", -1) }
  action parse = {
    val token = if (s.cursor < s.args.length()) s.args.nth(s.cursor) else ""
    val value = if (s.cursor + 1 < s.args.length()) s.args.nth(s.cursor + 1) else ""
    val pair = Set("--config", "--require", "--registry-origin").contains(token) and value != "" and not(flags.contains(value))
    val advanced = s.with("cursor", s.cursor + 2)
    all { s.phase == "args",
      s' = if (s.cursor == s.args.length()) s.with("phase", "argument-check")
        else if (token == "--probe") s.with("probe", true).with("cursor", s.cursor + 1)
        else if (not(pair)) refuse("usage")
        else if (token == "--config") advanced.with("fileCount", s.fileCount + 1)
        else if (token == "--require") advanced.with("required", s.required.union(Set(if (value == "net1") 1 else if (value == "net2") 2 else 0)))
          .with("requireCount", s.requireCount + 1)
        else if (s.origin != 0) refuse("duplicate-origin") else advanced.with("origin", 1) }
  }
  action checkArguments = all { s.phase == "argument-check",
    s' = if (s.required.contains(0)) refuse("unknown-network")
      else if (s.requireCount > 0 and not(s.probe)) refuse("require-needs-probe")
      else s.with("phase", "registry").with("registrySource", if (s.origin == 0) "local" else "live") }
  action registryReply(ok: bool): bool = all { s.phase == "registry", s.origin != 0 or ok,
    s' = if (ok) s.with("phase", "configs").with("configs", ids.mapBy(id => if (id <= s.fileCount) "pending" else "unused"))
      else refuse("registry-read") }
  action configReply(id: int, ok: bool): bool = {
    val configs = s.configs.set(id, if (ok) "done" else "failed")
    val completed = ids.forall(slot => configs.get(slot) != "pending")
    all { ids.contains(id), s.configs.get(id) == "pending",
      s' = if (s.phase != "configs") s.with("configs", configs)
        else if (not(ok)) refuse("config-read-or-json").with("configs", configs)
        else s.with("configs", configs).with("phase", if (completed) "rpc-map" else "configs")
          .with("configBarrier", completed) }
  }
  action noConfigs = all { s.phase == "configs", s.fileCount == 0,
    s' = s.with("phase", "rpc-map").with("configBarrier", true) }
  action rpcMap(kind: str, entries: int): bool = all { s.phase == "rpc-map",
    Set("absent", "object", "invalid").contains(kind), Set(0, 1, 2).contains(entries),
    s' = if (kind == "invalid") refuse("rpc-map") else s.with("entries", if (kind == "absent") 0 else entries)
      .with("phase", if (s.probe) "probe-select" else "database") }
  action entryKind(id: int, kind: str): bool = all { s.phase == "input", ids.contains(id),
    Set("eligible", "unknown", "non-string").contains(kind), s' = s.with("entryKinds", s.entryKinds.set(id, kind)) }
  action selectProbe = all { s.phase == "probe-select",
    s' = if (s.entry > s.entries) s.with("phase", "database")
      else if (s.entryKinds.get(s.entry) != "eligible") s.with("entry", s.entry + 1)
      else s.with("phase", "probe-wait").with("probeOrder", s.probeOrder.append(s.entry)) }
  action probeReply(result: str): bool = all { s.phase == "probe-wait", probeResults.contains(result),
    s' = s.with("results", s.results.set(s.entry, result)).with("entry", s.entry + 1).with("phase", "probe-select") }
  action databaseReply(ok: bool): bool = all { s.phase == "database",
    s' = if (ok) s.with("phase", "genesis-map") else refuse("registry-database") }
  action genesisMap(valid: bool): bool = all { s.phase == "genesis-map",
    s' = if (valid) s.with("phase", "report") else refuse("genesis-map") }
  // The delegated reporter decides readiness; with probing on, a ready row
  // requires its fresh finalized result and all its configuration predicates.
  action report(valid: bool, ready: Set[int]): bool = all { s.phase == "report", ready.subseteq(ids),
    not(valid) or not(s.probe) or ready.forall(id => s.results.get(id) == "finalized"),
    s' = if (valid) s.with("ready", ready).with("phase", "rows") else refuse("report-validation") }
  action writeRow(result: str): bool = all { s.phase == "rows", Set("accepted", "backpressure", "throws").contains(result),
    s' = if (result == "throws") refuse("stdout-row").with("partial", true)
      else s.with("writtenRows", s.writtenRows.union(Set(s.row))).with("row", s.row + 1)
        .with("phase", if (s.row == 2) "json" else "rows") }
  action writeJson(result: str): bool = all { s.phase == "json", Set("accepted", "backpressure", "throws").contains(result),
    s' = if (result == "throws") refuse("stdout-json").with("partial", true)
      else s.with("json", true).with("phase", "required") }
  action requireResult = all { s.phase == "required",
    s' = if (s.required.subseteq(s.ready)) s.with("phase", "done").with("exitCode", 0)
      else s.with("phase", "refusal-write") }
  action refusalWrite(ok: bool): bool = all { s.phase == "refusal-write",
    s' = if (ok) s.with("stderr", "refused").with("phase", "done").with("exitCode", 1) else refuse("stderr-refusal") }
  action catchWrite(ok: bool): bool = all { s.phase == "catch-write",
    s' = s.with("phase", "done").with("stderr", if (ok) "error" else "unhandled-output-error")
      .with("exitCode", if (ok) 1 else -1) }
  action rerun = all { s.phase == "done", s.invocation == 1,
    ids.forall(id => s.configs.get(id) != "pending"), s' = s.with("phase", "input") }
  action step = {
    nondet kind = 0.to(11).oneOf() nondet id = ids.oneOf() nondet count = Set(0, 1, 2).oneOf()
    nondet yes = Set(false, true).oneOf() nondet ready = Set(Set(), Set(1), Set(2), ids).oneOf()
    nondet mapKind = Set("absent", "object", "invalid").oneOf()
    nondet entry = Set("eligible", "unknown", "non-string").oneOf()
    nondet result = probeResults.oneOf() nondet output = Set("accepted", "backpressure", "throws").oneOf()
    any { arguments(kind), entryKind(id, entry), begin, parse, checkArguments, registryReply(yes), configReply(id, yes), noConfigs,
      rpcMap(mapKind, count), selectProbe, probeReply(result), databaseReply(yes), genesisMap(yes), report(yes, ready),
      writeRow(output), writeJson(output), requireResult, refusalWrite(yes), catchWrite(yes), rerun, s' = s }
  }
  val invariant = all { s.invocation <= 2, s.fileCount <= 2, s.requireCount <= 2, s.cursor <= 6,
    s.probeOrder.length() <= 2, s.writtenRows.subseteq(ids),
    s.probeOrder.length() > 0 implies s.probe and s.configBarrier,
    s.json implies s.writtenRows == ids,
    s.exitCode == 0 implies s.json and s.required.subseteq(s.ready),
    not(s.configBarrier) implies s.probeOrder == List(),
    s.stderr == "refused" implies s.json and not(s.required.subseteq(s.ready)) }
  action emptyArguments = begin.then(parse).then(checkArguments)
  action probeArguments = arguments(1).then(begin).then(parse).then(parse).then(checkArguments)
  action localInputs = registryReply(true).then(noConfigs).then(rpcMap("object", 0)).then(databaseReply(true)).then(genesisMap(true))
  action output = writeRow("accepted").then(writeRow("accepted")).then(writeJson("accepted")).then(requireResult)
  run noRequirementsCanReturnNotReadyReportTest = init.then(emptyArguments).then(localInputs).then(report(true, Set())).then(output)
    .expect(s.exitCode == 0 and s.json and s.ready == Set() and invariant)
  run requireWithoutProbeStopsBeforeRegistryTest = init.then(arguments(2)).then(begin).then(parse).then(parse).then(checkArguments).then(catchWrite(true))
    .expect(s.error == "require-needs-probe" and s.registrySource == "none" and invariant)
  run unknownRequiredNetworkStopsBeforeRegistryTest = init.then(arguments(3)).then(begin).then(parse).then(parse).then(parse).then(checkArguments)
    .expect(s.error == "unknown-network" and invariant)
  run missingFlagValueCannotConsumeNextFlagTest = init.then(arguments(6)).then(begin).then(parse)
    .expect(s.error == "usage" and not(s.probe) and invariant)
  run duplicateOriginRefusesWithoutFetchingEitherTest = init.then(arguments(7)).then(begin).then(parse).then(parse)
    .expect(s.error == "duplicate-origin" and s.registrySource == "none" and invariant)
  run repeatedProbeAndRequirementAreAcceptedTest = init.then(arguments(9)).then(begin).then(parse).then(parse).then(parse).then(parse).then(parse).then(checkArguments)
    .expect(s.probe and s.required == Set(1) and s.requireCount == 2 and s.phase == "registry" and invariant)
  run liveRegistryFailurePrecedesConfigReadsTest = init.then(arguments(10)).then(begin).then(parse).then(parse).then(parse).then(checkArguments)
    .then(registryReply(false)).expect(s.error == "registry-read" and s.configs.get(1) == "unused" and invariant)
  run failedParallelConfigDoesNotCancelSiblingTest = init.then(arguments(8)).then(begin).then(parse).then(parse).then(parse).then(parse).then(checkArguments)
    .then(registryReply(true)).then(configReply(1, false)).then(catchWrite(true)).then(configReply(2, true))
    .expect(s.exitCode == 1 and s.configs.get(2) == "done" and s.probeOrder == List() and invariant)
  run malformedRpcMapStopsBeforeProbesTest = init.then(probeArguments).then(registryReply(true)).then(noConfigs).then(rpcMap("invalid", 2))
    .expect(s.error == "rpc-map" and s.probeOrder == List() and invariant)
  run firstProbeFailureStillPermitsSecondProbeTest = init.then(probeArguments).then(registryReply(true)).then(noConfigs).then(rpcMap("object", 2))
    .then(selectProbe).then(probeReply("unreachable")).then(selectProbe).then(probeReply("finalized")).then(selectProbe)
    .expect(s.probeOrder == List(1, 2) and s.phase == "database" and invariant)
  run unknownAndNonStringEntriesAreSkippedTest = init.then(entryKind(1, "unknown")).then(entryKind(2, "non-string"))
    .then(probeArguments).then(registryReply(true)).then(noConfigs).then(rpcMap("object", 2)).then(selectProbe).then(selectProbe).then(selectProbe)
    .expect(s.probeOrder == List() and s.phase == "database" and invariant)
  run databaseFailureComesAfterProbeTest = init.then(probeArguments).then(registryReply(true)).then(noConfigs).then(rpcMap("object", 1))
    .then(selectProbe).then(probeReply("finalized")).then(selectProbe).then(databaseReply(false))
    .expect(s.error == "registry-database" and s.probeOrder == List(1) and not(s.json) and invariant)
  run genesisMapFailureComesAfterDatabaseReadTest = init.then(emptyArguments).then(registryReply(true)).then(noConfigs).then(rpcMap("absent", 0))
    .then(databaseReply(true)).then(genesisMap(false)).expect(s.error == "genesis-map" and s.writtenRows == Set() and invariant)
  run reportValidationRefusalPrintsNoRowsTest = init.then(emptyArguments).then(localInputs).then(report(false, Set()))
    .expect(s.error == "report-validation" and s.writtenRows == Set() and invariant)
  run requiredFailureFollowsCompleteJsonTest = init.then(arguments(11)).then(begin).then(parse).then(parse).then(parse).then(checkArguments)
    .then(registryReply(true)).then(noConfigs).then(rpcMap("absent", 0)).then(selectProbe).then(databaseReply(true)).then(genesisMap(true))
    .then(report(true, Set())).then(output).then(refusalWrite(true))
    .expect(s.exitCode == 1 and s.json and s.stderr == "refused" and invariant)
  run rowWriteErrorKeepsOnlyCompletedPrefixTest = init.then(emptyArguments).then(localInputs).then(report(true, Set()))
    .then(writeRow("accepted")).then(writeRow("throws")).then(catchWrite(true))
    .expect(s.exitCode == 1 and s.writtenRows == Set(1) and not(s.json) and s.partial and invariant)
  run jsonWriteErrorDoesNotEraseHumanRowsTest = init.then(emptyArguments).then(localInputs).then(report(true, Set()))
    .then(writeRow("accepted")).then(writeRow("accepted")).then(writeJson("throws")).then(catchWrite(true))
    .expect(s.writtenRows == ids and not(s.json) and s.exitCode == 1 and invariant)
  run backpressureDoesNotActAsARefusalTest = init.then(emptyArguments).then(localInputs).then(report(true, Set()))
    .then(writeRow("backpressure")).then(writeRow("backpressure")).then(writeJson("backpressure")).then(requireResult)
    .expect(s.exitCode == 0 and s.json and invariant)
  run secondProcessDoesNotInheritProbeResultsTest = init.then(probeArguments).then(registryReply(true)).then(noConfigs).then(rpcMap("object", 1))
    .then(selectProbe).then(probeReply("finalized")).then(selectProbe).then(databaseReply(true)).then(genesisMap(true))
    .then(report(true, Set(1))).then(output).then(rerun).then(arguments(0)).then(emptyArguments)
    .expect(s.invocation == 2 and s.results.get(1) == "none" and s.probeOrder == List() and invariant)
}
