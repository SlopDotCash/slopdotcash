// @source backend/security/direct-solana-recovery.ts
// @source backend/security/direct-payments.ts
// @source backend/security/handler.ts
// @source workers/fee-converter/solana-expiry.ts
// @evidence formal/tests/direct-solana-retirement.test.ts
// @evidence backend/security/direct-solana-api.integration.ts
// One invocation, one payer, one or two distinct retained messages, two
// providers. The production guard is 1..64 plans and <=64 submitted signatures;
// empty/over-64 are input-refusal classes, not a new two-plan production cap.
// Valid 3..64-plan executions are outside this finite protocol bound. Message
// shape, canonical payer/hash/base58 and strict Ed25519 checks are predicates.
// Only retained messages become challenges; submitted signatures select IDs,
// never replacement bytes. Caller aggregation/revision commits and UI cache
// validation are separate models. This function alone never creates a payment.
// Providers are resolved before the caught RPC phase: invalid URL may throw;
// absent/unrecognized/same-operator pairs hold. Loopback exception applies only
// to distinct endpoints with non-mainnet genesis. No independence or RPC truth
// is proved here. Genesis is checked per provider, then every retained anchor,
// context slot, invalid-blockhash result and strict finalized-height bound.
// Height classes 1/2/3 stand for below/equal/above bound 2; context adequacy is a
// predicate for the retained anchor. A missing validity value is not false and
// therefore yields expiry-required when context/height shapes are valid.
// All expiry checks precede any signature validation/challenge. Signature
// validation precedes history. History visits plans first, providers second;
// malformed/caught RPC failure can override an already found transaction.
// Any other non-null observation is conservatively payment-found, not verified
// payment or finality. Matching failed receipts require exact signed bytes,
// slot/block signature inclusion and matching error/block identity from both
// providers. One failure plus absence holds rather than using absence proof.
// proveSolanaExpiry is abstracted by complete/incomplete/error outcomes; its
// retained scan writes may survive any later hold. Scan effects here represent
// at most one write witness per plan/provider, not its full 32-page budget or
// the history algorithm. Existing direct_solana_retirement/expiry models retain
// that lower-level coverage contract. All source/tests are references only;
// no test, checker, parser, validator or provider was executed.
module solana_history_retirement {
  val planIds = Set(1, 2)
  val providers = Set(1, 2)
  val pairIds = Set(1, 2, 3, 4)
  val selections = Set(Set(), Set(1), Set(2), Set(1, 2))
  type State = { phase: str, plans: Set[int], supplied: Set[int], invalidSignature: str,
    plan: int, provider: int, pairTrusted: bool, validity: str,
    expired: Set[int], signaturesChecked: bool, challenges: Set[int],
    observations: int -> str, failureIds: int -> int,
    found: Set[int], proofs: Set[int], incomplete: bool, scanEffects: Set[int], result: str }
  var s: State
  action init = s' = { phase: "input", plans: Set(), supplied: Set(), invalidSignature: "none",
    plan: 1, provider: 1, pairTrusted: false, validity: "none", expired: Set(),
    signaturesChecked: false, challenges: Set(), observations: pairIds.mapBy(_ => "none"),
    failureIds: pairIds.mapBy(_ => 0), found: Set(), proofs: Set(), incomplete: false,
    scanEffects: Set(), result: "none" }
  def pair(plan: int, provider: int): int = (plan - 1) * 2 + provider
  def done(result: str): State = s.with("phase", "done").with("result", result)
  val nextExpiry = if (s.plan == 1 and s.plans.contains(2)) s.with("plan", 2).with("phase", "anchor")
    else if (s.provider == 1) s.with("provider", 2).with("plan", 1).with("phase", "genesis")
    else s.with("phase", "signatures")
  val nextHistory = if (s.plan == 1 and s.plans.contains(2))
    s.with("plan", 2).with("provider", 1).with("phase", "history-status") else s.with("phase", "finish")
  val nextProvider = if (s.provider == 1) s.with("provider", 2).with("phase", "history-status")
    else s.with("phase", "plan-result")
  action input(kind: str, plans: int, supplied: Set[int], invalidSignature: str): bool = all {
    s.phase == "input", Set("valid", "empty", "over-plans", "over-signatures").contains(kind),
    planIds.contains(plans), selections.contains(supplied), Set("none", "unknown", "duplicate", "invalid").contains(invalidSignature),
    s' = if (kind != "valid") done("input-error") else s.with("phase", "payer")
      .with("plans", if (plans == 1) Set(1) else planIds).with("supplied", supplied).with("invalidSignature", invalidSignature) }
  action payer(valid: bool): bool = all { s.phase == "payer", s' = if (valid) s.with("phase", "messages") else done("input-error") }
  action messages(kind: str): bool = all { s.phase == "messages", Set("valid", "wire", "hash", "anchor", "duplicate").contains(kind),
    s' = if (kind == "valid") s.with("phase", "providers") else done("input-error") }
  action providerPair(kind: str): bool = all {
    s.phase == "providers", Set("independent", "local-nonmainnet", "local-mainnet", "missing", "same", "unknown", "invalid-url").contains(kind),
    s' = if (kind == "invalid-url") done("input-error")
      else if (Set("independent", "local-nonmainnet").contains(kind)) s.with("phase", "genesis").with("pairTrusted", true)
      else done("history-check") }
  action genesis(matches: bool): bool = all { s.phase == "genesis", s' = if (matches) s.with("phase", "anchor") else done("history-check") }
  action anchor(matches: bool): bool = all { s.phase == "anchor", s' = if (matches) s.with("phase", "validity") else done("history-check") }
  action validity(kind: str): bool = all { s.phase == "validity", Set("false", "true", "missing-value", "bad-context").contains(kind),
    s' = s.with("phase", "height").with("validity", kind) }
  action height(value: int): bool = all { s.phase == "height", Set(-1, 1, 2, 3).contains(value),
    s' = if (value == -1 or s.validity == "bad-context") done("history-check")
      else if (s.validity != "false" or value <= 2) done("expiry-required")
      else nextExpiry.with("expired", s.expired.union(Set(pair(s.plan, s.provider)))) }
  action signatures = all { s.phase == "signatures",
    s' = if (s.invalidSignature != "none" or not(s.supplied.subseteq(s.plans))) done("signature-error")
      else if (s.supplied != s.plans) done("signature-required").with("signaturesChecked", true)
        .with("challenges", s.plans.exclude(s.supplied))
      else s.with("phase", "history-status").with("plan", 1).with("provider", 1).with("signaturesChecked", true) }
  action historyStatus(validContextAndShape: bool): bool = all { s.phase == "history-status",
    s' = if (validContextAndShape) s.with("phase", "history-receipt") else done("history-check") }
  action observation(kind: str): bool = all {
    s.phase == "history-receipt", Set("absent", "candidate-failure", "found").contains(kind),
    s' = if (kind == "candidate-failure") s.with("phase", "failure-proof")
      else nextProvider.with("observations", s.observations.set(pair(s.plan, s.provider), kind))
        .with("found", if (kind == "found") s.found.union(Set(s.plan)) else s.found) }
  action failureProof(valid: bool, identity: int): bool = all {
    s.phase == "failure-proof", planIds.contains(identity),
    s' = if (not(valid)) done("history-check") else nextProvider
      .with("observations", s.observations.set(pair(s.plan, s.provider), "failure"))
      .with("failureIds", s.failureIds.set(pair(s.plan, s.provider), identity)) }
  action planResult = {
    val first = s.observations.get(pair(s.plan, 1))
    val second = s.observations.get(pair(s.plan, 2))
    val anyFailure = first == "failure" or second == "failure"
    val matching = first == "failure" and second == "failure"
      and s.failureIds.get(pair(s.plan, 1)) == s.failureIds.get(pair(s.plan, 2))
    all { s.phase == "plan-result",
      s' = if (s.found.size() > 0) nextHistory
        else if (anyFailure) nextHistory.with("proofs", if (matching) s.proofs.union(Set(s.plan)) else s.proofs)
          .with("incomplete", s.incomplete or not(matching))
        else s.with("phase", "coverage") }
  }
  action retainScan(provider: int): bool = all { s.phase == "coverage", providers.contains(provider),
    not(s.scanEffects.contains(pair(s.plan, provider))),
    s' = s.with("scanEffects", s.scanEffects.union(Set(pair(s.plan, provider)))) }
  action coverage(complete: bool): bool = all { s.phase == "coverage",
    s' = nextHistory.with("proofs", if (complete) s.proofs.union(Set(s.plan)) else s.proofs)
      .with("incomplete", s.incomplete or not(complete)) }
  action caughtFailure = all { Set("genesis", "anchor", "validity", "height", "history-status", "history-receipt", "failure-proof", "coverage").contains(s.phase),
    s' = done("history-check") }
  action finish = all { s.phase == "finish", s' = done(if (s.found.size() > 0) "payment-found" else if (s.incomplete) "history-check" else "retired") }
  action step = {
    nondet kind = Set("valid", "empty", "over-plans", "over-signatures").oneOf()
    nondet plans = planIds.oneOf()
    nondet supplied = selections.oneOf()
    nondet invalid = Set("none", "unknown", "duplicate", "invalid").oneOf()
    nondet message = Set("valid", "wire", "hash", "anchor", "duplicate").oneOf()
    nondet pairKind = Set("independent", "local-nonmainnet", "local-mainnet", "missing", "same", "unknown", "invalid-url").oneOf()
    nondet value = Set(-1, 1, 2, 3).oneOf()
    nondet valid = Set(false, true).oneOf()
    nondet validityKind = Set("false", "true", "missing-value", "bad-context").oneOf()
    nondet observationKind = Set("absent", "candidate-failure", "found").oneOf()
    any { input(kind, plans, supplied, invalid), payer(valid), messages(message), providerPair(pairKind),
      genesis(valid), anchor(valid), validity(validityKind), height(value), signatures, historyStatus(valid),
      observation(observationKind), failureProof(valid, plans), planResult, retainScan(plans), coverage(valid), caughtFailure, finish, s' = s }
  }
  val expectedPairs = s.plans.fold(Set(), (pairs, plan) => pairs.union(Set(pair(plan, 1), pair(plan, 2))))
  val invariant = all {
    s.plans.subseteq(planIds), s.expired.subseteq(pairIds), s.found.subseteq(s.plans), s.proofs.subseteq(s.plans), s.scanEffects.subseteq(pairIds),
    s.result == "signature-required" implies s.pairTrusted and s.expired == expectedPairs
      and s.signaturesChecked and s.challenges == s.plans.exclude(s.supplied) and s.challenges.size() > 0,
    s.result == "retired" implies s.pairTrusted and s.expired == expectedPairs and s.signaturesChecked
      and s.supplied == s.plans and s.found == Set() and not(s.incomplete) and s.proofs == s.plans,
    s.result == "payment-found" implies s.found.size() > 0 and s.signaturesChecked,
    s.signaturesChecked implies s.expired == expectedPairs }
  action ready(plans: int, supplied: Set[int], invalid: str): bool = init.then(input("valid", plans, supplied, invalid))
    .then(payer(true)).then(messages("valid")).then(providerPair("independent"))
  action expiredPlan = anchor(true).then(validity("false")).then(height(3))
  action expiredOne = genesis(true).then(expiredPlan).then(genesis(true)).then(expiredPlan)
  action expiredTwo = genesis(true).then(expiredPlan).then(expiredPlan).then(genesis(true)).then(expiredPlan).then(expiredPlan)
  action historyReady = ready(2, planIds, "none").then(expiredTwo).then(signatures)
  action absent = historyStatus(true).then(observation("absent"))
  action failed(identity: int): bool = historyStatus(true).then(observation("candidate-failure")).then(failureProof(true, identity))
  action found = historyStatus(true).then(observation("found"))

  run emptyPlanListRefusesTest = init.then(input("empty", 1, Set(), "none")).expect(s.result == "input-error" and invariant)
  run over64PlansRefusesTest = init.then(input("over-plans", 2, Set(), "none")).expect(s.result == "input-error" and invariant)
  run over64SignaturesRefusesTest = init.then(input("over-signatures", 2, planIds, "none")).expect(s.result == "input-error" and invariant)
  run malformedRetainedMessageRefusesTest = init.then(input("valid", 1, Set(), "none")).then(payer(true)).then(messages("wire"))
    .expect(s.result == "input-error" and invariant)
  run duplicateRetainedMessageIdRefusesTest = init.then(input("valid", 2, Set(), "none")).then(payer(true)).then(messages("duplicate"))
    .expect(s.result == "input-error" and invariant)
  run noncanonicalPayerRefusesTest = init.then(input("valid", 1, Set(), "none")).then(payer(false))
    .expect(s.result == "input-error" and invariant)
  run sameOperatorCannotSupplyIndependentHistoryTest = init.then(input("valid", 1, Set(), "none")).then(payer(true)).then(messages("valid"))
    .then(providerPair("same")).expect(s.result == "history-check" and invariant)
  run invalidProviderUrlThrowsBeforeCaughtRpcPhaseTest = init.then(input("valid", 1, Set(), "none")).then(payer(true)).then(messages("valid"))
    .then(providerPair("invalid-url")).expect(s.result == "input-error" and invariant)
  run mainnetLoopbackExceptionIsRefusedTest = init.then(input("valid", 1, Set(), "none")).then(payer(true)).then(messages("valid"))
    .then(providerPair("local-mainnet")).expect(s.result == "history-check" and invariant)
  run nonmainnetDistinctLoopbacksCanReachExpiryChecksTest = init.then(input("valid", 1, Set(), "none")).then(payer(true)).then(messages("valid"))
    .then(providerPair("local-nonmainnet")).expect(s.phase == "genesis" and s.pairTrusted and invariant)
  run oneLivePlanWithholdsEveryChallengeTest = ready(2, Set(), "invalid").then(genesis(true)).then(expiredPlan)
    .then(anchor(true)).then(validity("true")).then(height(3))
    .expect(s.result == "expiry-required" and not(s.signaturesChecked) and s.challenges == Set() and invariant)
  run equalLastValidHeightStillRefusesChallengeTest = ready(1, Set(), "none").then(genesis(true)).then(anchor(true)).then(validity("false")).then(height(2))
    .expect(s.result == "expiry-required" and invariant)
  run missingValidityValueIsNotAnExpiryProofTest = ready(1, Set(), "none").then(genesis(true)).then(anchor(true)).then(validity("missing-value")).then(height(3))
    .expect(s.result == "expiry-required" and invariant)
  run staleValidityContextHoldsTest = ready(1, Set(), "none").then(genesis(true)).then(anchor(true)).then(validity("bad-context")).then(height(3))
    .expect(s.result == "history-check" and invariant)
  run wrongGenesisHoldsBeforeSignatureValidationTest = ready(1, Set(1), "invalid").then(genesis(false))
    .expect(s.result == "history-check" and not(s.signaturesChecked) and invariant)
  run wrongRetainedAnchorHoldsTest = ready(1, Set(), "none").then(genesis(true)).then(anchor(false))
    .expect(s.result == "history-check" and invariant)
  run challengesContainOnlyMissingRetainedMessagesTest = ready(2, Set(1), "none").then(expiredTwo).then(signatures)
    .expect(s.result == "signature-required" and s.challenges == Set(2) and invariant)
  run invalidSignatureThrowsBeforeHistoryTest = ready(2, planIds, "invalid").then(expiredTwo).then(signatures)
    .expect(s.result == "signature-error" and pairIds.forall(id => s.observations.get(id) == "none") and invariant)
  run duplicateSignatureIdThrowsTest = ready(2, planIds, "duplicate").then(expiredTwo).then(signatures)
    .expect(s.result == "signature-error" and invariant)
  run matchingFailedReceiptsRetireEveryMessageTest = historyReady.then(failed(1)).then(failed(1)).then(planResult)
    .then(failed(2)).then(failed(2)).then(planResult).then(finish).expect(s.result == "retired" and s.proofs == planIds and invariant)
  run disagreementBetweenFailedReceiptsHoldsTest = historyReady.then(failed(1)).then(failed(2)).then(planResult)
    .then(failed(1)).then(failed(1)).then(planResult).then(finish).expect(s.result == "history-check" and invariant)
  run oneFailedReceiptAndAbsenceDoNotUseCoverageTest = historyReady.then(failed(1)).then(absent).then(planResult)
    .then(failed(1)).then(failed(1)).then(planResult).then(finish)
    .expect(s.result == "history-check" and s.scanEffects == Set() and invariant)
  run foundObservationOverridesIncompleteEarlierPlanTest = historyReady.then(failed(1)).then(absent).then(planResult)
    .then(found).then(absent).then(planResult).then(finish).expect(s.result == "payment-found" and s.incomplete and invariant)
  run malformedLaterObservationOverridesFoundTest = historyReady.then(found).then(absent).then(planResult).then(historyStatus(false))
    .expect(s.result == "history-check" and s.found == Set(1) and invariant)
  run malformedFailureProofOverridesFoundTest = historyReady.then(found).then(absent).then(planResult)
    .then(historyStatus(true)).then(observation("candidate-failure")).then(failureProof(false, 1))
    .expect(s.result == "history-check" and s.found == Set(1) and invariant)
  run completeAbsenceCoverageRetiresAllMessagesTest = historyReady.then(absent).then(absent).then(planResult).then(coverage(true))
    .then(absent).then(absent).then(planResult).then(coverage(true)).then(finish)
    .expect(s.result == "retired" and s.proofs == planIds and invariant)
  run failedCoverageReplyKeepsAlreadyRetainedPagesTest = historyReady.then(absent).then(absent).then(planResult)
    .then(retainScan(1)).then(caughtFailure).expect(s.result == "history-check" and s.scanEffects == Set(1) and invariant)
  run foundLaterDoesNotEraseEarlierScanWritesTest = historyReady.then(absent).then(absent).then(planResult).then(retainScan(1)).then(coverage(false))
    .then(found).then(absent).then(planResult).then(finish)
    .expect(s.result == "payment-found" and s.scanEffects == Set(1) and invariant)
  run caughtRpcFailureOverridesAlreadyFoundTest = historyReady.then(found).then(caughtFailure)
    .expect(s.result == "history-check" and s.found == Set(1) and invariant)
}
