// @source src/lib/project-policy.mjs
// @source src/lib/project-schema.mjs
// @evidence scripts/project-policy-state.test.ts
// One proposed immutable revision; zero/two old bindings and zero/three new
// bindings. Schema/parser validation, canonical object equality, escrow,
// security-bounty and historical funding transitions are supplied predicates.
// This model refines receipt cutover/prefix and material-term composition; it
// grants neither owner publication authority nor payment/collection clearance.
// Active unverified input is schema-valid only with pending receipts and
// disabled payments. That is independent from the collector's status-only gate.
// The first receipt activation has the source's explicit same-revision material
// exception. All new scenarios and regression definitions are unexecuted.
module ui_project_policy {
  type State = { phase: str, oldActive: bool, nextActive: bool, projectActive: bool,
    verified: bool, payment: bool, oldCount: int, nextCount: int,
    schemaValid: bool, sameIdentity: bool, childrenValid: bool,
    activationMatches: bool, cutoverSame: bool, exactPrefix: bool,
    bindingChanged: bool, materialChanged: bool, sameRevision: bool,
    proofMatches: bool, accepted: bool, error: str }
  var s: State
  val initial: State = { phase: "input", oldActive: false, nextActive: false,
    projectActive: false, verified: false, payment: false, oldCount: 0, nextCount: 0,
    schemaValid: true, sameIdentity: true, childrenValid: true, activationMatches: true,
    cutoverSame: true, exactPrefix: true, bindingChanged: false, materialChanged: false,
    sameRevision: true, proofMatches: true, accepted: false, error: "none" }
  action init = s' = initial
  val activating = not(s.oldActive) and s.nextActive
  val appended = s.nextCount - s.oldCount
  def refuse(reason: str): State = s.with("phase", "done").with("error", reason)
  action profile(kind: int): bool = {
    val active = initial.with("oldActive", true).with("nextActive", true)
      .with("oldCount", 1).with("nextCount", 1).with("verified", true)
    val value = if (kind == 1) initial.with("projectActive", true)
      else if (kind == 2) initial.with("projectActive", true).with("verified", true).with("nextActive", true).with("nextCount", 1)
      else if (kind == 3) initial.with("projectActive", true).with("verified", true)
      else if (kind == 4) active.with("nextCount", 2).with("bindingChanged", true).with("materialChanged", true).with("sameRevision", false)
      else if (kind == 5) active.with("exactPrefix", false)
      else if (kind == 6) initial.with("childrenValid", false)
      else if (kind == 7) initial.with("schemaValid", false)
      else if (kind == 8) initial.with("sameIdentity", false)
      else if (kind == 9) initial.with("nextActive", true).with("nextCount", 1)
      else if (kind == 10) initial.with("nextActive", true).with("nextCount", 2).with("verified", true)
      else if (kind == 11) initial.with("nextActive", true).with("nextCount", 1).with("verified", true).with("activationMatches", false)
      else if (kind == 12) active.with("nextActive", false).with("nextCount", 0)
      else if (kind == 13) active.with("cutoverSame", false)
      else if (kind == 14) active.with("oldCount", 2).with("nextCount", 1)
      else if (kind == 15) active.with("nextCount", 3).with("bindingChanged", true).with("sameRevision", false)
      else if (kind == 16) active.with("bindingChanged", true)
      else if (kind == 17) active.with("nextCount", 2).with("sameRevision", false)
      else if (kind == 18) active.with("materialChanged", true)
      else if (kind == 19) initial.with("nextActive", true).with("nextCount", 1).with("verified", true).with("materialChanged", true)
      else if (kind == 20) initial.with("verified", true).with("proofMatches", false)
      else if (kind == 21) initial.with("projectActive", true).with("payment", true)
      else if (kind == 22) active.with("verified", false)
      else if (kind == 23) active else initial
    all { s.phase == "input", 0.to(23).contains(kind), s' = value }
  }
  action schema = all { s.phase == "input", s' =
    if (not(s.schemaValid) or (s.nextActive and s.nextCount == 0) or (not(s.nextActive) and s.nextCount != 0)) refuse("schema")
    else if (s.projectActive and not(s.verified) and (s.nextActive or s.payment)) refuse("schema")
    else if (s.projectActive and s.verified and (not(s.nextActive) or not(s.activationMatches))) refuse("schema")
    else s.with("phase", "identity") }
  action identity = all { s.phase == "identity", s' =
    if (not(s.sameIdentity)) refuse("identity") else s.with("phase", "children") }
  action children = all { s.phase == "children", s' =
    if (not(s.childrenValid)) refuse("child-transition") else s.with("phase", "receipts") }
  action receipts = all { s.phase == "receipts", s' =
    if (activating and (not(s.verified) or s.nextCount != 1 or not(s.activationMatches))) refuse("first-activation")
    else if (s.oldActive and not(s.nextActive)) refuse("cannot-deactivate")
    else if (s.oldActive and not(s.cutoverSame)) refuse("cutover")
    else if (s.oldActive and (appended < 0 or not(s.exactPrefix))) refuse("prefix")
    else if (s.oldActive and appended > 1) refuse("too-many-bindings")
    else if (s.oldActive and (s.bindingChanged != (appended == 1))) refuse("binding-change")
    else s.with("phase", "material") }
  action material = all { s.phase == "material", s' =
    if (s.materialChanged and s.sameRevision and not(activating)) refuse("material-revision")
    else s.with("phase", "proof") }
  action proof = all { s.phase == "proof", s' =
    if (s.verified and not(s.proofMatches)) refuse("proof-revision")
    else s.with("phase", "done").with("accepted", true) }
  action step = { nondet kind = 0.to(23).oneOf()
    any { profile(kind), schema, identity, children, receipts, material, proof, s' = s } }
  val invariant = all { s.accepted implies s.error == "none" and s.schemaValid and s.sameIdentity and s.childrenValid,
    s.accepted and activating implies s.verified and s.nextCount == 1 and s.activationMatches,
    s.accepted and s.oldActive implies s.nextActive and s.cutoverSame and s.exactPrefix and appended >= 0 and appended <= 1
      and (s.bindingChanged == (appended == 1)),
    s.accepted and s.materialChanged and s.sameRevision implies activating,
    s.accepted and s.verified implies s.proofMatches }
  action finish = schema.then(identity).then(children).then(receipts).then(material).then(proof)
  action toReceipts = schema.then(identity).then(children).then(receipts)
  run unverifiedCollectionTest = init.then(profile(1)).then(finish).expect(s.accepted and not(s.payment) and invariant)
  run verifiedReceiptTest = init.then(profile(2)).then(finish).expect(s.accepted and invariant)
  run missingReceiptTest = init.then(profile(3)).then(schema).expect(s.error == "schema" and invariant)
  run rotationTest = init.then(profile(4)).then(finish).expect(s.accepted and appended == 1 and invariant)
  run historyRewriteTest = init.then(profile(5)).then(toReceipts).expect(s.error == "prefix" and invariant)
  run orphanClosureTest = init.then(profile(6)).then(schema).then(identity).then(children).expect(s.error == "child-transition" and invariant)
  run invalidSchemaPrecedesTransitionTest = init.then(profile(7)).then(schema).expect(s.error == "schema" and invariant)
  run immutableProjectOrRepositoryIdentityRefusedTest = init.then(profile(8)).then(schema).then(identity).expect(s.error == "identity" and invariant)
  run initialReceiptNeedsVerifiedAuthorityTest = init.then(profile(9)).then(toReceipts).expect(s.error == "first-activation" and invariant)
  run initialReceiptNeedsExactlyOneBindingTest = init.then(profile(10)).then(toReceipts).expect(s.error == "first-activation" and invariant)
  run initialReceiptNeedsAuthorityCutoverTest = init.then(profile(11)).then(toReceipts).expect(s.error == "first-activation" and invariant)
  run activeReceiptCannotReturnToPendingTest = init.then(profile(12)).then(toReceipts).expect(s.error == "cannot-deactivate" and invariant)
  run activeCutoverCannotMoveTest = init.then(profile(13)).then(toReceipts).expect(s.error == "cutover" and invariant)
  run receiptPrefixCannotShrinkTest = init.then(profile(14)).then(toReceipts).expect(s.error == "prefix" and invariant)
  run oneRevisionCannotAppendTwoBindingsTest = init.then(profile(15)).then(toReceipts).expect(s.error == "too-many-bindings" and invariant)
  run changedBindingTermsNeedAppendTest = init.then(profile(16)).then(toReceipts).expect(s.error == "binding-change" and invariant)
  run unchangedBindingTermsCannotAppendTest = init.then(profile(17)).then(toReceipts).expect(s.error == "binding-change" and invariant)
  run materialChangeNeedsRevisionTest = init.then(profile(18)).then(toReceipts).then(material).expect(s.error == "material-revision" and invariant)
  run firstActivationRetainsExplicitMaterialExceptionTest = init.then(profile(19)).then(finish).expect(s.accepted and s.sameRevision and invariant)
  run verifiedProofMustMatchTermsTest = init.then(profile(20)).then(toReceipts).then(material).then(proof).expect(s.error == "proof-revision" and invariant)
  run activeUnverifiedCannotEnablePaymentTest = init.then(profile(21)).then(schema).expect(s.error == "schema" and invariant)
  run pausedProjectCanRetainActiveReceiptHistoryTest = init.then(profile(22)).then(finish).expect(s.accepted and s.nextActive and not(s.verified) and invariant)
  run identicalActiveRevisionAcceptedTest = init.then(profile(23)).then(finish).expect(s.accepted and invariant)
  run pendingPausedRevisionAcceptedTest = init.then(finish).expect(s.accepted and invariant)
}
