// @source backend/projects/vault-setup.ts
// @source contracts/evm/adapter.ts
// @source contracts/solana/owner-creation.ts
// @source src/lib/vault-setup.ts
// @evidence scripts/vault-setup-network-failure.test.ts
// @evidence scripts/solana-vault-setup-network-failure.test.ts
// @evidence tests/e2e/vault-actions.spec.ts
// One review/registration call, two ordered reviewed infrastructure candidates,
// two wallet-claim identities and both chain families. Policy, exact creation
// bytes, code pins, signatures and chain finality are input predicates, not
// cryptographic proofs. Candidate1 may be supplied configuration and candidate2
// retained D1 infrastructure; a new vault never inherits another project's
// owner, execution budget, consent nonce budget or prior upgrade history.
// Transport failure immediately returns503. Candidate verification refusal can
// advance to the next reviewed candidate. Solana preserves a preparation
// conflict for422 if no later candidate succeeds; EVM exhaustion returns503.
// Registration checks the transaction before selecting a candidate. A mismatch
// advances to another reviewed candidate; it is retained if all candidates fail.
// A matched failed transaction or unavailable RPC still stops immediately.
// Effective-wallet lookup is a captured observation, not a lock across RPCs.
// This service returns unsigned review data, pending or verified deployment
// metadata. The caller's registry append and authority checks remain separate.
// No tests, parser, simulation or verification were run for this model.
module vault_setup_resolution {
  var s: { phase: str, family: str, mode: str, bounty: bool, automatic: bool,
    candidate: int, selected: int, observedClaim: int, currentClaim: int,
    firstConflict: bool, verificationError: bool, result: str, signed: bool, broadcast: bool }
  action init = s' = { phase: "input", family: "evm", mode: "review", bounty: false,
    automatic: false, candidate: 1, selected: 0, observedClaim: 0, currentClaim: 1,
    firstConflict: false, verificationError: false, result: "none", signed: false, broadcast: false }
  action begin(family: str, mode: str, bounty: bool, automatic: bool, policy: bool): bool = all {
    s.phase == "input", Set("evm", "solana").contains(family), Set("review", "register").contains(mode),
    s' = s.with("family", family).with("mode", mode).with("bounty", bounty).with("automatic", automatic)
      .with("phase", if (policy and not(bounty and automatic)) "claim" else "done")
      .with("result", if (policy and not(bounty and automatic)) "none" else "policy-422") }
  action claim(matches: bool): bool = all { s.phase == "claim",
    s' = if (matches) s.with("phase", "asset").with("observedClaim", s.currentClaim)
      else s.with("phase", "done").with("result", "wallet-403") }
  action asset(valid: bool): bool = all { s.phase == "asset",
    s' = s.with("phase", if (valid) "templates" else "done")
      .with("result", if (valid) "none" else "asset-422") }
  action templates(available: bool): bool = all { s.phase == "templates",
    s' = s.with("phase", if (available) "candidate" else "done")
      .with("result", if (available) "none" else "unavailable-503") }
  def nextValue = s.with("candidate", if (s.candidate == 1) 2 else 2)
    .with("selected", 0)
    .with("phase", if (s.candidate == 1) "candidate" else "exhausted")
  action skipWrongNetwork = all { s.phase == "candidate", s' = nextValue }
  action prepare(outcome: str): bool = all { s.phase == "candidate",
    Set("compatible", "refused", "conflict", "unavailable").contains(outcome),
    s' = if (outcome == "unavailable") s.with("phase", "done").with("result", "network-503")
      else if (outcome == "compatible") s.with("phase", "prepared").with("selected", s.candidate)
      else nextValue.with("firstConflict", s.firstConflict or (s.family == "solana" and outcome == "conflict")) }
  action roleCheck(conflict: bool): bool = all { s.phase == "prepared",
    s' = if (s.family == "evm" and conflict) s.with("phase", "done").with("result", "role-422")
      else s.with("phase", if (s.mode == "review") "done" else "verify")
        .with("result", if (s.mode == "review") "unsigned-review" else "none") }
  action exhausted = all { s.phase == "exhausted",
    s' = s.with("phase", "done").with("result", if (s.verificationError or s.firstConflict) "creation-422" else "unavailable-503") }
  action transaction(outcome: str): bool = all { s.phase == "verify",
    Set("pending", "invalid", "failed", "valid", "unavailable").contains(outcome),
    s' = if (outcome == "invalid") nextValue.with("verificationError", true)
      else s.with("phase", "done").with("result",
      if (outcome == "pending") "pending" else if (outcome == "valid") "verified-deployment"
      else if (outcome == "unavailable") "network-503"
      else "failed-422") }
  action oldTerminalMismatch = all { s.phase == "verify", s.candidate == 1,
    s' = s.with("phase", "done").with("result", "creation-422") }
  action replaceClaim = all { s.currentClaim == 1, s' = s.with("currentClaim", 2) }
  action step = {
    nondet family = Set("evm", "solana").oneOf()
    nondet mode = Set("review", "register").oneOf()
    nondet bounty = Set(false, true).oneOf()
    nondet automatic = Set(false, true).oneOf()
    nondet yes = Set(false, true).oneOf()
    nondet prepared = Set("compatible", "refused", "conflict", "unavailable").oneOf()
    nondet receipt = Set("pending", "invalid", "failed", "valid", "unavailable").oneOf()
    any { begin(family, mode, bounty, automatic, yes), claim(yes), asset(yes), templates(yes),
      skipWrongNetwork, prepare(prepared), roleCheck(yes), exhausted, transaction(receipt), replaceClaim, s' = s }
  }
  val invariant = all { Set(1, 2).contains(s.candidate), Set(0, 1, 2).contains(s.selected),
    not(s.signed), not(s.broadcast),
    s.result == "unsigned-review" implies s.mode == "review" and s.selected > 0 and s.observedClaim > 0,
    Set("pending", "verified-deployment", "failed-422").contains(s.result) implies s.mode == "register" and s.selected > 0,
    s.result == "creation-422" implies s.candidate == 2,
    s.bounty and s.automatic implies s.result == "policy-422" }
  action ready(family: str, mode: str): bool = begin(family, mode, false, false, true)
    .then(claim(true)).then(asset(true)).then(templates(true))
  action selected(family: str, mode: str): bool = ready(family, mode).then(prepare("compatible")).then(roleCheck(false))
  run ordinaryPolicyRefusalTest = init.then(begin("evm", "review", false, false, false)).expect(s.result == "policy-422" and invariant)
  run automaticBountyRefusalTest = init.then(begin("solana", "review", true, true, true)).expect(s.result == "policy-422" and invariant)
  run absentEffectiveClaimRefusesTest = init.then(begin("evm", "register", false, false, true)).then(claim(false))
    .expect(s.result == "wallet-403" and invariant)
  run unavailableAssetRefusesTest = init.then(begin("solana", "register", false, false, true)).then(claim(true)).then(asset(false))
    .expect(s.result == "asset-422" and invariant)
  run evmReviewReturnsNoSignedOrBroadcastTransactionTest = init.then(selected("evm", "review"))
    .expect(s.result == "unsigned-review" and invariant)
  run solanaReviewReturnsNoSignedOrBroadcastTransactionTest = init.then(selected("solana", "review"))
    .expect(s.result == "unsigned-review" and invariant)
  run wrongNetworkCandidateIsSkippedTest = init.then(ready("evm", "review")).then(skipWrongNetwork).then(prepare("compatible")).then(roleCheck(false))
    .expect(s.selected == 2 and s.result == "unsigned-review" and invariant)
  run refusedFactoryCanUseRetainedReviewTest = init.then(ready("evm", "review")).then(prepare("refused")).then(prepare("compatible")).then(roleCheck(false))
    .expect(s.selected == 2 and invariant)
  run solanaPreparationConflictCanUseLaterReviewTest = init.then(ready("solana", "review")).then(prepare("conflict"))
    .then(prepare("compatible")).then(roleCheck(false)).expect(s.selected == 2 and invariant)
  run networkFailureDoesNotMasqueradeAsTemplateMismatchTest = init.then(ready("evm", "review")).then(prepare("unavailable"))
    .expect(s.result == "network-503" and s.candidate == 1 and invariant)
  run evmExhaustionIsUnavailableTest = init.then(ready("evm", "register")).then(prepare("refused")).then(prepare("refused")).then(exhausted)
    .expect(s.result == "unavailable-503" and invariant)
  run solanaExhaustionPreservesCreationConflictTest = init.then(ready("solana", "register")).then(prepare("conflict")).then(prepare("refused")).then(exhausted)
    .expect(s.result == "creation-422" and invariant)
  run platformRoleConflictRefusesBeforeReceiptTest = init.then(ready("evm", "register")).then(prepare("compatible")).then(roleCheck(true))
    .expect(s.result == "role-422" and invariant)
  run unfinalizedCreationRemainsPendingTest = init.then(selected("evm", "register")).then(transaction("pending"))
    .expect(s.result == "pending" and invariant)
  run finalizedExactCreationReturnsDeploymentTest = init.then(selected("solana", "register")).then(transaction("valid"))
    .expect(s.result == "verified-deployment" and invariant)
  run failedCreationDoesNotRegisterTest = init.then(selected("evm", "register")).then(transaction("failed"))
    .expect(s.result == "failed-422" and invariant)
  run registrationTransportFailureIsRetryableTest = init.then(selected("solana", "register")).then(transaction("unavailable"))
    .expect(s.result == "network-503" and invariant)
  run claimObservationDoesNotLockAcrossRpcTest = init.then(selected("evm", "register")).then(replaceClaim).then(transaction("valid"))
    .expect(s.observedClaim == 1 and s.currentClaim == 2 and s.result == "verified-deployment" and invariant)
  run laterMatchingInfrastructureRecoversRegistrationTest = init.then(selected("evm", "register")).then(transaction("invalid"))
    .then(prepare("compatible")).then(roleCheck(false)).then(transaction("valid"))
    .expect(s.selected == 2 and s.result == "verified-deployment" and invariant)
  run laterSolanaProgramRecoversRegistrationTest = init.then(selected("solana", "register")).then(transaction("invalid"))
    .then(prepare("compatible")).then(roleCheck(false)).then(transaction("valid"))
    .expect(s.selected == 2 and s.result == "verified-deployment" and invariant)
  run allMismatchesRetainCreationRefusalTest = init.then(selected("evm", "register")).then(transaction("invalid"))
    .then(prepare("compatible")).then(roleCheck(false)).then(transaction("invalid")).then(exhausted)
    .expect(s.result == "creation-422" and invariant)
  run laterPreparationFailureDoesNotHideEarlierMismatchTest = init.then(selected("solana", "register")).then(transaction("invalid"))
    .then(prepare("refused")).then(exhausted).expect(s.result == "creation-422" and invariant)
  run oldFirstCandidateMismatchNegativeControlTest = init.then(selected("evm", "register")).then(oldTerminalMismatch)
    .expect(not(invariant))
}
