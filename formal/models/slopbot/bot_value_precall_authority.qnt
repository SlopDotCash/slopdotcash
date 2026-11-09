// @source workers/slopbot/value-consumer.ts
// @source workers/slopbot/models.ts
// @source workers/slopbot/value-inference.ts
// @source workers/slopbot/registry.ts
// @evidence workers/slopbot/value-pipeline.test.ts
// One reserved inference, one project capability, one installation and one
// request/source lease pair. Local reads are separate observations, not a
// transaction with each other or with the external provider request. A late
// change after a successful observation may still precede the provider send.
module bot_value_precall_authority {
  var s: { phase: str, registered: bool, installed: bool,
    requestLive: bool, sourceLive: bool, observedRegistry: bool,
    observedInstallation: bool, observedRequest: bool, observedSource: bool,
    reserved: bool, calls: int, outcome: str }
  action init = s' = { phase: "before", registered: true, installed: true,
    requestLive: true, sourceLive: true, observedRegistry: false,
    observedInstallation: false, observedRequest: false, observedSource: false,
    reserved: true, calls: 0, outcome: "none" }
  action begin = all { s.phase == "before", s.registered, s.installed,
    s.requestLive, s.sourceLive, s' = s.with("phase", "membership") }
  action remoteReply(ok: bool): bool = all { s.phase == "membership",
    s' = s.with("phase", if (ok) "registry" else "refused")
      .with("outcome", if (ok) "none" else "retry") }
  action checkRegistry = all { s.phase == "registry",
    s' = s.with("phase", if (s.registered) "installation" else "refused")
      .with("observedRegistry", s.registered)
      .with("outcome", if (s.registered) "none" else "authority") }
  action checkInstallation = all { s.phase == "installation",
    s' = s.with("phase", if (s.installed) "request" else "refused")
      .with("observedInstallation", s.installed)
      .with("outcome", if (s.installed) "none" else "retry") }
  action checkRequest = all { s.phase == "request",
    s' = s.with("phase", if (s.requestLive) "source" else "refused")
      .with("observedRequest", s.requestLive)
      .with("outcome", if (s.requestLive) "none" else "authority") }
  action checkSource = {
    val live = s.sourceLive and s.requestLive
    all { s.phase == "source",
      s' = s.with("phase", if (live) "ready" else "refused")
        .with("observedSource", live)
        .with("outcome", if (live) "none" else "authority") }
  }
  action call = all { s.phase == "ready", s.reserved,
    s' = s.with("phase", "called").with("calls", 1) }
  action restrictProject = all { s.registered,
    s' = s.with("registered", false) }
  action suspendInstallation = all { s.installed,
    s' = s.with("installed", false) }
  action expireRequest = all { s.requestLive,
    s' = s.with("requestLive", false) }
  action expireSource = all { s.sourceLive,
    s' = s.with("sourceLive", false) }
  action step = {
    nondet ok = Set(false, true).oneOf()
    any { begin, remoteReply(ok), checkRegistry, checkInstallation, checkRequest,
      checkSource, call, restrictProject, suspendInstallation, expireRequest,
      expireSource, s' = s }
  }
  val invariant = all { s.calls <= 1,
    s.calls == 1 implies (s.reserved and s.observedRegistry
      and s.observedInstallation and s.observedRequest and s.observedSource),
    s.phase == "refused" implies s.calls == 0,
    s.reserved }
  run activeAuthorityReachesProviderTest = init.then(begin).then(remoteReply(true))
    .then(checkRegistry).then(checkInstallation).then(checkRequest).then(checkSource)
    .then(call).expect(s.calls == 1 and invariant)
  run pauseDuringMembershipPreventsCallTest = init.then(begin).then(restrictProject)
    .then(remoteReply(true)).then(checkRegistry)
    .expect(s.phase == "refused" and s.outcome == "authority" and s.calls == 0)
    .then(call.fail())
  run suspensionDuringMembershipPreventsCallTest = init.then(begin).then(suspendInstallation)
    .then(remoteReply(true)).then(checkRegistry).then(checkInstallation)
    .expect(s.phase == "refused" and s.outcome == "retry" and s.calls == 0)
    .then(call.fail())
  run unavailableMembershipPreventsCallTest = init.then(begin).then(remoteReply(false))
    .expect(s.phase == "refused" and s.outcome == "retry" and s.calls == 0)
    .then(call.fail())
  run expiredRequestAfterAuthorityStillPreventsCallTest = init.then(begin)
    .then(remoteReply(true)).then(checkRegistry).then(checkInstallation)
    .then(expireRequest).then(checkRequest)
    .expect(s.phase == "refused" and s.calls == 0).then(call.fail())
  run expiredSourceAfterAuthorityStillPreventsCallTest = init.then(begin)
    .then(remoteReply(true)).then(checkRegistry).then(checkInstallation)
    .then(checkRequest).then(expireSource).then(checkSource)
    .expect(s.phase == "refused" and s.calls == 0).then(call.fail())
  run requestExpiryBetweenLeaseReadsPreventsCallTest = init.then(begin)
    .then(remoteReply(true)).then(checkRegistry).then(checkInstallation)
    .then(checkRequest).then(expireRequest).then(checkSource)
    .expect(s.phase == "refused" and s.calls == 0).then(call.fail())
  // This is an explicit limit, not a forbidden trace: the local observations
  // and external send are not one distributed transaction.
  run laterRevocationDoesNotUndoCompletedCheckTest = init.then(begin)
    .then(remoteReply(true)).then(checkRegistry).then(checkInstallation)
    .then(checkRequest).then(checkSource).then(restrictProject)
    .then(suspendInstallation).then(call)
    .expect(s.calls == 1 and not(s.registered) and not(s.installed) and invariant)
  run alreadyStartedCallRemainsRecordedTest = init.then(begin).then(remoteReply(true))
    .then(checkRegistry).then(checkInstallation).then(checkRequest).then(checkSource)
    .then(call).then(expireRequest).then(suspendInstallation)
    .expect(s.calls == 1 and s.reserved and invariant)
}
