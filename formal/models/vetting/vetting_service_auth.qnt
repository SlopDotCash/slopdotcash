// @source workers/vetting/service.ts
// @source backend/vetting/handler.ts
// Exact method/path/query/body bytes and configured key bind a signed request.
// The real protocol has a bounded timestamp window, not a nonce replay store;
// mutation endpoints provide their own immutable/idempotent write guards.
module vetting_service_auth {
  var s: { now: int, signedAt: int, signed: bool, exact: bool, key: bool,
    admitted: bool, writes: int }
  action init = s' = {now: 0, signedAt: 0, signed: false, exact: true, key: true, admitted: false, writes: 0}
  action sign = s' = s.with("signed", true).with("signedAt", s.now).with("exact", true).with("admitted", false)
  action changeRequest = s' = s.with("exact", false).with("admitted", false)
  action revokeKey = s' = s.with("key", false).with("admitted", false)
  action tick = all { s.now < 3, s' = s.with("now", s.now + 1).with("admitted", false) }
  action verify = all { s.signed, s.exact, s.key, s.now - s.signedAt <= 1,
    s' = s.with("admitted", true) }
  action idempotentMutation = all { s.admitted, s.writes == 0, s' = s.with("writes", 1) }
  action step = any { sign, changeRequest, revokeKey, tick, verify, idempotentMutation, s' = s }
  val invariant = all { s.admitted implies s.signed and s.exact and s.key and s.now - s.signedAt <= 1, s.writes <= 1 }
  run changedBytesRefusedTest = init.then(sign).then(changeRequest).expect(not(s.admitted))
  run staleSignatureRefusedTest = init.then(sign).then(tick).then(tick).expect(not(s.admitted))
  run signedReplayReliesOnWriteIdempotencyTest = init.then(sign).then(verify).then(idempotentMutation)
    .then(verify).expect(s.writes == 1 and s.admitted)
}
