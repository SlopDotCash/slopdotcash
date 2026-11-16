// @source src/OwnerVaultSetup.tsx
// @evidence tests/e2e/vault-actions.spec.ts
// One saved vault creation and the checks that ask the server to register it.
// A timer asks only for a saved hash the owner is not editing, while no owner
// action runs. The check is a server request and opens no wallet prompt. The server alone decides: it registers a
// finalized matching creation, answers "pending" before finality, and refuses a
// failed or unrelated one. A refusal is shown; a failed creation or three
// refusals in a row stop the timer, and so does a refusal the owner saw from
// the button. An owner action retires an automatic check in flight, never the
// reverse. Abstracted: four automatic attempts stand for the source's 120; the
// server's verification is one answer per request.
module ui_vault_auto_register {
  var s: { saved: bool, editing: bool, chain: str, kind: str, busy: bool, inflight: str,
    retired: bool, attempts: int, errors: int, stopped: bool, error: bool,
    registered: bool }
  pure val LIMIT = 4
  pure val ERRORS = 3
  // kind: "good" matches the request, "reverted" failed on chain, "unrelated" is another transaction.
  action start(kind: str): bool = s' = { saved: true, editing: false, chain: "included", kind: kind,
    busy: false, inflight: "none", retired: false, attempts: 0, errors: 0, stopped: false,
    error: false, registered: false }
  action init = any { start("good"), start("reverted"), start("unrelated") }
  action finalize = all { s.chain == "included", s' = s.with("chain", "final") }
  action edit = all { s.saved, not(s.busy), not(s.registered),
    s' = s.with("editing", true).with("retired", s.inflight == "auto") }
  action restore = all { s.editing, s' = s.with("editing", false) }
  action autoAsk = all { s.saved, not(s.editing), not(s.busy), not(s.registered), not(s.stopped),
    s.inflight == "none", s.attempts < LIMIT,
    s' = s.with("inflight", "auto").with("retired", false).with("attempts", s.attempts + 1) }
  action ownerAsk = all { s.saved, not(s.editing), not(s.busy), not(s.registered),
    s.inflight != "manual",
    s' = s.with("inflight", "manual").with("busy", true).with("error", false)
      .with("retired", s.inflight == "auto") }
  val answer = if (s.kind == "unrelated") "refused"
    else if (s.chain != "final") "pending"
    else if (s.kind == "reverted") "failed" else "registered"
  // An automatic answer that an owner action retired changes nothing on screen.
  action autoAnswer = all { s.inflight == "auto",
    if (s.retired) s' = s.with("inflight", "none").with("retired", false)
    else if (answer == "registered")
      s' = s.with("inflight", "none").with("registered", true).with("saved", false).with("error", false)
    else if (answer == "pending")
      s' = s.with("inflight", "none").with("error", false).with("errors", 0)
    else s' = s.with("inflight", "none").with("error", true).with("errors", s.errors + 1)
      .with("stopped", answer == "failed" or s.errors + 1 >= ERRORS) }
  action ownerAnswer = all { s.inflight == "manual",
    if (answer == "registered")
      s' = s.with("inflight", "none").with("busy", false).with("registered", true).with("saved", false)
    else if (answer == "pending") s' = s.with("inflight", "none").with("busy", false)
    else s' = s.with("inflight", "none").with("busy", false).with("error", true).with("stopped", true) }
  action step = any { finalize, edit, restore, autoAsk, ownerAsk, autoAnswer, ownerAnswer, s' = s }
  val invariant = all {
    s.registered implies (s.chain == "final" and s.kind == "good" and not(s.saved)),
    s.inflight == "auto" implies not(s.busy),
    s.busy implies s.inflight == "manual",
    s.attempts <= LIMIT,
    s.errors <= ERRORS,
    (s.kind == "good" and s.error) implies false
  }
  run registersWithoutClickTest = start("good").then(autoAsk).then(autoAnswer)
    .expect(not(s.registered) and s.saved and not(s.error))
    .then(finalize).then(autoAsk).then(autoAnswer).expect(s.registered and s.attempts == 2)
  run failedCreationStopsTest = start("reverted").then(finalize).then(autoAsk).then(autoAnswer)
    .expect(s.error and s.stopped and not(s.registered))
  run repeatedRefusalStopsTest = start("unrelated").then(autoAsk).then(autoAnswer)
    .then(autoAsk).then(autoAnswer).expect(s.error and not(s.stopped))
    .then(autoAsk).then(autoAnswer).expect(s.stopped and s.errors == ERRORS)
  run ownerRefusalStopsTimerTest = start("unrelated").then(ownerAsk).then(ownerAnswer)
    .expect(s.error and s.stopped and s.attempts == 0)
  run editingRetiresAutomaticAnswerTest = start("good").then(finalize).then(autoAsk).then(edit)
    .then(autoAnswer).expect(not(s.registered) and s.saved)
  run attemptLimitTest = start("good").then(autoAsk).then(autoAnswer).then(autoAsk).then(autoAnswer)
    .then(autoAsk).then(autoAnswer).then(autoAsk).then(autoAnswer)
    .expect(s.attempts == LIMIT and s.saved and not(s.registered))
    .then(finalize).then(ownerAsk).then(ownerAnswer).expect(s.registered)
}
