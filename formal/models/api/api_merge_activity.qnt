// @source backend/projects/merge-activity.ts
// @source src/lib/merge-activity.ts
// @source migrations/0125_repository_merge_activity.sql
// Daily merge activity per repository (#1993). A row is published only after a
// successful read; a failed read keeps the last values and their date, never
// zeros; a fresh row is not read again before the refresh interval.
module api_merge_activity {
  var s: {now: int, observedAt: int, attemptedAt: int, waiting: int, failed: bool, published: bool, shownWaiting: int}
  action init = s' = {now: 0, observedAt: -1, attemptedAt: -1, waiting: 0, failed: false, published: false, shownWaiting: -1}
  val due = s.attemptedAt < 0 or (if (s.failed) s.now - s.attemptedAt >= 1 else s.now - s.attemptedAt >= 2)
  action success(w: int): bool = all { due, s' = s.with("observedAt", s.now).with("attemptedAt", s.now).with("waiting", w).with("failed", false).with("published", true) }
  action failure = all { due, s' = s.with("attemptedAt", s.now).with("failed", true) }
  action tick = all { s.now < 5, s' = s.with("now", s.now + 1) }
  action serve = s' = s.with("shownWaiting", if (s.published) s.waiting else -1)
  action step = any { nondet w = 0.to(3).oneOf() success(w), failure, tick, serve }
  val invariant = all {
    s.published implies s.observedAt >= 0,
    s.shownWaiting >= 0 implies s.published,
    s.observedAt <= s.attemptedAt
  }
  run neverReadIsNotPublishedTest = init.then(failure).then(serve).expect(s.shownWaiting == -1 and invariant)
  run failureKeepsValuesTest = init.then(success(3)).then(tick).then(tick).then(failure).then(serve).expect(s.shownWaiting == 3 and s.failed and invariant)
  run freshRowIsNotDueTest = init.then(success(1)).then(tick).expect(not(due))
}
