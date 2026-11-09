// @source backend/payments/handler.ts
// @source backend/payments/monthly.ts
// @source backend/payments/monthly-reserve-release.ts
// @evidence backend/payments/monthly.test.ts
// Pages gateway for an already authenticated actor, two requests, two project
// revisions and one served network. The private worker's chain proof, retained
// allocation checks and signing are delegated to monthly_release_prepare/check.
// This gateway only authorizes the owner request and rechecks the project.
// GitHub authority is an observation, not a continuously held capability.
// Registry checks before/after the worker are separate awaits. A worker may
// retain a signature before the gateway's postflight refuses a changed project.
// That failure cannot erase the worker's immutable artifact. Conversely, a
// project or GitHub authority change after the last observation can precede the
// HTTP response. Recovery uses the caller's current manifest and delegates
// compatibility with the saved plan to the worker; it is not an old-hash lock.
// No operation here signs a wallet transaction, broadcasts, withdraws, or pays.
// Request syntax, session/CSRF, deadlines, and network deployment validation
// have separate models. All new scenarios are source-authored, not executed.
module monthly_release_gateway {
  type Request = { phase: str, actor: int, mode: str, expectedVersion: int,
    expectedNetwork: int, periodValid: bool, capturedVersion: int,
    authorityActor: int, beforeVersion: int, afterVersion: int,
    workerResult: str, result: str }
  val ids = Set(1, 2)
  val empty: Request = { phase: "unused", actor: 1, mode: "prepare",
    expectedVersion: 1, expectedNetwork: 1, periodValid: true,
    capturedVersion: 0, authorityActor: 0, beforeVersion: 0,
    afterVersion: 0, workerResult: "none", result: "none" }
  var s: { revision: int, registryAvailable: bool, owner: int,
    configured: bool, calls: int -> Request, retained: Set[int] }
  action init = s' = { revision: 1, registryAvailable: true, owner: 1,
    configured: true, calls: ids.mapBy(_ => empty), retained: Set() }
  def ended(request: Request, result: str): Request =
    request.with("phase", "done").with("result", result)
  action reviseProject = all { s.revision == 1, s' = s.with("revision", 2) }
  action registryAvailability(available: bool): bool = s' = s.with("registryAvailable", available)
  action ownerChange(owner: int): bool = all { Set(0, 1, 2).contains(owner), s' = s.with("owner", owner) }
  action unavailableWorker = all { ids.forall(id => s.calls.get(id).phase == "unused"),
    s' = s.with("configured", false) }
  action begin(id: int, actor: int, mode: str, version: int, network: int, periodValid: bool): bool = all {
    ids.contains(id), ids.contains(actor), ids.contains(version), ids.contains(network),
    Set("prepare", "check").contains(mode), s.calls.get(id).phase == "unused",
    s' = s.with("calls", s.calls.set(id, empty.with("phase", "project")
      .with("actor", actor).with("mode", mode).with("expectedVersion", version)
      .with("expectedNetwork", network).with("periodValid", periodValid))) }
  action readProject(id: int): bool = {
    val request = s.calls.get(id)
    all { request.phase == "project",
      s' = s.with("calls", s.calls.set(id,
        if (s.registryAvailable) request.with("phase", "authority").with("capturedVersion", s.revision)
        else ended(request, "project-unavailable"))) }
  }
  action readAuthority(id: int): bool = {
    val request = s.calls.get(id)
    all { request.phase == "authority",
      s' = s.with("calls", s.calls.set(id,
        if (s.owner == request.actor) request.with("phase", "policy").with("authorityActor", s.owner)
        else ended(request, "not-owner"))) }
  }
  action policy(id: int): bool = {
    val request = s.calls.get(id)
    val nextRequest = if (not(request.periodValid)) ended(request, "invalid-period")
      else if (request.expectedVersion != request.capturedVersion or request.expectedNetwork != 1)
        ended(request, "project-changed")
      else if (not(s.configured)) ended(request, "worker-unavailable")
      else request.with("phase", "before")
    all { request.phase == "policy", s' = s.with("calls", s.calls.set(id, nextRequest)) }
  }
  action before(id: int): bool = {
    val request = s.calls.get(id)
    all { request.phase == "before",
      s' = s.with("calls", s.calls.set(id,
        if (s.registryAvailable and s.revision == request.capturedVersion)
          request.with("phase", "worker").with("beforeVersion", s.revision)
        else ended(request, "project-changed"))) }
  }
  // A positive worker proof may retain its artifact before response delivery.
  action retainWorkerSignature(id: int): bool = all {
    s.calls.get(id).phase == "worker", s.calls.get(id).mode == "prepare",
    s' = s.with("retained", s.retained.union(Set(id))) }
  action workerReply(id: int, result: str): bool = {
    val request = s.calls.get(id)
    val valid = if (request.mode == "prepare")
      (result == "ready" and s.retained.contains(id)) or (result == "held" and not(s.retained.contains(id)))
      else Set("pending", "failed", "finalized").contains(result)
    all { request.phase == "worker", valid,
      s' = s.with("calls", s.calls.set(id, request.with("phase", "after").with("workerResult", result))) }
  }
  action workerReject(id: int): bool = all { s.calls.get(id).phase == "worker",
    s' = s.with("calls", s.calls.set(id, ended(s.calls.get(id), "worker-error"))) }
  action after(id: int): bool = {
    val request = s.calls.get(id)
    all { request.phase == "after",
      s' = s.with("calls", s.calls.set(id,
        if (s.registryAvailable and s.revision == request.capturedVersion)
          request.with("phase", "response").with("afterVersion", s.revision)
        else ended(request, "project-changed"))) }
  }
  action registryReject(id: int): bool = all {
    Set("project", "before", "after").contains(s.calls.get(id).phase),
    s' = s.with("calls", s.calls.set(id, ended(s.calls.get(id), "registry-error"))) }
  action response(id: int, delivered: bool): bool = {
    val request = s.calls.get(id)
    all { request.phase == "response",
      s' = s.with("calls", s.calls.set(id, ended(request,
        if (delivered) request.workerResult else "response-lost"))) }
  }
  action step = {
    nondet id = ids.oneOf()
    nondet actor = ids.oneOf()
    nondet version = ids.oneOf()
    nondet network = ids.oneOf()
    nondet owner = Set(0, 1, 2).oneOf()
    nondet mode = Set("prepare", "check").oneOf()
    nondet yes = Set(false, true).oneOf()
    nondet result = Set("ready", "held", "pending", "failed", "finalized").oneOf()
    any { reviseProject, registryAvailability(yes), ownerChange(owner), unavailableWorker,
      begin(id, actor, mode, version, network, yes), readProject(id), readAuthority(id), policy(id), before(id),
      retainWorkerSignature(id), workerReply(id, result), workerReject(id), after(id), registryReject(id),
      response(id, yes), s' = s }
  }
  val invariant = all {
    s.retained.subseteq(ids),
    ids.forall(id => {
      val request = s.calls.get(id)
      all {
        s.retained.contains(id) implies request.mode == "prepare" and request.authorityActor == request.actor
          and request.beforeVersion == request.capturedVersion,
        Set("ready", "held", "pending", "failed", "finalized").contains(request.result) implies
          request.authorityActor == request.actor and request.beforeVersion == request.capturedVersion
          and request.afterVersion == request.capturedVersion and request.expectedNetwork == 1,
        request.result == "ready" implies s.retained.contains(id)
      }
    }) }
  action admitted(id: int, actor: int, mode: str, version: int): bool =
    begin(id, actor, mode, version, 1, true).then(readProject(id)).then(readAuthority(id)).then(policy(id)).then(before(id))
  action ready(id: int): bool = retainWorkerSignature(id).then(workerReply(id, "ready"))
  run stablePrepareReturnsReadyTest = init.then(admitted(1, 1, "prepare", 1)).then(ready(1)).then(after(1)).then(response(1, true))
    .expect(s.calls.get(1).result == "ready" and invariant)
  run heldResultDoesNotMintSignatureTest = init.then(admitted(1, 1, "prepare", 1)).then(workerReply(1, "held")).then(after(1)).then(response(1, true))
    .expect(s.calls.get(1).result == "held" and s.retained == Set() and invariant)
  run pendingCheckIsNotFinalityTest = init.then(admitted(1, 1, "check", 1)).then(workerReply(1, "pending")).then(after(1)).then(response(1, true))
    .expect(s.calls.get(1).result == "pending" and s.retained == Set() and invariant)
  run failedCheckIsRelayedTest = init.then(admitted(1, 1, "check", 1)).then(workerReply(1, "failed")).then(after(1)).then(response(1, true))
    .expect(s.calls.get(1).result == "failed" and invariant)
  run finalizedCheckIsRelayedTest = init.then(admitted(1, 1, "check", 1)).then(workerReply(1, "finalized")).then(after(1)).then(response(1, true))
    .expect(s.calls.get(1).result == "finalized" and invariant)
  run ownerRefusalIsExplicitTest = init.then(begin(1, 2, "prepare", 1, 1, true)).then(readProject(1)).then(readAuthority(1))
    .expect(s.calls.get(1).result == "not-owner" and s.retained == Set() and invariant)
  run staleManifestStopsBeforeWorkerTest = init.then(begin(1, 1, "prepare", 2, 1, true)).then(readProject(1)).then(readAuthority(1)).then(policy(1))
    .expect(s.calls.get(1).result == "project-changed" and invariant)
  run otherNetworkStopsBeforeWorkerTest = init.then(begin(1, 1, "prepare", 1, 2, true)).then(readProject(1)).then(readAuthority(1)).then(policy(1))
    .expect(s.calls.get(1).result == "project-changed" and invariant)
  run invalidPeriodStopsBeforeWorkerTest = init.then(begin(1, 1, "prepare", 1, 1, false)).then(readProject(1)).then(readAuthority(1)).then(policy(1))
    .expect(s.calls.get(1).result == "invalid-period" and invariant)
  run missingWorkerIsUnavailableTest = init.then(unavailableWorker).then(begin(1, 1, "prepare", 1, 1, true)).then(readProject(1)).then(readAuthority(1)).then(policy(1))
    .expect(s.calls.get(1).result == "worker-unavailable" and invariant)
  run revisionBeforePreflightStopsWorkerTest = init.then(begin(1, 1, "prepare", 1, 1, true)).then(readProject(1)).then(readAuthority(1)).then(policy(1))
    .then(reviseProject).then(before(1)).expect(s.calls.get(1).result == "project-changed" and s.retained == Set() and invariant)
  run revisionAfterWorkerRetainsPrivateSignatureTest = init.then(admitted(1, 1, "prepare", 1)).then(ready(1))
    .then(reviseProject).then(after(1)).expect(s.calls.get(1).result == "project-changed" and s.retained == Set(1) and invariant)
  run finalObservationDoesNotPromiseContinuousRevisionTest = init.then(admitted(1, 1, "prepare", 1)).then(ready(1)).then(after(1))
    .then(reviseProject).then(response(1, true)).expect(s.calls.get(1).result == "ready" and s.revision == 2 and invariant)
  run observedOwnerIsNotContinuousAuthorityTest = init.then(admitted(1, 1, "prepare", 1)).then(ownerChange(2))
    .then(ready(1)).then(after(1)).then(response(1, true)).expect(s.calls.get(1).result == "ready" and s.owner == 2 and invariant)
  run workerFailureDoesNotEraseRetainedSignatureTest = init.then(admitted(1, 1, "prepare", 1)).then(retainWorkerSignature(1)).then(workerReject(1))
    .expect(s.calls.get(1).result == "worker-error" and s.retained == Set(1) and invariant)
  run lostHttpResponseKeepsArtifactTest = init.then(admitted(1, 1, "prepare", 1)).then(ready(1)).then(after(1)).then(response(1, false))
    .expect(s.calls.get(1).result == "response-lost" and s.retained == Set(1) and invariant)
  run recoveryUsesCurrentManifestTest = init.then(admitted(1, 1, "prepare", 1)).then(ready(1)).then(after(1)).then(response(1, true))
    .then(reviseProject).then(admitted(2, 1, "check", 2)).then(workerReply(2, "finalized")).then(after(2)).then(response(2, true))
    .expect(s.calls.get(2).result == "finalized" and invariant)
}
