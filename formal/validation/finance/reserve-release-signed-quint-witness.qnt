module reserve_release_signed_witness {
  import settlement__reserveRelease as M from "../../../gen/settlement__reserveRelease"
  var placeholder: int
  action init = placeholder' = 0
  run signedReleaseJourney1Test = init.expect({
    val s0 = M::initial
    val s1 = M::qualifyUpgrade(s0, "owner")
    val s2 = M::observe(s1, 1)
    val s3 = M::check(s2, "root", List(5), 1, 1, "owner")
    val s4 = M::approve(s3, "attester")
    val s5 = M::observe(s4, 2)
    val s6 = M::check(s5, "root", List(5), 2, 1, "owner")
    val s7 = M::approve(s6, "attester")
    val s8 = M::ownerSign(s7, 1, "owner")
    val s9 = M::observe(s8, 3)
    val s10 = M::finalize(s9, { attempt: 1, root: "root", height: 2, releasedAmount: List(6), settledAmount: List(0), finalized: true, succeeded: true })
    val finalValue = s10
    and { M::canQualifyUpgrade(s0, "owner"), M::canObserve(s1, 1), M::canCheck(s2, "root", List(5), 1, 1, "owner"), M::canApprove(s3, "attester"), M::canObserve(s4, 2), not(M::canOwnerSign(s5, 1, "owner")), not(M::canCheck(s5, "root", List(5), 1, 1, "owner")), M::canCheck(s5, "root", List(5), 2, 1, "owner"), M::canApprove(s6, "attester"), M::canOwnerSign(s7, 1, "owner"), M::canObserve(s8, 3), M::canFinalize(s9, { attempt: 1, root: "root", height: 2, releasedAmount: List(6), settledAmount: List(0), finalized: true, succeeded: true }), not(M::canFinalize(s10, { attempt: 1, root: "root", height: 2, releasedAmount: List(6), settledAmount: List(0), finalized: true, succeeded: true })), M::sometimesObservedThenReleased(finalValue) and finalValue.finalizedHeight == 2 and finalValue.signedAttempt == 1 }
  })
  run signedReleaseJourney2Test = init.expect({
    val s0 = M::initial
    val s1 = M::qualifyUpgrade(s0, "owner")
    val s2 = M::observe(s1, 1)
    val s3 = M::check(s2, "root", List(5), 1, 1, "owner")
    val s4 = M::approve(s3, "attester")
    val s5 = M::ownerSign(s4, 1, "owner")
    val s6 = M::observe(s5, 2)
    val s7 = M::changeOwner(s6, 2)
    val s8 = M::finalize(s7, { attempt: 1, root: "root", height: 2, releasedAmount: List(6, 0), settledAmount: List(0, 0), finalized: true, succeeded: true })
    val finalValue = s8
    and { M::canQualifyUpgrade(s0, "owner"), M::canObserve(s1, 1), M::canCheck(s2, "root", List(5), 1, 1, "owner"), M::canApprove(s3, "attester"), M::canOwnerSign(s4, 1, "owner"), M::canObserve(s5, 2), M::canChangeOwner(s6, 2), not(M::canFinalize(s7, { attempt: 2, root: "root", height: 2, releasedAmount: List(6), settledAmount: List(0), finalized: true, succeeded: true })), not(M::canFinalize(s7, { attempt: 1, root: "wrong", height: 2, releasedAmount: List(6), settledAmount: List(0), finalized: true, succeeded: true })), not(M::canFinalize(s7, { attempt: 1, root: "root", height: 0, releasedAmount: List(6), settledAmount: List(0), finalized: true, succeeded: true })), not(M::canFinalize(s7, { attempt: 1, root: "root", height: 2, releasedAmount: List(5), settledAmount: List(0), finalized: true, succeeded: true })), not(M::canFinalize(s7, { attempt: 1, root: "root", height: 2, releasedAmount: List(6), settledAmount: List(1), finalized: true, succeeded: true })), not(M::canFinalize(s7, { attempt: 1, root: "root", height: 2, releasedAmount: List(6), settledAmount: List(0), finalized: false, succeeded: true })), not(M::canFinalize(s7, { attempt: 1, root: "root", height: 2, releasedAmount: List(6), settledAmount: List(0), finalized: true, succeeded: false })), not(M::canCheck(s7, "root", List(5), 2, 2, "owner")), M::canFinalize(s7, { attempt: 1, root: "root", height: 2, releasedAmount: List(6, 0), settledAmount: List(0, 0), finalized: true, succeeded: true }), finalValue.phase == M::Released and finalValue.requestRevision == 1 and finalValue.ownerRevision == 2 }
  })
  run signedReleaseJourney3Test = init.expect({
    val s0 = M::initial
    val s1 = M::qualifyUpgrade(s0, "owner")
    val s2 = M::observe(s1, 1)
    val s3 = M::check(s2, "root", List(5), 1, 1, "owner")
    val s4 = M::approve(s3, "attester")
    val s5 = M::ownerSign(s4, 1, "owner")
    val s6 = M::settlePart(s5, List(1))
    val s7 = M::observe(s6, 2)
    val s8 = M::changeOwner(s7, 2)
    val finalValue = s8
    and { M::canQualifyUpgrade(s0, "owner"), M::canObserve(s1, 1), M::canCheck(s2, "root", List(5), 1, 1, "owner"), M::canApprove(s3, "attester"), M::canOwnerSign(s4, 1, "owner"), M::canSettlePart(s5, List(1)), M::canObserve(s6, 2), M::canChangeOwner(s7, 2), not(M::canFinalize(s8, { attempt: 1, root: "root", height: 2, releasedAmount: List(6), settledAmount: List(0), finalized: true, succeeded: true })), not(M::canCheck(s8, "root", List(5), 2, 2, "owner")), finalValue.phase == M::Reserved and finalValue.hasSettled and finalValue.signedAttempt == 1 and finalValue.evidenceHeight == 1 }
  })
  run signedReleaseJourney4Test = init.expect({
    val s0 = M::initial
    val s1 = M::qualifyUpgrade(s0, "owner")
    val s2 = M::observe(s1, 1)
    val s3 = M::check(s2, "root", List(5), 1, 1, "owner")
    val s4 = M::approve(s3, "attester")
    val s5 = M::ownerSign(s4, 1, "owner")
    val s6 = M::observe(s5, 3)
    val s7 = M::changeOwner(s6, 2)
    val s8 = M::retireFailedAttempt(s7, { attempt: 1, root: "root", height: 2, canonicalFailure: true })
    val s9 = M::check(s8, "root", List(5), 3, 2, "owner")
    val s10 = M::approve(s9, "attester")
    val s11 = M::ownerSign(s10, 2, "owner")
    val s12 = M::finalize(s11, { attempt: 2, root: "root", height: 3, releasedAmount: List(6), settledAmount: List(0), finalized: true, succeeded: true })
    val finalValue = s12
    and { M::canQualifyUpgrade(s0, "owner"), M::canObserve(s1, 1), M::canCheck(s2, "root", List(5), 1, 1, "owner"), M::canApprove(s3, "attester"), M::canOwnerSign(s4, 1, "owner"), M::canObserve(s5, 3), M::canChangeOwner(s6, 2), not(M::canRetireFailedAttempt(s7, { attempt: 2, root: "root", height: 2, canonicalFailure: true })), not(M::canRetireFailedAttempt(s7, { attempt: 1, root: "wrong", height: 2, canonicalFailure: true })), not(M::canRetireFailedAttempt(s7, { attempt: 1, root: "root", height: 0, canonicalFailure: true })), not(M::canRetireFailedAttempt(s7, { attempt: 1, root: "root", height: 2, canonicalFailure: false })), not(M::canCheck(s7, "root", List(5), 3, 2, "owner")), M::canRetireFailedAttempt(s7, { attempt: 1, root: "root", height: 2, canonicalFailure: true }), not(M::canRetireFailedAttempt(s8, { attempt: 1, root: "root", height: 2, canonicalFailure: true })), not(M::canFinalize(s8, { attempt: 1, root: "root", height: 2, releasedAmount: List(6), settledAmount: List(0), finalized: true, succeeded: true })), not(M::canCheck(s8, "root", List(5), 2, 2, "owner")), not(M::canCheck(s8, "root", List(5), 3, 1, "owner")), M::canCheck(s8, "root", List(5), 3, 2, "owner"), M::canApprove(s9, "attester"), not(M::canOwnerSign(s10, 1, "owner")), M::canOwnerSign(s10, 2, "owner"), not(M::canFinalize(s11, { attempt: 1, root: "root", height: 3, releasedAmount: List(6), settledAmount: List(0), finalized: true, succeeded: true })), M::canFinalize(s11, { attempt: 2, root: "root", height: 3, releasedAmount: List(6), settledAmount: List(0), finalized: true, succeeded: true }), finalValue.phase == M::Released and finalValue.signedAttempt == 2 and finalValue.retiredAttempts.length() == 1 and finalValue.retiredAttempts[0] == { attempt: 1, requestRevision: 1, evidenceHeight: 1, failureHeight: 2 } }
  })
  run signedReleaseJourney5Test = init.expect({
    val s0 = M::initial
    val s1 = M::qualifyUpgrade(s0, "owner")
    val s2 = M::observe(s1, 1)
    val s3 = M::check(s2, "root", List(5), 1, 1, "owner")
    val s4 = M::approve(s3, "attester")
    val s5 = M::ownerSign(s4, 1, "owner")
    val s6 = M::settlePart(s5, List(1))
    val s7 = M::retireFailedAttempt(s6, { attempt: 1, root: "root", height: 2, canonicalFailure: true })
    val finalValue = s7
    and { M::canQualifyUpgrade(s0, "owner"), M::canObserve(s1, 1), M::canCheck(s2, "root", List(5), 1, 1, "owner"), M::canApprove(s3, "attester"), M::canOwnerSign(s4, 1, "owner"), M::canSettlePart(s5, List(1)), M::canRetireFailedAttempt(s6, { attempt: 1, root: "root", height: 2, canonicalFailure: true }), not(M::canCheck(s7, "root", List(5), 2, 1, "owner")), finalValue.phase == M::Reserved and finalValue.hasSettled and finalValue.signedAttempt == 0 and finalValue.retiredAttempts.length() == 1 and finalValue.observedHeight == 2 }
  })
}
