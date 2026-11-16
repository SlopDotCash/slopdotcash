// @source src/lib/project-policy.mjs
// @source src/lib/project-schema.mjs
// @source src/lib/project-revision-changes.ts
// @source src/lib/repositories.mjs
// Current admission and transition contracts, not every schema field/regex.
// Explicit unverified active projects remain collectible with pending receipts
// and disabled payment. Verified authority needs the exact receipt cutover.
module ui_project_policy {
  var s: { status: str, verified: bool, receipts: str, terms: int, binding: int,
    history: List[int], priorHistory: List[int], closedPrior: bool,
    successor: bool, sameIdentity: bool, accepted: bool, payment: bool }
  action init = s' = { status: "paused", verified: false, receipts: "pending",
    terms: 1, binding: 0, history: List(1), priorHistory: List(1),
    closedPrior: false, successor: false, sameIdentity: true, accepted: false, payment: false }
  action activateUnverified = s' = s.with("status", "active").with("accepted", false)
  action verifyAuthority = s' = s.with("verified", true).with("receipts", "active").with("binding", s.terms).with("accepted", false)
  action reviseTerms = all { s.terms == 1,
    s' = s.with("terms", 2).with("binding", 2).with("accepted", false) }
  action omitReceiptBinding = s' = s.with("binding", 0).with("accepted", false)
  action rotate = s' = s.with("history", List(1, 2)).with("successor", true).with("closedPrior", true).with("accepted", false)
  action rewriteHistory = s' = s.with("history", List(2)).with("accepted", false)
  action closeWithoutSuccessor = s' = s.with("closedPrior", true).with("successor", false).with("accepted", false)
  action identityDrift = s' = s.with("sameIdentity", false).with("accepted", false)
  val prefix = s.history.length() >= s.priorHistory.length() and s.history.nth(0) == s.priorHistory.nth(0)
  val valid = s.sameIdentity and prefix and (not(s.closedPrior) or s.successor)
    and (s.receipts != "active" or s.binding == s.terms)
    and (s.status != "active" or
      (if (s.verified) s.receipts == "active" else s.receipts == "pending" and not(s.payment)))
  action admit = s' = s.with("accepted", valid)
  action step = any { activateUnverified, verifyAuthority, reviseTerms,
    omitReceiptBinding, rotate, rewriteHistory, closeWithoutSuccessor, identityDrift, admit }
  val invariant = s.accepted implies valid
  run unverifiedCollectionTest = init.then(activateUnverified).then(admit).expect(s.accepted and not(s.payment))
  run verifiedReceiptTest = init.then(verifyAuthority).then(activateUnverified).then(admit).expect(s.accepted)
  run missingReceiptTest = init.then(verifyAuthority).then(omitReceiptBinding).then(admit).expect(not(s.accepted))
  run rotationTest = init.then(rotate).then(admit).expect(s.accepted)
  run historyRewriteTest = init.then(rewriteHistory).then(admit).expect(not(s.accepted))
  run orphanClosureTest = init.then(closeWithoutSuccessor).then(admit).expect(not(s.accepted))
}
