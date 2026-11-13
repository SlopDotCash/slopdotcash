// @source migrations/0002_slop_identity.sql
// @source migrations/0008_points.sql
// @source migrations/0108_identity_failed_callback.sql
/// OAuth/PKCE plus the explicitly separate loopback handoff.
// @source workers/identity/contracts.ts
// @source workers/identity/handler.ts
// @source workers/identity/persistence.ts
// @source workers/identity/crypto.ts
// @source backend/http.ts
module api_identity {
  var s: {phase: str, now: int, local: bool, pkce: bool, verified: bool, assertion: bool, consumed: int, assertionExpiry: int}
  action init = s' = {phase: "pending", now: 0, local: false, pkce: true, verified: false, assertion: false, consumed: 0, assertionExpiry: 0}
  action chooseLocal = all { s.phase == "pending", s' = s.with("local", true) }
  action callback = all { s.phase == "pending", s.now < 5, s' = s.with("phase", "processing").with("pkce", false) }
  action failCallback = all { s.phase == "processing", s' = s.with("phase", "failed") }
  action verify = all { s.phase == "processing", s.now < 5, s' = s.with("phase", "verified").with("verified", true) }
  action storeAssertion = all { s.phase == "verified", not(s.local), s.now < 5, s' = s.with("assertion", true).with("assertionExpiry", s.now + 1) }
  action issue = all { s.phase == "verified", s.now < 5, s.local or (s.assertion and s.now < s.assertionExpiry), s' = s.with("phase", "issued") }
  action consume(matchingAudience: bool): bool = all { matchingAudience, s.phase == "issued", not(s.local), s.assertion, s.now < s.assertionExpiry,
    s' = s.with("phase", "consumed").with("consumed", s.consumed + 1) }
  action tick = all { s.now < 6, s' = s.with("now", s.now + 1) }
  action step = any { chooseLocal, callback, failCallback, verify, storeAssertion, issue, consume(true), consume(false), tick, s' = s }
  val invariant = all { s.consumed <= 1, s.local implies not(s.assertion),
    s.phase != "pending" implies not(s.pkce), s.phase == "issued" implies s.verified,
    s.phase == "consumed" implies (s.assertion and not(s.local)) }
  run localHandoffTest = init.then(chooseLocal).then(callback).then(verify).then(issue).expect(not(s.assertion))
  run identityTest = init.then(callback).then(verify).then(storeAssertion).then(issue).then(consume(true)).expect(s.consumed == 1)
  run failedExchangeTest = init.then(callback).then(failCallback).expect(s.phase == "failed")
  run expiryDuringCallbackTest = init.then(callback).then(tick).then(tick).then(tick).then(tick).then(tick).expect(not(s.verified))
  // A claim that expires before completion is ended, not left processing.
  run expiredClaimFailsTest = init.then(callback).then(tick).then(tick).then(tick).then(tick).then(tick).then(failCallback).expect(s.phase == "failed" and not(s.verified))
}
