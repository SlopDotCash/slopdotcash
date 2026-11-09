// @source scripts/skill-python.mjs
// @source scripts/prepare-site.mjs
// @evidence tests/integration/installer.e2e.ts
// One resolver/prepare-site invocation, at most three deduplicated interpreter
// paths and one uv probe. IDs 1=custom SLOP_PYTHON, 2=python3, 3=/usr/bin/python3,
// 4=uv. Deduplication is string equality, not resolved executable identity.
// Interpreter success proves an observed yaml.__version__ == '6.0.3'; it does
// not pin a Python version or executable bytes. uv --version proves only that
// command succeeded; the later prefix requests PyYAML==6.0.3 and may still fail
// to resolve/install/run it. This model makes no network availability claim.
//
// execFileSync blocks for the direct child and catches selection failures.
// There is no configured timeout, cancellation handler or process-group cleanup.
// Host death therefore does not prove child termination; live child is retained
// as an unknown resource until an external exit is observed. Descendants are
// outside the bound, so a successful direct-child exit is no cleanup proof for
// arbitrary subprocess trees. The separate install_process is not this helper.
//
// Validation content is refined by skill_validation_content. prepare-site has
// already written/removed other public outputs before validation. A successful
// validator is required before its later bootstrap copies, but cannot prove the
// complete publication succeeded or that a separately reread source is the same
// bytes. File races and rollback of those writes are not abstracted as atomic.
module skill_validation_runtime {
  val interpreterIds = Set(1, 2, 3)
  type State = { phase: str, host: bool, child: bool, candidates: List[int], position: int,
    attempts: List[int], selected: int, probe: int, pinnedObserved: bool,
    currentPinned: bool, uvVersionObserved: bool, pinnedRequest: bool,
    preludeChanged: bool, validated: bool, bootstrapPublished: bool, error: str, result: str }
  var s: State
  action init = s' = { phase: "input", host: true, child: false, candidates: List(), position: 0,
    attempts: List(), selected: 0, probe: 0, pinnedObserved: false, currentPinned: true,
    uvVersionObserved: false, pinnedRequest: false, preludeChanged: false, validated: false,
    bootstrapPublished: false, error: "none", result: "none" }
  action begin(override: int): bool = all { s.phase == "input", 0.to(3).contains(override),
    s' = s.with("phase", "select").with("candidates",
      if (override == 0 or override == 2) List(2, 3)
      else if (override == 3) List(3, 2) else List(1, 2, 3)) }
  action launchProbe = all { s.phase == "select", s.host,
    val id = if (s.position < s.candidates.length()) s.candidates.nth(s.position) else 4
    s' = s.with("phase", "probe").with("child", true).with("probe", id).with("attempts", s.attempts.append(id)) }
  action probeReply(outcome: str): bool = all { s.phase == "probe", s.host, s.child,
    Set("exact", "wrong", "spawn-error", "signal", "uv-ok").contains(outcome),
    (s.probe == 4) implies outcome != "exact" and outcome != "wrong",
    (s.probe != 4) implies outcome != "uv-ok",
    s' = if (outcome == "exact") s.with("phase", "selected").with("child", false)
      .with("selected", s.probe).with("pinnedObserved", true)
      else if (outcome == "uv-ok") s.with("phase", "selected").with("child", false)
        .with("selected", 4).with("uvVersionObserved", true).with("pinnedRequest", true)
      else if (s.probe == 4) s.with("phase", "done").with("child", false).with("error", "runtime-unavailable").with("result", "failed")
      else s.with("phase", "select").with("child", false).with("position", s.position + 1) }
  action runtimeChanges = all { s.phase == "selected", s' = s.with("currentPinned", false) }
  action prelude(ok: bool): bool = all { s.phase == "selected", s.host,
    s' = s.with("preludeChanged", true).with("phase", if (ok) "validator-launch" else "done")
      .with("error", if (ok) "none" else "prelude-io").with("result", if (ok) "none" else "failed") }
  action launchValidator(ok: bool): bool = all { s.phase == "validator-launch", s.host,
    s' = if (ok) s.with("phase", "validator").with("child", true)
      else s.with("phase", "done").with("error", "validator-spawn").with("result", "failed") }
  action validatorExit(outcome: str): bool = all { s.phase == "validator", s.host, s.child,
    Set("valid", "refused", "exception", "signal").contains(outcome),
    s' = s.with("child", false).with("phase", if (outcome == "valid") "after-validation" else "done")
      .with("validated", outcome == "valid").with("error", if (outcome == "valid") "none" else outcome)
      .with("result", if (outcome == "valid") "none" else "failed") }
  action publishBootstrap = all { s.phase == "after-validation", s.host, s.validated,
    s' = s.with("phase", "later-publication").with("bootstrapPublished", true) }
  action laterPublication(ok: bool): bool = all { s.phase == "later-publication", s.host,
    s' = s.with("phase", "done").with("result", if (ok) "success" else "failed")
      .with("error", if (ok) "none" else "later-io") }
  action hostDies = all { s.host, s.phase != "done",
    s' = s.with("host", false).with("phase", "abandoned").with("result", "interrupted") }
  action abandonedChildExits = all { not(s.host), s.child, s' = s.with("child", false) }
  action step = {
    nondet override = 0.to(3).oneOf() nondet yes = Set(false, true).oneOf()
    nondet probeResult = Set("exact", "wrong", "spawn-error", "signal", "uv-ok").oneOf()
    nondet validation = Set("valid", "refused", "exception", "signal").oneOf()
    any { begin(override), launchProbe, probeReply(probeResult), runtimeChanges, prelude(yes), launchValidator(yes),
      validatorExit(validation), publishBootstrap, laterPublication(yes), hostDies, abandonedChildExits, s' = s }
  }
  val invariant = all { s.attempts.length() <= 4, s.position <= 3,
    s.selected != 0 implies (if (s.selected == 4) s.uvVersionObserved and s.pinnedRequest else s.pinnedObserved),
    s.bootstrapPublished implies s.validated,
    s.result == "success" implies s.validated and s.bootstrapPublished and not(s.child) and s.error == "none",
    s.error != "none" implies s.result == "failed",
    s.selected != 4 implies not(s.pinnedRequest) }
  action selected = begin(1).then(launchProbe).then(probeReply("exact"))
  action launched = selected.then(prelude(true)).then(launchValidator(true))
  action uv = begin(0).then(launchProbe).then(probeReply("wrong")).then(launchProbe).then(probeReply("spawn-error"))
    .then(launchProbe).then(probeReply("uv-ok"))
  run configuredPinnedInterpreterWinsTest = init.then(selected).expect(s.selected == 1 and s.attempts == List(1) and invariant)
  run fallbackAfterUnavailableRuntimeTest = init.then(begin(1)).then(launchProbe).then(probeReply("spawn-error"))
    .then(launchProbe).then(probeReply("exact")).expect(s.selected == 2 and s.attempts == List(1, 2) and invariant)
  run wrongPyYamlVersionFallsThroughTest = init.then(begin(1)).then(launchProbe).then(probeReply("wrong"))
    .then(launchProbe).then(probeReply("exact")).expect(s.selected == 2 and invariant)
  run python3OverrideIsDeduplicatedTest = init.then(begin(2)).then(launchProbe).then(probeReply("wrong"))
    .then(launchProbe).then(probeReply("exact")).expect(s.attempts == List(2, 3) and invariant)
  run absoluteOverrideKeepsConfiguredPriorityTest = init.then(begin(3)).then(launchProbe).then(probeReply("wrong"))
    .then(launchProbe).then(probeReply("exact")).expect(s.attempts == List(3, 2) and invariant)
  run uvVersionDoesNotProveInstalledDependencyTest = init.then(uv)
    .expect(s.selected == 4 and s.pinnedRequest and not(s.pinnedObserved) and not(s.validated) and invariant)
  run absentUvRefusesAfterAllCandidatesTest = init.then(begin(0)).then(launchProbe).then(probeReply("wrong"))
    .then(launchProbe).then(probeReply("signal")).then(launchProbe).then(probeReply("spawn-error"))
    .expect(s.error == "runtime-unavailable" and s.attempts == List(2, 3, 4) and invariant)
  run pinnedObservationDoesNotFreezeExecutableTest = init.then(selected).then(runtimeChanges).then(prelude(true))
    .then(launchValidator(true)).then(validatorExit("exception")).expect(s.pinnedObserved and not(s.currentPinned) and s.result == "failed" and invariant)
  run symlinkRefusedTest = init.then(launched).then(validatorExit("refused"))
    .expect(not(s.validated) and not(s.bootstrapPublished) and s.preludeChanged and invariant)
  run invalidYamlRefusedTest = init.then(launched).then(validatorExit("refused"))
    .expect(s.result == "failed" and s.error == "refused" and invariant)
  run uvDependencyFailureStopsPublicationTest = init.then(uv).then(prelude(true)).then(launchValidator(true)).then(validatorExit("exception"))
    .expect(s.result == "failed" and not(s.bootstrapPublished) and invariant)
  run validatorSpawnFailureIsNotSelectionFallbackTest = init.then(selected).then(prelude(true)).then(launchValidator(false))
    .expect(s.attempts == List(1) and s.error == "validator-spawn" and invariant)
  run preludeIoFailureCanLeaveEarlierWritesTest = init.then(selected).then(prelude(false))
    .expect(s.preludeChanged and not(s.validated) and s.result == "failed" and invariant)
  run validContentAllowsBootstrapPublicationTest = init.then(launched).then(validatorExit("valid")).then(publishBootstrap).then(laterPublication(true))
    .expect(s.result == "success" and invariant)
  run laterFailureDoesNotRollBackBootstrapCopiesTest = init.then(launched).then(validatorExit("valid")).then(publishBootstrap).then(laterPublication(false))
    .expect(s.result == "failed" and s.bootstrapPublished and invariant)
  run interruptedProbeDoesNotProveChildCleanupTest = init.then(begin(1)).then(launchProbe).then(hostDies)
    .expect(s.child and s.result == "interrupted" and s.selected == 0 and invariant)
  run interruptedValidationRetainsUnknownChildTest = init.then(launched).then(hostDies)
    .expect(s.child and s.preludeChanged and not(s.validated) and invariant)
  run laterObservedChildExitClosesRetainedResourceTest = init.then(launched).then(hostDies).then(abandonedChildExits)
    .expect(not(s.child) and s.result == "interrupted" and invariant)
}
