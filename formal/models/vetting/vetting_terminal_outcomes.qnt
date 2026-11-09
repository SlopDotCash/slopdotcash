// @source workers/vetting/acquire.ts
// @source workers/vetting/queue.ts
// @source workers/vetting/run.ts
// @source workers/vetting/scanners.ts
// One assessment, two passes. Only an accepted publication consumes the queue;
// publication transport/journal recovery has its separate model. Inspection
// and clean disposition predicates are abstracted to their successful case.
module vetting_terminal_outcomes {
  var s: {phase: str, attempt: int, pending: bool, primary: str,
    specialist: str, refusal: str, disposition: str, retained: bool}
  action init = s' = {phase: "queued", attempt: 0, pending: true,
    primary: "none", specialist: "none", refusal: "none",
    disposition: "none", retained: false}
  action start = all {s.pending, s.phase.in(Set("queued", "retry")), s.attempt < 2,
    s' = s.with("phase", "acquire").with("attempt", s.attempt + 1)
      .with("primary", "none").with("specialist", "none")
      .with("refusal", "none").with("disposition", "none").with("retained", false)}
  action identity(response: str): bool = all {s.phase == "acquire",
    response.in(Set("ok", "missing", "moved", "unavailable")),
    s' = if(response == "unavailable") s.with("phase", "retry")
      else if(response == "ok") s.with("phase", "primary")
      else s.with("phase", "evidence").with("refusal", response).with("disposition", "incomplete")}
  action primary(outcome: str): bool = all {s.phase == "primary",
    outcome.in(Set("clean", "escalate", "declined", "unavailable")),
    s' = if(outcome == "unavailable") s.with("phase", "retry").with("primary", "failed")
      else if(outcome == "declined") s.with("phase", "evidence").with("primary", "declined")
        .with("disposition", "incomplete")
      else if(outcome == "escalate") s.with("phase", "specialist").with("primary", "completed")
      else s.with("phase", "evidence").with("primary", "completed").with("disposition", "clean")}
  action specialist(outcome: str): bool = all {s.phase == "specialist",
    outcome.in(Set("clean", "declined", "unavailable")),
    s' = if(outcome == "unavailable") s.with("phase", "retry").with("specialist", "failed")
      else s.with("phase", "evidence").with("specialist", if(outcome == "declined") "declined" else "completed")
        .with("disposition", if(outcome == "declined") "incomplete" else "clean")}
  action retain(ok: bool): bool = all {s.phase == "evidence",
    s' = s.with("retained", ok)
      .with("phase", if(not(ok) and s.disposition == "clean") "retry" else "publication")}
  action accepted = all {s.phase == "publication",
    s' = s.with("phase", "recorded").with("pending", false)}
  action step = {
    nondet response = Set("ok", "missing", "moved", "unavailable").oneOf()
    nondet outcome = Set("clean", "escalate", "declined", "unavailable").oneOf()
    nondet retained = Set(false, true).oneOf()
    any {start, identity(response), primary(outcome), specialist(outcome), retain(retained), accepted, s' = s}
  }
  val invariant = all {
    not(s.pending) iff s.phase == "recorded",
    s.primary == "declined" implies s.specialist == "none" and s.disposition == "incomplete",
    s.specialist == "declined" implies s.disposition == "incomplete",
    s.refusal != "none" implies s.primary == "none" and s.disposition == "incomplete",
    s.phase == "recorded" and s.disposition == "clean" implies
      s.retained and s.primary == "completed" and s.specialist.in(Set("none", "completed")),
    s.attempt <= 2,
  }
  run missingRepositoryIsTerminalIncompleteTest = init.then(start).then(identity("missing"))
    .then(retain(true)).then(accepted).expect(not(s.pending) and s.disposition == "incomplete" and s.primary == "none")
  run movedRepositoryIsTerminalIncompleteTest = init.then(start).then(identity("moved"))
    .then(retain(true)).then(accepted).expect(s.refusal == "moved" and not(s.pending))
  run repositoryOutageRemainsPendingTest = init.then(start).then(identity("unavailable"))
    .expect(s.pending and s.phase == "retry").then(start).then(identity("ok")).expect(s.phase == "primary")
  run primaryDeclineSkipsSpecialistTest = init.then(start).then(identity("ok")).then(primary("declined"))
    .then(retain(true)).then(accepted).expect(s.specialist == "none" and s.disposition == "incomplete")
  run specialistDeclineIsIncompleteTest = init.then(start).then(identity("ok")).then(primary("escalate"))
    .then(specialist("declined")).then(retain(true)).then(accepted).expect(s.disposition == "incomplete")
  run serviceFailureMayRecoverTest = init.then(start).then(identity("ok")).then(primary("unavailable"))
    .then(start).then(identity("ok")).then(primary("clean")).then(retain(true)).then(accepted)
    .expect(s.disposition == "clean" and not(s.pending))
  run incompleteCanRecordFailedRetentionTest = init.then(start).then(identity("ok")).then(primary("declined"))
    .then(retain(false)).then(accepted).expect(not(s.retained) and s.disposition == "incomplete")
  run cleanCannotRecordFailedRetentionTest = init.then(start).then(identity("ok")).then(primary("clean"))
    .then(retain(false)).expect(s.pending and s.phase == "retry")
}
