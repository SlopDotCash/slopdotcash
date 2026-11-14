// Preserve ordered predecessors and unique challenge and authorization keys.
lemma register_ensures(b: WalletRegistration, registration: Registration, by_: string)
  ensures (inv(b) ==> canRegister(b, registration, by_) ==> alwaysPartitionValid(register(b, registration, by_)))
  ensures (inv(b) ==> canRegister(b, registration, by_) ==> alwaysPredecessors(register(b, registration, by_)))
  ensures (inv(b) ==> canRegister(b, registration, by_) ==> alwaysClaimsAdmitted(register(b, registration, by_)))
  ensures (inv(b) ==> canRegister(b, registration, by_) ==> alwaysOneConsumption(register(b, registration, by_)))
  ensures (inv(b) ==> canRegister(b, registration, by_) ==> alwaysOneAuthorization(register(b, registration, by_)))
  ensures (inv(b) ==> canRegister(b, registration, by_) ==> alwaysAuthorizationAdmitted(register(b, registration, by_)))
  ensures (inv(b) ==> canRegister(b, registration, by_) ==> alwaysAuthorizationIncreases(register(b, registration, by_)))
  ensures (inv(b) ==> canRegister(b, registration, by_) ==> alwaysOperatorsAreNotTheActor(register(b, registration, by_)))
  ensures (inv(b) ==> canRegister(b, registration, by_) ==> stepClaimsRetained(b, register(b, registration, by_)))
  ensures (inv(b) ==> canRegister(b, registration, by_) ==> stepAuthorizationsRetained(b, register(b, registration, by_)))
  ensures (inv(b) ==> canRegister(b, registration, by_) ==> stepConsumedRetained(b, register(b, registration, by_)))
  ensures (inv(b) ==> canRegister(b, registration, by_) ==> stepFirstProofPersists(b, register(b, registration, by_)))
  ensures (inv(b) ==> canRegister(b, registration, by_) ==> stepRecoveryHistoryRetained(b, register(b, registration, by_)))
{
  if inv(b) && canRegister(b, registration, by_) && !sameRegistryWallet(b, registration.wallet) {
    var appended := WalletClaim(|b.claims|, registration.wallet, registration.digest, Registry);
    ProofLib.FoldLeftAppend((acc: ClaimSequenceCheck, claim: WalletClaim) =>
      ClaimSequenceCheck((acc.nextPredecessor + 1), (acc.ordered && (claim.predecessor == acc.nextPredecessor))),
      emptyClaimSequence, b.claims, appended);
  }
}

lemma consume_ensures(b: WalletRegistration, requestId: int)
  ensures (inv(b) ==> canConsume(b, requestId) ==> alwaysPartitionValid(consume(b, requestId)))
  ensures (inv(b) ==> canConsume(b, requestId) ==> alwaysPredecessors(consume(b, requestId)))
  ensures (inv(b) ==> canConsume(b, requestId) ==> alwaysClaimsAdmitted(consume(b, requestId)))
  ensures (inv(b) ==> canConsume(b, requestId) ==> alwaysOneConsumption(consume(b, requestId)))
  ensures (inv(b) ==> canConsume(b, requestId) ==> alwaysOneAuthorization(consume(b, requestId)))
  ensures (inv(b) ==> canConsume(b, requestId) ==> alwaysAuthorizationAdmitted(consume(b, requestId)))
  ensures (inv(b) ==> canConsume(b, requestId) ==> alwaysAuthorizationIncreases(consume(b, requestId)))
  ensures (inv(b) ==> canConsume(b, requestId) ==> alwaysOperatorsAreNotTheActor(consume(b, requestId)))
  ensures (inv(b) ==> canConsume(b, requestId) ==> stepClaimsRetained(b, consume(b, requestId)))
  ensures (inv(b) ==> canConsume(b, requestId) ==> stepAuthorizationsRetained(b, consume(b, requestId)))
  ensures (inv(b) ==> canConsume(b, requestId) ==> stepConsumedRetained(b, consume(b, requestId)))
  ensures (inv(b) ==> canConsume(b, requestId) ==> stepFirstProofPersists(b, consume(b, requestId)))
  ensures (inv(b) ==> canConsume(b, requestId) ==> stepRecoveryHistoryRetained(b, consume(b, requestId)))
{
  if inv(b) && canConsume(b, requestId) {
    var proofRead := readFor(b, requestId);
    var added := Consumption(proofRead.challengeId, requestId, proofRead.claim, proofRead.capturedAt);
    ConsumptionMeaning(b);
    AppendUniqueConsumption(b.consumptions, added);
    ConsumptionMeaning(consume(b, requestId));
  }
}

lemma commitAuthorization_ensures(b: WalletRegistration, requestId: int, storageSucceeded: bool)
  ensures (inv(b) ==> canCommitAuthorization(b, requestId, storageSucceeded) ==> alwaysPartitionValid(commitAuthorization(b, requestId, storageSucceeded)))
  ensures (inv(b) ==> canCommitAuthorization(b, requestId, storageSucceeded) ==> alwaysPredecessors(commitAuthorization(b, requestId, storageSucceeded)))
  ensures (inv(b) ==> canCommitAuthorization(b, requestId, storageSucceeded) ==> alwaysClaimsAdmitted(commitAuthorization(b, requestId, storageSucceeded)))
  ensures (inv(b) ==> canCommitAuthorization(b, requestId, storageSucceeded) ==> alwaysOneConsumption(commitAuthorization(b, requestId, storageSucceeded)))
  ensures (inv(b) ==> canCommitAuthorization(b, requestId, storageSucceeded) ==> alwaysOneAuthorization(commitAuthorization(b, requestId, storageSucceeded)))
  ensures (inv(b) ==> canCommitAuthorization(b, requestId, storageSucceeded) ==> alwaysAuthorizationAdmitted(commitAuthorization(b, requestId, storageSucceeded)))
  ensures (inv(b) ==> canCommitAuthorization(b, requestId, storageSucceeded) ==> alwaysAuthorizationIncreases(commitAuthorization(b, requestId, storageSucceeded)))
  ensures (inv(b) ==> canCommitAuthorization(b, requestId, storageSucceeded) ==> alwaysOperatorsAreNotTheActor(commitAuthorization(b, requestId, storageSucceeded)))
  ensures (inv(b) ==> canCommitAuthorization(b, requestId, storageSucceeded) ==> stepClaimsRetained(b, commitAuthorization(b, requestId, storageSucceeded)))
  ensures (inv(b) ==> canCommitAuthorization(b, requestId, storageSucceeded) ==> stepAuthorizationsRetained(b, commitAuthorization(b, requestId, storageSucceeded)))
  ensures (inv(b) ==> canCommitAuthorization(b, requestId, storageSucceeded) ==> stepConsumedRetained(b, commitAuthorization(b, requestId, storageSucceeded)))
  ensures (inv(b) ==> canCommitAuthorization(b, requestId, storageSucceeded) ==> stepFirstProofPersists(b, commitAuthorization(b, requestId, storageSucceeded)))
  ensures (inv(b) ==> canCommitAuthorization(b, requestId, storageSucceeded) ==> stepRecoveryHistoryRetained(b, commitAuthorization(b, requestId, storageSucceeded)))
{
  if inv(b) && canCommitAuthorization(b, requestId, storageSucceeded) {
    var proofRead := readFor(b, requestId);
    if storageSucceeded && proofRead.claim == |b.claims| && currentClaim(b).source.Registry? && !alreadyAuthorized(b, proofRead.claim) {
      var added := Authorization(proofRead.claim, proofRead.challengeId, proofRead.capturedAt);
      AuthorizationMeaning(b);
      AppendUniqueAuthorization(b.authorizations, added);
      AuthorizationMeaning(commitAuthorization(b, requestId, storageSucceeded));
    }
  }
}

lemma operatorRecover_ensures(b: WalletRegistration, by_: string, contact: int, registration: Registration)
  ensures (inv(b) ==> canOperatorRecover(b, by_, contact, registration) ==> alwaysPartitionValid(operatorRecover(b, by_, contact, registration)))
  ensures (inv(b) ==> canOperatorRecover(b, by_, contact, registration) ==> alwaysPredecessors(operatorRecover(b, by_, contact, registration)))
  ensures (inv(b) ==> canOperatorRecover(b, by_, contact, registration) ==> alwaysClaimsAdmitted(operatorRecover(b, by_, contact, registration)))
  ensures (inv(b) ==> canOperatorRecover(b, by_, contact, registration) ==> alwaysOneConsumption(operatorRecover(b, by_, contact, registration)))
  ensures (inv(b) ==> canOperatorRecover(b, by_, contact, registration) ==> alwaysOneAuthorization(operatorRecover(b, by_, contact, registration)))
  ensures (inv(b) ==> canOperatorRecover(b, by_, contact, registration) ==> alwaysAuthorizationAdmitted(operatorRecover(b, by_, contact, registration)))
  ensures (inv(b) ==> canOperatorRecover(b, by_, contact, registration) ==> alwaysAuthorizationIncreases(operatorRecover(b, by_, contact, registration)))
  ensures (inv(b) ==> canOperatorRecover(b, by_, contact, registration) ==> alwaysOperatorsAreNotTheActor(operatorRecover(b, by_, contact, registration)))
  ensures (inv(b) ==> canOperatorRecover(b, by_, contact, registration) ==> stepClaimsRetained(b, operatorRecover(b, by_, contact, registration)))
  ensures (inv(b) ==> canOperatorRecover(b, by_, contact, registration) ==> stepAuthorizationsRetained(b, operatorRecover(b, by_, contact, registration)))
  ensures (inv(b) ==> canOperatorRecover(b, by_, contact, registration) ==> stepConsumedRetained(b, operatorRecover(b, by_, contact, registration)))
  ensures (inv(b) ==> canOperatorRecover(b, by_, contact, registration) ==> stepFirstProofPersists(b, operatorRecover(b, by_, contact, registration)))
  ensures (inv(b) ==> canOperatorRecover(b, by_, contact, registration) ==> stepRecoveryHistoryRetained(b, operatorRecover(b, by_, contact, registration)))
{
  if inv(b) && canOperatorRecover(b, by_, contact, registration) {
    var appended := WalletClaim(|b.claims|, registration.wallet, registration.digest, Registry);
    ProofLib.FoldLeftAppend((acc: ClaimSequenceCheck, claim: WalletClaim) =>
      ClaimSequenceCheck((acc.nextPredecessor + 1), (acc.ordered && (claim.predecessor == acc.nextPredecessor))),
      emptyClaimSequence, b.claims, appended);
    var added := Recovery(|b.claims| + 1, by_, contact);
    forall r | r in b.recoveries + [added]
      ensures |ProofLib.Filter((o: Recovery) => (o.contact == r.contact), b.recoveries + [added])| == 1
    {
      ProofLib.FilterAppend((o: Recovery) => (o.contact == r.contact), b.recoveries, added);
      if r.contact == contact {
        ProofLib.FilterNone((o: Recovery) => (o.contact == r.contact), b.recoveries);
      }
    }
  }
}

lemma ConsumptionMeaning(b: WalletRegistration)
  ensures alwaysOneConsumption(b) == !(exists value :: value in b.consumptions && !(|ProofLib.Filter((other: Consumption) => (other.challengeId == value.challengeId), b.consumptions)| == 1))
{
}

lemma AppendUniqueConsumption(xs: seq<Consumption>, added: Consumption)
  requires forall value :: value in xs ==> |ProofLib.Filter((other: Consumption) => (other.challengeId == value.challengeId), xs)| == 1
  requires forall value :: value in xs ==> value.challengeId != added.challengeId
  ensures forall value :: value in xs + [added] ==> |ProofLib.Filter((other: Consumption) => (other.challengeId == value.challengeId), xs + [added])| == 1
{
  forall value | value in xs + [added]
    ensures |ProofLib.Filter((other: Consumption) => (other.challengeId == value.challengeId), xs + [added])| == 1
  {
    ProofLib.FilterAppend((other: Consumption) => (other.challengeId == value.challengeId), xs, added);
    if value.challengeId == added.challengeId {
      ProofLib.FilterNone((other: Consumption) => (other.challengeId == value.challengeId), xs);
    }
  }
}

lemma AuthorizationMeaning(b: WalletRegistration)
  ensures alwaysOneAuthorization(b) == !(exists value :: value in b.authorizations && !(|ProofLib.Filter((other: Authorization) => (other.claim == value.claim), b.authorizations)| == 1))
{
}

lemma AppendUniqueAuthorization(xs: seq<Authorization>, added: Authorization)
  requires forall value :: value in xs ==> |ProofLib.Filter((other: Authorization) => (other.claim == value.claim), xs)| == 1
  requires forall value :: value in xs ==> value.claim != added.claim
  ensures forall value :: value in xs + [added] ==> |ProofLib.Filter((other: Authorization) => (other.claim == value.claim), xs + [added])| == 1
{
  forall value | value in xs + [added]
    ensures |ProofLib.Filter((other: Authorization) => (other.claim == value.claim), xs + [added])| == 1
  {
    ProofLib.FilterAppend((other: Authorization) => (other.claim == value.claim), xs, added);
    if value.claim == added.claim {
      ProofLib.FilterNone((other: Authorization) => (other.claim == value.claim), xs);
    }
  }
}

