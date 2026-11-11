// @source src/ProjectSetupStatus.tsx
// @source src/App.tsx
// @evidence tests/e2e/project-setup-resume.spec.ts
// React Suspense hides layout effects while preserving component state.
// Two request generations, one hide/reveal, two response outcomes. Actor and
// project authorization are composed with ui_setup_check_lifetime; this model
// isolates the layout lifetime and automatic restart for an empty projection.
module ui_setup_check_suspense {
  var s: { visible: bool, generation: int, pending: int, data: bool,
    initial: bool, first: str, second: str, error: bool }
  action init = s' = { visible: true, generation: 1, pending: 1, data: false,
    initial: false, first: "pending", second: "unused", error: false }
  action trustedInitial = all { s.first == "pending", s.generation == 1,
    s' = s.with("pending", 0).with("data", true).with("initial", true)
      .with("first", "unused") }
  action hide = all { s.visible, s.generation == 1,
    s' = s.with("visible", false).with("generation", 2).with("pending", 0) }
  action reveal = all { not(s.visible),
    s' = if (s.initial) s.with("visible", true)
      else s.with("visible", true).with("pending", 2).with("second", "pending") }
  action completeFirst = all { s.first == "pending",
    s' = if (s.visible and s.pending == 1 and s.generation == 1)
      s.with("first", "done").with("data", true).with("pending", 0)
      else s.with("first", "done") }
  action completeSecond(success: bool): bool = all { s.second == "pending", s.visible,
    s' = s.with("second", "done").with("pending", 0)
      .with("data", success or s.data).with("error", not(success)) }
  action retry = all { s.visible, s.error,
    s' = s.with("second", "pending").with("pending", 2).with("error", false) }
  action step = any { trustedInitial, hide, reveal, completeFirst,
    completeSecond(true), completeSecond(false), retry, s' = s }
  val invariant = all {
    not(s.visible) implies s.pending == 0,
    s.visible and s.generation == 2 and not(s.initial) and s.second == "unused" implies false,
    s.second == "done" implies s.pending == 0,
    s.initial implies s.data,
    s.error implies s.visible and s.pending == 0 }
  run hiddenResponseCannotPublishTest = init.then(hide).then(completeFirst)
    .expect(not(s.data) and s.pending == 0)
  run revealRestartsEmptyCheckTest = init.then(hide).then(completeFirst).then(reveal)
    .expect(s.visible and s.pending == 2 and not(s.data))
  run restartedCheckPublishesTest = init.then(hide).then(completeFirst).then(reveal)
    .then(completeSecond(true)).expect(s.data and s.pending == 0)
  run oldResponseAfterRevealCannotReplaceNewRequestTest = init.then(hide).then(reveal)
    .then(completeFirst).expect(s.pending == 2 and not(s.data))
  run initialProjectionSurvivesRevealTest = init.then(trustedInitial).then(hide).then(reveal)
    .expect(s.data and s.pending == 0)
  run restartFailureCanRetryTest = init.then(hide).then(reveal).then(completeSecond(false))
    .then(retry).then(completeSecond(true)).expect(s.data and not(s.error))
}
