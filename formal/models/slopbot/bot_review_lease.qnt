// @source migrations/0013_slopbot.sql
// @source migrations/0045_slopbot_review_leases.sql
// @source workers/slopbot/persistence.ts
// workers/slopbot/persistence.ts: startReview, ownsReviewClaim, finishReview.
// Three token generations and five clock instants represent renewal/expiry.
// Clock expiry grants no authority to an old worker, even before takeover.
// This single-item projection assumes admission capacity; the multi-item
// author cap and pending external closures are in bot_author_admission.
module bot_review_lease {
  var s: { status: str, token: int, now: int, expires: int,
    recordedToken: int, callMade: bool, retry: bool }
  action init = s' = { status: "absent", token: 0, now: 0, expires: 0,
    recordedToken: 0, callMade: false, retry: false }
  action start = all {
    any { s.status.in(Set("absent", "failed", "skipped")),
      s.status == "running" and s.now >= s.expires },
    s.token < 3, s.now < 4,
    s' = s.with("status", "running").with("token", s.token + 1)
      .with("expires", s.now + 1)
      .with("retry", s.callMade or s.status.in(Set("failed", "running"))),
  }
  action call = all { s.status == "running", s.now < s.expires,
    s' = s.with("callMade", true) }
  action finish(t, status) = all {
    s.status == "running", t == s.token, s.now < s.expires,
    status.in(Set("failed", "skipped", "completed")),
    s' = s.with("status", status).with("recordedToken", t),
  }
  action obsolete(t) = all {
    t != s.token or s.now >= s.expires or s.status != "running", s' = s,
  }
  action tick = all { s.now < 4, s' = s.with("now", s.now + 1) }
  action step = {
    nondet t = Set(0, 1, 2, 3).oneOf()
    nondet status = Set("failed", "skipped", "completed").oneOf()
    any { start, call, finish(t, status), obsolete(t), tick }
  }
  val invariant = all {
    s.recordedToken <= s.token,
    (s.status == "completed") implies s.recordedToken == s.token,
    (s.status == "absent") implies s.token == 0,
    s.token <= 3, s.now <= 4,
  }
  run expiredWorkerCannotFinishTest = init.then(start).then(tick).then(obsolete(1))
    .expect(s.status == "running" and s.recordedToken == 0)
  run takeoverFencesOldWorkerTest = init.then(start).then(call).then(tick)
    .then(start).then(obsolete(1)).then(finish(2, "completed"))
    .expect(s.status == "completed" and s.recordedToken == 2 and s.retry)
  run skippedBeforeInferenceIsNewTest = init.then(start).then(finish(1, "skipped"))
    .then(start).expect(not(s.retry))
  run failedCallIsRetryTest = init.then(start).then(call).then(finish(1, "failed"))
    .then(start).expect(s.retry)
}
