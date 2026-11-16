// @source backend/security/handler.ts
// @source backend/security/project-access.ts
// @source backend/security/case-store.ts
// Authority abstraction of caseRoles, readCase and allowedActions.
// Actors: 0 stranger, 1 reporter, 2 program maintainer, 3 financial approver,
// 4 moderator, 5 assigned triager. Reporter also occurs in program approvers:
// the reporter override removes those roles. One role revocation is modeled.
// Receipt "open" stands for received, needs-information and triaging. The
// reporter may appeal a duplicate, out-of-scope or rejected finding, or a
// confirmed finding whose award is ineligible or capacity-exhausted
// (allowedActions). A moderator holds the dispute role once the case has an
// appeal or a related-party review (caseRoles) and upholds the appeal, which
// restores `from`, or returns it, which reopens triage and turns only an
// ineligible award back into pending. Finance reads only an approved award.
// "reserved" is a confirmed case that held a reservation before
// discretionary awards (`legacyReservation`, the earlier writer): awardOpen
// accepts it and only an amount approves it; it is not appealable.
module api_private_case_roles {
  type R = {receipt: str, award: str, appeal: str, from: str, relatedPending: bool,
    relatedApproved: bool, authority: bool, triager: bool, lastAction: str, lastActor: int,
    lastRoles: Set[str], readRoles: Set[str], readActor: int, hasRead: bool,
    readHadAward: bool, readHadReview: bool}
  var s: R
  action init = s' = {receipt: "open", award: "pending", appeal: "none", from: "none",
    relatedPending: false, relatedApproved: false, authority: true, triager: true,
    lastAction: "none", lastActor: 0, lastRoles: Set(), readRoles: Set(), readActor: 0,
    hasRead: false, readHadAward: false, readHadReview: false}
  val refusals = Set("duplicate", "out-of-scope", "rejected")
  val reviewed = s.appeal != "none" or s.relatedPending or s.relatedApproved
  val appealable = s.appeal != "open" and (refusals.contains(s.receipt) or
    (s.receipt == "confirmed" and Set("ineligible", "capacity-exhausted").contains(s.award)))
  def roles(who: int): Set[str] =
    if (who == 1) Set("reporter")
    else if (who == 2 and s.authority) Set("security-maintainer")
    else if (who == 3 and s.award == "approved") Set("financial")
    else if (who == 4 and reviewed) Set("dispute")
    else if (who == 5 and s.triager) Set("triager")
    else Set()
  def record(x: R, name: str, who: int): R =
    x.with("lastAction", name).with("lastActor", who).with("lastRoles", roles(who))
  action read(who: int): bool = all { roles(who).size() > 0,
    s' = s.with("readRoles", roles(who)).with("readActor", who).with("hasRead", true)
      .with("readHadAward", s.award == "approved").with("readHadReview", reviewed) }
  action decide(who: int, outcome: str): bool = all {
    roles(who).contains("security-maintainer"), s.receipt == "open",
    not(Set("reserved", "approved").contains(s.award)),
    outcome.in(refusals.union(Set("confirmed"))),
    s' = record(s.with("receipt", outcome)
      .with("award", if (outcome == "confirmed") "pending" else "ineligible"), "decide", who) }
  // planAward: a funded amount, an unfunded amount (capacity wait) or none.
  action award(who: int, kind: str): bool = all {
    roles(who).contains("security-maintainer"), s.receipt == "confirmed", s.appeal != "open",
    not(s.relatedPending), Set("pending", "capacity-exhausted", "reserved").contains(s.award),
    kind.in(Set("amount", "short", "none")), s.award == "reserved" implies kind == "amount",
    s' = record(s.with("award", if (kind == "amount") "approved"
      else if (kind == "short") "capacity-exhausted" else "ineligible"), "award", who) }
  action appeal(who: int): bool = all { roles(who).contains("reporter"), appealable,
    s' = record(s.with("appeal", "open").with("from", s.receipt).with("receipt", "disputed"),
      "appeal", who) }
  action decideAppeal(who: int, uphold: bool): bool = all { roles(who).contains("dispute"),
    s.appeal == "open",
    s' = record(if (uphold) s.with("appeal", "upheld").with("receipt", s.from)
      else s.with("appeal", "returned").with("receipt", "open")
        .with("award", if (s.award == "ineligible") "pending" else s.award),
      "decide-appeal", who) }
  action legacyReservation = all { s.receipt == "confirmed", s.award == "pending",
    not(s.relatedPending), s' = s.with("award", "reserved") }
  action markRelated = all { s.award != "approved", s' = s.with("relatedPending", true) }
  action approveRelated(who: int): bool = all { roles(who).contains("dispute"), s.relatedPending,
    s.receipt == "confirmed",
    s' = record(s.with("relatedPending", false).with("relatedApproved", true),
      "approve-related", who) }
  action preparePayment(who: int): bool = all {
    s.award == "approved",
    (roles(who).contains("security-maintainer") or roles(who).contains("financial")),
    s' = record(s, "prepare-payment", who) }
  action disclose(who: int): bool = all { roles(who).contains("security-maintainer"),
    s' = record(s, "disclose", who) }
  action revokeAuthority = s' = s.with("authority", false)
  action revokeTriager = s' = s.with("triager", false)
  action step = {
    nondet who = 0.to(5).oneOf()
    nondet outcome = Set("confirmed", "duplicate", "out-of-scope", "rejected").oneOf()
    nondet kind = Set("amount", "short", "none").oneOf()
    nondet yes = Set(true, false).oneOf()
    any { read(who), decide(who, outcome), award(who, kind), appeal(who), decideAppeal(who, yes),
      legacyReservation, markRelated, approveRelated(who), preparePayment(who), disclose(who), revokeAuthority,
      revokeTriager, s' = s }
  }
  val invariant = all {
    s.hasRead implies (s.readActor != 0 and s.readRoles.size() > 0),
    (s.hasRead and s.readActor == 3) implies s.readHadAward,
    (s.hasRead and s.readActor == 4) implies s.readHadReview,
    s.readActor == 1 implies s.readRoles == Set("reporter"),
    Set("decide", "award", "disclose").contains(s.lastAction) implies
      (s.lastActor == 2 and s.lastRoles.contains("security-maintainer")),
    s.lastAction == "appeal" implies (s.lastActor == 1 and s.lastRoles == Set("reporter")),
    Set("decide-appeal", "approve-related").contains(s.lastAction) implies
      (s.lastActor == 4 and s.lastRoles.contains("dispute")),
    s.lastAction == "prepare-payment" implies
      (s.lastActor == 2 or s.lastActor == 3),
    s.award == "approved" implies (s.receipt == "confirmed" and not(s.relatedPending)),
    s.award == "reserved" implies s.receipt == "confirmed",
    (s.appeal == "open") iff (s.receipt == "disputed"),
    s.appeal == "open" implies (refusals.contains(s.from) or (s.from == "confirmed"
      and Set("ineligible", "capacity-exhausted").contains(s.award))),
    s.appeal == "upheld" implies s.receipt.in(refusals.union(Set("confirmed", "open"))),
  }
  run strangerReadRefusedTest = init.then(read(0).fail())
  run reporterReadTest = init.then(read(1)).expect(s.readRoles == Set("reporter"))
  run reporterCannotDecideTest = init.then(decide(1, "confirmed").fail())
  run moderatorWithoutCaseReviewRefusedTest = init.then(read(4).fail())
  run financeBeforeAwardRefusedTest = init.then(read(3).fail())
  run maintainerDecisionTest = init.then(decide(2, "confirmed")).expect(s.receipt == "confirmed")
  run financeAfterAwardTest = init.then(decide(2, "confirmed")).then(award(2, "amount"))
    .then(read(3)).then(preparePayment(3))
  run financeWaitsOnCapacityTest = init.then(decide(2, "confirmed")).then(award(2, "short"))
    .then(read(3).fail())
  run triagerCannotDecideTest = init.then(read(5)).then(decide(5, "confirmed").fail())
  run revokedTriagerReadRefusedTest = init.then(revokeTriager).then(read(5).fail())
  run revokedMaintainerRefusedTest = init.then(revokeAuthority).then(decide(2, "confirmed").fail())
  run appealReviewTest = init.then(decide(2, "rejected")).then(appeal(1)).then(read(4))
    .then(decideAppeal(4, false)).expect(s.receipt == "open" and s.award == "pending")
  run duplicateAppealUpheldTest = init.then(decide(2, "duplicate")).then(appeal(1))
    .then(decideAppeal(4, true)).expect(s.receipt == "duplicate" and s.appeal == "upheld")
  run outOfScopeAppealTest = init.then(decide(2, "out-of-scope")).then(appeal(1))
    .expect(s.receipt == "disputed" and s.from == "out-of-scope")
  run ineligibleAwardAppealTest = init.then(decide(2, "confirmed")).then(award(2, "none"))
    .then(appeal(1)).then(decideAppeal(4, false))
    .expect(s.receipt == "open" and s.award == "pending")
  run capacityWaitAppealReturnKeepsWaitTest = init.then(decide(2, "confirmed"))
    .then(award(2, "short")).then(appeal(1)).then(decideAppeal(4, false))
    .expect(s.receipt == "open" and s.award == "capacity-exhausted")
  run pendingAwardNotAppealableTest = init.then(decide(2, "confirmed")).then(appeal(1).fail())
  run approvedAwardNotAppealableTest = init.then(decide(2, "confirmed")).then(award(2, "amount"))
    .then(appeal(1).fail())
  run maintainerCannotDecideAppealTest = init.then(decide(2, "rejected")).then(appeal(1))
    .then(decideAppeal(2, true).fail())
  run pendingRelatedAwardRefusedTest = init.then(decide(2, "confirmed")).then(markRelated)
    .then(award(2, "amount").fail())
  run relatedAwardReviewTest = init.then(decide(2, "confirmed")).then(markRelated)
    .then(approveRelated(4)).then(award(2, "amount"))
  run legacyReservationAwardedByAmountTest = init.then(decide(2, "confirmed"))
    .then(legacyReservation).then(award(2, "none").fail())
  run legacyReservationNotAppealableTest = init.then(decide(2, "confirmed"))
    .then(legacyReservation).then(appeal(1).fail())
  run legacyReservationApprovedTest = init.then(decide(2, "confirmed"))
    .then(legacyReservation).then(award(2, "amount")).then(read(3))
  run reporterCannotDiscloseTest = init.then(disclose(1).fail())
}
