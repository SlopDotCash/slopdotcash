// @source workers/slopbot/value-disputes.ts
// @source workers/slopbot/models.ts
// @source workers/slopbot/persistence.ts
// @source workers/slopbot/review.ts
// @evidence workers/slopbot/penalty-appeal.test.ts
// One draftValueDispute invocation and three configured route entries:
// Orbio Sonnet, Surplus Sonnet and Surplus Terra. Every Orbio error moves
// immediately to the backup provider, including insufficient credits.
// Missing provider credentials skip their entries before any authority check
// or receipt. Configured route entries check mayCall separately. Invalid
// output, a wrong served model and ordinary provider failures may fall back.
// A structured Surplus budget response stops the route; Orbio quota failure
// falls back. Usage recording precedes every returned verdict,
// deferred result or route error. Inserts are sequential: a failure may retain
// only a prefix. A retry can incur and record new calls; exactly-once provider
// charging is not claimed. Confidence classes preserve the 0.9 decision cut
// and 0.89 uncertainty cap, not floating-point implementation details.
// Head/base change, source gaps and multi-source joint records all force the
// cap. These inputs are captured; later policy changes need caller handling.
// No model verdict itself changes a score, award, penalty or PR state.
// The linked fixtures check control flow with synthetic provider responses.
// They do not establish live provider conformance, receipt truth or model
// qualification. The runner separately reports scenario and TLC results.
module bot_value_dispute_draft {
  val confidences = Set(0, 70, 89, 90, 100)
  var s: { phase: str, step: int, calls: int, persisted: int, outcome: str,
    gap: bool, partialJoint: bool, draft: str, confidence: int, returnedConfidence: int,
    recordedBeforeReturn: bool, laterAllowed: bool }
  action init = s' = { phase: "idle", step: 1, calls: 0, persisted: 0, outcome: "none",
    gap: false, partialJoint: false, draft: "none", confidence: 0, returnedConfidence: 0,
    recordedBeforeReturn: false, laterAllowed: true }
  action begin(gap: bool, partialJoint: bool): bool = all { s.phase == "idle",
    s' = s.with("phase", "authority").with("gap", gap).with("partialJoint", partialJoint) }
  action missingProvider = all { s.phase == "authority", Set(1, 2).contains(s.step),
    s' = s.with("step", if (s.step == 1) 2 else 3)
      .with("phase", if (s.step == 1) "authority" else "persist")
      .with("outcome", if (s.step == 1) "none" else "exhausted") }
  action authority(answer: str): bool = all { s.phase == "authority", Set("allow", "deny", "throw").contains(answer),
    s' = if (answer == "allow") s.with("phase", "provider")
      else s.with("phase", "persist").with("outcome", if (answer == "deny") "blocked" else "authority-failure") }
  action authorityChanges = s' = s.with("laterAllowed", not(s.laterAllowed))
  action provider(reply: str, confidence: int, draft: str): bool = {
    val valid = reply == "valid"
    val stopped = reply == "budget" and s.step >= 2
    val fallback = not(valid) and not(stopped)
    all { s.phase == "provider", Set("valid", "invalid", "wrong-model", "failed", "budget").contains(reply),
      confidences.contains(confidence), Set("uphold", "deny").contains(draft),
      s' = s.with("calls", s.calls + 1)
        .with("draft", if (valid) draft else "none").with("confidence", if (valid) confidence else 0)
        .with("outcome", if (valid) "verdict" else if (stopped) "budget" else if (s.step == 3) "exhausted" else "none")
        .with("phase", if (fallback and s.step < 3) "authority" else "persist")
        .with("step", if (fallback and s.step < 3) s.step + 1 else s.step) }
  }
  action persistOne = all { s.phase == "persist", s.persisted < s.calls,
    s' = s.with("persisted", s.persisted + 1) }
  action storageFailure = all { s.phase == "persist", s.persisted < s.calls,
    s' = s.with("phase", "storage-error") }
  // An INSERT can commit before its awaited RETURNING reply is lost.
  action persistLostReply = all { s.phase == "persist", s.persisted < s.calls,
    s' = s.with("persisted", s.persisted + 1).with("phase", "storage-error") }
  action finish = all { s.phase == "persist", s.persisted == s.calls,
    s' = s.with("phase", if (s.outcome == "verdict") "returned" else if (s.outcome == "budget") "deferred" else "route-error")
      .with("recordedBeforeReturn", true)
      .with("returnedConfidence", if (s.outcome == "verdict")
        (if ((s.gap or s.partialJoint) and s.confidence > 89) 89 else s.confidence) else 0) }
  action step = {
    nondet yes = Set(false, true).oneOf()
    nondet joint = Set(false, true).oneOf()
    nondet answer = Set("allow", "deny", "throw").oneOf()
    nondet reply = Set("valid", "invalid", "wrong-model", "failed", "budget").oneOf()
    nondet confidence = confidences.oneOf()
    nondet draft = Set("uphold", "deny").oneOf()
    any { begin(yes, joint), missingProvider, authority(answer), authorityChanges, provider(reply, confidence, draft), persistOne, storageFailure, persistLostReply, finish, s' = s }
  }
  val invariant = all { s.calls >= 0 and s.calls <= 3, s.persisted >= 0 and s.persisted <= s.calls,
    Set(1, 2, 3).contains(s.step),
    Set("returned", "deferred", "route-error").contains(s.phase) implies s.recordedBeforeReturn and s.persisted == s.calls,
    s.phase == "returned" implies s.outcome == "verdict" and Set("uphold", "deny").contains(s.draft),
    s.phase == "returned" and (s.gap or s.partialJoint) implies s.returnedConfidence <= 89,
    s.phase == "storage-error" implies not(s.recordedBeforeReturn) }
  action allow = authority("allow")
  action valid(confidence: int): bool = provider("valid", confidence, "uphold")
  run missingOrbioStartsSurplusWithoutReceiptTest = init.then(begin(false, false)).then(missingProvider)
    .expect(s.step == 2 and s.calls == 0).then(allow).then(valid(90)).then(persistOne).then(finish)
    .expect(s.calls == 1 and s.phase == "returned" and invariant)
  run missingBothProvidersMakesNoCallTest = init.then(begin(false, false))
    .then(missingProvider).then(missingProvider).then(finish)
    .expect(s.calls == 0 and s.outcome == "exhausted" and s.phase == "route-error" and invariant)
  run completeSourceKeepsHighConfidenceTest = init.then(begin(false, false)).then(allow).then(valid(100)).then(persistOne).then(finish)
    .expect(s.phase == "returned" and s.returnedConfidence == 100 and invariant)
  run sourceGapCapsConfidenceTest = init.then(begin(true, false)).then(allow).then(valid(100)).then(persistOne).then(finish)
    .expect(s.returnedConfidence == 89 and invariant)
  run multiSourceJointCapsConfidenceTest = init.then(begin(false, true)).then(allow).then(valid(90)).then(persistOne).then(finish)
    .expect(s.returnedConfidence == 89 and invariant)
  run lowConfidenceIsNotRaisedTest = init.then(begin(true, true)).then(allow).then(valid(70)).then(persistOne).then(finish)
    .expect(s.returnedConfidence == 70 and invariant)
  run denyDraftCanBeReturnedTest = init.then(begin(false, false)).then(allow).then(provider("valid", 90, "deny")).then(persistOne).then(finish)
    .expect(s.draft == "deny" and s.phase == "returned" and invariant)
  run invalidOutputUsesSecondRouteTest = init.then(begin(false, false)).then(allow).then(provider("invalid", 100, "uphold"))
    .then(allow).then(valid(90)).then(persistOne).then(persistOne).then(finish)
    .expect(s.calls == 2 and s.persisted == 2 and s.phase == "returned" and invariant)
  run wrongServedModelCannotSupplyVerdictTest = init.then(begin(false, false)).then(allow).then(provider("wrong-model", 100, "uphold"))
    .expect(s.phase == "authority" and s.draft == "none" and s.calls == 1 and invariant)
  run initialDeniedAuthorityCallsNoProviderTest = init.then(begin(false, false)).then(authority("deny")).then(finish)
    .expect(s.calls == 0 and s.phase == "route-error" and s.outcome == "blocked" and invariant)
  run fallbackDeniedAuthorityStillRecordsFirstCallTest = init.then(begin(false, false)).then(allow).then(provider("failed", 0, "uphold"))
    .then(authority("deny")).then(persistOne).then(finish).expect(s.calls == 1 and s.outcome == "blocked" and invariant)
  run fallbackAuthorityExceptionStillRecordsFirstCallTest = init.then(begin(false, false)).then(allow).then(provider("failed", 0, "uphold"))
    .then(authority("throw")).then(persistOne).then(finish).expect(s.persisted == 1 and s.outcome == "authority-failure" and invariant)
  run surplusBudgetStopsFallbackTest = init.then(begin(false, false))
    .then(allow).then(provider("failed", 0, "uphold"))
    .then(allow).then(provider("budget", 0, "uphold"))
    .then(persistOne).then(persistOne).then(finish)
    .expect(s.calls == 2 and s.phase == "deferred" and invariant)
  run orbioQuotaFailureImmediatelyUsesSurplusTest = init.then(begin(false, false))
    .then(allow).then(provider("budget", 0, "uphold"))
    .then(allow).then(valid(90)).then(persistOne).then(persistOne).then(finish)
    .expect(s.calls == 2 and s.phase == "returned" and invariant)
  run exhaustedRoutesRecordAllFailuresTest = init.then(begin(false, false))
    .then(allow).then(provider("failed", 0, "uphold"))
    .then(allow).then(provider("invalid", 0, "uphold"))
    .then(allow).then(provider("wrong-model", 0, "uphold"))
    .then(persistOne).then(persistOne).then(persistOne).then(finish)
    .expect(s.outcome == "exhausted" and s.phase == "route-error" and s.calls == 3 and invariant)
  run backupAuthorityRefusalRecordsOrbioFailureTest = init.then(begin(false, false))
    .then(allow).then(provider("failed", 0, "uphold"))
    .then(authority("deny")).then(persistOne).then(finish)
    .expect(s.calls == 1 and s.outcome == "blocked" and s.persisted == 1 and invariant)
  run usageCannotBeSkippedBeforeReturnTest = init.then(begin(false, false)).then(allow).then(valid(100)).then(finish.fail())
  run usageFailurePreventsVerdictReturnTest = init.then(begin(false, false)).then(allow).then(valid(100)).then(storageFailure)
    .expect(s.phase == "storage-error" and s.persisted == 0 and invariant)
  run partialUsagePrefixSurvivesFailureTest = init.then(begin(false, false)).then(allow).then(provider("failed", 0, "uphold"))
    .then(allow).then(valid(100)).then(persistOne).then(storageFailure)
    .expect(s.persisted == 1 and s.calls == 2 and s.phase == "storage-error" and invariant)
  run lostFinalUsageReplyKeepsCommittedRowWithoutVerdictTest = init.then(begin(false, false)).then(allow).then(valid(100)).then(persistLostReply)
    .expect(s.persisted == 1 and s.calls == 1 and s.phase == "storage-error" and not(s.recordedBeforeReturn) and invariant)
  run authorityIsAnObservationNotContinuousLockTest = init.then(begin(false, false)).then(allow).then(authorityChanges)
    .then(valid(90)).then(persistOne).then(finish).expect(not(s.laterAllowed) and s.phase == "returned" and invariant)
}
