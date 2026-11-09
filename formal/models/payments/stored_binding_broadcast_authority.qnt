// @source workers/payment-executor/core.ts
// @source workers/payment-executor/index.ts
// @source scripts/payment-keeper/keeper.ts
// @source migrations/0016_binding_authorizations.sql
// @evidence workers/payment-executor/bind-trigger.integration.ts
// @evidence workers/payment-executor/binding-nonce-limit.integration.ts
// One actor, obligation, deployment and retained original binding; at most two
// calls and three immutable same-nonce signed candidates. Candidate IDs stand
// for distinct hashes/fees with identical actor, claim, destination, calldata,
// version and consent. Crypto, fee arithmetic, D1 joins and journal integrity
// are predicates, not proofs here. Candidate validation receives the actual
// bytes/hash together with original metadata; retained-budget validation keeps
// the original attempt identity. No action deletes or rewrites signed bytes.
// Hosted bind-destinations does not set FEE_BUMP. Variants model the generic
// broadcast/helper boundary and do not claim a hosted stored-binding fee-bump
// caller exists. Fee selection, replacement signing and cancellation are out
// of scope; an already signed candidate is the input to this boundary.
// Attempt loading and its earlier admission/budget guards are assumed passed.
// The modeled suffix is receipt observation, final retained-budget await, then
// the optional stored-binding authority callback and network send. The callback's
// registry, signer, unpaid, version, policy and consent observations are not a
// transaction. Consent captures a clock before its D1 await; units abstract the
// strict 600-second submission margin: expiry 2, margin 1, clock 0..2. Changes
// after any observation remain possible, including after final registry read.
// Consent rows are immutable. A failed exact-consent predicate summarizes an
// unavailable/mismatched query result or invalid retained input, not deletion.
// registryAllowed summarizes the exact reserved-obligation/approved-wallet join
// and its signature checks; it does not add an account-ban policy to this path.
// The invariant proves an ordered set of observations, never atomic or live
// authority at the external send. No deadline, fairness or automatic retry is
// assumed. A later call is an explicit retry; two calls may also overlap.
// A receipt can reconcile obsolete bytes without authorizing another send.
// One canonical same-nonce receipt is assumed. Known hashes describe this RPC
// node's observation only; missing hashes are not proof of non-submission.
// Waiting sends retain their fee-wait result, but authority errors are never
// swallowed as fee-wait outcomes. Lost replies preserve all retained effects.
// The old callback-before-budget order is an explicit negative control outside
// step. Existing integration files are source references; no test, parser or
// checker was executed when these definitions were authored.
module stored_binding_broadcast_authority {
  val ids = Set(1, 2)
  val candidates = Set(1, 2, 3)
  val expiry = 2
  val margin = 1
  type Call = { phase: str, candidate: int, waiting: bool, budget: bool,
    checkedCandidate: int, afterBudget: bool, firstRegistry: bool,
    signer: bool, unpaid: bool, version: int, policy: bool,
    consentStamp: int, consent: bool, finalRegistry: bool,
    sent: bool, observed: bool, desired: str, response: str }
  val idle: Call = { phase: "unused", candidate: 1, waiting: false, budget: false,
    checkedCandidate: 0, afterBudget: false, firstRegistry: false,
    signer: false, unpaid: false, version: -1, policy: false,
    consentStamp: -1, consent: false, finalRegistry: false,
    sent: false, observed: false, desired: "none", response: "none" }
  var s: { now: int, claim: int, registryAllowed: bool, signerAllowed: bool,
    paid: bool, version: int, signed: Set[int],
    known: Set[int], receipts: int -> str, calls: int -> Call }
  action init = s' = { now: 0, claim: 1, registryAllowed: true, signerAllowed: true,
    paid: false, version: 0, signed: Set(1), known: Set(),
    receipts: candidates.mapBy(_ => "none"), calls: ids.mapBy(_ => idle) }
  val registryMatches = s.claim == 1 and s.registryAllowed
  def ended(call: Call, result: str): Call = call.with("phase", "response").with("desired", result)
  def submitted(call: Call): str = if (call.waiting) "waiting" else "submitted"
  val receiptCandidate = s.signed.fold(0, (prior, candidate) =>
    if (s.receipts.get(candidate) != "none" and candidate > prior) candidate else prior)
  val receiptStatus = if (receiptCandidate == 0) "none" else s.receipts.get(receiptCandidate)
  action advance = all { s.now < 2, s' = s.with("now", s.now + 1) }
  action replaceClaim = all { s.claim == 1, s' = s.with("claim", 2) }
  action restrictRegistry = all { s.registryAllowed, s' = s.with("registryAllowed", false) }
  action rotateSigner = all { s.signerAllowed, s' = s.with("signerAllowed", false) }
  action payAward = all { not(s.paid), s' = s.with("paid", true) }
  action changeVersion = all { s.version == 0, s' = s.with("version", 1) }
  action retainVariant(candidate: int): bool = all {
    candidates.contains(candidate), candidate > 1, s.signed.contains(candidate - 1),
    not(s.signed.contains(candidate)), s' = s.with("signed", s.signed.union(Set(candidate))) }
  action mine(candidate: int, successful: bool): bool = all {
    s.signed.contains(candidate), s.known.contains(candidate), receiptCandidate == 0,
    s' = s.with("receipts", s.receipts.set(candidate, if (successful) "success" else "reverted")) }
  action begin(id: int, candidate: int, waiting: bool): bool = all {
    ids.contains(id), s.signed.contains(candidate), s.calls.get(id).phase == "unused",
    s' = s.with("calls", s.calls.set(id, idle.with("phase", "receipt")
      .with("candidate", candidate).with("waiting", waiting))) }
  action receiptRead(id: int): bool = {
    val call = s.calls.get(id)
    all { call.phase == "receipt", s' = s.with("calls", s.calls.set(id,
      if (receiptStatus == "none") call.with("phase", "budget")
      else ended(call, if (receiptStatus == "success") "receipt" else "reverted"))) }
  }
  action budgetReply(id: int, accepted: bool): bool = {
    val call = s.calls.get(id)
    all { call.phase == "budget", s' = s.with("calls", s.calls.set(id,
      if (accepted) call.with("phase", "intent").with("budget", true)
      else ended(call, "budget-error"))) }
  }
  action intentReply(id: int, accepted: bool): bool = {
    val call = s.calls.get(id)
    all { call.phase == "intent", s' = s.with("calls", s.calls.set(id,
      if (accepted) call.with("phase", "registry-first").with("checkedCandidate", call.candidate)
        .with("afterBudget", call.budget)
      else ended(call, "authority-error"))) }
  }
  action firstRegistryRead(id: int): bool = {
    val call = s.calls.get(id)
    all { call.phase == "registry-first", s' = s.with("calls", s.calls.set(id,
      if (registryMatches) call.with("phase", "signer").with("firstRegistry", true)
      else ended(call, "authority-error"))) }
  }
  action signerRead(id: int): bool = {
    val call = s.calls.get(id)
    all { call.phase == "signer", s' = s.with("calls", s.calls.set(id,
      if (s.signerAllowed) call.with("phase", "unpaid").with("signer", true)
      else ended(call, "authority-error"))) }
  }
  action unpaidRead(id: int): bool = {
    val call = s.calls.get(id)
    all { call.phase == "unpaid", s' = s.with("calls", s.calls.set(id,
      if (not(s.paid)) call.with("phase", "version").with("unpaid", true)
      else ended(call, "authority-error"))) }
  }
  action versionRead(id: int): bool = {
    val call = s.calls.get(id)
    all { call.phase == "version", s' = s.with("calls", s.calls.set(id,
      if (s.version == 0) call.with("phase", "policy").with("version", s.version)
      else ended(call, "authority-error"))) }
  }
  action policyReply(id: int, accepted: bool): bool = {
    val call = s.calls.get(id)
    all { call.phase == "policy", s' = s.with("calls", s.calls.set(id,
      if (accepted) call.with("phase", "consent-start").with("policy", true)
      else ended(call, "authority-error"))) }
  }
  action startConsentRead(id: int): bool = {
    val call = s.calls.get(id)
    all { call.phase == "consent-start", s' = s.with("calls", s.calls.set(id,
      call.with("phase", "consent-reply").with("consentStamp", s.now))) }
  }
  action consentReply(id: int, exactConsentValid: bool): bool = {
    val call = s.calls.get(id)
    val accepted = exactConsentValid and expiry > call.consentStamp + margin
    all { call.phase == "consent-reply", s' = s.with("calls", s.calls.set(id,
      if (accepted) call.with("phase", "registry-final").with("consent", true)
      else ended(call, "authority-error"))) }
  }
  action finalRegistryRead(id: int): bool = {
    val call = s.calls.get(id)
    all { call.phase == "registry-final", s' = s.with("calls", s.calls.set(id,
      if (registryMatches) call.with("phase", "ready").with("finalRegistry", true)
      else ended(call, "authority-error"))) }
  }
  action awaitFailure(id: int): bool = {
    val call = s.calls.get(id)
    all { Set("receipt", "budget", "intent", "registry-first", "signer", "unpaid", "version",
      "policy", "consent-reply", "registry-final").contains(call.phase),
      s' = s.with("calls", s.calls.set(id, ended(call, "check-error"))) }
  }
  action transmit(id: int, knownToNode: bool): bool = {
    val call = s.calls.get(id)
    all { call.phase == "ready",
      s' = s.with("known", if (knownToNode) s.known.union(Set(call.candidate)) else s.known)
        .with("calls", s.calls.set(id, call.with("phase", "rpc-reply").with("sent", true))) }
  }
  action rpcReply(id: int, exactHash: bool): bool = {
    val call = s.calls.get(id)
    all { call.phase == "rpc-reply", not(exactHash) or s.known.contains(call.candidate),
      s' = s.with("calls", s.calls.set(id, if (exactHash) ended(call, submitted(call))
        else call.with("phase", "hash-read"))) }
  }
  action hashRead(id: int, readSucceeded: bool): bool = {
    val call = s.calls.get(id)
    val observed = readSucceeded and s.known.contains(call.candidate)
    all { call.phase == "hash-read", s' = s.with("calls", s.calls.set(id,
      ended(call.with("observed", observed), if (observed) submitted(call)
        else if (call.waiting) "waiting" else "send-error"))) }
  }
  action respond(id: int, delivered: bool): bool = {
    val call = s.calls.get(id)
    all { call.phase == "response", s' = s.with("calls", s.calls.set(id,
      call.with("phase", "done").with("response", if (delivered) call.desired else "lost"))) }
  }
  // Historical complete callback before the retained-budget await. This is
  // intentionally absent from step; it witnesses the repaired stale window.
  action oldAuthorizeBeforeBudget(id: int): bool = {
    val call = s.calls.get(id)
    all { call.phase == "budget", registryMatches, s.signerAllowed, not(s.paid),
      s.version == 0, expiry > s.now + margin,
      s' = s.with("calls", s.calls.set(id, call.with("phase", "old-budget")
        .with("checkedCandidate", call.candidate).with("firstRegistry", true)
        .with("signer", true).with("unpaid", true).with("version", 0).with("policy", true)
        .with("consentStamp", s.now).with("consent", true).with("finalRegistry", true))) }
  }
  action oldBudgetReply(id: int): bool = {
    val call = s.calls.get(id)
    all { call.phase == "old-budget", s' = s.with("calls", s.calls.set(id,
      call.with("phase", "ready").with("budget", true))) }
  }
  action step = {
    nondet id = ids.oneOf()
    nondet candidate = candidates.oneOf()
    nondet a = Set(false, true).oneOf()
    nondet b = Set(false, true).oneOf()
    any { advance, replaceClaim, restrictRegistry, rotateSigner, payAward, changeVersion,
      retainVariant(candidate), mine(candidate, a), begin(id, candidate, a),
      receiptRead(id), budgetReply(id, a), intentReply(id, a), firstRegistryRead(id),
      signerRead(id), unpaidRead(id), versionRead(id), policyReply(id, a), startConsentRead(id),
      consentReply(id, a), finalRegistryRead(id), awaitFailure(id), transmit(id, a),
      rpcReply(id, a), hashRead(id, a), respond(id, b), s' = s }
  }
  val invariant = all {
    Set(0, 1, 2).contains(s.now), Set(1, 2).contains(s.claim), Set(0, 1).contains(s.version),
    s.signed.contains(1), s.signed.subseteq(candidates), s.known.subseteq(s.signed),
    candidates.filter(candidate => s.receipts.get(candidate) != "none").size() <= 1,
    candidates.forall(candidate => s.receipts.get(candidate) == "none" or s.known.contains(candidate)),
    ids.forall(id => {
      val call = s.calls.get(id)
      all { s.signed.contains(call.candidate),
        call.sent implies call.budget and call.afterBudget and call.checkedCandidate == call.candidate
          and call.firstRegistry and call.signer and call.unpaid and call.version == 0
          and call.policy and call.consent and call.finalRegistry and expiry > call.consentStamp + margin,
        call.observed implies call.sent and s.known.contains(call.candidate),
        call.desired == "submitted" implies call.sent and not(call.waiting) and s.known.contains(call.candidate),
        call.desired == "waiting" implies call.waiting and call.sent,
        Set("authority-error", "budget-error", "check-error", "receipt", "reverted").contains(call.desired) implies not(call.sent) }
    }) }
  action started(id: int, candidate: int, waiting: bool): bool = begin(id, candidate, waiting).then(receiptRead(id))
  action checkedThroughVersion(id: int): bool = budgetReply(id, true).then(intentReply(id, true))
    .then(firstRegistryRead(id)).then(signerRead(id)).then(unpaidRead(id)).then(versionRead(id))
  action checkedThroughConsent(id: int): bool = checkedThroughVersion(id).then(policyReply(id, true))
    .then(startConsentRead(id)).then(consentReply(id, true))
  action ready(id: int): bool = checkedThroughConsent(id).then(finalRegistryRead(id))
  action sent(id: int): bool = transmit(id, true).then(rpcReply(id, true)).then(respond(id, true))

  run originalCandidatePassesOrderedAuthorityTest = init.then(started(1, 1, false)).then(ready(1)).then(sent(1))
    .expect(s.calls.get(1).response == "submitted" and invariant)
  run replacementCandidateUsesActualSignedIdentityTest = init.then(retainVariant(2)).then(started(1, 2, false)).then(ready(1)).then(sent(1))
    .expect(s.calls.get(1).checkedCandidate == 2 and s.signed == Set(1, 2) and invariant)
  run latestThirdVariantUsesActualSignedIdentityTest = init.then(retainVariant(2)).then(retainVariant(3))
    .then(started(1, 3, false)).then(ready(1)).then(sent(1)).expect(s.calls.get(1).checkedCandidate == 3 and invariant)
  run changedClaimDuringBudgetAwaitRefusesTest = init.then(started(1, 1, false)).then(replaceClaim)
    .then(budgetReply(1, true)).then(intentReply(1, true)).then(firstRegistryRead(1)).then(respond(1, true))
    .expect(s.calls.get(1).response == "authority-error" and not(s.calls.get(1).sent) and s.signed == Set(1) and invariant)
  run oldOrderCanSendObsoleteClaimNegativeControlTest = init.then(started(1, 1, false)).then(oldAuthorizeBeforeBudget(1))
    .then(replaceClaim).then(oldBudgetReply(1)).then(sent(1))
    .expect(s.claim == 2 and s.calls.get(1).sent and not(invariant))
  run invalidRetainedBudgetRefusesBeforeAuthorityTest = init.then(started(1, 1, false)).then(budgetReply(1, false)).then(respond(1, true))
    .expect(s.calls.get(1).response == "budget-error" and s.calls.get(1).checkedCandidate == 0 and invariant)
  run malformedCandidateRefusesBeforeRegistryTest = init.then(started(1, 1, false)).then(budgetReply(1, true))
    .then(intentReply(1, false)).then(respond(1, true)).expect(s.calls.get(1).response == "authority-error" and invariant)
  run registryRestrictionRefusesTest = init.then(started(1, 1, false)).then(budgetReply(1, true)).then(intentReply(1, true))
    .then(restrictRegistry).then(firstRegistryRead(1)).then(respond(1, true)).expect(s.calls.get(1).response == "authority-error" and invariant)
  run signerRotationRefusesTest = init.then(started(1, 1, false)).then(budgetReply(1, true)).then(intentReply(1, true))
    .then(firstRegistryRead(1)).then(rotateSigner).then(signerRead(1)).then(respond(1, true))
    .expect(s.calls.get(1).response == "authority-error" and invariant)
  run paidAwardRefusesTest = init.then(started(1, 1, false)).then(budgetReply(1, true)).then(intentReply(1, true))
    .then(firstRegistryRead(1)).then(signerRead(1)).then(payAward).then(unpaidRead(1)).then(respond(1, true))
    .expect(s.calls.get(1).response == "authority-error" and invariant)
  run changedVersionRefusesTest = init.then(started(1, 1, false)).then(budgetReply(1, true)).then(intentReply(1, true))
    .then(firstRegistryRead(1)).then(signerRead(1)).then(unpaidRead(1)).then(changeVersion).then(versionRead(1)).then(respond(1, true))
    .expect(s.calls.get(1).response == "authority-error" and invariant)
  run bindingPolicyRefusalKeepsSignedBytesTest = init.then(started(1, 1, false)).then(checkedThroughVersion(1))
    .then(policyReply(1, false)).then(respond(1, true)).expect(s.calls.get(1).response == "authority-error" and s.signed == Set(1) and invariant)
  run missingOrMismatchedExactConsentRefusesTest = init.then(started(1, 1, false)).then(checkedThroughVersion(1)).then(policyReply(1, true))
    .then(startConsentRead(1)).then(consentReply(1, false)).then(respond(1, true)).expect(s.calls.get(1).response == "authority-error" and invariant)
  run exactSubmissionMarginRefusesTest = init.then(started(1, 1, false)).then(checkedThroughVersion(1)).then(policyReply(1, true))
    .then(advance).then(startConsentRead(1)).then(consentReply(1, true)).then(respond(1, true))
    .expect(s.calls.get(1).consentStamp == 1 and s.calls.get(1).response == "authority-error" and invariant)
  run delayedConsentReplyUsesCapturedClockTest = init.then(started(1, 1, false)).then(checkedThroughVersion(1)).then(policyReply(1, true))
    .then(startConsentRead(1)).then(advance).then(consentReply(1, true)).then(finalRegistryRead(1)).then(sent(1))
    .expect(s.now == 1 and s.calls.get(1).consentStamp == 0 and s.calls.get(1).response == "submitted" and invariant)
  run finalRegistryRecheckRefusesLateSuccessorTest = init.then(started(1, 1, false)).then(checkedThroughConsent(1))
    .then(replaceClaim).then(finalRegistryRead(1)).then(respond(1, true)).expect(s.calls.get(1).response == "authority-error" and invariant)
  run authorityErrorInWaitingSendIsNotFeeWaitTest = init.then(started(1, 1, true)).then(replaceClaim)
    .then(budgetReply(1, true)).then(intentReply(1, true)).then(firstRegistryRead(1)).then(respond(1, true))
    .expect(s.calls.get(1).response == "authority-error" and not(s.calls.get(1).sent) and invariant)
  run waitingRebroadcastRetainsWaitingResultTest = init.then(started(1, 1, true)).then(ready(1)).then(sent(1))
    .expect(s.calls.get(1).response == "waiting" and s.known == Set(1) and invariant)
  run uncertainReplyWithKnownHashSucceedsTest = init.then(started(1, 1, false)).then(ready(1)).then(transmit(1, true))
    .then(rpcReply(1, false)).then(hashRead(1, true)).then(respond(1, true))
    .expect(s.calls.get(1).response == "submitted" and s.calls.get(1).observed and invariant)
  run uncertainReplyWithMissingHashFailsTest = init.then(started(1, 1, false)).then(ready(1)).then(transmit(1, false))
    .then(rpcReply(1, false)).then(hashRead(1, true)).then(respond(1, true))
    .expect(s.calls.get(1).response == "send-error" and not(s.calls.get(1).observed) and invariant)
  run failedHashReadDoesNotProveNonSubmissionTest = init.then(started(1, 1, false)).then(ready(1)).then(transmit(1, true))
    .then(rpcReply(1, false)).then(hashRead(1, false)).then(respond(1, true))
    .expect(s.calls.get(1).response == "send-error" and s.known == Set(1) and invariant)
  run waitingTransportFailureStillReportsFeeWaitTest = init.then(started(1, 1, true)).then(ready(1)).then(transmit(1, false))
    .then(rpcReply(1, false)).then(hashRead(1, true)).then(respond(1, true))
    .expect(s.calls.get(1).response == "waiting" and invariant)
  run lostSuccessReplyRetainsObservedSubmissionTest = init.then(started(1, 1, false)).then(ready(1))
    .then(transmit(1, true)).then(rpcReply(1, true)).then(respond(1, false))
    .expect(s.calls.get(1).response == "lost" and s.known == Set(1) and s.signed == Set(1) and invariant)
  run failedCheckCanRetrySameSignedCandidateTest = init.then(started(1, 1, false)).then(awaitFailure(1)).then(respond(1, true))
    .then(started(2, 1, false)).then(ready(2)).then(sent(2))
    .expect(s.calls.get(1).response == "check-error" and s.calls.get(2).response == "submitted" and s.signed == Set(1) and invariant)
  run obsoleteSuccessfulReceiptReconcilesWithoutResendTest = init.then(started(1, 1, false)).then(ready(1)).then(sent(1))
    .then(mine(1, true)).then(replaceClaim).then(begin(2, 1, false)).then(receiptRead(2)).then(respond(2, true))
    .expect(s.calls.get(2).response == "receipt" and not(s.calls.get(2).sent) and s.calls.get(2).checkedCandidate == 0 and invariant)
  run revertedReceiptRefusesWithoutResendTest = init.then(started(1, 1, false)).then(ready(1)).then(sent(1))
    .then(mine(1, false)).then(begin(2, 1, false)).then(receiptRead(2)).then(respond(2, true))
    .expect(s.calls.get(2).response == "reverted" and not(s.calls.get(2).sent) and invariant)
  run replacementReceiptIsFoundBeforeOriginalResendTest = init.then(retainVariant(2)).then(started(1, 2, false)).then(ready(1)).then(sent(1))
    .then(mine(2, true)).then(begin(2, 1, false)).then(receiptRead(2)).then(respond(2, true))
    .expect(s.calls.get(2).response == "receipt" and not(s.calls.get(2).sent) and invariant)
  run finalReadDoesNotPromiseAtomicRegistrySendTest = init.then(started(1, 1, false)).then(ready(1)).then(replaceClaim).then(sent(1))
    .expect(s.claim == 2 and s.calls.get(1).response == "submitted" and invariant)
  run earlierVersionObservationDoesNotLockChainTest = init.then(started(1, 1, false)).then(checkedThroughConsent(1))
    .then(changeVersion).then(finalRegistryRead(1)).then(sent(1)).expect(s.version == 1 and s.calls.get(1).version == 0 and invariant)
  run elapsedTimeAfterFinalReadDoesNotRevalidateConsentTest = init.then(started(1, 1, false)).then(ready(1))
    .then(advance).then(advance).then(sent(1))
    .expect(s.now == expiry and s.calls.get(1).consentStamp == 0 and s.calls.get(1).response == "submitted" and invariant)
}
