// @source src/AdminProjectEnforcement.tsx
// @source backend/projects/handler.ts
// @evidence tests/e2e/admin-editor-lifetime.spec.ts
// Full fingerprints abstract action/reason/evidence/account selection.
// Identity and lifetime remain in ui_admin_mutation_identity. Unexecuted.
module ui_admin_enforcement_intent {
  var s: { input: int, revision: int, sequence: int, serverRevision: int, serverSequence: int,
    phase: str, requestedInput: int, requestedRevision: int, requestedSequence: int,
    previewInput: int, previewRevision: int, previewSequence: int, accountsPinned: bool,
    applyInput: int, applyRevision: int, applySequence: int,
    sentInput: int, sentRevision: int, sentSequence: int, previewSent: bool,
    responseMatches: bool, requestAccepted: bool, accepted: bool,
    acceptedInput: int, acceptedRevision: int, acceptedSequence: int,
    callback: bool, callbackInput: int, callbackRevision: int, callbackSequence: int,
    observedInput: int, observedRevision: int, observedSequence: int, failure: str, error: str }
  action init = s' = { input: 1, revision: 1, sequence: 1, serverRevision: 1, serverSequence: 1,
    phase: "draft", requestedInput: 0, requestedRevision: 0, requestedSequence: 0,
    previewInput: 0, previewRevision: 0, previewSequence: 0, accountsPinned: false,
    applyInput: 0, applyRevision: 0, applySequence: 0,
    sentInput: 0, sentRevision: 0, sentSequence: 0, previewSent: false,
    responseMatches: false, requestAccepted: false, accepted: false,
    acceptedInput: 0, acceptedRevision: 0, acceptedSequence: 0,
    callback: false, callbackInput: 0, callbackRevision: 0, callbackSequence: 0,
    observedInput: 0, observedRevision: 0, observedSequence: 0, failure: "none", error: "none" }
  val currentPreview = s.previewInput == s.input and s.previewRevision == s.revision
    and s.previewSequence == s.sequence and s.previewInput != 0
  val currentPreviewRequest = s.requestedInput == s.input
    and s.requestedRevision == s.revision and s.requestedSequence == s.sequence
  val currentApplyRequest = s.applyInput == s.input
    and s.applyRevision == s.revision and s.applySequence == s.sequence
  action edit(input: int): bool = all { Set(1, 2).contains(input), not(currentPreview), s.phase != "saved",
    s' = s.with("input", input) }
  action preview = all { s.phase == "draft" or s.phase == "review",
    s' = s.with("phase", "preview-preflight").with("requestedInput", s.input)
      .with("requestedRevision", s.revision).with("requestedSequence", s.sequence)
      .with("previewSent", false).with("error", "none") }
  // The identity observation can wait while the form or parent props change.
  action dispatchPreview = all { s.phase == "preview-preflight", currentPreviewRequest,
    s' = s.with("phase", "preview-http").with("previewSent", true) }
  action changedPreviewPreflight = all { s.phase == "preview-preflight", not(currentPreviewRequest),
    s' = s.with("phase", if (s.previewInput == 0) "draft" else "review").with("error", "preview-again") }
  action previewResponse(matches: bool): bool = all { s.phase == "preview-http",
    s' = s.with("phase", "preview-postflight").with("responseMatches", matches) }
  action finishPreview = all { s.phase == "preview-postflight",
    s' = if (not(currentPreviewRequest) or not(s.responseMatches))
      s.with("phase", if (s.previewInput == 0) "draft" else "review").with("error", "preview-again")
    else s.with("phase", "review").with("previewInput", s.requestedInput)
      .with("previewRevision", s.requestedRevision).with("previewSequence", s.requestedSequence)
      .with("accountsPinned", true) }
  action previewFailure = all { s.phase == "preview-http", s' = s.with("phase", "preview-error-check") }
  action finishPreviewFailure = all { s.phase == "preview-error-check",
    s' = s.with("phase", if (s.previewInput == 0) "draft" else "review")
      .with("error", if (currentPreviewRequest) "request" else s.error) }
  action propsAdvance = all { s.revision == 1, s' = s.with("revision", 2) }
  action sequencePropsAdvance = all { s.sequence == 1, s' = s.with("sequence", 2) }
  action serverAdvance = all { s.serverRevision == 1, s' = s.with("serverRevision", 2) }
  action serverSequenceAdvance = all { s.serverSequence == 1, s' = s.with("serverSequence", 2) }
  action confirm = all { s.phase == "review", currentPreview,
    s' = s.with("phase", "apply-preflight").with("applyInput", s.previewInput)
      .with("applyRevision", s.previewRevision).with("applySequence", s.previewSequence)
      .with("sentInput", 0).with("sentRevision", 0).with("sentSequence", 0)
      .with("requestAccepted", false).with("failure", "none").with("error", "none") }
  action dispatchApply = all { s.phase == "apply-preflight", currentApplyRequest,
    s' = s.with("phase", "apply-http").with("sentInput", s.applyInput)
      .with("sentRevision", s.applyRevision).with("sentSequence", s.applySequence) }
  action changedApplyPreflight = all { s.phase == "apply-preflight", not(currentApplyRequest),
    s' = s.with("phase", "draft").with("previewInput", 0).with("error", "preview-again") }
  // Acceptance precedes HTTP delivery. Later server changes or failed delivery
  // do not rewrite the retained decision. The next attempt has its own result.
  action admitApply(accountsStillMatch: bool): bool = {
    val valid = s.sentRevision == s.serverRevision and s.sentSequence == s.serverSequence
      and s.accountsPinned and accountsStillMatch
    all { s.phase == "apply-http",
      s' = s.with("phase", "apply-reply").with("requestAccepted", valid)
        .with("accepted", s.accepted or valid)
        .with("acceptedInput", if (valid) s.sentInput else s.acceptedInput)
        .with("acceptedRevision", if (valid) s.sentRevision else s.acceptedRevision)
        .with("acceptedSequence", if (valid) s.sentSequence else s.acceptedSequence) }
  }
  action applyResponse = all { s.phase == "apply-reply", s.requestAccepted,
    s' = s.with("phase", "apply-postflight") }
  // Covers ordinary transport failure or stale/account refusal; identity loss
  // is separate. A failure after acceptance leaves that accepted fact intact.
  action applyFailure = all { s.phase == "apply-reply",
    s' = s.with("phase", "apply-error-check")
      .with("failure", if (s.requestAccepted) "request" else "stale") }
  action applyTransportFailure = all { s.phase == "apply-http",
    s' = s.with("phase", "apply-error-check").with("failure", "request") }
  action finishApply = all { s.phase == "apply-postflight",
    s' = if (not(currentApplyRequest)) s.with("phase", "review")
    else s.with("phase", "saved").with("callback", true)
      .with("callbackInput", s.sentInput).with("callbackRevision", s.sentRevision)
      .with("callbackSequence", s.sentSequence).with("observedInput", s.input)
      .with("observedRevision", s.revision).with("observedSequence", s.sequence) }
  action finishApplyFailure = all { s.phase == "apply-error-check",
    s' = if (not(currentApplyRequest)) s.with("phase", "review")
    else s.with("phase", "draft").with("previewInput", 0)
      .with("error", s.failure) }
  action cancel = all { s.phase == "review", currentPreview,
    s' = s.with("phase", "draft").with("previewInput", 0) }
  action step = {
    nondet input = Set(1, 2).oneOf()
    nondet matches = Set(false, true).oneOf()
    any { edit(input), preview, dispatchPreview, changedPreviewPreflight,
      previewResponse(matches), finishPreview, previewFailure, finishPreviewFailure,
      propsAdvance, sequencePropsAdvance, serverAdvance, serverSequenceAdvance,
      confirm, dispatchApply, changedApplyPreflight, admitApply(matches), applyResponse,
      applyFailure, applyTransportFailure, finishApply, finishApplyFailure, cancel, s' = s }
  }
  val invariant = all {
    Set("apply-http", "apply-reply", "apply-postflight", "apply-error-check").contains(s.phase)
      implies (s.sentInput == s.applyInput and s.sentRevision == s.applyRevision and s.sentSequence == s.applySequence),
    Set("apply-preflight", "apply-http", "apply-reply", "apply-postflight", "apply-error-check").contains(s.phase)
      implies (s.applyInput == s.previewInput and s.applyRevision == s.previewRevision
        and s.applySequence == s.previewSequence),
    s.accepted implies s.accountsPinned and s.acceptedInput != 0,
    s.callback implies (s.accepted and s.callbackInput == s.observedInput
      and s.callbackRevision == s.observedRevision and s.callbackSequence == s.observedSequence)
  }
  run unchangedPreviewConfirmsExactRequestTest = init.then(preview).then(dispatchPreview)
    .then(previewResponse(true)).then(finishPreview).then(confirm).then(dispatchApply)
    .then(admitApply(true)).then(applyResponse).then(finishApply)
    .expect(s.accepted and s.sentInput == 1 and s.callback)
  run changedPendingInputRequiresNewPreviewTest = init.then(preview).then(dispatchPreview)
    .then(edit(2)).then(previewResponse(true)).then(finishPreview)
    .expect(s.phase == "draft" and s.previewInput == 0 and s.input == 2)
  run restoredExactInputMayUseReplyTest = init.then(preview).then(dispatchPreview)
    .then(edit(2)).then(edit(1)).then(previewResponse(true)).then(finishPreview)
    .then(confirm).then(dispatchApply).then(admitApply(true)).then(applyResponse)
    .then(finishApply).expect(s.accepted and s.callback)
  run mismatchingPreviewCannotBeConfirmedTest = init.then(preview).then(dispatchPreview)
    .then(previewResponse(false)).then(finishPreview).then(confirm.fail())
  run changedPropsHideOldConfirmationTest = init.then(preview).then(dispatchPreview)
    .then(previewResponse(true)).then(finishPreview).then(propsAdvance).then(confirm.fail())
  run changedSequenceHidesOldConfirmationTest = init.then(preview).then(dispatchPreview)
    .then(previewResponse(true)).then(finishPreview).then(sequencePropsAdvance).then(confirm.fail())
  run unchangedPropsStillUseOldServerVersionTest = init.then(preview).then(dispatchPreview)
    .then(previewResponse(true)).then(finishPreview).then(serverAdvance).then(confirm)
    .then(dispatchApply).then(admitApply(true)).then(applyFailure).then(finishApplyFailure)
    .expect(not(s.accepted) and s.error == "stale")
  run changedServerSequenceRefusesCapturedRequestTest = init.then(preview).then(dispatchPreview)
    .then(previewResponse(true)).then(finishPreview).then(serverSequenceAdvance).then(confirm)
    .then(dispatchApply).then(admitApply(true)).then(applyFailure).then(finishApplyFailure)
    .expect(not(s.accepted))
  run changedAccountIdentityRefusesApplyTest = init.then(preview).then(dispatchPreview)
    .then(previewResponse(true)).then(finishPreview).then(confirm).then(dispatchApply)
    .then(admitApply(false)).then(applyFailure).then(finishApplyFailure).expect(not(s.accepted))
  run cancelAndNewPreviewUsesNewInputTest = init.then(preview).then(dispatchPreview)
    .then(previewResponse(true)).then(finishPreview).then(cancel).then(edit(2)).then(preview)
    .then(dispatchPreview).then(previewResponse(true)).then(finishPreview).then(confirm)
    .then(dispatchApply).then(admitApply(true)).then(applyResponse).then(finishApply)
    .expect(s.accepted and s.sentInput == 2)
  run changedPreviewPreflightSendsNothingTest = init.then(preview).then(edit(2))
    .then(changedPreviewPreflight).expect(not(s.previewSent) and s.error == "preview-again")
  run changedPreviewPreflightCannotDispatchTest = init.then(preview).then(edit(2)).then(dispatchPreview.fail())
  run changedConfirmPreflightSendsNothingTest = init.then(preview).then(dispatchPreview)
    .then(previewResponse(true)).then(finishPreview).then(confirm).then(propsAdvance)
    .then(changedApplyPreflight).expect(s.sentInput == 0 and not(s.accepted))
  run changedConfirmPreflightCannotDispatchTest = init.then(preview).then(dispatchPreview)
    .then(previewResponse(true)).then(finishPreview).then(confirm).then(sequencePropsAdvance).then(dispatchApply.fail())
  run changedPreviewPostflightRejectsReplyTest = init.then(preview).then(dispatchPreview)
    .then(previewResponse(true)).then(edit(2)).then(finishPreview)
    .expect(s.previewInput == 0 and s.error == "preview-again")
  run acceptedApplyWithChangedPropsSuppressesCallbackTest = init.then(preview).then(dispatchPreview)
    .then(previewResponse(true)).then(finishPreview).then(confirm).then(dispatchApply)
    .then(admitApply(true)).then(propsAdvance).then(applyResponse).then(finishApply)
    .expect(s.accepted and not(s.callback) and not(currentPreview))
  run acceptedApplyWithChangedPostflightSuppressesCallbackTest = init.then(preview).then(dispatchPreview)
    .then(previewResponse(true)).then(finishPreview).then(confirm).then(dispatchApply)
    .then(admitApply(true)).then(applyResponse).then(sequencePropsAdvance).then(finishApply)
    .expect(s.accepted and not(s.callback))
  run acceptedWriteSurvivesLaterServerAdvanceTest = init.then(preview).then(dispatchPreview)
    .then(previewResponse(true)).then(finishPreview).then(confirm).then(dispatchApply)
    .then(admitApply(true)).then(serverAdvance).then(serverSequenceAdvance)
    .then(applyResponse).then(finishApply).expect(s.accepted and s.callback and s.acceptedRevision == 1)
  run acceptedWriteSurvivesFailedDeliveryTest = init.then(preview).then(dispatchPreview)
    .then(previewResponse(true)).then(finishPreview).then(confirm).then(dispatchApply)
    .then(admitApply(true)).then(applyFailure).then(finishApplyFailure)
    .expect(s.accepted and not(s.callback) and s.error == "request")
  run previewFailureAllowsRetryTest = init.then(preview).then(dispatchPreview)
    .then(previewFailure).then(finishPreviewFailure).then(preview).then(dispatchPreview)
    .then(previewResponse(true)).then(finishPreview).expect(currentPreview and s.error == "none")
  run applyTransportFailureRetainsLocalErrorTest = init.then(preview).then(dispatchPreview)
    .then(previewResponse(true)).then(finishPreview).then(confirm).then(dispatchApply)
    .then(applyTransportFailure).then(finishApplyFailure)
    .expect(not(s.accepted) and not(s.callback) and s.error == "request")
  run busyPreviewCannotStartAgainTest = init.then(preview).then(preview.fail())
  run busyConfirmCannotStartAgainTest = init.then(preview).then(dispatchPreview)
    .then(previewResponse(true)).then(finishPreview).then(confirm).then(confirm.fail())
}
