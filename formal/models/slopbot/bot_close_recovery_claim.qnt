// @source workers/slopbot/review.ts
// @source workers/slopbot/close-attempts.ts
// @source workers/slopbot/persistence.ts
// One delayed external close and two review-claim generations. Its immutable
// receipt can settle after lease loss; a stale worker cannot publish a comment
// or finish the successor's review. External comment delivery is abstracted.
module bot_close_recovery_claim {
  var s: {sent: bool, closed: bool, confirmed: bool, lateReply: bool,
    owner: int, live: bool, commentOwner: int, completedOwner: int}
  action init = s' = {sent: false, closed: false, confirmed: false, lateReply: false,
    owner: 1, live: true, commentOwner: 0, completedOwner: 0}
  action dispatch = all {s.owner == 1, s.live, not(s.sent), s' = s.with("sent", true)}
  action externalClose = all {s.sent, not(s.closed), s' = s.with("closed", true)}
  action expire = all {s.live, s.completedOwner == 0, s' = s.with("live", false)}
  action recoverClaim = all {s.closed, not(s.live), s.owner == 1,
    s' = s.with("owner", 2).with("live", true)}
  action confirmFact = all {s.closed, s' = s.with("confirmed", true)}
  action oldReply = all {s.closed, s' = s.with("lateReply", true).with("confirmed", true)}
  action comment(token) = all {s.confirmed, s.live, token == s.owner,
    s.completedOwner == 0, s' = s.with("commentOwner", token)}
  action finish(token) = all {s.confirmed, s.live, token == s.owner,
    s' = s.with("completedOwner", token)}
  action stalePublication(token) = all {token != s.owner or not(s.live), s' = s}
  action step = {nondet token = Set(1, 2).oneOf()
    any {dispatch, externalClose, expire, recoverClaim, confirmFact, oldReply,
      comment(token), finish(token), stalePublication(token), s' = s}}
  val invariant = all {s.confirmed implies s.closed,
    s.completedOwner == 2 implies s.owner == 2,
    s.owner == 2 and s.commentOwner == 2 implies s.confirmed}
  run lateOriginalResponseCannotPublishOverRecoveryTest = init.then(dispatch).then(externalClose)
    .then(expire).then(recoverClaim).then(confirmFact).then(comment(2)).then(finish(2))
    .then(oldReply).then(stalePublication(1))
    .expect(s.commentOwner == 2 and s.completedOwner == 2 and s.confirmed)
  run knownExternalFactSurvivesLeaseExpiryTest = init.then(dispatch).then(externalClose)
    .then(expire).then(oldReply).expect(s.confirmed and s.commentOwner == 0 and not(s.live))
}
