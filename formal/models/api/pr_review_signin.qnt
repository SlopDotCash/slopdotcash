// @source workers/identity/handler.ts
// One OAuth flow, three logical time units. Decryption/identity outcomes are
// nondeterministic; cryptography and provider behavior are external assumptions.
module signin {
  var s: { phase: str, now: int, pkce: bool, resolved: bool, verified: bool }
  action init = s' = {phase: "pending", now: 0, pkce: true, resolved: false, verified: false}
  action claim = all { s.phase == "pending", s.now < 3,
    s' = s.with("phase", "processing").with("pkce", false) }
  action resolve(ok: bool): bool = all { s.phase == "processing", s.now < 3,
    s' = s.with("resolved", true).with("verified", ok)
      .with("phase", if(ok) "complete" else "failed") }
  action tick = all { s.now < 3, s' = s.with("now", s.now + 1) }
  action expire = all { s.now == 3, Set("pending", "processing").contains(s.phase),
    s' = s.with("phase", "expired").with("pkce", false) }
  action step = any {claim, resolve(true), resolve(false), tick, expire, s' = s}
  val poll = if (Set("failed", "expired").contains(s.phase) or s.now == 3) 410
    else if (s.phase == "complete") 200 else 202
  val invariant = all { s.now >= 0 and s.now <= 3,
    s.phase != "pending" implies not(s.pkce),
    s.resolved implies Set("complete", "failed").contains(s.phase),
    s.phase == "complete" iff s.verified,
    s.phase == "failed" implies poll == 410 }
  run decryptFailureTest = init.then(claim).then(resolve(false))
    .expect(s.phase == "failed" and poll == 410 and not(s.pkce))
  run completeTest = init.then(claim).then(resolve(true)).expect(poll == 200)
  run expireTest = init.then(claim).then(tick).then(tick).then(tick)
    .then(expire).expect(poll == 410)
}
