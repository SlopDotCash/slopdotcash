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
//
// review.ts writes a close in separate steps: confirmClose, then
// recordPenalty (only when penalty_eligible), then the comment and
// finishReview. A throw or crash between them (a comment or notification
// failure) leaves the attempt confirmed and the review failed, possibly
// without a penalty row. unfinishedClose selects such a confirmed attempt
// whose review is not completed, and recovery repeats the same steps; the
// penalty insert is idempotent per item. `progress` is the step the running
// review reached; at most two failures after a reservation are modeled.
module bot_close_recorded_key {
  var s: { attempt: str, recordedKey: int, currentKey: int, github: str,
    sent: bool, review: str, progress: str, eligible: bool, penalties: int,
    keyChanges: int, fails: int }
  action init = s' = { attempt: "none", recordedKey: 0, currentKey: 1, github: "open",
    sent: false, review: "none", progress: "none", eligible: false, penalties: 0,
    keyChanges: 0, fails: 0 }
  // The pending attempt carries the review key that reserved it and whether
  // the close debits the author (penalty_eligible).
  action reserve(eligible: bool): bool = all { s.attempt == "none", s.github == "open",
    s' = s.with("attempt", "pending").with("recordedKey", s.currentKey).with("review", "running")
      .with("eligible", eligible) }
  // GitHub applies the close. A delivered response continues the same run;
  // a lost one fails the review and leaves the attempt pending.
  action send(lost: bool): bool = all { s.attempt == "pending", not(s.sent), s.github == "open",
    s.review == "running",
    s' = if (lost) s.with("sent", true).with("github", "closedByApp").with("review", "failed")
      else s.with("sent", true).with("github", "closedByApp").with("progress", "closed") }
  // confirmClose (idempotent for an already confirmed attempt).
  action confirm = all { s.review == "running", s.progress == "closed",
    s.attempt.in(Set("pending", "confirmed")), s.github == "closedByApp",
    s' = s.with("attempt", "confirmed").with("progress", "confirmed") }
  // recordPenalty: INSERT OR IGNORE per item, only when eligible.
  action penalize = all { s.review == "running", s.progress == "confirmed",
    s.attempt == "confirmed",
    s' = s.with("penalties", if (s.eligible) 1 else s.penalties).with("progress", "penalized") }
  // Comment, notification and finishReview.
  action complete = all { s.review == "running", s.progress == "penalized",
    s' = s.with("review", "completed").with("progress", "none") }
  // A throw or crash after the close request, before finishReview.
  action crash = all { s.review == "running", s.progress != "none", s.fails < 2,
    s' = s.with("review", "failed").with("progress", "none").with("fails", s.fails + 1) }
  // 401/403/404/410/422/429 prove GitHub made no change.
  action refuse = all { s.attempt == "pending", not(s.sent), s.github == "open",
    s' = s.with("sent", true).with("attempt", "rejected").with("review", "failed") }
  // Policy, base branch or verifier inputs change; at most twice.
  action changeKey = all { s.keyChanges < 2,
    s' = s.with("currentKey", 3 - s.currentKey).with("keyChanges", s.keyChanges + 1) }
  action humanClose = all { s.github == "open", s' = s.with("github", "closedByHuman") }
  // While GitHub still shows the item open, an unknown request stays pending.
  action retryWhileOpen = all { s.attempt == "pending", s.github == "open", s' = s }
  // Recovery claims the recorded review key and repeats confirm, penalty and
  // completion for a pending attempt, or for a confirmed one whose review
  // did not complete.
  val unfinished = (s.attempt == "pending" or (s.attempt == "confirmed" and s.review != "completed"))
    and s.github == "closedByApp"
  val recoverEnabled = unfinished and s.review != "running"
  action recover = all { recoverEnabled,
    s' = s.with("review", "running").with("progress", "closed") }
  // An attempt whose item a human closed stays pending; retries refuse.
  action retryHumanClosed = all { s.attempt == "pending", s.github == "closedByHuman", s' = s }
  action step = any { reserve(true), reserve(false), send(true), send(false), confirm, penalize,
    complete, crash, refuse, changeKey, humanClose, retryWhileOpen, recover, retryHumanClosed,
    s' = s }
  val invariant = all {
    s.attempt == "confirmed" implies s.github == "closedByApp",
    s.penalties <= 1,
    s.penalties == 1 implies (s.attempt == "confirmed" and s.eligible),
    // A completed confirmed close carries its debit exactly when eligible.
    (s.attempt == "confirmed" and s.review == "completed")
      implies s.penalties == (if (s.eligible) 1 else 0),
    s.attempt == "rejected" implies s.github != "closedByApp",
    s.attempt != "none" implies s.recordedKey.in(Set(1, 2)),
    s.progress != "none" implies s.review == "running",
    // An unfinished app close was actually sent and still holds the key that
    // reserved it, whatever the current key is. Recovery reaching completion
    // is checked by recoveryProgressProperty.
    unfinished implies (s.sent and s.recordedKey.in(Set(1, 2))
      and s.penalties <= (if (s.eligible) 1 else 0)),
  }
  // Scheduler fairness only: a queued retry eventually runs recovery and its
  // D1 steps. It does not assume GitHub or provider success (the close
  // already happened); failures are bounded by `fails`.
  temporal recoveryProgressProperty = (recover.weakFair(s) and confirm.weakFair(s)
    and penalize.weakFair(s) and complete.weakFair(s)).implies(
    always(unfinished implies eventually(s.attempt == "confirmed" and s.review == "completed")))
  run lostResponseRecoversUnderSameKeyTest = init.then(reserve(true)).then(send(true))
    .then(recover).then(confirm).then(penalize).then(complete)
    .expect(s.attempt == "confirmed" and s.penalties == 1 and s.recordedKey == s.currentKey)
  run lostResponseRecoversAfterKeyChangeTest = init.then(reserve(true)).then(send(true))
    .then(changeKey).then(recover).then(confirm).then(penalize).then(complete)
    .expect(s.attempt == "confirmed" and s.review == "completed" and s.recordedKey == 1
      and s.currentKey == 2 and s.penalties == 1)
  run deliveredCloseCannotRecoverAgainTest = init.then(reserve(true)).then(send(false))
    .then(confirm).then(penalize).then(complete).then(changeKey).then(recover.fail())
  // The close is confirmed, then the comment fails before the review
  // completes (with or without the penalty row); recovery finishes it once.
  run confirmedCloseFailedBeforeCommentRecoversTest = init.then(reserve(true)).then(send(false))
    .then(confirm).then(crash).then(recover).then(confirm).then(penalize).then(complete)
    .expect(s.attempt == "confirmed" and s.review == "completed" and s.penalties == 1)
  run penalizedCloseFailedBeforeFinishRecoversTest = init.then(reserve(true)).then(send(false))
    .then(confirm).then(penalize).then(crash).then(recover).then(confirm).then(penalize)
    .then(complete).expect(s.review == "completed" and s.penalties == 1)
  run ineligibleCloseRecordsNoDebitTest = init.then(reserve(false)).then(send(false))
    .then(confirm).then(penalize).then(complete)
    .expect(s.attempt == "confirmed" and s.penalties == 0)
  run openItemKeepsUnknownAttemptPendingTest = init.then(reserve(true)).then(retryWhileOpen)
    .expect(s.attempt == "pending").then(recover.fail())
  run humanCloseKeepsSlotPendingTest = init.then(reserve(true)).then(humanClose)
    .then(retryHumanClosed).expect(s.attempt == "pending" and s.penalties == 0)
    .then(recover.fail())
  run definitiveRefusalReleasesWithoutPenaltyTest = init.then(reserve(true)).then(refuse)
    .expect(s.attempt == "rejected" and s.penalties == 0)
}
