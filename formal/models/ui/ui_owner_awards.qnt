// @source src/OwnerAwards.tsx
// @source src/lib/use-time-boundary.ts
// Automatic cutoff is a local render boundary and a separate server guard.
// Manual finalization remains possible; a scheduled allocation is not payment.
module ui_owner_awards {
  var s: { automatic: bool, cutoffPassed: bool, finalized: bool, draft: bool,
    stored: int, proposed: int, frozen: int, requestedSequence: int, sequence: int,
    phase: str }
  action init = s' = { automatic: true, cutoffPassed: false, finalized: false,
    draft: false, stored: 1, proposed: 1, frozen: 0, requestedSequence: 0,
    sequence: 1, phase: "ready" }
  val editable = not(s.finalized) and not(s.automatic and s.cutoffPassed)
  action edit = all { editable, s' = s.with("draft", true).with("proposed", 2) }
  action cutoff = s' = s.with("cutoffPassed", true)
  action manual = s' = s.with("automatic", false)
  action beginSave = all { editable, s.draft, s' = s.with("phase", "saving").with("requestedSequence", s.sequence) }
  action concurrentSave = all { s.sequence == 1, s' = s.with("sequence", 2).with("stored", 2) }
  action acceptSave = all { s.phase == "saving", editable,
    s.requestedSequence == s.sequence, s' = s.with("stored", s.proposed).with("draft", false).with("phase", "ready") }
  action conflict = all { s.phase == "saving", s.requestedSequence != s.sequence,
    s' = s.with("phase", "conflict") }
  action freeze = all { not(s.finalized), s' = s.with("finalized", true).with("frozen", s.stored).with("phase", "finalized") }
  action step = any { edit, cutoff, manual, beginSave, concurrentSave, acceptSave, conflict, freeze, s' = s }
  val invariant = all {
    s.finalized implies not(editable), s.automatic and s.cutoffPassed implies not(editable),
    s.finalized implies s.frozen > 0, s.frozen <= 2
  }
  // Manual mode may reopen an unfrozen month; finalization never does.
  temporal finalizationStaysClosedProperty = always(s.finalized implies always(s.finalized))
  run cutoffTest = init.then(edit).then(cutoff).expect(not(editable) and s.draft)
  run manualTest = init.then(cutoff).then(manual).expect(editable)
  run staleSaveTest = init.then(edit).then(beginSave).then(concurrentSave).then(conflict).expect(s.phase == "conflict")
  run savedOnlyTest = init.then(edit).then(freeze).expect(s.frozen == 1)
}
