// @source workers/operator-keeper/index.ts
// @source workers/operator-keeper/storage.ts
// @source scripts/payment-keeper/keeper.ts
// @source scripts/payment-keeper/storage.ts
// @source scripts/payment-keeper/signer.ts
// @source scripts/payment-keeper/budget.ts
// @evidence scripts/payment-keeper/evm.integration.ts
// One normalized network/gas-wallet Durable Object, two instance lifetimes,
// two core runs and three incoming request slots. Project selection is not
// part of object identity. Two registry identities model the durable journal
// guard; address normalization and configuration validation are predicates.
// The environment is fixed during an instance; a replacement may change its
// mode, registry or selected projects without resetting persisted storage.
//
// A pending in-memory promise coalesces callers. Its finally clears the slot
// before every caller necessarily receives a response. Core completion, HTTP
// delivery and the scheduled handler's result inspection are separate. Partial
// item failure returns HTTP200 but still fails scheduled execution; thrown core
// failure returns a redacted503. No public route reaches this object.
//
// Inner payment guards and amounts are predicates of the executor/funding
// models. One symbolic signed attempt, nonce mark and gas liability commit in
// the same storage transaction; staging alone authorizes no broadcast. Dry-run
// indexing may write durable state but never invokes a signer or sends. Gas
// evidence releases only that liability, never establishes an award as paid.
// A lost instance abandons unfinished work, not its journal or external sends.
// An already completed response may still arrive after the replacement starts.
// Durable Object single-instance exclusivity and transaction
// rollback are host assumptions, not claims about a second namespace/CLI.
// Existing native integration defines coalescing, transaction rollback and
// kill/restart recovery. It is partial evidence; no checks were executed here.
module operator_keeper_lifecycle {
  val ids = Set(1, 2, 3)
  val runIds = Set(1, 2)
  val modes = Set("off", "dry_run", "execute", "invalid")
  type Request = { phase: str, caller: str, instance: int, runId: int, http: int, result: str }
  type Run = { phase: str, instance: int, mode: str, registry: int,
    configValid: bool, projects: int, staged: bool, attempted: bool, itemError: bool, outcome: str }
  type State = { instance: int, mode: str, configValid: bool, registry: int, projects: int,
    active: int, count: int, runs: int -> Run, requests: int -> Request,
    journalRegistry: int, indexed: bool, signed: bool, nonce: bool, liability: bool,
    settledGas: bool, broadcasts: int, safeSigning: bool }
  val unusedRequest: Request = { phase: "unused", caller: "direct", instance: 0, runId: 0, http: 0, result: "none" }
  val unusedRun: Run = { phase: "unused", instance: 0, mode: "off", registry: 1,
    configValid: true, projects: 1, staged: false, attempted: false, itemError: false, outcome: "none" }
  var s: State
  action init = s' = { instance: 1, mode: "off", configValid: true, registry: 1, projects: 1,
    active: 0, count: 0, runs: runIds.mapBy(_ => unusedRun), requests: ids.mapBy(_ => unusedRequest),
    journalRegistry: 0, indexed: false, signed: false, nonce: false, liability: false,
    settledGas: false, broadcasts: 0, safeSigning: true }
  action configure(mode: str, valid: bool, registry: int): bool = all {
    s.count == 0, ids.forall(id => s.requests.get(id).phase == "unused"), modes.contains(mode), Set(1, 2).contains(registry),
    s' = s.with("mode", mode).with("configValid", valid).with("registry", registry) }
  def settle(id: int, outcome: str): State = s.with("active", 0)
    .with("runs", s.runs.set(id, s.runs.get(id).with("phase", "settled").with("outcome", outcome).with("staged", false)))
  action request(id: int, caller: str): bool = {
    val local = unusedRequest.with("caller", caller).with("instance", s.instance)
    val rejected = caller == "public" or caller == "wrong-route"
    val cronOff = caller == "cron" and s.mode == "off"
    val cronInvalid = caller == "cron" and (s.mode == "invalid" or not(s.configValid))
    all { ids.contains(id), s.requests.get(id).phase == "unused", Set("public", "wrong-route", "direct", "cron").contains(caller),
      s' = s.with("requests", s.requests.set(id,
        if (rejected) local.with("phase", "done").with("http", 404).with("result", "not-found")
        else if (cronOff) local.with("phase", "done").with("result", "success")
        else if (cronInvalid) local.with("phase", "done").with("result", "configuration-error")
        else local.with("phase", "dispatch").with("result", "pending"))) }
  }
  action dispatch(id: int): bool = {
    val r = s.requests.get(id)
    val fresh = s.active == 0
    val key = if (fresh) s.count + 1 else s.active
    all { r.phase == "dispatch", not(fresh) or s.count < 2,
      s' = s.with("active", key).with("count", if (fresh) key else s.count)
        .with("runs", if (fresh) s.runs.set(key, unusedRun.with("phase", "mode").with("instance", s.instance)
          .with("mode", s.mode).with("configValid", s.configValid).with("registry", s.registry).with("projects", s.projects)) else s.runs)
        .with("requests", s.requests.set(id, r.with("phase", "waiting").with("instance", s.instance).with("runId", key))) }
  }
  action selectMode(id: int): bool = {
    val activeRun = s.runs.get(id)
    all { s.active == id, activeRun.phase == "mode",
      s' = if (activeRun.mode == "off") settle(id, "off")
        else if (activeRun.mode == "invalid" or not(activeRun.configValid)) settle(id, "throw")
        else s.with("runs", s.runs.set(id, activeRun.with("phase", "identity"))) }
  }
  action identity(id: int, storageWorks: bool): bool = {
    val activeRun = s.runs.get(id)
    all { s.active == id, activeRun.phase == "identity",
      s' = if (not(storageWorks) or (s.journalRegistry != 0 and s.journalRegistry != activeRun.registry)) settle(id, "throw")
        else s.with("journalRegistry", activeRun.registry).with("runs", s.runs.set(id, activeRun.with("phase", "core"))) }
  }
  action indexReads(id: int): bool = all { s.active == id, s.runs.get(id).phase == "core", s' = s.with("indexed", true) }
  action stageAttempt(id: int): bool = {
    val activeRun = s.runs.get(id)
    all { s.active == id, activeRun.phase == "core", activeRun.mode == "execute", not(s.signed), not(activeRun.attempted),
      s' = s.with("runs", s.runs.set(id, activeRun.with("staged", true).with("attempted", true))) }
  }
  action commitAttempt(id: int, valid: bool): bool = {
    val activeRun = s.runs.get(id)
    all { s.active == id, activeRun.phase == "core", activeRun.staged,
      s' = s.with("signed", s.signed or valid).with("nonce", s.nonce or valid).with("liability", s.liability or valid)
        .with("safeSigning", s.safeSigning and (not(valid) or activeRun.mode == "execute"))
        .with("runs", s.runs.set(id, activeRun.with("staged", false).with("itemError", activeRun.itemError or not(valid)))) }
  }
  action broadcast(id: int): bool = all { s.active == id, s.runs.get(id).phase == "core", s.runs.get(id).mode == "execute",
    s.signed, s.nonce, s.liability, not(s.settledGas), s.broadcasts < 2,
    s' = s.with("broadcasts", s.broadcasts + 1) }
  action gasEvidence(id: int, valid: bool): bool = {
    val activeRun = s.runs.get(id)
    all { s.active == id, activeRun.phase == "core", s.signed,
      s' = if (valid) s.with("liability", false).with("settledGas", true)
        else s.with("runs", s.runs.set(id, activeRun.with("itemError", true))) }
  }
  action itemFailure(id: int): bool = {
    val activeRun = s.runs.get(id)
    all { s.active == id, activeRun.phase == "core", s' = s.with("runs", s.runs.set(id, activeRun.with("itemError", true))) }
  }
  action finish(id: int): bool = all { s.active == id, s.runs.get(id).phase == "core", not(s.runs.get(id).staged),
    s' = settle(id, if (s.runs.get(id).itemError) "partial" else "ok") }
  action fatal(id: int): bool = all { s.active == id, s.runs.get(id).phase == "core", s' = settle(id, "throw") }
  action deliver(id: int, received: bool): bool = {
    val request = s.requests.get(id)
    val activeRun = if (request.runId > 0) s.runs.get(request.runId) else unusedRun
    val http = if (activeRun.outcome == "throw") 503 else 200
    all { request.phase == "waiting", activeRun.phase == "settled",
      s' = s.with("requests", s.requests.set(id,
        if (not(received)) request.with("phase", "done").with("result", "response-lost")
        else request.with("http", http).with("phase", if (request.caller == "cron" and http == 200) "body" else "done")
          .with("result", if (http == 503) "redacted-failure" else if (request.caller == "cron") "pending" else activeRun.outcome))) }
  }
  action inspectScheduled(id: int, bodyValid: bool): bool = {
    val request = s.requests.get(id)
    val activeRun = if (request.runId > 0) s.runs.get(request.runId) else unusedRun
    all { request.phase == "body", request.caller == "cron",
      s' = s.with("requests", s.requests.set(id, request.with("phase", "done")
        .with("result", if (not(bodyValid)) "response-error" else if (activeRun.outcome == "partial") "unavailable-work" else "success"))) }
  }
  action restart(mode: str, valid: bool, registry: int, projects: int): bool = all {
    s.instance == 1, modes.contains(mode), Set(1, 2).contains(registry), Set(1, 2).contains(projects),
    s' = s.with("instance", 2).with("mode", mode).with("configValid", valid).with("registry", registry).with("projects", projects).with("active", 0)
      .with("runs", runIds.mapBy(id => {
        val activeRun = s.runs.get(id)
        if (activeRun.phase == "settled" or activeRun.phase == "unused") activeRun else activeRun.with("phase", "lost").with("staged", false)
      }))
      .with("requests", ids.mapBy(id => {
        val request = s.requests.get(id)
        if (request.phase == "waiting" and request.runId > 0 and s.runs.get(request.runId).phase != "settled")
          request.with("phase", "done").with("result", "interrupted") else request
      })) }
  action step = {
    nondet id = ids.oneOf()
    nondet activeRun = runIds.oneOf()
    nondet caller = Set("public", "wrong-route", "direct", "cron").oneOf()
    nondet mode = modes.oneOf()
    nondet yes = Set(false, true).oneOf()
    nondet registry = Set(1, 2).oneOf()
    nondet projects = Set(1, 2).oneOf()
    any { configure(mode, yes, registry), request(id, caller), dispatch(id), selectMode(activeRun), identity(activeRun, yes), indexReads(activeRun),
      stageAttempt(activeRun), commitAttempt(activeRun, yes), broadcast(activeRun), gasEvidence(activeRun, yes), itemFailure(activeRun), finish(activeRun), fatal(activeRun),
      deliver(id, yes), inspectScheduled(id, yes), restart(mode, yes, registry, projects), s' = s }
  }
  val invariant = all { s.count <= 2, s.instance <= 2, s.safeSigning,
    s.signed == s.nonce, s.liability implies s.signed, s.settledGas implies s.signed and not(s.liability),
    s.broadcasts > 0 implies s.signed and s.nonce,
    if (s.active == 0) true else s.runs.get(s.active).instance == s.instance
      and not(Set("settled", "unused", "lost").contains(s.runs.get(s.active).phase)),
    ids.forall(id => {
      val request = s.requests.get(id)
      request.http == 200 implies request.runId > 0 and s.runs.get(request.runId).phase == "settled"
    }) }
  action core(id: int): bool = selectMode(id).then(identity(id, true))
  action executing = configure("execute", true, 1).then(request(1, "direct")).then(dispatch(1)).then(core(1))
  action committed = executing.then(stageAttempt(1)).then(commitAttempt(1, true))
  run publicRouteCannotReachKeeperTest = init.then(request(1, "public")).expect(s.count == 0 and s.requests.get(1).http == 404 and invariant)
  run wrongInternalRouteDoesNoWorkTest = init.then(request(1, "wrong-route")).expect(s.count == 0 and invariant)
  run offCronDoesNotValidateConfigurationTest = init.then(configure("off", false, 1)).then(request(1, "cron"))
    .expect(s.requests.get(1).result == "success" and s.count == 0 and s.journalRegistry == 0 and invariant)
  run directOffTickReturnsEmptyResultTest = init.then(request(1, "direct")).then(dispatch(1)).then(selectMode(1)).then(deliver(1, true))
    .expect(s.requests.get(1).http == 200 and s.requests.get(1).result == "off" and invariant)
  run invalidCronConfigurationStartsNoObjectWorkTest = init.then(configure("execute", false, 1)).then(request(1, "cron"))
    .expect(s.count == 0 and s.requests.get(1).result == "configuration-error" and invariant)
  run invalidDirectConfigurationIsRedacted503Test = init.then(configure("invalid", true, 1)).then(request(1, "direct")).then(dispatch(1)).then(selectMode(1)).then(deliver(1, true))
    .expect(s.requests.get(1).http == 503 and s.requests.get(1).result == "redacted-failure" and invariant)
  run overlappingRequestsShareOneCoreRunTest = init.then(executing).then(request(2, "cron")).then(dispatch(2)).then(indexReads(1)).then(finish(1)).then(deliver(1, true)).then(deliver(2, true)).then(inspectScheduled(2, true))
    .expect(s.count == 1 and s.requests.get(1).runId == s.requests.get(2).runId and s.requests.get(2).result == "success" and invariant)
  run settledPromiseDoesNotWaitForResponseDeliveryTest = init.then(executing).then(finish(1)).then(request(2, "direct")).then(dispatch(2)).then(core(2))
    .expect(s.count == 2 and s.requests.get(1).phase == "waiting" and s.active == 2 and invariant)
  run dryRunMayPersistReadStateWithoutSigningTest = init.then(configure("dry_run", true, 1)).then(request(1, "cron")).then(dispatch(1)).then(core(1)).then(indexReads(1)).then(finish(1)).then(deliver(1, true)).then(inspectScheduled(1, true))
    .expect(s.indexed and s.journalRegistry == 1 and not(s.signed) and s.broadcasts == 0 and invariant)
  run dryRunCannotPrepareSignedAttemptTest = init.then(configure("dry_run", true, 1)).then(request(1, "direct")).then(dispatch(1)).then(core(1)).then(stageAttempt(1).fail())
  run stagedSigningDoesNotAuthorizeBroadcastTest = init.then(executing).then(stageAttempt(1)).then(broadcast(1).fail())
  run failedTransactionRollsBackNonceAndLiabilityTest = init.then(executing).then(stageAttempt(1)).then(commitAttempt(1, false)).then(finish(1)).then(deliver(1, true))
    .expect(not(s.signed) and not(s.nonce) and not(s.liability) and s.requests.get(1).result == "partial" and invariant)
  run instanceLossDiscardsOnlyUncommittedAttemptTest = init.then(executing).then(stageAttempt(1)).then(restart("execute", true, 1, 1))
    .expect(not(s.signed) and s.active == 0 and s.requests.get(1).result == "interrupted" and invariant)
  run committedAttemptSurvivesRestartTest = init.then(committed).then(restart("execute", true, 1, 1)).then(request(2, "direct")).then(dispatch(2)).then(core(2)).then(broadcast(2))
    .expect(s.signed and s.nonce and s.liability and s.broadcasts == 1 and invariant)
  run unknownSendReusesJournalAfterRestartTest = init.then(committed).then(broadcast(1)).then(restart("execute", true, 1, 1)).then(request(2, "direct")).then(dispatch(2)).then(core(2)).then(broadcast(2))
    .expect(s.broadcasts == 2 and s.liability and invariant)
  run changedProjectSelectionKeepsSameLiabilityTest = init.then(committed).then(restart("execute", true, 1, 2)).then(request(2, "direct")).then(dispatch(2)).then(core(2))
    .expect(s.projects == 2 and s.journalRegistry == 1 and s.liability and invariant)
  run changedRegistryCannotReuseJournalTest = init.then(committed).then(restart("execute", true, 2, 1)).then(request(2, "direct")).then(dispatch(2)).then(selectMode(2)).then(identity(2, true)).then(deliver(2, true))
    .expect(s.requests.get(2).http == 503 and s.journalRegistry == 1 and s.liability and invariant)
  run stoppingNewInstanceKeepsUnknownAttemptTest = init.then(committed).then(broadcast(1)).then(restart("off", true, 1, 1)).then(request(2, "cron"))
    .expect(s.count == 1 and s.liability and s.requests.get(2).result == "success" and invariant)
  run partialFailureIsHttp200ButScheduledFailureTest = init.then(configure("execute", true, 1)).then(request(1, "cron")).then(dispatch(1)).then(core(1)).then(indexReads(1)).then(itemFailure(1)).then(finish(1)).then(deliver(1, true)).then(inspectScheduled(1, true))
    .expect(s.indexed and s.requests.get(1).http == 200 and s.requests.get(1).result == "unavailable-work" and invariant)
  run lostResponseDoesNotUndoSignedAttemptTest = init.then(committed).then(broadcast(1)).then(finish(1)).then(deliver(1, false))
    .expect(s.signed and s.liability and s.requests.get(1).result == "response-lost" and invariant)
  run settledResponseCanArriveAfterInstanceReplacementTest = init.then(executing).then(finish(1)).then(restart("off", true, 1, 1)).then(deliver(1, true))
    .expect(s.requests.get(1).http == 200 and s.requests.get(1).result == "ok" and s.instance == 2 and invariant)
  run unavailableGasEvidenceKeepsLiabilityTest = init.then(committed).then(gasEvidence(1, false)).then(finish(1))
    .expect(s.liability and not(s.settledGas) and invariant)
  run exactGasEvidenceReleasesOnlyGasLiabilityTest = init.then(committed).then(broadcast(1)).then(finish(1)).then(request(2, "direct")).then(dispatch(2)).then(core(2)).then(gasEvidence(2, true))
    .expect(s.settledGas and not(s.liability) and s.signed and s.nonce and invariant)
}
