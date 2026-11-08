// @source src/AdminProjectEnforcement.tsx
// @source backend/projects/handler.ts
// @evidence tests/e2e/admin-editor-lifetime.spec.ts
// Full request fingerprints abstract action/reason/evidence/account selection.
// Actor and request lifetime are in ui_admin_mutation_identity. Unexecuted.
module ui_admin_enforcement_intent {
  var s: { input: int, revision: int, sequence: int, serverRevision: int, serverSequence: int,
    phase: str, requestedInput: int, requestedRevision: int, requestedSequence: int,
    previewInput: int, previewRevision: int, previewSequence: int, accountsPinned: bool,
    sentInput: int, sentRevision: int, sentSequence: int, accepted: bool, error: str }
  action init = s' = { input: 1, revision: 1, sequence: 1, serverRevision: 1, serverSequence: 1,
    phase: "draft", requestedInput: 0, requestedRevision: 0, requestedSequence: 0,
    previewInput: 0, previewRevision: 0, previewSequence: 0, accountsPinned: false,
    sentInput: 0, sentRevision: 0, sentSequence: 0, accepted: false, error: "none" }
  val currentPreview = s.previewInput == s.input and s.previewRevision == s.revision
    and s.previewSequence == s.sequence and s.previewInput != 0
  action edit(input: int): bool = all { Set(1, 2).contains(input), not(currentPreview),
    s' = s.with("input", input) }
  action preview = all { s.phase == "draft" or s.phase == "review",
    s' = s.with("phase", "preview-pending").with("requestedInput", s.input)
      .with("requestedRevision", s.revision).with("requestedSequence", s.sequence).with("error", "none") }
  action previewResponse(matches: bool): bool = {
    val unchanged = s.requestedInput == s.input and s.requestedRevision == s.revision
      and s.requestedSequence == s.sequence
    all { s.phase == "preview-pending",
      s' = if (not(unchanged) or not(matches)) s.with("phase", "draft")
        .with("previewInput", 0).with("error", "preview-again")
      else s.with("phase", "review").with("previewInput", s.requestedInput)
        .with("previewRevision", s.requestedRevision).with("previewSequence", s.requestedSequence)
        .with("accountsPinned", true) }
  }
  action propsAdvance = all { s.revision == 1, s' = s.with("revision", 2) }
  action sequencePropsAdvance = all { s.sequence == 1, s' = s.with("sequence", 2) }
  action serverAdvance = all { s.serverRevision == 1, s' = s.with("serverRevision", 2) }
  action serverSequenceAdvance = all { s.serverSequence == 1, s' = s.with("serverSequence", 2) }
  action confirm = all { s.phase == "review", currentPreview,
    s' = s.with("phase", "apply-pending").with("sentInput", s.previewInput)
      .with("sentRevision", s.previewRevision).with("sentSequence", s.previewSequence) }
  action applyResult(accountsStillMatch: bool): bool = {
    val valid = s.sentRevision == s.serverRevision and s.sentSequence == s.serverSequence
      and s.accountsPinned and accountsStillMatch
    all { s.phase == "apply-pending",
      s' = s.with("phase", if (valid) "saved" else "draft").with("accepted", valid)
        .with("error", if (valid) "none" else "stale").with("previewInput", if (valid) s.previewInput else 0) }
  }
  action cancel = all { s.phase == "review", s' = s.with("phase", "draft").with("previewInput", 0) }
  action step = {
    nondet input = Set(1, 2).oneOf()
    nondet matches = Set(false, true).oneOf()
    any { edit(input), preview, previewResponse(matches), propsAdvance, sequencePropsAdvance,
      serverAdvance, serverSequenceAdvance, confirm,
      applyResult(matches), cancel, s' = s }
  }
  val invariant = all { (s.phase == "apply-pending" or s.accepted) implies
    (s.sentInput == s.previewInput and s.sentRevision == s.previewRevision and s.sentSequence == s.previewSequence),
    s.accepted implies s.accountsPinned }
  run unchangedPreviewConfirmsExactRequestTest = init.then(preview).then(previewResponse(true))
    .then(confirm).then(applyResult(true)).expect(s.accepted and s.sentInput == 1)
  run changedPendingInputRequiresNewPreviewTest = init.then(preview).then(edit(2)).then(previewResponse(true))
    .expect(s.phase == "draft" and s.previewInput == 0 and s.input == 2)
  run restoredExactInputMayUseReplyTest = init.then(preview).then(edit(2)).then(edit(1))
    .then(previewResponse(true)).then(confirm).then(applyResult(true)).expect(s.accepted)
  run mismatchingPreviewCannotBeConfirmedTest = init.then(preview).then(previewResponse(false))
    .then(confirm.fail())
  run changedPropsHideOldConfirmationTest = init.then(preview).then(previewResponse(true))
    .then(propsAdvance).then(confirm.fail())
  run changedSequenceHidesOldConfirmationTest = init.then(preview).then(previewResponse(true))
    .then(sequencePropsAdvance).then(confirm.fail())
  run unchangedPropsStillUseOldServerVersionTest = init.then(preview).then(previewResponse(true))
    .then(serverAdvance).then(confirm).then(applyResult(true)).expect(not(s.accepted) and s.error == "stale")
  run changedServerSequenceRefusesCapturedRequestTest = init.then(preview).then(previewResponse(true))
    .then(serverSequenceAdvance).then(confirm).then(applyResult(true)).expect(not(s.accepted))
  run changedAccountIdentityRefusesApplyTest = init.then(preview).then(previewResponse(true))
    .then(confirm).then(applyResult(false)).expect(not(s.accepted))
  run cancelAndNewPreviewUsesNewInputTest = init.then(preview).then(previewResponse(true)).then(cancel)
    .then(edit(2)).then(preview).then(previewResponse(true)).then(confirm).then(applyResult(true))
    .expect(s.accepted and s.sentInput == 2)
}
