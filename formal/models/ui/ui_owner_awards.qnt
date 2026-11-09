// @source src/OwnerAwards.tsx
// @source src/lib/use-time-boundary.ts
// @evidence tests/e2e/owner-awards.spec.ts
// One month, two allocation rows, values 0..3, one invalid input, two mutations
// and one independent server revision. These are finite bounds, not limits.
// Other-month drafts/calendar navigation remain outside this projection.
// Identity, generations, departure and HTTP parsing are refined separately by
// ui_owner_private_requests. Money grammar/arithmetic and backend authorization
// and sequence CAS are delegated. Successful server transitions represent
// admitted outcomes, not authority from local controls. Commit and UI callback
// are separate: a successful save can return after cutoff. Drafts survive only
// while their captured base matches the accepted row. Finalization uses saved
// values and never proves payment. Source-only scenarios, unexecuted.
module ui_owner_awards {
  type View = { automatic: bool, finalized: bool, proposal: bool,
    rows: Set[int], values: int -> int, sequence: int }
  type State = { canManage: bool, view: bool, proposal: bool, automatic: bool,
    cutoffPassed: bool, finalized: bool, serverAutomatic: bool,
    serverFinalized: bool, serverProposal: bool, rows: Set[int], serverRows: Set[int],
    values: int -> int, serverValues: int -> int, frozen: int -> int,
    draftIds: Set[int], draftValues: int -> int, draftBases: int -> int,
    sequence: int, serverSequence: int, phase: str, requestedActor: int,
    requestedValue: int, requestedSequence: int, desiredAutomatic: bool,
    attempts: int, remoteUsed: bool, error: str, notice: str, paid: bool, reply: View }
  val actors = Set(1, 2)
  val amounts = Set(0, 1, 2, 3)
  var s: State
  action initWith(canManage: bool): bool = s' = { canManage: canManage,
    view: true, proposal: true, automatic: true, cutoffPassed: false,
    finalized: false, serverAutomatic: true, serverFinalized: false,
    serverProposal: true, rows: actors, serverRows: actors,
    values: Map(1 -> 1, 2 -> 2), serverValues: Map(1 -> 1, 2 -> 2),
    frozen: Map(1 -> 0, 2 -> 0), draftIds: Set(),
    draftValues: Map(1 -> 0, 2 -> 0), draftBases: Map(1 -> 0, 2 -> 0),
    sequence: 1, serverSequence: 1, phase: "ready", requestedActor: 0,
    requestedValue: 0, requestedSequence: 0, desiredAutomatic: true,
    attempts: 0, remoteUsed: false, error: "none", notice: "none", paid: false,
    reply: { automatic: true, finalized: false, proposal: true,
      rows: actors, values: Map(1 -> 1, 2 -> 2), sequence: 1 } }
  action init = { nondet manager = Set(false, true).oneOf() initWith(manager) }
  val busy = s.phase != "ready"
  val fixedAtCutoff = s.automatic and s.cutoffPassed
  val open = s.view and s.proposal and not(s.finalized) and not(fixedAtCutoff)
  val editable = s.canManage and open and not(busy)
  def canSave(actor: int): bool = editable and s.rows.contains(actor) and s.draftIds.contains(actor)
  val canFinalize = s.canManage and s.view and s.proposal and not(s.finalized) and not(busy)
  val canToggle = s.canManage and s.view and not(busy)
  // accept() filters each old draft independently. A successful save also
  // deletes its own draft even when gross is unchanged.
  def bodyOf(value: State): View = { automatic: value.serverAutomatic,
    finalized: value.serverFinalized, proposal: value.serverProposal,
    rows: value.serverRows, values: value.serverValues, sequence: value.serverSequence }
  def withView(value: State): State = value.with("view", true)
    .with("proposal", value.reply.proposal).with("automatic", value.reply.automatic)
    .with("finalized", value.reply.finalized).with("rows", value.reply.rows)
    .with("values", value.reply.values).with("sequence", value.reply.sequence)
    .with("draftIds", value.draftIds.filter(actor => value.reply.rows.contains(actor)
      and value.draftBases.get(actor) == value.reply.values.get(actor)))
  action edit(actor: int, value: int): bool = all { editable, s.rows.contains(actor),
    Set(-1, 0, 1, 2, 3).contains(value),
    s' = s.with("draftIds", s.draftIds.union(Set(actor)))
      .with("draftValues", s.draftValues.set(actor, value))
      .with("draftBases", s.draftBases.set(actor, s.values.get(actor))) }
  action cutoff = s' = s.with("cutoffPassed", true)
  action beginSave(actor: int): bool = all { canSave(actor), s.attempts < 2,
    s' = s.with("phase", "saving").with("requestedActor", actor)
      .with("requestedValue", s.draftValues.get(actor)).with("requestedSequence", s.sequence)
      .with("attempts", s.attempts + 1).with("error", "none").with("notice", "none") }
  action invalidAmount = all { s.phase == "saving", s.requestedValue == -1,
    s' = s.with("phase", "ready").with("error", "amount") }
  action acceptSave = {
    val actor = if (actors.contains(s.requestedActor)) s.requestedActor else 1
    val accepted = s.with("phase", "save-reply").with("serverSequence", s.serverSequence + 1)
      .with("serverValues", s.serverValues.set(actor, s.requestedValue))
    all { s.phase == "saving", amounts.contains(s.requestedValue),
      s.requestedSequence == s.serverSequence, s.serverProposal, not(s.serverFinalized),
      not(s.serverAutomatic and s.cutoffPassed), s.serverRows.contains(s.requestedActor),
      s' = accepted.with("reply", bodyOf(accepted)) }
  }
  action showSave = all { s.phase == "save-reply",
    s' = withView(s).with("phase", "ready").with("notice", "saved")
      .with("draftIds", withView(s).draftIds.exclude(Set(s.requestedActor))) }
  action conflict = all { s.phase == "saving", s.requestedSequence != s.serverSequence,
    s' = s.with("phase", "ready").with("error", "conflict") }
  action failedRequest = all { Set("saving", "save-reply", "finalizing", "finalize-reply", "toggling", "toggle-reply").contains(s.phase),
    s' = s.with("phase", "ready").with("error", "request") }
  // A remote edit/removal does not rewrite the rendered proposal. Only an
  // accepted view prunes a draft whose captured row base changed.
  action concurrentSave(actor: int, value: int, remove: bool): bool = all {
    not(s.remoteUsed), not(s.serverFinalized), actors.contains(actor), amounts.contains(value),
    s' = s.with("remoteUsed", true).with("serverSequence", s.serverSequence + 1)
      .with("serverValues", s.serverValues.set(actor, value))
      .with("serverRows", if (remove) s.serverRows.exclude(Set(actor)) else s.serverRows) }
  action beginRead = all { not(busy), s' = s.with("phase", "reading").with("view", false)
    .with("error", "none").with("notice", "none") }
  action receiveRead = all { s.phase == "reading",
    s' = s.with("reply", bodyOf(s)).with("phase", "read-reply") }
  action showRead = all { s.phase == "read-reply", s' = withView(s).with("phase", "ready") }
  action failedRead = all { Set("reading", "read-reply").contains(s.phase), s' = s.with("phase", "ready").with("error", "read") }
  action noProposal = all { s.phase == "reading", not(s.serverFinalized),
    s' = s.with("serverProposal", false).with("serverRows", Set()) }
  action beginFinalize = all { canFinalize, s.attempts < 2,
    s' = s.with("phase", "finalizing").with("requestedSequence", s.sequence)
      .with("attempts", s.attempts + 1).with("error", "none").with("notice", "none") }
  action freeze = {
    val accepted = s.with("phase", "finalize-reply").with("serverFinalized", true)
      .with("frozen", s.serverValues)
    all { s.phase == "finalizing", s.serverProposal, not(s.serverFinalized),
      s.requestedSequence == s.serverSequence, s' = accepted.with("reply", bodyOf(accepted)) }
  }
  action showFinal = all { s.phase == "finalize-reply",
    s' = withView(s).with("phase", "ready").with("draftIds", Set()).with("notice", "finalized") }
  action beginToggle = all { canToggle, s.attempts < 2,
    s' = s.with("phase", "toggling").with("desiredAutomatic", not(s.automatic))
      .with("attempts", s.attempts + 1).with("error", "none").with("notice", "none") }
  action acceptToggle = all { s.phase == "toggling",
    s' = s.with("phase", "toggle-reply").with("serverAutomatic", s.desiredAutomatic)
      .with("reply", bodyOf(s).with("automatic", s.desiredAutomatic)) }
  // Settings success changes only automatic, not allocation rows or drafts.
  action showToggle = all { s.phase == "toggle-reply",
    s' = s.with("phase", "ready").with("automatic", s.reply.automatic) }
  action step = {
    nondet actor = actors.oneOf() nondet value = Set(-1, 0, 1, 2, 3).oneOf()
    nondet amount = amounts.oneOf() nondet remove = Set(false, true).oneOf()
    any { edit(actor, value), cutoff, beginSave(actor), invalidAmount, acceptSave,
      showSave, conflict, failedRequest, concurrentSave(actor, amount, remove),
      beginRead, receiveRead, showRead, failedRead, noProposal, beginFinalize, freeze, showFinal,
      beginToggle, acceptToggle, showToggle, s' = s }
  }
  val invariant = all { s.attempts <= 2, s.serverSequence <= 4, not(s.paid),
    s.draftIds.subseteq(actors), s.rows.subseteq(actors), s.serverRows.subseteq(actors),
    s.finalized implies not(editable), fixedAtCutoff implies not(editable),
    not(s.canManage) implies not(editable) and not(canFinalize) and not(canToggle),
    s.notice == "finalized" implies s.finalized and s.draftIds == Set() }
  temporal finalizationStaysClosedProperty = always(s.serverFinalized implies always(s.serverFinalized))
  action saveRow(actor: int): bool = beginSave(actor).then(acceptSave).then(showSave)
  action manual = beginToggle.then(acceptToggle).then(showToggle)
  action finalized = beginFinalize.then(freeze).then(showFinal)
  run cutoffTest = initWith(true).then(edit(1, 3)).then(cutoff).expect(not(editable) and s.draftIds == Set(1))
  run manualTest = initWith(true).then(cutoff).then(manual).expect(editable and not(s.automatic))
  run staleSaveTest = initWith(true).then(edit(1, 3)).then(beginSave(1))
    .then(concurrentSave(1, 2, false)).then(conflict).expect(s.error == "conflict" and s.draftIds == Set(1))
  run savedOnlyTest = initWith(true).then(edit(1, 3)).then(finalized)
    .expect(s.frozen.get(1) == 1 and s.draftIds == Set() and invariant)
  run maintainerCannotEditTest = initWith(false).expect(not(editable)).then(edit(1, 3).fail())
  run maintainerCannotFinalizeTest = initWith(false).then(beginFinalize.fail())
  run maintainerCannotChangeModeTest = initWith(false).then(beginToggle.fail())
  run savedResponseAfterCutoffStillAppliesTest = initWith(true).then(edit(1, 3)).then(beginSave(1)).then(acceptSave)
    .then(cutoff).then(showSave).expect(s.values.get(1) == 3 and not(editable) and s.notice == "saved" and invariant)
  run cutoffBeforeServerAdmissionRefusesSaveTest = initWith(true).then(edit(1, 3)).then(beginSave(1)).then(cutoff)
    .expect(s.serverValues.get(1) == 1).then(acceptSave.fail())
  run saveRemovesOnlyItsOwnUnchangedBaseDraftTest = initWith(true).then(edit(1, 3)).then(edit(2, 1)).then(saveRow(2))
    .expect(s.draftIds == Set(1) and s.draftValues.get(1) == 3 and s.values.get(2) == 1 and invariant)
  run sameGrossSuccessfulSaveStillClearsDraftTest = initWith(true).then(edit(1, 1)).then(saveRow(1))
    .expect(s.values.get(1) == 1 and s.draftIds == Set() and s.notice == "saved")
  run newerReadDropsChangedBaseDraftTest = initWith(true).then(edit(1, 3)).then(edit(2, 1))
    .then(concurrentSave(1, 2, false)).then(beginRead).then(receiveRead).then(showRead)
    .expect(s.draftIds == Set(2) and s.values.get(1) == 2 and s.sequence == 2)
  run newerReadDropsRemovedRowDraftTest = initWith(true).then(edit(1, 3)).then(edit(2, 1))
    .then(concurrentSave(1, 1, true)).then(beginRead).then(receiveRead).then(showRead)
    .expect(s.draftIds == Set(2) and not(s.rows.contains(1)))
  run equalBaseDraftSurvivesSequenceChangeTest = initWith(true).then(edit(1, 3))
    .then(concurrentSave(2, 3, false)).then(beginRead).then(receiveRead).then(showRead)
    .expect(s.draftIds == Set(1) and s.sequence == 2 and canSave(1))
  run invalidInputKeepsDraftWithoutServerWriteTest = initWith(true).then(edit(1, -1)).then(beginSave(1)).then(invalidAmount)
    .expect(s.error == "amount" and s.draftValues.get(1) == -1 and s.serverSequence == 1 and invariant)
  run invalidInputCanBeCorrectedAndSavedTest = initWith(true).then(edit(1, -1)).then(beginSave(1)).then(invalidAmount)
    .then(edit(1, 3)).then(saveRow(1)).expect(s.values.get(1) == 3 and s.error == "none" and invariant)
  run failedSaveKeepsDraftAndSavedAmountsTest = initWith(true).then(edit(1, 3)).then(beginSave(1)).then(failedRequest)
    .expect(s.draftIds == Set(1) and s.values.get(1) == 1 and s.error == "request")
  run lostSaveReplyKeepsCommittedAmountUntilRefreshTest = initWith(true).then(edit(1, 3)).then(beginSave(1)).then(acceptSave)
    .then(failedRequest).expect(s.values.get(1) == 1 and s.serverValues.get(1) == 3 and s.draftIds == Set(1))
    .then(beginRead).then(receiveRead).then(showRead).expect(s.values.get(1) == 3 and s.draftIds == Set())
  run refreshFailureHidesAmountsAndRetainsDraftTest = initWith(true).then(edit(1, 3)).then(beginRead).then(failedRead)
    .expect(not(s.view) and not(editable) and s.draftIds == Set(1)).then(beginRead).then(receiveRead).then(showRead)
    .expect(canSave(1) and s.error == "none")
  run absentProposalDropsDraftsAndControlsTest = initWith(true).then(edit(1, 3)).then(beginRead).then(noProposal).then(receiveRead).then(showRead)
    .expect(not(s.proposal) and s.draftIds == Set() and not(canFinalize) and not(editable))
  run manualFinalizationRemainsAvailableAfterCutoffTest = initWith(true).then(edit(1, 3)).then(cutoff)
    .expect(canFinalize and not(editable)).then(finalized).expect(s.frozen.get(1) == 1 and not(s.paid))
  run lostFinalizationReplyDoesNotInventPaymentTest = initWith(true).then(beginFinalize).then(freeze).then(failedRequest)
    .expect(s.serverFinalized and not(s.finalized) and not(s.paid)).then(beginRead).then(receiveRead).then(showRead)
    .expect(s.finalized and not(editable) and not(s.paid))
  run toggleRetainsDraftAndDoesNotAcceptNewRowsTest = initWith(true).then(edit(1, 3))
    .then(concurrentSave(1, 2, false)).then(manual)
    .expect(s.draftIds == Set(1) and s.values.get(1) == 1 and s.serverValues.get(1) == 2)
  run finalizedMonthCannotBeReopenedByManualModeTest = initWith(true).then(finalized).then(manual)
    .expect(s.finalized and not(s.automatic) and not(editable) and not(s.paid))
  run busyControlsRejectFurtherEditsTest = initWith(true).then(edit(1, 3)).then(beginSave(1))
    .expect(busy and not(editable) and not(canFinalize) and not(canToggle)).then(edit(2, 1).fail())
  run returnedSnapshotDoesNotReadLaterServerValuesTest = initWith(true).then(edit(1, 3)).then(beginSave(1)).then(acceptSave)
    .then(concurrentSave(2, 3, false)).then(showSave)
    .expect(s.values.get(2) == 2 and s.serverValues.get(2) == 3 and s.sequence == 2 and s.serverSequence == 3)
  run savedNoticeDoesNotMeanLaterEditsAreSavedTest = initWith(true).then(edit(1, 3)).then(saveRow(1)).then(edit(1, 2))
    .expect(s.notice == "saved" and s.draftIds == Set(1) and s.values.get(1) == 3 and s.draftValues.get(1) == 2)
}
