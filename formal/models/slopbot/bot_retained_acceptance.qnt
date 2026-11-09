// @source workers/slopbot/value-retained-copy.ts
// @source workers/slopbot/value-retained-reference.ts
// @source workers/slopbot/value-indirect.ts
// @source workers/slopbot/value-indirect-retention.ts
// @source workers/slopbot/value-no-change-promotion.ts
// @source workers/slopbot/value-branch-policy.ts
// @source workers/slopbot/value-commit-hints.ts
// Hints discover candidates; they never prove acceptance. Two imported commits
// in a no-change promotion need exactly one original source each.
module bot_retained_acceptance {
  var s: { hinted: bool, observed: bool, ancestry: bool, trees: bool,
    originals: Set[int], promotion: bool, accepted: bool, newCredit: bool }
  action init = s' = {hinted: false, observed: false, ancestry: false, trees: false,
    originals: Set(), promotion: false, accepted: false, newCredit: false}
  action hint = s' = s.with("hinted", true)
  action observeRegisteredBranch = all { s.hinted, s' = s.with("observed", true) }
  action verifyAncestry = all { s.observed, s' = s.with("ancestry", true) }
  action verifyRetainedTrees = all { s.ancestry, s' = s.with("trees", true) }
  action original(commit: int): bool = all { s.trees, not(commit.in(s.originals)),
    s' = s.with("originals", s.originals.union(Set(commit))) }
  action classifyPromotion = all { s.trees, s.originals == Set(1, 2),
    s' = s.with("promotion", true).with("accepted", true).with("newCredit", false) }
  action step = { nondet commit = Set(1, 2).oneOf()
    any { hint, observeRegisteredBranch, verifyAncestry, verifyRetainedTrees,
      original(commit), classifyPromotion, s' = s } }
  val invariant = all { s.accepted implies s.observed and s.ancestry and s.trees,
    s.promotion implies s.originals == Set(1, 2) and not(s.newCredit) }
  run hintIsNotAcceptanceTest = init.then(hint).expect(not(s.accepted))
  run unchangedPromotionHasNoAdditionalCreditTest = init.then(hint).then(observeRegisteredBranch)
    .then(verifyAncestry).then(verifyRetainedTrees).then(original(1)).then(original(2))
    .then(classifyPromotion).expect(s.accepted and not(s.newCredit) and invariant)
}
