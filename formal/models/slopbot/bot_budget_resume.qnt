// @source workers/slopbot/budget-blocks.ts
// @source migrations/0048_slopbot_budget_blocks.sql
// Queue-before-checkpoint retry. Expired claim or lost installation prevents
// selection; an unknown queue outcome can duplicate dispatch, never a review.
module bot_budget_resume {
  var s: { now: int, due: int, claim: int, blockClaim: int, installed: bool,
    dispatch: bool, sends: int }
  action init = s' = {now: 0, due: 1, claim: 1, blockClaim: 1, installed: true, dispatch: false, sends: 0}
  action tick = all { s.now < 2, s' = s.with("now", s.now + 1) }
  action nextClaim = all { s.claim == 1, s' = s.with("claim", 2) }
  action remove = s' = s.with("installed", false)
  action send = all { s.now >= s.due, s.claim == s.blockClaim, s.installed,
    not(s.dispatch), s.sends < 2, s' = s.with("sends", s.sends + 1) }
  action checkpoint = all { s.sends > 0, s' = s.with("dispatch", true) }
  action step = any { tick, nextClaim, remove, send, checkpoint, s' = s }
  val invariant = all { s.sends <= 2, s.dispatch implies s.sends > 0 }
  run queueLostResponseRetriedTest = init.then(tick).then(send).then(send).then(checkpoint)
    .expect(s.sends == 2 and s.dispatch)
  run oldClaimCannotResumeTest = init.then(tick).then(nextClaim).expect(s.claim != s.blockClaim and s.sends == 0)
}
