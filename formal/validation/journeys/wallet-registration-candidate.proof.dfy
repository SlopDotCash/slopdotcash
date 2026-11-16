// Preserve ordered predecessors and unique challenge and authorization keys.
lemma register_ensures(b: WalletRegistration, registration: Registration, authenticated: bool, by_: string)
  ensures (inv(b) ==> canRegister(b, registration, authenticated, by_) ==> alwaysPartitionValid(register(b, registration, authenticated, by_)))
  ensures (inv(b) ==> canRegister(b, registration, authenticated, by_) ==> alwaysPredecessors(register(b, registration, authenticated, by_)))
  ensures (inv(b) ==> canRegister(b, registration, authenticated, by_) ==> alwaysClaimsAdmitted(register(b, registration, authenticated, by_)))
  ensures (inv(b) ==> canRegister(b, registration, authenticated, by_) ==> alwaysOneConsumption(register(b, registration, authenticated, by_)))
  ensures (inv(b) ==> canRegister(b, registration, authenticated, by_) ==> alwaysOneAuthorization(register(b, registration, authenticated, by_)))
  ensures (inv(b) ==> canRegister(b, registration, authenticated, by_) ==> alwaysAuthorizationAdmitted(register(b, registration, authenticated, by_)))
  ensures (inv(b) ==> canRegister(b, registration, authenticated, by_) ==> alwaysAuthorizationIncreases(register(b, registration, authenticated, by_)))
  ensures (inv(b) ==> canRegister(b, registration, authenticated, by_) ==> stepClaimsRetained(b, register(b, registration, authenticated, by_)))
  ensures (inv(b) ==> canRegister(b, registration, authenticated, by_) ==> stepAuthorizationsRetained(b, register(b, registration, authenticated, by_)))
  ensures (inv(b) ==> canRegister(b, registration, authenticated, by_) ==> stepConsumedRetained(b, register(b, registration, authenticated, by_)))
  ensures (inv(b) ==> canRegister(b, registration, authenticated, by_) ==> stepFirstProofPersists(b, register(b, registration, authenticated, by_)))
{
  if inv(b) && canRegister(b, registration, authenticated, by_) && !sameRegistryWallet(b, registration.wallet) {
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
  ensures (inv(b) ==> canConsume(b, requestId) ==> stepClaimsRetained(b, consume(b, requestId)))
  ensures (inv(b) ==> canConsume(b, requestId) ==> stepAuthorizationsRetained(b, consume(b, requestId)))
  ensures (inv(b) ==> canConsume(b, requestId) ==> stepConsumedRetained(b, consume(b, requestId)))
  ensures (inv(b) ==> canConsume(b, requestId) ==> stepFirstProofPersists(b, consume(b, requestId)))
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
  ensures (inv(b) ==> canCommitAuthorization(b, requestId, storageSucceeded) ==> stepClaimsRetained(b, commitAuthorization(b, requestId, storageSucceeded)))
  ensures (inv(b) ==> canCommitAuthorization(b, requestId, storageSucceeded) ==> stepAuthorizationsRetained(b, commitAuthorization(b, requestId, storageSucceeded)))
  ensures (inv(b) ==> canCommitAuthorization(b, requestId, storageSucceeded) ==> stepConsumedRetained(b, commitAuthorization(b, requestId, storageSucceeded)))
  ensures (inv(b) ==> canCommitAuthorization(b, requestId, storageSucceeded) ==> stepFirstProofPersists(b, commitAuthorization(b, requestId, storageSucceeded)))
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

