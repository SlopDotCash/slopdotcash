// @source src/OwnerAwards.tsx
// @source src/lib/use-time-boundary.ts
// Automatic cutoff is a local render boundary and a separate server guard.
// Manual finalization remains possible; a scheduled allocation is not payment.
// Request/session/lifetime admission is refined by ui_owner_private_requests.
// `canManage` is the server's owner-or-admin verdict for the viewer. A
// maintainer may read awards but never edits, saves or finalizes them.
module ui_owner_awards {
  var s: { canManage: bool, automatic: bool, cutoffPassed: bool, finalized: bool, draft: bool,
    stored: int, proposed: int, frozen: int, requestedSequence: int, sequence: int,
    phase: str }
  action initWith(canManage) = s' = { canManage: canManage, automatic: true,
    cutoffPassed: false, finalized: false, draft: false, stored: 1, proposed: 1,
    frozen: 0, requestedSequence: 0, sequence: 1, phase: "ready" }
  action init = { nondet canManage = Set(false, true).oneOf() initWith(canManage) }
  val open = not(s.finalized) and not(s.automatic and s.cutoffPassed)
  val editable = s.canManage and open
  action edit = all { editable, s' = s.with("draft", true).with("proposed", 2) }
  action cutoff = s' = s.with("cutoffPassed", true)
  action manual = all { s.canManage, s' = s.with("automatic", false) }
  action beginSave = all { editable, s.draft, s' = s.with("phase", "saving").with("requestedSequence", s.sequence) }
  action concurrentSave = all { s.sequence == 1, s' = s.with("sequence", 2).with("stored", 2) }
  action acceptSave = all { s.phase == "saving", editable,
    s.requestedSequence == s.sequence, s' = s.with("stored", s.proposed).with("draft", false).with("phase", "ready") }
  action conflict = all { s.phase == "saving", s.requestedSequence != s.sequence,
    s' = s.with("phase", "conflict") }
  action freeze = all { s.canManage, not(s.finalized), s' = s.with("finalized", true).with("frozen", s.stored).with("phase", "finalized") }
  action step = any { edit, cutoff, manual, beginSave, concurrentSave, acceptSave, conflict, freeze, s' = s }
  val invariant = all {
    s.finalized implies not(editable), s.automatic and s.cutoffPassed implies not(editable),
    s.finalized implies s.frozen > 0, s.frozen <= 2,
    not(s.canManage) implies (not(editable) and not(s.draft) and s.phase != "saving"),
  }
  // Manual mode may reopen an unfrozen month; finalization never does.
  temporal finalizationStaysClosedProperty = always(s.finalized implies always(s.finalized))
  run cutoffTest = initWith(true).then(edit).then(cutoff).expect(not(editable) and s.draft)
  run manualTest = initWith(true).then(cutoff).then(manual).expect(editable)
  run staleSaveTest = initWith(true).then(edit).then(beginSave).then(concurrentSave).then(conflict).expect(s.phase == "conflict")
  run savedOnlyTest = initWith(true).then(edit).then(freeze).expect(s.frozen == 1)
  run maintainerCannotEditTest = initWith(false).expect(not(editable)).then(edit.fail())
  run maintainerCannotFinalizeTest = initWith(false).then(freeze.fail())
  run maintainerCannotChangeModeTest = initWith(false).then(manual.fail())
}
