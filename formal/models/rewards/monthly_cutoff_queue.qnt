// @source backend/payments/monthly.ts
// @source migrations/0062_monthly_allocations.sql
// One allocation write, one cutoff, and a current automatic-payment setting.
// The SQL statement observes the setting and execution clock atomically.
// Authorization, amount validity, and sequence uniqueness are separate models.
module monthly_cutoff_queue {
  var s: { now: int, automatic: bool, phase: str, checkedBefore: bool,
    writes: int, wroteAfterCutoff: bool, wroteAutomatic: bool, frozen: bool }
  action init = s' = {now: 0, automatic: true, phase: "idle", checkedBefore: false,
    writes: 0, wroteAfterCutoff: false, wroteAutomatic: false, frozen: false}
  action queueWrite = all {s.phase == "idle",
    s' = s.with("phase", "queued").with("checkedBefore", s.now == 0)}
  action cutoff = all {s.now == 0, s' = s.with("now", 1)}
  action disable = all {s.automatic, s' = s.with("automatic", false)}
  action enable = all {not(s.automatic), s' = s.with("automatic", true)}
  action freeze = all {s.now == 1, s.automatic, not(s.frozen),
    s' = s.with("frozen", true)}
  action commit = all {s.phase == "queued", not(s.frozen),
    not(s.automatic) or (s.checkedBefore and s.now == 0),
    s' = s.with("phase", "committed").with("writes", s.writes + 1)
      .with("wroteAfterCutoff", s.now == 1).with("wroteAutomatic", s.automatic)}
  action refuse = all {s.phase == "queued",
    s.frozen or (s.automatic and (not(s.checkedBefore) or s.now == 1)),
    s' = s.with("phase", "refused")}
  action step = any {queueWrite, cutoff, disable, enable, freeze, commit, refuse, s' = s}
  val invariant = all {s.writes <= 1,
    s.wroteAutomatic implies not(s.wroteAfterCutoff),
    s.phase == "refused" implies s.writes == 0}
  run queuedAcrossCutoffTest = init.then(queueWrite).then(cutoff).then(refuse).expect(s.writes == 0)
  run beforeCutoffCommitTest = init.then(queueWrite).then(commit).expect(s.writes == 1)
  run currentOptOutAllowsLateEditTest = init.then(queueWrite).then(cutoff).then(disable)
    .then(commit).expect(s.writes == 1 and not(s.wroteAutomatic))
  run currentOptInRejectsLateEditTest = init.then(disable).then(queueWrite).then(cutoff)
    .then(enable).then(refuse)
  run frozenMonthRejectsEditTest = init.then(queueWrite).then(cutoff).then(freeze)
    .then(disable).then(refuse)
}
