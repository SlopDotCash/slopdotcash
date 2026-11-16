// @source src/lib/referral-claims.ts
// Cached eligibility and Merkle proof precede a fresh wallet/RPC review. Sending
// repeats the review and account check. An ambiguous send is never auto-retried.
module referral_claim_review {
  type S = { current: bool, paused: bool, account: bool, code: bool, root: int,
    cachedRoot: int, amountMatches: bool, reviewed: bool, durable: bool, phase: str }
  var s: S
  action init = s' = { current: true, paused: false, account: true, code: true, root: 1,
    cachedRoot: 1, amountMatches: true, reviewed: false, durable: false, phase: "idle" }
  val eligible = s.current and not(s.paused) and s.account and s.code and s.root == s.cachedRoot and s.amountMatches
  action review = all { s.phase == "idle", eligible, s' = s.with("reviewed", true) }
  action stale = s' = s.with("current", false)
  action rootChanged = s' = s.with("root", 2)
  action accountChanged = s' = s.with("account", false)
  action amountChanged = s' = s.with("amountMatches", false)
  action send = all { s.phase == "idle", s.reviewed, eligible,
    s' = s.with("durable", true).with("phase", "requesting") }
  action response(hash: bool): bool = all { s.phase == "requesting", s' = s.with("phase", if(hash) "submitted" else "unknown") }
  action step = any { review, stale, rootChanged, accountChanged, amountChanged, send, response(true), response(false), s' = s }
  val invariant = s.phase != "idle" implies s.durable
  run refreshedRootRefusedTest = init.then(review).then(rootChanged).then(send.fail())
  run changedAmountRefusedTest = init.then(review).then(amountChanged).then(send.fail())
  run unknownSendNotRetriedTest = init.then(review).then(send).then(response(false)).then(send.fail())
  run reviewedClaimTest = init.then(review).then(send).then(response(true)).expect(s.phase == "submitted" and invariant)
}
