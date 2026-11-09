// @source backend/security/handler.ts
// @source backend/security/project-access.ts
// @source backend/security/case-store.ts
// Authority abstraction of caseRoles, readCase and allowedActions.
// Actors: 0 stranger, 1 reporter, 2 program maintainer, 3 financial approver,
// 4 moderator, 5 assigned triager. Reporter also occurs in program approvers:
// the reporter override removes those roles. One role revocation is modeled.
module api_private_case_roles {
  var s: {receipt: str, award: bool, appeal: bool, relatedPending: bool, relatedApproved: bool, authority: bool, triager: bool, lastAction: str, lastActor: int, lastRoles: Set[str], readRoles: Set[str], readActor: int, hasRead: bool, readHadAward: bool, readHadReview: bool}
  action init = s' = {receipt: "open", award: false, appeal: false, relatedPending: false, relatedApproved: false, authority: true, triager: true, lastAction: "none", lastActor: 0, lastRoles: Set(), readRoles: Set(), readActor: 0, hasRead: false, readHadAward: false, readHadReview: false}
  def roles(who: int): Set[str] =
    if (who == 1) Set("reporter")
    else if (who == 2 and s.authority) Set("security-maintainer")
    else if (who == 3 and s.award) Set("financial")
    else if (who == 4 and (s.appeal or s.relatedPending)) Set("dispute")
    else if (who == 5 and s.triager) Set("triager")
    else Set()
  action read(who: int): bool = all { roles(who).size() > 0,
    s' = s.with("readRoles", roles(who)).with("readActor", who).with("hasRead", true).with("readHadAward", s.award).with("readHadReview", s.appeal or s.relatedPending) }
  action decide(who: int, confirmed: bool): bool = all {
    roles(who).contains("security-maintainer"), s.receipt == "open",
    s' = s.with("receipt", if (confirmed) "confirmed" else "rejected")
      .with("lastAction", "decide").with("lastActor", who).with("lastRoles", roles(who)) }
  action award(who: int): bool = all {
    roles(who).contains("security-maintainer"), s.receipt == "confirmed", not(s.appeal),
    not(s.relatedPending),
    s' = s.with("award", true).with("lastAction", "award").with("lastActor", who).with("lastRoles", roles(who)) }
  action appeal(who: int): bool = all { roles(who).contains("reporter"), s.receipt == "rejected", not(s.appeal),
    s' = s.with("appeal", true).with("lastAction", "appeal").with("lastActor", who).with("lastRoles", roles(who)) }
  action decideAppeal(who: int): bool = all { roles(who).contains("dispute"), s.appeal,
    s' = s.with("appeal", false).with("lastAction", "decide-appeal").with("lastActor", who).with("lastRoles", roles(who)) }
  action markRelated = all { not(s.award), s' = s.with("relatedPending", true) }
  action approveRelated(who: int): bool = all { roles(who).contains("dispute"), s.relatedPending, s.receipt == "confirmed",
    s' = s.with("relatedPending", false).with("relatedApproved", true)
      .with("lastAction", "approve-related").with("lastActor", who).with("lastRoles", roles(who)) }
  action preparePayment(who: int): bool = all {
    s.award, (roles(who).contains("security-maintainer") or roles(who).contains("financial")),
    s' = s.with("lastAction", "prepare-payment").with("lastActor", who).with("lastRoles", roles(who)) }
  action disclose(who: int): bool = all { roles(who).contains("security-maintainer"),
    s' = s.with("lastAction", "disclose").with("lastActor", who).with("lastRoles", roles(who)) }
  action revokeAuthority = s' = s.with("authority", false)
  action revokeTriager = s' = s.with("triager", false)
  action step = {
    nondet who = 0.to(5).oneOf()
    any { read(who), decide(who,true), decide(who,false), award(who), appeal(who), decideAppeal(who),
      markRelated, approveRelated(who), preparePayment(who), disclose(who), revokeAuthority, revokeTriager, s' = s }
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
    s.award implies (s.receipt == "confirmed" and not(s.relatedPending)),
  }
  run strangerReadRefusedTest = init.then(read(0).fail())
  run reporterReadTest = init.then(read(1)).expect(s.readRoles == Set("reporter"))
  run reporterCannotDecideTest = init.then(decide(1,true).fail())
  run moderatorWithoutCaseReviewRefusedTest = init.then(read(4).fail())
  run financeBeforeAwardRefusedTest = init.then(read(3).fail())
  run maintainerDecisionTest = init.then(decide(2,true)).expect(s.receipt == "confirmed")
  run financeAfterAwardTest = init.then(decide(2,true)).then(award(2)).then(read(3)).then(preparePayment(3))
  run triagerCannotDecideTest = init.then(read(5)).then(decide(5,true).fail())
  run revokedTriagerReadRefusedTest = init.then(revokeTriager).then(read(5).fail())
  run revokedMaintainerRefusedTest = init.then(revokeAuthority).then(decide(2,true).fail())
  run appealReviewTest = init.then(decide(2,false)).then(appeal(1)).then(read(4)).then(decideAppeal(4))
  run pendingRelatedAwardRefusedTest = init.then(decide(2,true)).then(markRelated).then(award(2).fail())
  run relatedAwardReviewTest = init.then(decide(2,true)).then(markRelated).then(approveRelated(4)).then(award(2))
  run reporterCannotDiscloseTest = init.then(disclose(1).fail())
}
