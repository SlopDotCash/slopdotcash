// @source workers/slopbot/submission-evidence.ts
// @source workers/slopbot/review.ts
// @source workers/slopbot/contracts.ts
// @source workers/slopbot/penalties.ts
// One PR with a bounded set of source versions. Eligibility abstracts
// the project, author, and repository closure controls.
module bot_submission_evidence {
  type Source = { footer: bool, policy: bool, missing: bool, revision: int }
  var s: { current: Source, reviewed: Source, eligible: bool,
    enabled: bool, closed: bool, authorizedAtClose: bool }
  action init = s' = {
    current: { footer: true, policy: true, missing: true, revision: 1 },
    reviewed: { footer: false, policy: false, missing: false, revision: 0 },
    eligible: true, enabled: false, closed: false, authorizedAtClose: false,
  }
  pure def finding(source: Source): bool = source.footer and source.policy and source.missing
  action observe = s' = s.with("reviewed", s.current)
  action change(footer: bool, policy: bool, missing: bool, revision: int): bool =
    s' = s.with("current", { footer: footer, policy: policy, missing: missing, revision: revision })
  action controls(activation: bool, eligible: bool): bool =
    s' = s.with("enabled", activation).with("eligible", eligible)
  val authorized =
    s.enabled and s.eligible and finding(s.reviewed) and s.reviewed == s.current
  action close = all {
    not(s.closed), authorized,
    s' = s.with("closed", true).with("authorizedAtClose", authorized),
  }
  action step = {
    nondet flag = Set(true, false).oneOf()
    nondet second = Set(true, false).oneOf()
    nondet third = Set(true, false).oneOf()
    nondet revision = Set(1, 2).oneOf()
    any { observe, change(flag, second, third, revision), controls(flag, second), close, s' = s }
  }
  val invariant = s.closed implies s.authorizedAtClose
  run missingFieldsCanCloseTest =
    init.then(controls(true, true)).then(observe).then(close).expect(s.closed)
  run evidenceAddedBeforeCloseTest =
    init.then(controls(true, true)).then(observe).then(change(true, true, false, 2))
      .expect(not(s.closed)).then(close.fail())
  run unsignedCannotCloseTest =
    init.then(controls(true, true)).then(change(false, true, true, 1)).then(observe)
      .expect(not(s.closed)).then(close.fail())
  run optOutCannotCloseTest =
    init.then(controls(true, true)).then(observe).then(controls(true, false))
      .expect(not(s.closed)).then(close.fail())
}
