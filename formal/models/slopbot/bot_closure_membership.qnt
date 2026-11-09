// @source workers/slopbot/closure-eligibility.ts
// @source backend/points/handler.ts
// @source workers/slopbot/routing.ts
// Account closure ends closure authority; recorded participation still permits
// advisory review under the participants audience. No advisory review can debit.
module bot_closure_membership {
  var s: { account: str, enrolled: bool, recordedRun: bool, maintainer: bool,
    pr: bool, authorizedAtDecision: bool, decision: str, advisory: bool }
  action init = s' = { account: "active", recordedRun: true, maintainer: false,
    enrolled: true, pr: true, authorizedAtDecision: false, decision: "none", advisory: false }
  val eligible = s.account == "active" and s.recordedRun and not(s.maintainer) and s.pr
  action closeAccount = s' = s.with("account", "closed")
  action reopenExplicitly = s' = s.with("account", "active")
  action authority(maintainer, pr) = s' = s.with("maintainer", maintainer).with("pr", pr)
  action evaluate = s' = s.with("authorizedAtDecision", eligible)
    .with("decision", if (eligible) "allowed" else "denied").with("advisory", s.enrolled)
  action step = {
    nondet maintainer = Set(false, true).oneOf()
    nondet pr = Set(false, true).oneOf()
    any { closeAccount, reopenExplicitly, authority(maintainer, pr), evaluate }
  }
  val invariant = all {
    s.recordedRun, s.enrolled,
    (s.decision == "allowed") implies s.authorizedAtDecision,
    (s.account == "closed") implies not(eligible),
  }
  run closedMembershipTest = init.then(closeAccount).then(evaluate)
    .expect(s.decision == "denied" and s.recordedRun and s.advisory)
  run maintainerExcludedTest = init.then(authority(true, true)).then(evaluate)
    .expect(s.decision == "denied")
  run explicitReopenTest = init.then(closeAccount).then(evaluate).then(reopenExplicitly)
    .then(evaluate).expect(s.decision == "allowed")
}
