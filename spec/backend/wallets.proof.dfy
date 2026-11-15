// Preserve ordered predecessors, unique keys and the possession and operator records.
lemma register_ensures(b: WalletRegistration, registration: Registration, by_: string)
  ensures (inv(b) ==> canRegister(b, registration, by_) ==> alwaysPartitionValid(register(b, registration, by_)))
  ensures (inv(b) ==> canRegister(b, registration, by_) ==> alwaysPredecessors(register(b, registration, by_)))
  ensures (inv(b) ==> canRegister(b, registration, by_) ==> alwaysClaimsAdmitted(register(b, registration, by_)))
  ensures (inv(b) ==> canRegister(b, registration, by_) ==> alwaysOneConsumption(register(b, registration, by_)))
  ensures (inv(b) ==> canRegister(b, registration, by_) ==> alwaysOneAuthorization(register(b, registration, by_)))
  ensures (inv(b) ==> canRegister(b, registration, by_) ==> alwaysAuthorizationAdmitted(register(b, registration, by_)))
  ensures (inv(b) ==> canRegister(b, registration, by_) ==> alwaysAuthorizationIncreases(register(b, registration, by_)))
  ensures (inv(b) ==> canRegister(b, registration, by_) ==> alwaysOperatorRecordsMatchClaims(register(b, registration, by_)))
  ensures (inv(b) ==> canRegister(b, registration, by_) ==> alwaysPossessionRecordsValid(register(b, registration, by_)))
  ensures (inv(b) ==> canRegister(b, registration, by_) ==> stepClaimsRetained(b, register(b, registration, by_)))
  ensures (inv(b) ==> canRegister(b, registration, by_) ==> stepAuthorizationsRetained(b, register(b, registration, by_)))
  ensures (inv(b) ==> canRegister(b, registration, by_) ==> stepConsumedRetained(b, register(b, registration, by_)))
  ensures (inv(b) ==> canRegister(b, registration, by_) ==> stepFirstProofPersists(b, register(b, registration, by_)))
  ensures (inv(b) ==> canRegister(b, registration, by_) ==> stepOperatorHistoryRetained(b, register(b, registration, by_)))
  ensures (inv(b) ==> canRegister(b, registration, by_) ==> stepPossessionRecordsPermanent(b, register(b, registration, by_)))
{
  if inv(b) && canRegister(b, registration, by_) && !sameRegistryWallet(b, registration.wallet) {
    var appended := WalletClaim(|b.claims|, registration.wallet, registration.digest, Registry);
    ProofLib.FoldLeftAppend((acc: ClaimSequenceCheck, claim: WalletClaim) =>
      ClaimSequenceCheck((acc.nextPredecessor + 1), (acc.ordered && (claim.predecessor == acc.nextPredecessor))),
      emptyClaimSequence, b.claims, appended);
    ClaimsAppendKeepsClaimAt(b, register(b, registration, by_));
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
  ensures (inv(b) ==> canConsume(b, requestId) ==> alwaysOperatorRecordsMatchClaims(consume(b, requestId)))
  ensures (inv(b) ==> canConsume(b, requestId) ==> alwaysPossessionRecordsValid(consume(b, requestId)))
  ensures (inv(b) ==> canConsume(b, requestId) ==> stepClaimsRetained(b, consume(b, requestId)))
  ensures (inv(b) ==> canConsume(b, requestId) ==> stepAuthorizationsRetained(b, consume(b, requestId)))
  ensures (inv(b) ==> canConsume(b, requestId) ==> stepConsumedRetained(b, consume(b, requestId)))
  ensures (inv(b) ==> canConsume(b, requestId) ==> stepFirstProofPersists(b, consume(b, requestId)))
  ensures (inv(b) ==> canConsume(b, requestId) ==> stepOperatorHistoryRetained(b, consume(b, requestId)))
  ensures (inv(b) ==> canConsume(b, requestId) ==> stepPossessionRecordsPermanent(b, consume(b, requestId)))
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
  ensures (inv(b) ==> canCommitAuthorization(b, requestId, storageSucceeded) ==> alwaysOperatorRecordsMatchClaims(commitAuthorization(b, requestId, storageSucceeded)))
  ensures (inv(b) ==> canCommitAuthorization(b, requestId, storageSucceeded) ==> alwaysPossessionRecordsValid(commitAuthorization(b, requestId, storageSucceeded)))
  ensures (inv(b) ==> canCommitAuthorization(b, requestId, storageSucceeded) ==> stepClaimsRetained(b, commitAuthorization(b, requestId, storageSucceeded)))
  ensures (inv(b) ==> canCommitAuthorization(b, requestId, storageSucceeded) ==> stepAuthorizationsRetained(b, commitAuthorization(b, requestId, storageSucceeded)))
  ensures (inv(b) ==> canCommitAuthorization(b, requestId, storageSucceeded) ==> stepConsumedRetained(b, commitAuthorization(b, requestId, storageSucceeded)))
  ensures (inv(b) ==> canCommitAuthorization(b, requestId, storageSucceeded) ==> stepFirstProofPersists(b, commitAuthorization(b, requestId, storageSucceeded)))
  ensures (inv(b) ==> canCommitAuthorization(b, requestId, storageSucceeded) ==> stepOperatorHistoryRetained(b, commitAuthorization(b, requestId, storageSucceeded)))
  ensures (inv(b) ==> canCommitAuthorization(b, requestId, storageSucceeded) ==> stepPossessionRecordsPermanent(b, commitAuthorization(b, requestId, storageSucceeded)))
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

// An operator claim appends one claim, one audit record and one notice with a fresh claim number.
lemma operatorClaim_ensures(b: WalletRegistration, by_: string, request: OperatorClaim)
  ensures (inv(b) ==> canOperatorClaim(b, by_, request) ==> alwaysPartitionValid(operatorClaim(b, by_, request)))
  ensures (inv(b) ==> canOperatorClaim(b, by_, request) ==> alwaysPredecessors(operatorClaim(b, by_, request)))
  ensures (inv(b) ==> canOperatorClaim(b, by_, request) ==> alwaysClaimsAdmitted(operatorClaim(b, by_, request)))
  ensures (inv(b) ==> canOperatorClaim(b, by_, request) ==> alwaysOneConsumption(operatorClaim(b, by_, request)))
  ensures (inv(b) ==> canOperatorClaim(b, by_, request) ==> alwaysOneAuthorization(operatorClaim(b, by_, request)))
  ensures (inv(b) ==> canOperatorClaim(b, by_, request) ==> alwaysAuthorizationAdmitted(operatorClaim(b, by_, request)))
  ensures (inv(b) ==> canOperatorClaim(b, by_, request) ==> alwaysAuthorizationIncreases(operatorClaim(b, by_, request)))
  ensures (inv(b) ==> canOperatorClaim(b, by_, request) ==> alwaysOperatorRecordsMatchClaims(operatorClaim(b, by_, request)))
  ensures (inv(b) ==> canOperatorClaim(b, by_, request) ==> alwaysPossessionRecordsValid(operatorClaim(b, by_, request)))
  ensures (inv(b) ==> canOperatorClaim(b, by_, request) ==> stepClaimsRetained(b, operatorClaim(b, by_, request)))
  ensures (inv(b) ==> canOperatorClaim(b, by_, request) ==> stepAuthorizationsRetained(b, operatorClaim(b, by_, request)))
  ensures (inv(b) ==> canOperatorClaim(b, by_, request) ==> stepConsumedRetained(b, operatorClaim(b, by_, request)))
  ensures (inv(b) ==> canOperatorClaim(b, by_, request) ==> stepFirstProofPersists(b, operatorClaim(b, by_, request)))
  ensures (inv(b) ==> canOperatorClaim(b, by_, request) ==> stepOperatorHistoryRetained(b, operatorClaim(b, by_, request)))
  ensures (inv(b) ==> canOperatorClaim(b, by_, request) ==> stepPossessionRecordsPermanent(b, operatorClaim(b, by_, request)))
{
  if inv(b) && canOperatorClaim(b, by_, request) {
    var after := operatorClaim(b, by_, request);
    var appended := WalletClaim(|b.claims|, request.wallet, request.digest, (if request.source.FromGithubIssue? then ClaimSource.Historical else ClaimSource.Registry));
    ProofLib.FoldLeftAppend((acc: ClaimSequenceCheck, claim: WalletClaim) =>
      ClaimSequenceCheck((acc.nextPredecessor + 1), (acc.ordered && (claim.predecessor == acc.nextPredecessor))),
      emptyClaimSequence, b.claims, appended);
    ClaimsAppendKeepsClaimAt(b, after);
    var added := OperatorRecord(|b.claims| + 1, request.source);
    assert claimAt(after, |b.claims| + 1) == appended;
    forall r | r in b.operatorRecords + [added]
      ensures |ProofLib.Filter((o: OperatorRecord) => (o.claim == r.claim), b.operatorRecords + [added])| == 1
    {
      ProofLib.FilterAppend((o: OperatorRecord) => (o.claim == r.claim), b.operatorRecords, added);
      if r.claim == added.claim {
        ProofLib.FilterNone((o: OperatorRecord) => (o.claim == r.claim), b.operatorRecords);
      }
    }
  }
}

// A possession challenge gets a fresh ID; an attestation consumes exactly its own unconsumed challenge.
lemma issuePossessionChallenge_ensures(b: WalletRegistration, by_: string, claim: int)
  ensures (inv(b) ==> canIssuePossessionChallenge(b, by_, claim) ==> alwaysPartitionValid(issuePossessionChallenge(b, by_, claim)))
  ensures (inv(b) ==> canIssuePossessionChallenge(b, by_, claim) ==> alwaysPredecessors(issuePossessionChallenge(b, by_, claim)))
  ensures (inv(b) ==> canIssuePossessionChallenge(b, by_, claim) ==> alwaysClaimsAdmitted(issuePossessionChallenge(b, by_, claim)))
  ensures (inv(b) ==> canIssuePossessionChallenge(b, by_, claim) ==> alwaysOneConsumption(issuePossessionChallenge(b, by_, claim)))
  ensures (inv(b) ==> canIssuePossessionChallenge(b, by_, claim) ==> alwaysOneAuthorization(issuePossessionChallenge(b, by_, claim)))
  ensures (inv(b) ==> canIssuePossessionChallenge(b, by_, claim) ==> alwaysAuthorizationAdmitted(issuePossessionChallenge(b, by_, claim)))
  ensures (inv(b) ==> canIssuePossessionChallenge(b, by_, claim) ==> alwaysAuthorizationIncreases(issuePossessionChallenge(b, by_, claim)))
  ensures (inv(b) ==> canIssuePossessionChallenge(b, by_, claim) ==> alwaysOperatorRecordsMatchClaims(issuePossessionChallenge(b, by_, claim)))
  ensures (inv(b) ==> canIssuePossessionChallenge(b, by_, claim) ==> alwaysPossessionRecordsValid(issuePossessionChallenge(b, by_, claim)))
  ensures (inv(b) ==> canIssuePossessionChallenge(b, by_, claim) ==> stepClaimsRetained(b, issuePossessionChallenge(b, by_, claim)))
  ensures (inv(b) ==> canIssuePossessionChallenge(b, by_, claim) ==> stepAuthorizationsRetained(b, issuePossessionChallenge(b, by_, claim)))
  ensures (inv(b) ==> canIssuePossessionChallenge(b, by_, claim) ==> stepConsumedRetained(b, issuePossessionChallenge(b, by_, claim)))
  ensures (inv(b) ==> canIssuePossessionChallenge(b, by_, claim) ==> stepFirstProofPersists(b, issuePossessionChallenge(b, by_, claim)))
  ensures (inv(b) ==> canIssuePossessionChallenge(b, by_, claim) ==> stepOperatorHistoryRetained(b, issuePossessionChallenge(b, by_, claim)))
  ensures (inv(b) ==> canIssuePossessionChallenge(b, by_, claim) ==> stepPossessionRecordsPermanent(b, issuePossessionChallenge(b, by_, claim)))
{
  if inv(b) && canIssuePossessionChallenge(b, by_, claim) {
    var xs := b.possessionChallenges;
    var added := PossessionChallenge((b.lastPossessionChallenge + 1), claim, claimAt(b, claim).wallet, b.clock, (b.clock + possessionLifetime), false, 0);
    assert issuePossessionChallenge(b, by_, claim).possessionChallenges == xs + [added];
    forall i | 0 <= i < |xs|
      ensures xs[i].id != added.id
    {
      assert xs[i] in xs;
    }
    forall c | c in xs + [added]
      ensures |ProofLib.Filter((o: PossessionChallenge) => (o.id == c.id), xs + [added])| == 1
    {
      ProofLib.FilterAppend((o: PossessionChallenge) => (o.id == c.id), xs, added);
      if c.id == added.id {
        ProofLib.FilterNone((o: PossessionChallenge) => (o.id == c.id), xs);
      }
    }
  }
}

lemma attestPossession_ensures(b: WalletRegistration, by_: string, claim: int, challengeId: int, recoveredSigner: string)
  ensures (inv(b) ==> canAttestPossession(b, by_, claim, challengeId, recoveredSigner) ==> alwaysPartitionValid(attestPossession(b, by_, claim, challengeId, recoveredSigner)))
  ensures (inv(b) ==> canAttestPossession(b, by_, claim, challengeId, recoveredSigner) ==> alwaysPredecessors(attestPossession(b, by_, claim, challengeId, recoveredSigner)))
  ensures (inv(b) ==> canAttestPossession(b, by_, claim, challengeId, recoveredSigner) ==> alwaysClaimsAdmitted(attestPossession(b, by_, claim, challengeId, recoveredSigner)))
  ensures (inv(b) ==> canAttestPossession(b, by_, claim, challengeId, recoveredSigner) ==> alwaysOneConsumption(attestPossession(b, by_, claim, challengeId, recoveredSigner)))
  ensures (inv(b) ==> canAttestPossession(b, by_, claim, challengeId, recoveredSigner) ==> alwaysOneAuthorization(attestPossession(b, by_, claim, challengeId, recoveredSigner)))
  ensures (inv(b) ==> canAttestPossession(b, by_, claim, challengeId, recoveredSigner) ==> alwaysAuthorizationAdmitted(attestPossession(b, by_, claim, challengeId, recoveredSigner)))
  ensures (inv(b) ==> canAttestPossession(b, by_, claim, challengeId, recoveredSigner) ==> alwaysAuthorizationIncreases(attestPossession(b, by_, claim, challengeId, recoveredSigner)))
  ensures (inv(b) ==> canAttestPossession(b, by_, claim, challengeId, recoveredSigner) ==> alwaysOperatorRecordsMatchClaims(attestPossession(b, by_, claim, challengeId, recoveredSigner)))
  ensures (inv(b) ==> canAttestPossession(b, by_, claim, challengeId, recoveredSigner) ==> alwaysPossessionRecordsValid(attestPossession(b, by_, claim, challengeId, recoveredSigner)))
  ensures (inv(b) ==> canAttestPossession(b, by_, claim, challengeId, recoveredSigner) ==> stepClaimsRetained(b, attestPossession(b, by_, claim, challengeId, recoveredSigner)))
  ensures (inv(b) ==> canAttestPossession(b, by_, claim, challengeId, recoveredSigner) ==> stepAuthorizationsRetained(b, attestPossession(b, by_, claim, challengeId, recoveredSigner)))
  ensures (inv(b) ==> canAttestPossession(b, by_, claim, challengeId, recoveredSigner) ==> stepConsumedRetained(b, attestPossession(b, by_, claim, challengeId, recoveredSigner)))
  ensures (inv(b) ==> canAttestPossession(b, by_, claim, challengeId, recoveredSigner) ==> stepFirstProofPersists(b, attestPossession(b, by_, claim, challengeId, recoveredSigner)))
  ensures (inv(b) ==> canAttestPossession(b, by_, claim, challengeId, recoveredSigner) ==> stepOperatorHistoryRetained(b, attestPossession(b, by_, claim, challengeId, recoveredSigner)))
  ensures (inv(b) ==> canAttestPossession(b, by_, claim, challengeId, recoveredSigner) ==> stepPossessionRecordsPermanent(b, attestPossession(b, by_, claim, challengeId, recoveredSigner)))
{
  if inv(b) && canAttestPossession(b, by_, claim, challengeId, recoveredSigner) {
    var xs := b.possessionChallenges;
    var after := attestPossession(b, by_, claim, challengeId, recoveredSigner);
    var ys := after.possessionChallenges;
    var target := possessionChallenge(b, challengeId);
    AttestPointwise(b, by_, claim, challengeId, recoveredSigner);
    forall c | c in ys
      ensures |ProofLib.Filter((o: PossessionChallenge) => (o.id == c.id), ys)| == 1
    {
      var i :| 0 <= i < |ys| && ys[i] == c;
      assert xs[i] in xs;
      ProofLib.FilterLengthPointwise((o: PossessionChallenge) => (o.id == c.id), (o: PossessionChallenge) => (o.id == c.id), xs, ys);
    }
    forall c | c in xs
      ensures exists d :: d in ys && d.id == c.id && d.claim == c.claim && d.wallet == c.wallet && d.expiresAt == c.expiresAt && (!c.consumed || d == c)
    {
      var i :| 0 <= i < |xs| && xs[i] == c;
      assert ys[i] in ys;
    }
    forall a | a in b.attestations
      ensures exists c :: c in ys && c.id == a.challenge && c.claim == a.claim && c.consumed && c.consumedAt == a.attestedAt
    {
      var c :| c in xs && c.id == a.challenge && c.claim == a.claim && c.consumed && c.consumedAt == a.attestedAt;
      var i :| 0 <= i < |xs| && xs[i] == c;
      assert ys[i] in ys;
    }
    if possessionMatches(b, claim, challengeId, recoveredSigner) {
      var added := Attestation(claim, challengeId, claimAt(b, claim).wallet, b.clock);
      var k :| 0 <= k < |xs| && xs[k] == target;
      assert ys[k] in ys && ys[k].id == challengeId && ys[k].claim == claim && ys[k].consumed && ys[k].consumedAt == b.clock;
      var own := ProofLib.Filter((a: Attestation) => (a.claim == claim), b.attestations);
      if |own| > 0 {
        ProofLib.FilterMember((a: Attestation) => (a.claim == claim), b.attestations, own[0]);
      }
      assert |own| == 0;
      forall a | a in b.attestations + [added]
        ensures |ProofLib.Filter((o: Attestation) => (o.claim == a.claim), b.attestations + [added])| == 1
      {
        ProofLib.FilterAppend((o: Attestation) => (o.claim == a.claim), b.attestations, added);
        if a.claim == claim {
          ProofLib.FilterNone((o: Attestation) => (o.claim == claim), b.attestations);
          if a in b.attestations { ProofLib.FilterMember((o: Attestation) => (o.claim == claim), b.attestations, a); }
        }
      }
    }
  }
}



lemma AttestPointwise(b: WalletRegistration, by_: string, claim: int, challengeId: int, recoveredSigner: string)
  requires inv(b) && canAttestPossession(b, by_, claim, challengeId, recoveredSigner)
  ensures possessionChallenge(b, challengeId) in b.possessionChallenges && possessionChallenge(b, challengeId).id == challengeId
  ensures |attestPossession(b, by_, claim, challengeId, recoveredSigner).possessionChallenges| == |b.possessionChallenges|
  ensures forall i :: 0 <= i < |b.possessionChallenges| ==>
    attestPossession(b, by_, claim, challengeId, recoveredSigner).possessionChallenges[i].id == b.possessionChallenges[i].id
    && attestPossession(b, by_, claim, challengeId, recoveredSigner).possessionChallenges[i].claim == b.possessionChallenges[i].claim
    && attestPossession(b, by_, claim, challengeId, recoveredSigner).possessionChallenges[i].wallet == b.possessionChallenges[i].wallet
    && attestPossession(b, by_, claim, challengeId, recoveredSigner).possessionChallenges[i].expiresAt == b.possessionChallenges[i].expiresAt
    && attestPossession(b, by_, claim, challengeId, recoveredSigner).possessionChallenges[i].issuedAt == b.possessionChallenges[i].issuedAt
    && (b.possessionChallenges[i].consumed ==> attestPossession(b, by_, claim, challengeId, recoveredSigner).possessionChallenges[i] == b.possessionChallenges[i])
    && (b.possessionChallenges[i].id == challengeId ==> attestPossession(b, by_, claim, challengeId, recoveredSigner).possessionChallenges[i]
      == b.possessionChallenges[i].(consumed := true, consumedAt := b.clock))
{
  var xs := b.possessionChallenges;
    var after := attestPossession(b, by_, claim, challengeId, recoveredSigner);
    var ys := after.possessionChallenges;
    var target := possessionChallenge(b, challengeId);
    assert |ProofLib.Filter((c: PossessionChallenge) => (c.id == challengeId), xs)| > 0;
    ProofLib.FilterMember((c: PossessionChallenge) => (c.id == challengeId), xs, target);
    assert target in xs && target.id == challengeId && !target.consumed;
    assert |ys| == |xs|;
    forall i | 0 <= i < |xs|
      ensures ys[i].id == xs[i].id && ys[i].claim == xs[i].claim && ys[i].wallet == xs[i].wallet
        && ys[i].expiresAt == xs[i].expiresAt && ys[i].issuedAt == xs[i].issuedAt
        && (xs[i].consumed ==> ys[i] == xs[i])
        && (xs[i].id == challengeId ==> ys[i] == xs[i].(consumed := true, consumedAt := b.clock))
    {
      if xs[i].id == challengeId {
        assert xs[i] in xs;
        ProofLib.FilterCountOneIffUnique((c: PossessionChallenge) => (c.id == xs[i].id), xs, (c: PossessionChallenge) => c.id, i);
        var k :| 0 <= k < |xs| && xs[k] == target;
        assert k == i;
      }
    }
}

lemma ClaimsAppendKeepsClaimAt(b: WalletRegistration, after: WalletRegistration)
  requires |after.claims| == |b.claims| + 1 && after.claims[..|b.claims|] == b.claims
  ensures forall k :: 1 <= k <= |b.claims| ==> claimAt(after, k) == claimAt(b, k)
{
  forall k | 1 <= k <= |b.claims|
    ensures claimAt(after, k) == claimAt(b, k)
  {
    assert after.claims[k - 1] == after.claims[..|b.claims|][k - 1];
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
