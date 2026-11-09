// @source migrations/0067_vetting_audit_retention.sql
// @source workers/vetting-backup/core.ts
// @evidence workers/vetting-backup/qualification-retention.ts
// Six rows, two calendar-month advances and two DELETE forms. Calendar samples
// use the same UTC day/time, so subtracting twelve months is exactly one year.
// Lexical SQL selection and parsed-date trigger eligibility remain distinct.
// One SQLite statement uses one captured execution clock; no wall-clock advance
// between its rows changes that captured cutoff. Source-only, unexecuted.
module vetting_audit_retention {
  type Date = { valid: bool, month: int, lexical: int }
  val ids = Set(1, 2, 3, 4, 5, 6)
  // Epoch: November 8, 2025, at the fixed UTC sample time.
  // 4/5 are invalid strings sorting before/after every sampled SQL cutoff.
  // 6 is an equal parsed date written with a space instead of the ISO 'T';
  // it sorts before the formatted cutoff but the trigger still refuses it.
  val dates: int -> Date = Map(
    1 -> {valid: true, month: -1, lexical: -1},
    2 -> {valid: true, month: 0, lexical: 0},
    3 -> {valid: true, month: 1, lexical: 1},
    4 -> {valid: false, month: 0, lexical: -2},
    5 -> {valid: false, month: 0, lexical: 3},
    6 -> {valid: true, month: 0, lexical: -1})
  var s: { phase: str, enabled: bool, now: int, observedCutoff: int,
    statementCutoff: int, kind: str, requested: Set[int], rows: Set[int],
    inserted: Set[int], before: Set[int], selected: Set[int], checked: Set[int],
    staged: Set[int], deletedAt: int -> int, lastDeleted: Set[int], result: str }
  action init = s' = { phase: "idle", enabled: true, now: 12,
    observedCutoff: 0, statementCutoff: -1, kind: "none", requested: Set(),
    rows: Set(1, 2, 3, 5), inserted: Set(1, 2, 3, 5), before: Set(1, 2, 3, 5),
    selected: Set(), checked: Set(), staged: Set(),
    deletedAt: ids.mapBy(_ => -2), lastDeleted: Set(), result: "none" }
  def oldEnough(row: int, cutoff: int): bool =
    dates.get(row).valid and dates.get(row).month < cutoff
  action insertEdge(row: int): bool = all { s.phase == "idle", Set(4, 6).contains(row),
    not(s.inserted.contains(row)),
    s' = s.with("rows", s.rows.union(Set(row))).with("inserted", s.inserted.union(Set(row)))
      .with("result", "none") }
  action mode(isEnabled: bool): bool = all { s.phase == "idle", s' = s.with("enabled", isEnabled) }
  action advance = all { s.now < 14, s' = s.with("now", s.now + 1) }
  // observedCutoff records invocation timing for the model, not a runtime
  // argument. pruneAccessAudit passes no date into its DELETE statement.
  action scheduled = all { s.phase == "idle",
    s' = if (s.enabled) s.with("phase", "prepared").with("kind", "scheduled")
        .with("observedCutoff", s.now - 12).with("result", "pending")
      else s.with("result", "disabled") }
  // Direct DELETE represents the trigger's protection outside the scheduler.
  action direct(requested: Set[int]): bool = all { s.phase == "idle", requested.subseteq(ids),
    s' = s.with("phase", "prepared").with("kind", "direct").with("requested", requested)
      .with("observedCutoff", s.now - 12).with("result", "pending") }
  action execute = all { s.phase == "prepared",
    s' = s.with("phase", "checking").with("statementCutoff", s.now - 12)
      .with("before", s.rows).with("checked", Set()).with("staged", Set()).with("lastDeleted", Set())
      .with("selected", if (s.kind == "scheduled")
        s.rows.filter(row => dates.get(row).lexical < s.now - 12)
        else s.rows.intersect(s.requested)) }
  action inspect(row: int): bool = all { s.phase == "checking",
    s.selected.contains(row), not(s.checked.contains(row)),
    s' = if (oldEnough(row, s.statementCutoff))
        s.with("checked", s.checked.union(Set(row))).with("staged", s.staged.union(Set(row)))
      // RAISE(ABORT) rolls back every prior deletion in this statement.
      else s.with("phase", "aborted").with("staged", Set()) }
  action commit = all { s.phase == "checking", s.checked == s.selected,
    s' = s.with("phase", "idle").with("rows", s.rows.exclude(s.staged))
      .with("deletedAt", ids.mapBy(row => if (s.staged.contains(row)) s.statementCutoff else s.deletedAt.get(row)))
      .with("lastDeleted", s.staged).with("staged", Set()).with("result", "committed") }
  action finishAbort = all { s.phase == "aborted",
    s' = s.with("phase", "idle").with("result", "aborted") }
  action step = {
    nondet row = ids.oneOf()
    nondet isEnabled = Set(false, true).oneOf()
    any { insertEdge(row), mode(isEnabled), advance, scheduled, direct(Set(row)), direct(s.rows),
      execute, inspect(row), commit, finishAbort, s' = s }
  }
  val invariant = all {
    s.now >= 12 and s.now <= 14, s.statementCutoff <= s.now - 12,
    s.rows.subseteq(s.inserted), s.inserted.subseteq(ids),
    s.inserted.exclude(s.rows).forall(row => oldEnough(row, s.deletedAt.get(row))),
    s.inserted.intersect(Set(4, 5)).subseteq(s.rows),
    s.phase == "checking" implies s.staged.subseteq(s.selected)
      and s.staged.forall(row => oldEnough(row, s.statementCutoff)),
    s.phase == "aborted" implies s.rows == s.before and s.staged == Set(),
    s.result == "aborted" implies s.rows == s.before and s.lastDeleted == Set(),
    s.result == "committed" implies s.rows == s.before.exclude(s.lastDeleted) }

  run disabledSchedulerDoesNotDeleteTest = init.then(mode(false)).then(scheduled)
    .expect(s.result == "disabled" and s.rows == Set(1, 2, 3, 5) and invariant)
  run scheduledOldOnlyBeforeEqualBoundaryTest = init.then(scheduled).then(execute)
    .expect(s.selected == Set(1)).then(inspect(1)).then(commit)
    .expect(s.rows == Set(2, 3, 5) and invariant)
  run directEqualBoundaryRefusedTest = init.then(direct(Set(2))).then(execute)
    .then(inspect(2)).then(finishAbort).expect(s.result == "aborted" and s.rows.contains(2) and invariant)
  run directNewerRefusedTest = init.then(direct(Set(3))).then(execute)
    .then(inspect(3)).then(finishAbort).expect(s.result == "aborted" and s.rows.contains(3) and invariant)
  run invalidEarlyDateRefusedTest = init.then(insertEdge(4)).then(direct(Set(4))).then(execute)
    .then(inspect(4)).then(finishAbort).expect(s.rows.contains(4) and invariant)
  run invalidLateDateRefusedOutsideSchedulerTest = init.then(direct(Set(5))).then(execute)
    .then(inspect(5)).then(finishAbort).expect(s.rows.contains(5) and invariant)
  run lexicalInvalidSelectionRollsBackOldRowTest = init.then(insertEdge(4)).then(scheduled).then(execute)
    .expect(s.selected == Set(1, 4)).then(inspect(1)).expect(s.staged == Set(1))
    .then(inspect(4)).then(finishAbort).expect(s.rows == Set(1, 2, 3, 4, 5) and invariant)
  run mixedDirectDeleteRollsBackEveryRowTest = init.then(direct(Set(1, 2))).then(execute)
    .then(inspect(1)).then(inspect(2)).then(finishAbort)
    .expect(s.rows == Set(1, 2, 3, 5) and s.lastDeleted == Set() and invariant)
  run lexicalEqualParsedDateStillRefusesTest = init.then(insertEdge(6)).then(scheduled).then(execute)
    .expect(s.selected == Set(1, 6)).then(inspect(1)).then(inspect(6)).then(finishAbort)
    .expect(s.rows.contains(1) and s.rows.contains(6) and invariant)
  run prepareTimeDoesNotFreezeDatabaseCutoffTest = init.then(scheduled).then(advance).then(execute)
    .expect(s.observedCutoff == 0 and s.statementCutoff == 1 and s.selected == Set(1, 2))
    .then(inspect(1)).then(inspect(2)).then(commit).expect(s.rows == Set(3, 5) and invariant)
  run statementClockDoesNotAdvanceBetweenRowsTest = init.then(direct(Set(1, 2))).then(execute)
    .then(inspect(1)).then(advance).then(inspect(2)).then(finishAbort)
    .expect(s.statementCutoff == 0 and s.rows.contains(1) and s.rows.contains(2) and invariant)
    .then(direct(Set(2))).then(execute).then(inspect(2)).then(commit)
    .expect(not(s.rows.contains(2)) and s.deletedAt.get(2) == 1 and invariant)
  run laterStatementDeletesOnlyStrictlyOlderRowsTest = init.then(advance).then(scheduled).then(execute)
    .then(inspect(1)).then(inspect(2)).then(commit).expect(s.rows == Set(3, 5))
    .then(advance).then(scheduled).then(execute).then(inspect(3)).then(commit)
    .expect(s.rows == Set(5) and invariant)
  run directOldRowsDeleteAtomicallyWhileInvalidStaysTest = init.then(advance).then(advance)
    .then(direct(Set(1, 2, 3))).then(execute).then(inspect(3)).then(inspect(1)).then(inspect(2)).then(commit)
    .expect(s.rows == Set(5) and s.lastDeleted == Set(1, 2, 3) and invariant)
  run disabledWorkerDoesNotDisableTriggerTest = init.then(mode(false)).then(direct(Set(2)))
    .then(execute).then(inspect(2)).then(finishAbort).expect(s.rows.contains(2) and invariant)
}
