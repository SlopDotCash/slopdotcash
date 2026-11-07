// @source migrations/0060_slopbot_maintainer_holds.sql
// @source migrations/0093_slopbot_reopen_source.sql
// @source workers/slopbot/review.ts
// @source workers/slopbot/maintainer-holds.ts
// @source workers/slopbot/reopen-source.ts
// @source workers/slopbot/closure-eligibility.ts
// One immutable PR revision. Global activation and member eligibility are
// observations, never derived from a pasted attribution marker or model text.
module bot_moderation {
  var s: { verdict: str, phase: str, qualified: bool, consent: bool,
    member: bool, exempt: bool, assigned: bool, reopened: bool,
    due: bool, closed: bool, debited: bool, label: bool }
  action init = s' = { verdict: "none", phase: "new", qualified: false,
    consent: false, member: false, exempt: false, assigned: false,
    reopened: false, due: false, closed: false, debited: false, label: false }
  action policy(qualified, consent, member, exempt, assigned) = all {
    s.phase == "new",
    s' = s.with("qualified", qualified).with("consent", consent)
      .with("member", member).with("exempt", exempt).with("assigned", assigned),
  }
  action review(verdict) = all {
    s.phase == "new", verdict.in(Set("clean", "uncertain", "confirmed")),
    s' = s.with("verdict", verdict).with("phase", if (verdict == "uncertain") "hold" else "reviewed"),
  }
  action deadline = all { s.phase == "hold", s' = s.with("due", true) }
  action uncertainLabel = all { s.phase == "hold", s.due, not(s.reopened),
    s' = s.with("phase", "complete").with("label", true) }
  val mayClose = s.verdict == "confirmed" and s.qualified and s.consent
    and s.member and not(s.exempt) and not(s.assigned) and not(s.reopened)
  action closeConfirmedByGithub = all {
    s.phase == "reviewed", mayClose, s' = s.with("closed", true).with("phase", "closed"),
  }
  action debit = all { s.phase == "closed", s.closed, not(s.reopened),
    s' = s.with("debited", true) }
  action maintainerReopen = s' = s.with("reopened", true).with("closed", false)
    .with("debited", false).with("phase", "complete")
  action step = {
    nondet qualified = Set(false, true).oneOf()
    nondet consent = Set(false, true).oneOf()
    nondet member = Set(false, true).oneOf()
    nondet exempt = Set(false, true).oneOf()
    nondet assigned = Set(false, true).oneOf()
    nondet verdict = Set("clean", "uncertain", "confirmed").oneOf()
    any { policy(qualified, consent, member, exempt, assigned), review(verdict),
      deadline, uncertainLabel, closeConfirmedByGithub, debit, maintainerReopen }
  }
  val invariant = all {
    s.closed implies mayClose,
    s.debited implies s.closed,
    s.verdict == "uncertain" implies not(s.closed),
    s.reopened implies not(s.closed),
  }
  run uncertainNeverClosesTest = init.then(policy(true, true, true, false, false))
    .then(review("uncertain")).then(deadline).then(uncertainLabel)
    .expect(s.label and not(s.closed) and not(s.debited))
  run qualifiedClosureTest = init.then(policy(true, true, true, false, false))
    .then(review("confirmed")).then(closeConfirmedByGithub).then(debit)
    .then(maintainerReopen).expect(not(s.closed) and not(s.debited))
  run absentConsentTest = init.then(policy(true, false, true, false, false))
    .then(review("confirmed")).expect(not(mayClose))
}
