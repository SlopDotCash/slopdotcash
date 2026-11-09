// @source migrations/0026_private_security_cases.sql
// @source migrations/0028_security_case_related_party.sql
// @source migrations/0061_security_automatic_intake.sql
// @source backend/security/handler.ts
// @source backend/security/analysis.ts
// @source backend/security/report-analysis.ts
// @source backend/security/project-access.ts
// @source backend/security/award-asset.ts
// @source backend/security/case-store.ts
// @evidence backend/security/handler.test.ts
// Private case decision lifecycle (PRD section 8, SEC-04, SEC-10, SEC-12,
// SEC-18): technical decision, discretionary award, related-party review,
// appeal and its independent uphold/return, remediation and disclosure.
// Receipt states follow planDecision/planChange; an appeal is open exactly
// while the receipt is "disputed" and remembers `from` (appeal_from_state).
// Appealable: a duplicate, out-of-scope or rejected finding, or a confirmed
// finding whose award is ineligible or capacity-exhausted (allowedActions).
// Uphold restores `from`; return reopens triage and turns only a refusal
// (ineligible) back into pending, so a capacity wait survives.
// Independence (priorCaseDecider): an appeal or related-party reviewer never
// made a decide, award, related-party or appeal decision on this case; the
// journal keeps every earlier decider. `reviews` records each related-party
// and appeal decision with the deciders before it; the invariant checks every
// recorded reviewer against them, and the *MustBeIndependent and
// *CannotDecideAppeal scenarios show each refusal. Paid terms are assumed present; funding
// shortfall is the nondeterministic `short` award. Bounds: three human actors,
// three technical decisions, two appeals. Roles and CAS are refined by
// api_private_case_roles and api_private_case_transaction.
module api_private_case {
  type Case = { receipt: str, award: str, related: bool, relatedReview: str,
    appeal: str, from: str, deciders: Set[int], decisions: int, appeals: int,
    reviews: Set[(int, Set[int])], remediation: str, redaction: int, disclosed: int }
  var s: Case
  val actors = Set(1, 2, 3)
  val openReceipt = Set("received", "needs-information", "triaging")
  val refusals = Set("duplicate", "out-of-scope", "rejected")
  val awardOpen = s.receipt == "confirmed" and s.appeal != "open" and s.relatedReview != "pending"
    and Set("pending", "capacity-exhausted").contains(s.award)
  val appealable = s.appeal != "open" and (refusals.contains(s.receipt) or
    (s.receipt == "confirmed" and Set("ineligible", "capacity-exhausted").contains(s.award)))

  action init = s' = { receipt: "received", award: "pending", related: false,
    relatedReview: "not-applicable", appeal: "none", from: "none", deciders: Set(),
    decisions: 0, appeals: 0, reviews: Set(), remediation: "investigating", redaction: 0, disclosed: 0 }

  action requestInformation = all { openReceipt.contains(s.receipt), s' = s.with("receipt", "needs-information") }
  // planDecision: open receipt only; an accepted obligation is never reduced.
  action decide(a: int, outcome: str, related: bool): bool = all {
    openReceipt.contains(s.receipt), s.award != "approved", s.decisions < 3,
    s' = s.with("receipt", outcome).with("award", if (outcome == "confirmed") "pending" else "ineligible")
      .with("related", related).with("relatedReview", "not-applicable")
      .with("deciders", s.deciders.union(Set(a))).with("decisions", s.decisions + 1) }
  // planAward: none, a funded amount, an unfunded amount, or a related-party proposal.
  action award(a: int, kind: str): bool = all { awardOpen,
    s' = (if (kind == "none") s.with("award", "ineligible")
      else if (s.related) s.with("award", "pending").with("relatedReview", "pending")
      else if (kind == "short") s.with("award", "capacity-exhausted")
      else s.with("award", "approved")).with("deciders", s.deciders.union(Set(a))) }
  action decideRelated(a: int, approve: bool): bool = all {
    s.relatedReview == "pending", s.receipt == "confirmed", s.award == "pending",
    not(s.deciders.contains(a)),
    s' = s.with("relatedReview", if (approve) "approved" else "refused")
      .with("award", if (approve) "approved" else "ineligible")
      .with("reviews", s.reviews.union(Set((a, s.deciders))))
      .with("deciders", s.deciders.union(Set(a))) }
  action appeal = all { appealable, s.appeals < 2,
    s' = s.with("appeal", "open").with("from", s.receipt).with("receipt", "disputed").with("appeals", s.appeals + 1) }
  action decideAppeal(a: int, uphold: bool): bool = all { s.appeal == "open", not(s.deciders.contains(a)),
    s' = (if (uphold) s.with("appeal", "upheld").with("receipt", s.from)
      else s.with("appeal", "returned").with("receipt", "triaging")
        .with("award", if (s.award == "ineligible") "pending" else s.award))
      .with("reviews", s.reviews.union(Set((a, s.deciders))))
      .with("deciders", s.deciders.union(Set(a))) }
  action resolve = s' = s.with("remediation", "resolved")
  action mitigate = all { s.remediation == "resolved", s' = s.with("remediation", "mitigation-verified") }
  action approveRedaction = s' = s.with("redaction", 1)
  action disclose(digest: int): bool = all { digest == s.redaction, digest != 0, s' = s.with("disclosed", digest) }

  action step = any {
    requestInformation, appeal, resolve, mitigate, approveRedaction, disclose(1), disclose(2),
    nondet a = actors.oneOf()
    nondet outcome = Set("confirmed", "duplicate", "out-of-scope", "rejected").oneOf()
    nondet related = Set(true, false).oneOf()
    nondet kind = Set("none", "amount", "short").oneOf()
    nondet yes = Set(true, false).oneOf()
    any { decide(a, outcome, related), award(a, kind), decideRelated(a, yes), decideAppeal(a, yes) },
    s' = s,
  }

  val invariant = all {
    (s.appeal == "open") iff (s.receipt == "disputed"),
    s.appeal == "open" implies (refusals.contains(s.from) or s.from == "confirmed"),
    s.appeal == "upheld" implies s.receipt == s.from,
    // A returned appeal reopens triage with no refusal left on the award.
    s.appeal == "returned" and openReceipt.contains(s.receipt) implies
      Set("pending", "capacity-exhausted").contains(s.award),
    s.award == "approved" implies (s.receipt == "confirmed" and s.appeal != "open"
      and (not(s.related) or s.relatedReview == "approved")),
    s.relatedReview == "pending" implies (s.related and s.award == "pending"),
    // Every related-party or appeal reviewer was independent of all earlier
    // deciders on the case, and stays in the journal.
    s.reviews.forall(r => not(r._2.contains(r._1)) and r._2.subseteq(s.deciders)
      and s.deciders.contains(r._1)),
    s.disclosed != 0 implies s.disclosed == s.redaction,
  }

  run relatedAwardTest = init.then(decide(1, "confirmed", true)).then(award(1, "amount"))
    .then(decideRelated(2, true)).expect(s.award == "approved" and invariant)
  run relatedReviewerMustBeIndependentTest = init.then(decide(1, "confirmed", true)).then(award(1, "amount"))
    .then(decideRelated(1, true).fail())
  run disclosureTest = init.then(resolve).then(mitigate).then(approveRedaction).then(disclose(1)).expect(s.disclosed == 1)
  run rejectionReturnedTest = init.then(decide(1, "rejected", false)).then(appeal).then(decideAppeal(2, false))
    .expect(s.receipt == "triaging" and s.award == "pending" and s.appeal == "returned" and invariant)
  run duplicateUpheldTest = init.then(decide(1, "duplicate", false)).then(appeal).then(decideAppeal(2, true))
    .expect(s.receipt == "duplicate" and s.appeal == "upheld" and invariant)
  run originalDeciderCannotDecideAppealTest = init.then(decide(1, "out-of-scope", false)).then(appeal)
    .then(decideAppeal(1, true).fail())
  run awardDeciderCannotDecideAppealTest = init.then(decide(1, "confirmed", false)).then(award(2, "none"))
    .then(appeal).then(decideAppeal(2, false).fail())
  run refusedAwardReturnedReopensTest = init.then(decide(1, "confirmed", false)).then(award(1, "none"))
    .then(appeal).then(decideAppeal(2, false))
    .expect(s.receipt == "triaging" and s.award == "pending" and invariant)
  run capacityWaitSurvivesReturnTest = init.then(decide(1, "confirmed", false)).then(award(1, "short"))
    .then(appeal).then(decideAppeal(2, false))
    .expect(s.receipt == "triaging" and s.award == "capacity-exhausted" and invariant)
  run upheldCapacityWaitCanStillBeAwardedTest = init.then(decide(1, "confirmed", false)).then(award(1, "short"))
    .then(appeal).then(decideAppeal(2, true)).then(award(1, "amount"))
    .expect(s.award == "approved" and s.receipt == "confirmed" and invariant)
  run approvedAwardNotAppealableTest = init.then(decide(1, "confirmed", false)).then(award(1, "amount"))
    .then(appeal.fail())
  run openAppealBlocksAwardTest = init.then(decide(1, "confirmed", false)).then(award(1, "none"))
    .then(appeal).then(award(1, "amount").fail())
  run secondAppealNeedsNewReviewerTest = init.then(decide(1, "rejected", false)).then(appeal)
    .then(decideAppeal(2, false)).then(decide(1, "rejected", false)).then(appeal)
    .then(decideAppeal(2, true).fail())
}
