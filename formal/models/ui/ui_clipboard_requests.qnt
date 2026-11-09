// @source src/lib/use-copy-feedback.ts
// @source src/lib/copy-text.ts
// @source src/Operations.tsx
// @source src/App.tsx
// @evidence tests/e2e/clipboard-feedback.spec.ts
// Source-only, unexecuted. Two text values, three committed text versions,
// two component lifetimes and three copy requests. Native clipboard effects
// are external: current feedback does not promise exclusive clipboard control.
module ui_clipboard_requests {
  type Request = { phase: str, value: int, version: int, lifetime: int, timer: bool }
  var s: { active: bool, value: int, version: int, lifetime: int, latest: int,
    feedback: str, feedbackValue: int, feedbackVersion: int,
    feedbackLifetime: int, expires: bool, requests: int -> Request }
  val ids = Set(1, 2, 3)
  action init = s' = { active: true, value: 1, version: 1, lifetime: 1,
    latest: 0, feedback: "idle", feedbackValue: 0, feedbackVersion: 0,
    feedbackLifetime: 0, expires: true,
    requests: ids.mapBy(_ => {phase: "unused", value: 0, version: 0, lifetime: 0, timer: false}) }
  def owns(id: int): bool = s.active and s.latest == id
    and s.requests.get(id).version == s.version
    and s.requests.get(id).lifetime == s.lifetime
  action persistentFeedback = all { s.latest == 0,
    s' = s.with("expires", false) }
  action copy(id: int): bool = all {
    s.active, ids.contains(id), s.requests.get(id).phase == "unused",
    s' = s.with("latest", id).with("feedback", "idle")
      .with("requests", s.requests.set(id, {phase: "pending", value: s.value,
        version: s.version, lifetime: s.lifetime, timer: false})) }
  action changeValue(value: int): bool = all {
    s.active, Set(1, 2).contains(value), value != s.value, s.version < 3,
    s' = s.with("value", value).with("version", s.version + 1)
      .with("latest", 0).with("feedback", "idle") }
  action complete(id: int, outcome: str): bool = {
    val request = s.requests.get(id)
    val nextValue = s.with("requests", s.requests.set(id,
      request.with("phase", outcome).with("timer", owns(id) and outcome == "copied" and s.expires)))
    all { ids.contains(id), request.phase == "pending", Set("copied", "failed").contains(outcome),
      s' = if (owns(id)) nextValue.with("feedback", outcome)
        .with("feedbackValue", request.value).with("feedbackVersion", request.version)
        .with("feedbackLifetime", request.lifetime) else nextValue }
  }
  // Includes a timer already queued before its effect cleanup cancelled it.
  action expire(id: int): bool = {
    val nextValue = s.with("requests", s.requests.set(id, s.requests.get(id).with("timer", false)))
    all { ids.contains(id), s.requests.get(id).timer,
      s' = if (owns(id)) nextValue.with("feedback", "idle") else nextValue }
  }
  action leave = all { s.active,
    s' = s.with("active", false).with("latest", 0).with("feedback", "idle") }
  action returnToView = all { not(s.active), s.lifetime == 1,
    s' = s.with("active", true).with("lifetime", 2) }
  action step = {
    nondet id = ids.oneOf()
    nondet value = Set(1, 2).oneOf()
    nondet outcome = Set("copied", "failed").oneOf()
    any { persistentFeedback, copy(id), changeValue(value), complete(id, outcome),
      expire(id), leave, returnToView, s' = s }
  }
  val invariant = all {
    if (s.feedback == "idle") true else all { s.active, s.latest != 0,
      s.feedbackValue == s.value, s.feedbackVersion == s.version,
      s.feedbackLifetime == s.lifetime,
      s.requests.get(s.latest).phase == s.feedback },
    ids.forall(id => s.requests.get(id).timer implies s.requests.get(id).phase == "copied") }
  run successTest = init.then(copy(1)).then(complete(1, "copied")).expect(s.feedback == "copied")
  run deniedTest = init.then(copy(1)).then(complete(1, "failed")).expect(s.feedback == "failed")
  run deniedRetryTest = init.then(copy(1)).then(complete(1, "failed")).then(copy(2))
    .then(complete(2, "copied")).expect(s.feedback == "copied")
  run clearOnNewAttemptTest = init.then(copy(1)).then(complete(1, "copied"))
    .then(copy(2)).expect(s.feedback == "idle")
  run changedPromptDiscardsOldSuccessTest = init.then(copy(1)).then(changeValue(2))
    .then(complete(1, "copied")).expect(s.feedback == "idle")
  run changedPromptDiscardsOldFailureTest = init.then(copy(1)).then(changeValue(2))
    .then(complete(1, "failed")).expect(s.feedback == "idle")
  run changedPromptClearsSuccessTest = init.then(copy(1)).then(complete(1, "copied"))
    .then(changeValue(2)).expect(s.feedback == "idle")
  run changedPromptClearsFailureTest = init.then(copy(1)).then(complete(1, "failed"))
    .then(changeValue(2)).expect(s.feedback == "idle")
  run textAbaDoesNotReviveOldRequestTest = init.then(copy(1)).then(changeValue(2))
    .then(changeValue(1)).then(complete(1, "copied")).expect(s.feedback == "idle")
  run oldFailureCannotReplaceNewSuccessTest = init.then(copy(1)).then(copy(2))
    .then(complete(2, "copied")).then(complete(1, "failed")).expect(s.feedback == "copied")
  run oldSuccessCannotReplaceNewFailureTest = init.then(copy(1)).then(copy(2))
    .then(complete(2, "failed")).then(complete(1, "copied")).expect(s.feedback == "failed")
  run oldSuccessDoesNotEndNewPendingTest = init.then(copy(1)).then(copy(2))
    .then(complete(1, "copied")).expect(s.feedback == "idle")
  run currentSuccessExpiresTest = init.then(copy(1)).then(complete(1, "copied"))
    .then(expire(1)).expect(s.feedback == "idle")
  run oldTimerCannotClearNewSuccessTest = init.then(copy(1)).then(complete(1, "copied"))
    .then(copy(2)).then(complete(2, "copied")).then(expire(1)).expect(s.feedback == "copied")
  run identifierSuccessDoesNotExpireTest = init.then(persistentFeedback).then(copy(1))
    .then(complete(1, "copied")).then(expire(1).fail())
  run departedSuccessIsIgnoredTest = init.then(copy(1)).then(leave)
    .then(complete(1, "copied")).expect(s.feedback == "idle")
  run remountedValueDoesNotOwnOldResultTest = init.then(copy(1)).then(leave)
    .then(returnToView).then(copy(2)).then(complete(2, "failed"))
    .then(complete(1, "copied")).expect(s.feedback == "failed")
  run departedTimerDoesNotClearNewResultTest = init.then(copy(1)).then(complete(1, "copied"))
    .then(leave).then(returnToView).then(copy(2)).then(complete(2, "copied"))
    .then(expire(1)).expect(s.feedback == "copied")
}
