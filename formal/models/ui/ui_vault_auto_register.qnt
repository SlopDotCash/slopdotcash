// @source src/OwnerVaultSetup.tsx
// @source src/lib/vault-auto-register.ts
// @evidence tests/e2e/vault-actions.spec.ts
// @evidence scripts/vault-auto-register.test.ts
// One saved vault creation and the checks that ask the server to register it.
// A timer asks only for a saved hash the owner is not editing, while no owner
// action runs. The check is a server request and opens no wallet prompt. The server alone decides: it registers a
// finalized matching creation, answers "pending" before finality, and refuses a
// failed or unrelated one. A refusal is shown; a failed creation or three
// refusals in a row stop the timer, and so does a refusal the owner saw from
// the button. An owner action retires an automatic check in flight, never the
// reverse. A background tab keeps asking on its own limit and spends no
// attempt, so switching tabs does not leave the vault unrecorded; past that
// limit it waits until the tab is shown. Abstracted: four automatic attempts
// stand for the source's 120 and two background asks for its 120; the server's
// verification is one answer per request.
module ui_vault_auto_register {
  var s: { saved: bool, editing: bool, chain: str, kind: str, busy: bool, inflight: str,
    retired: bool, attempts: int, errors: int, stopped: bool, error: bool,
    registered: bool, hidden: bool, hiddenAsks: int }
  pure val LIMIT = 4
  pure val HIDDEN_LIMIT = 2
  pure val ERRORS = 3
  // kind: "good" matches the request, "reverted" failed on chain, "unrelated" is another transaction.
  action start(kind: str): bool = s' = { saved: true, editing: false, chain: "included", kind: kind,
    busy: false, inflight: "none", retired: false, attempts: 0, errors: 0, stopped: false,
    error: false, registered: false, hidden: false, hiddenAsks: 0 }
  action init = any { start("good"), start("reverted"), start("unrelated") }
  action finalize = all { s.chain == "included", s' = s.with("chain", "final") }
  action edit = all { s.saved, not(s.busy), not(s.registered),
    s' = s.with("editing", true).with("retired", s.inflight == "auto") }
  action restore = all { s.editing, s' = s.with("editing", false) }
  action hide = all { not(s.hidden), s' = s.with("hidden", true) }
  action show = all { s.hidden, s' = s.with("hidden", false) }
  action autoAsk = all { s.saved, not(s.editing), not(s.busy), not(s.registered), not(s.stopped),
    s.inflight == "none", s.attempts < LIMIT, not(s.hidden) or s.hiddenAsks < HIDDEN_LIMIT,
    s' = if (s.hidden)
        s.with("inflight", "auto").with("retired", false).with("hiddenAsks", s.hiddenAsks + 1)
      else s.with("inflight", "auto").with("retired", false).with("attempts", s.attempts + 1) }
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
  action step = any { finalize, edit, restore, hide, show, autoAsk, ownerAsk, autoAnswer,
    ownerAnswer, s' = s }
  val invariant = all {
    s.registered implies (s.chain == "final" and s.kind == "good" and not(s.saved)),
    s.inflight == "auto" implies not(s.busy),
    s.busy implies s.inflight == "manual",
    s.attempts <= LIMIT,
    s.hiddenAsks <= HIDDEN_LIMIT,
    s.errors <= ERRORS,
    (s.kind == "good" and s.error) implies false
  }
  run registersWithoutClickTest = start("good").then(autoAsk).then(autoAnswer)
    .expect(not(s.registered) and s.saved and not(s.error))
    .then(finalize).then(autoAsk).then(autoAnswer).expect(s.registered and s.attempts == 2)
  run backgroundTabRegistersTest = start("good").then(hide).then(autoAsk).then(autoAnswer)
    .expect(not(s.registered) and s.saved).then(finalize).then(autoAsk).then(autoAnswer)
    .expect(s.registered and s.attempts == 0 and s.hiddenAsks == 2)
  run backgroundLimitWaitsForTabTest = start("good").then(hide).then(autoAsk).then(autoAnswer)
    .then(autoAsk).then(autoAnswer).expect(s.hiddenAsks == HIDDEN_LIMIT and not(s.registered))
    .then(finalize).then(show).then(autoAsk).then(autoAnswer)
    .expect(s.registered and s.attempts == 1)
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
