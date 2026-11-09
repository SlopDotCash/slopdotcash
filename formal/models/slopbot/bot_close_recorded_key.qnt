// @source workers/slopbot/review.ts
// @source workers/slopbot/close-attempts.ts
// @source workers/slopbot/persistence.ts
// @source migrations/0117_slopbot_close_attempts.sql
// One item and one close attempt. The review key is a digest of revision,
// policy, base, item text, verifier key and quality ids, so it can change
// after a close while the closed PR's head stays the same. Keys 1 and 2 stand
// for any two distinct digests; revision and author are held equal.
//
// The recorded attempt keeps its own review key. Recovery after a lost close
// response is bound to that recorded key, not to the key recomputed for the
// current item. The earlier guard `recordedKey == currentKey` made recovery
// unreachable after any key change: the attempt stayed pending, held a daily
// close slot forever and every retry threw (recoveryProgressProperty fails
// under that guard). A human close leaves Slopbot's attempt pending by design:
// a late request may still land after a reopen, so no outcome is inferred.
module bot_close_recorded_key {
  var s: { attempt: str, recordedKey: int, currentKey: int, github: str,
    sent: bool, review: str, penalties: int, keyChanges: int }
  action init = s' = { attempt: "none", recordedKey: 0, currentKey: 1, github: "open",
    sent: false, review: "none", penalties: 0, keyChanges: 0 }
  // The pending attempt carries the review key that reserved it.
  action reserve = all { s.attempt == "none", s.github == "open",
    s' = s.with("attempt", "pending").with("recordedKey", s.currentKey).with("review", "running") }
  // GitHub applies the close. A delivered response confirms in the same run;
  // a lost one fails the review and leaves the attempt pending.
  action send(lost: bool): bool = all { s.attempt == "pending", not(s.sent), s.github == "open",
    s' = if (lost) s.with("sent", true).with("github", "closedByApp").with("review", "failed")
      else s.with("sent", true).with("github", "closedByApp").with("attempt", "confirmed")
        .with("review", "completed").with("penalties", 1) }
  // 401/403/404/410/422/429 prove GitHub made no change.
  action refuse = all { s.attempt == "pending", not(s.sent), s.github == "open",
    s' = s.with("sent", true).with("attempt", "rejected").with("review", "failed") }
  // Policy, base branch or verifier inputs change; at most twice.
  action changeKey = all { s.keyChanges < 2,
    s' = s.with("currentKey", 3 - s.currentKey).with("keyChanges", s.keyChanges + 1) }
  action humanClose = all { s.github == "open", s' = s.with("github", "closedByHuman") }
  // While GitHub still shows the item open, an unknown request stays pending.
  action retryWhileOpen = all { s.attempt == "pending", s.github == "open", s' = s }
  // Recovery claims the recorded review key, confirms the fact, debits once
  // (INSERT OR IGNORE per item) and completes that review.
  val recoverEnabled = s.attempt == "pending" and s.github == "closedByApp" and s.review != "running"
  action recover = all { recoverEnabled,
    s' = s.with("attempt", "confirmed").with("review", "completed").with("penalties", 1) }
  // An attempt whose item a human closed stays pending; retries refuse.
  action retryHumanClosed = all { s.attempt == "pending", s.github == "closedByHuman", s' = s }
  action step = any { reserve, send(true), send(false), refuse, changeKey, humanClose,
    retryWhileOpen, recover, retryHumanClosed, s' = s }
  val invariant = all {
    s.attempt == "confirmed" implies (s.github == "closedByApp" and s.review == "completed"),
    s.penalties <= 1,
    s.penalties == 1 iff s.attempt == "confirmed",
    s.attempt == "rejected" implies s.github != "closedByApp",
    s.attempt != "none" implies s.recordedKey.in(Set(1, 2)),
    // A pending attempt on an app-closed item can always settle.
    (s.attempt == "pending" and s.github == "closedByApp") implies recoverEnabled,
  }
  // Scheduler fairness only: a queued retry eventually runs recovery. It does
  // not assume GitHub or provider success; the close already happened.
  temporal recoveryProgressProperty = recover.weakFair(s).implies(
    always((s.attempt == "pending" and s.github == "closedByApp")
      implies eventually(s.attempt == "confirmed")))
  run lostResponseRecoversUnderSameKeyTest = init.then(reserve).then(send(true)).then(recover)
    .expect(s.attempt == "confirmed" and s.penalties == 1 and s.recordedKey == s.currentKey)
  run lostResponseRecoversAfterKeyChangeTest = init.then(reserve).then(send(true)).then(changeKey)
    .then(recover)
    .expect(s.attempt == "confirmed" and s.review == "completed" and s.recordedKey == 1
      and s.currentKey == 2 and s.penalties == 1)
  run deliveredCloseCannotRecoverAgainTest = init.then(reserve).then(send(false)).then(changeKey)
    .then(recover.fail())
  run openItemKeepsUnknownAttemptPendingTest = init.then(reserve).then(retryWhileOpen)
    .expect(s.attempt == "pending").then(recover.fail())
  run humanCloseKeepsSlotPendingTest = init.then(reserve).then(humanClose).then(retryHumanClosed)
    .expect(s.attempt == "pending" and s.penalties == 0).then(recover.fail())
  run definitiveRefusalReleasesWithoutPenaltyTest = init.then(reserve).then(refuse)
    .expect(s.attempt == "rejected" and s.penalties == 0)
}
