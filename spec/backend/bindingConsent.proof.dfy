// Each wrapped wallet event keeps its partition valid by the wallet registry's own proved transition.
lemma observeTime_ensures(b: Binding, timestamp: int)
  ensures (inv(b) ==> canObserveTime(b, timestamp) ==> alwaysConsentsVerified(observeTime(b, timestamp)))
  ensures (inv(b) ==> canObserveTime(b, timestamp) ==> alwaysPaymentsKeyed(observeTime(b, timestamp)))
  ensures (inv(b) ==> canObserveTime(b, timestamp) ==> alwaysOneLiveGeneration(observeTime(b, timestamp)))
  ensures (inv(b) ==> canObserveTime(b, timestamp) ==> alwaysPrivateGenerationsLogged(observeTime(b, timestamp)))
  ensures (inv(b) ==> canObserveTime(b, timestamp) ==> alwaysWalletValid(observeTime(b, timestamp)))
  ensures (inv(b) ==> canObserveTime(b, timestamp) ==> alwaysSolanaPartitionAuthorized(observeTime(b, timestamp)))
  ensures (inv(b) ==> canObserveTime(b, timestamp) ==> stepConsentsAppendOnly(b, observeTime(b, timestamp)))
  ensures (inv(b) ==> canObserveTime(b, timestamp) ==> stepGenerationIdentityFixed(b, observeTime(b, timestamp)))
  ensures (inv(b) ==> canObserveTime(b, timestamp) ==> stepEvidenceIdentityFixed(b, observeTime(b, timestamp)))
{
  if inv(b) && canObserveTime(b, timestamp) {
    backend__wallets_observeTime_ensures(b.wallet, timestamp);
  }
}

lemma register_ensures(b: Binding, registration: backend__wallets_Registration, by_: string)
  ensures (inv(b) ==> canRegister(b, registration, by_) ==> alwaysConsentsVerified(register(b, registration, by_)))
  ensures (inv(b) ==> canRegister(b, registration, by_) ==> alwaysPaymentsKeyed(register(b, registration, by_)))
  ensures (inv(b) ==> canRegister(b, registration, by_) ==> alwaysOneLiveGeneration(register(b, registration, by_)))
  ensures (inv(b) ==> canRegister(b, registration, by_) ==> alwaysPrivateGenerationsLogged(register(b, registration, by_)))
  ensures (inv(b) ==> canRegister(b, registration, by_) ==> alwaysWalletValid(register(b, registration, by_)))
  ensures (inv(b) ==> canRegister(b, registration, by_) ==> alwaysSolanaPartitionAuthorized(register(b, registration, by_)))
  ensures (inv(b) ==> canRegister(b, registration, by_) ==> stepConsentsAppendOnly(b, register(b, registration, by_)))
  ensures (inv(b) ==> canRegister(b, registration, by_) ==> stepGenerationIdentityFixed(b, register(b, registration, by_)))
  ensures (inv(b) ==> canRegister(b, registration, by_) ==> stepEvidenceIdentityFixed(b, register(b, registration, by_)))
{
  if inv(b) && canRegister(b, registration, by_) {
    backend__wallets_register_ensures(b.wallet, registration, by_);
  }
}

lemma issue_ensures(b: Binding, claim: int, challengeId: int, messageDigest: string, by_: string)
  ensures (inv(b) ==> canIssue(b, claim, challengeId, messageDigest, by_) ==> alwaysConsentsVerified(issue(b, claim, challengeId, messageDigest, by_)))
  ensures (inv(b) ==> canIssue(b, claim, challengeId, messageDigest, by_) ==> alwaysPaymentsKeyed(issue(b, claim, challengeId, messageDigest, by_)))
  ensures (inv(b) ==> canIssue(b, claim, challengeId, messageDigest, by_) ==> alwaysOneLiveGeneration(issue(b, claim, challengeId, messageDigest, by_)))
  ensures (inv(b) ==> canIssue(b, claim, challengeId, messageDigest, by_) ==> alwaysPrivateGenerationsLogged(issue(b, claim, challengeId, messageDigest, by_)))
  ensures (inv(b) ==> canIssue(b, claim, challengeId, messageDigest, by_) ==> alwaysWalletValid(issue(b, claim, challengeId, messageDigest, by_)))
  ensures (inv(b) ==> canIssue(b, claim, challengeId, messageDigest, by_) ==> alwaysSolanaPartitionAuthorized(issue(b, claim, challengeId, messageDigest, by_)))
  ensures (inv(b) ==> canIssue(b, claim, challengeId, messageDigest, by_) ==> stepConsentsAppendOnly(b, issue(b, claim, challengeId, messageDigest, by_)))
  ensures (inv(b) ==> canIssue(b, claim, challengeId, messageDigest, by_) ==> stepGenerationIdentityFixed(b, issue(b, claim, challengeId, messageDigest, by_)))
  ensures (inv(b) ==> canIssue(b, claim, challengeId, messageDigest, by_) ==> stepEvidenceIdentityFixed(b, issue(b, claim, challengeId, messageDigest, by_)))
{
  if inv(b) && canIssue(b, claim, challengeId, messageDigest, by_) {
    backend__wallets_issue_ensures(b.wallet, claim, challengeId, messageDigest, by_);
  }
}

lemma readProof_ensures(b: Binding, proof: backend__wallets_PossessionEvidence, by_: string)
  ensures (inv(b) ==> canReadProof(b, proof, by_) ==> alwaysConsentsVerified(readProof(b, proof, by_)))
  ensures (inv(b) ==> canReadProof(b, proof, by_) ==> alwaysPaymentsKeyed(readProof(b, proof, by_)))
  ensures (inv(b) ==> canReadProof(b, proof, by_) ==> alwaysOneLiveGeneration(readProof(b, proof, by_)))
  ensures (inv(b) ==> canReadProof(b, proof, by_) ==> alwaysPrivateGenerationsLogged(readProof(b, proof, by_)))
  ensures (inv(b) ==> canReadProof(b, proof, by_) ==> alwaysWalletValid(readProof(b, proof, by_)))
  ensures (inv(b) ==> canReadProof(b, proof, by_) ==> alwaysSolanaPartitionAuthorized(readProof(b, proof, by_)))
  ensures (inv(b) ==> canReadProof(b, proof, by_) ==> stepConsentsAppendOnly(b, readProof(b, proof, by_)))
  ensures (inv(b) ==> canReadProof(b, proof, by_) ==> stepGenerationIdentityFixed(b, readProof(b, proof, by_)))
  ensures (inv(b) ==> canReadProof(b, proof, by_) ==> stepEvidenceIdentityFixed(b, readProof(b, proof, by_)))
{
  if inv(b) && canReadProof(b, proof, by_) {
    backend__wallets_readProof_ensures(b.wallet, proof, by_);
  }
}

lemma consume_ensures(b: Binding, requestId: int)
  ensures (inv(b) ==> canConsume(b, requestId) ==> alwaysConsentsVerified(consume(b, requestId)))
  ensures (inv(b) ==> canConsume(b, requestId) ==> alwaysPaymentsKeyed(consume(b, requestId)))
  ensures (inv(b) ==> canConsume(b, requestId) ==> alwaysOneLiveGeneration(consume(b, requestId)))
  ensures (inv(b) ==> canConsume(b, requestId) ==> alwaysPrivateGenerationsLogged(consume(b, requestId)))
  ensures (inv(b) ==> canConsume(b, requestId) ==> alwaysWalletValid(consume(b, requestId)))
  ensures (inv(b) ==> canConsume(b, requestId) ==> alwaysSolanaPartitionAuthorized(consume(b, requestId)))
  ensures (inv(b) ==> canConsume(b, requestId) ==> stepConsentsAppendOnly(b, consume(b, requestId)))
  ensures (inv(b) ==> canConsume(b, requestId) ==> stepGenerationIdentityFixed(b, consume(b, requestId)))
  ensures (inv(b) ==> canConsume(b, requestId) ==> stepEvidenceIdentityFixed(b, consume(b, requestId)))
{
  if inv(b) && canConsume(b, requestId) {
    backend__wallets_consume_ensures(b.wallet, requestId);
  }
}

lemma commitAuthorization_ensures(b: Binding, requestId: int, storageSucceeded: bool)
  ensures (inv(b) ==> canCommitAuthorization(b, requestId, storageSucceeded) ==> alwaysConsentsVerified(commitAuthorization(b, requestId, storageSucceeded)))
  ensures (inv(b) ==> canCommitAuthorization(b, requestId, storageSucceeded) ==> alwaysPaymentsKeyed(commitAuthorization(b, requestId, storageSucceeded)))
  ensures (inv(b) ==> canCommitAuthorization(b, requestId, storageSucceeded) ==> alwaysOneLiveGeneration(commitAuthorization(b, requestId, storageSucceeded)))
  ensures (inv(b) ==> canCommitAuthorization(b, requestId, storageSucceeded) ==> alwaysPrivateGenerationsLogged(commitAuthorization(b, requestId, storageSucceeded)))
  ensures (inv(b) ==> canCommitAuthorization(b, requestId, storageSucceeded) ==> alwaysWalletValid(commitAuthorization(b, requestId, storageSucceeded)))
  ensures (inv(b) ==> canCommitAuthorization(b, requestId, storageSucceeded) ==> alwaysSolanaPartitionAuthorized(commitAuthorization(b, requestId, storageSucceeded)))
  ensures (inv(b) ==> canCommitAuthorization(b, requestId, storageSucceeded) ==> stepConsentsAppendOnly(b, commitAuthorization(b, requestId, storageSucceeded)))
  ensures (inv(b) ==> canCommitAuthorization(b, requestId, storageSucceeded) ==> stepGenerationIdentityFixed(b, commitAuthorization(b, requestId, storageSucceeded)))
  ensures (inv(b) ==> canCommitAuthorization(b, requestId, storageSucceeded) ==> stepEvidenceIdentityFixed(b, commitAuthorization(b, requestId, storageSucceeded)))
{
  if inv(b) && canCommitAuthorization(b, requestId, storageSucceeded) {
    backend__wallets_commitAuthorization_ensures(b.wallet, requestId, storageSucceeded);
  }
}

lemma solanaRegister_ensures(b: Binding, registration: backend__wallets_Registration, by_: string)
  ensures (inv(b) ==> canSolanaRegister(b, registration, by_) ==> alwaysConsentsVerified(solanaRegister(b, registration, by_)))
  ensures (inv(b) ==> canSolanaRegister(b, registration, by_) ==> alwaysPaymentsKeyed(solanaRegister(b, registration, by_)))
  ensures (inv(b) ==> canSolanaRegister(b, registration, by_) ==> alwaysOneLiveGeneration(solanaRegister(b, registration, by_)))
  ensures (inv(b) ==> canSolanaRegister(b, registration, by_) ==> alwaysPrivateGenerationsLogged(solanaRegister(b, registration, by_)))
  ensures (inv(b) ==> canSolanaRegister(b, registration, by_) ==> alwaysWalletValid(solanaRegister(b, registration, by_)))
  ensures (inv(b) ==> canSolanaRegister(b, registration, by_) ==> alwaysSolanaPartitionAuthorized(solanaRegister(b, registration, by_)))
  ensures (inv(b) ==> canSolanaRegister(b, registration, by_) ==> stepConsentsAppendOnly(b, solanaRegister(b, registration, by_)))
  ensures (inv(b) ==> canSolanaRegister(b, registration, by_) ==> stepGenerationIdentityFixed(b, solanaRegister(b, registration, by_)))
  ensures (inv(b) ==> canSolanaRegister(b, registration, by_) ==> stepEvidenceIdentityFixed(b, solanaRegister(b, registration, by_)))
{
  if inv(b) && canSolanaRegister(b, registration, by_) {
    backend__wallets_register_ensures(b.solanaWallet, registration, by_);
  }
}

lemma solanaOperatorClaim_ensures(b: Binding, by_: string, request: backend__wallets_OperatorClaim)
  ensures (inv(b) ==> canSolanaOperatorClaim(b, by_, request) ==> alwaysConsentsVerified(solanaOperatorClaim(b, by_, request)))
  ensures (inv(b) ==> canSolanaOperatorClaim(b, by_, request) ==> alwaysPaymentsKeyed(solanaOperatorClaim(b, by_, request)))
  ensures (inv(b) ==> canSolanaOperatorClaim(b, by_, request) ==> alwaysOneLiveGeneration(solanaOperatorClaim(b, by_, request)))
  ensures (inv(b) ==> canSolanaOperatorClaim(b, by_, request) ==> alwaysPrivateGenerationsLogged(solanaOperatorClaim(b, by_, request)))
  ensures (inv(b) ==> canSolanaOperatorClaim(b, by_, request) ==> alwaysWalletValid(solanaOperatorClaim(b, by_, request)))
  ensures (inv(b) ==> canSolanaOperatorClaim(b, by_, request) ==> alwaysSolanaPartitionAuthorized(solanaOperatorClaim(b, by_, request)))
  ensures (inv(b) ==> canSolanaOperatorClaim(b, by_, request) ==> stepConsentsAppendOnly(b, solanaOperatorClaim(b, by_, request)))
  ensures (inv(b) ==> canSolanaOperatorClaim(b, by_, request) ==> stepGenerationIdentityFixed(b, solanaOperatorClaim(b, by_, request)))
  ensures (inv(b) ==> canSolanaOperatorClaim(b, by_, request) ==> stepEvidenceIdentityFixed(b, solanaOperatorClaim(b, by_, request)))
{
  if inv(b) && canSolanaOperatorClaim(b, by_, request) {
    backend__wallets_operatorClaim_ensures(b.solanaWallet, by_, request);
  }
}

lemma solanaIssue_ensures(b: Binding, claim: int, challengeId: int, messageDigest: string, by_: string)
  ensures (inv(b) ==> canSolanaIssue(b, claim, challengeId, messageDigest, by_) ==> alwaysConsentsVerified(solanaIssue(b, claim, challengeId, messageDigest, by_)))
  ensures (inv(b) ==> canSolanaIssue(b, claim, challengeId, messageDigest, by_) ==> alwaysPaymentsKeyed(solanaIssue(b, claim, challengeId, messageDigest, by_)))
  ensures (inv(b) ==> canSolanaIssue(b, claim, challengeId, messageDigest, by_) ==> alwaysOneLiveGeneration(solanaIssue(b, claim, challengeId, messageDigest, by_)))
  ensures (inv(b) ==> canSolanaIssue(b, claim, challengeId, messageDigest, by_) ==> alwaysPrivateGenerationsLogged(solanaIssue(b, claim, challengeId, messageDigest, by_)))
  ensures (inv(b) ==> canSolanaIssue(b, claim, challengeId, messageDigest, by_) ==> alwaysWalletValid(solanaIssue(b, claim, challengeId, messageDigest, by_)))
  ensures (inv(b) ==> canSolanaIssue(b, claim, challengeId, messageDigest, by_) ==> alwaysSolanaPartitionAuthorized(solanaIssue(b, claim, challengeId, messageDigest, by_)))
  ensures (inv(b) ==> canSolanaIssue(b, claim, challengeId, messageDigest, by_) ==> stepConsentsAppendOnly(b, solanaIssue(b, claim, challengeId, messageDigest, by_)))
  ensures (inv(b) ==> canSolanaIssue(b, claim, challengeId, messageDigest, by_) ==> stepGenerationIdentityFixed(b, solanaIssue(b, claim, challengeId, messageDigest, by_)))
  ensures (inv(b) ==> canSolanaIssue(b, claim, challengeId, messageDigest, by_) ==> stepEvidenceIdentityFixed(b, solanaIssue(b, claim, challengeId, messageDigest, by_)))
{
  if inv(b) && canSolanaIssue(b, claim, challengeId, messageDigest, by_) {
    backend__wallets_issue_ensures(b.solanaWallet, claim, challengeId, messageDigest, by_);
  }
}

lemma solanaReadProof_ensures(b: Binding, proof: backend__wallets_PossessionEvidence, by_: string)
  ensures (inv(b) ==> canSolanaReadProof(b, proof, by_) ==> alwaysConsentsVerified(solanaReadProof(b, proof, by_)))
  ensures (inv(b) ==> canSolanaReadProof(b, proof, by_) ==> alwaysPaymentsKeyed(solanaReadProof(b, proof, by_)))
  ensures (inv(b) ==> canSolanaReadProof(b, proof, by_) ==> alwaysOneLiveGeneration(solanaReadProof(b, proof, by_)))
  ensures (inv(b) ==> canSolanaReadProof(b, proof, by_) ==> alwaysPrivateGenerationsLogged(solanaReadProof(b, proof, by_)))
  ensures (inv(b) ==> canSolanaReadProof(b, proof, by_) ==> alwaysWalletValid(solanaReadProof(b, proof, by_)))
  ensures (inv(b) ==> canSolanaReadProof(b, proof, by_) ==> alwaysSolanaPartitionAuthorized(solanaReadProof(b, proof, by_)))
  ensures (inv(b) ==> canSolanaReadProof(b, proof, by_) ==> stepConsentsAppendOnly(b, solanaReadProof(b, proof, by_)))
  ensures (inv(b) ==> canSolanaReadProof(b, proof, by_) ==> stepGenerationIdentityFixed(b, solanaReadProof(b, proof, by_)))
  ensures (inv(b) ==> canSolanaReadProof(b, proof, by_) ==> stepEvidenceIdentityFixed(b, solanaReadProof(b, proof, by_)))
{
  if inv(b) && canSolanaReadProof(b, proof, by_) {
    backend__wallets_readProof_ensures(b.solanaWallet, proof, by_);
  }
}

lemma solanaConsume_ensures(b: Binding, requestId: int)
  ensures (inv(b) ==> canSolanaConsume(b, requestId) ==> alwaysConsentsVerified(solanaConsume(b, requestId)))
  ensures (inv(b) ==> canSolanaConsume(b, requestId) ==> alwaysPaymentsKeyed(solanaConsume(b, requestId)))
  ensures (inv(b) ==> canSolanaConsume(b, requestId) ==> alwaysOneLiveGeneration(solanaConsume(b, requestId)))
  ensures (inv(b) ==> canSolanaConsume(b, requestId) ==> alwaysPrivateGenerationsLogged(solanaConsume(b, requestId)))
  ensures (inv(b) ==> canSolanaConsume(b, requestId) ==> alwaysWalletValid(solanaConsume(b, requestId)))
  ensures (inv(b) ==> canSolanaConsume(b, requestId) ==> alwaysSolanaPartitionAuthorized(solanaConsume(b, requestId)))
  ensures (inv(b) ==> canSolanaConsume(b, requestId) ==> stepConsentsAppendOnly(b, solanaConsume(b, requestId)))
  ensures (inv(b) ==> canSolanaConsume(b, requestId) ==> stepGenerationIdentityFixed(b, solanaConsume(b, requestId)))
  ensures (inv(b) ==> canSolanaConsume(b, requestId) ==> stepEvidenceIdentityFixed(b, solanaConsume(b, requestId)))
{
  if inv(b) && canSolanaConsume(b, requestId) {
    backend__wallets_consume_ensures(b.solanaWallet, requestId);
  }
}

lemma solanaCommitAuthorization_ensures(b: Binding, requestId: int, storageSucceeded: bool)
  ensures (inv(b) ==> canSolanaCommitAuthorization(b, requestId, storageSucceeded) ==> alwaysConsentsVerified(solanaCommitAuthorization(b, requestId, storageSucceeded)))
  ensures (inv(b) ==> canSolanaCommitAuthorization(b, requestId, storageSucceeded) ==> alwaysPaymentsKeyed(solanaCommitAuthorization(b, requestId, storageSucceeded)))
  ensures (inv(b) ==> canSolanaCommitAuthorization(b, requestId, storageSucceeded) ==> alwaysOneLiveGeneration(solanaCommitAuthorization(b, requestId, storageSucceeded)))
  ensures (inv(b) ==> canSolanaCommitAuthorization(b, requestId, storageSucceeded) ==> alwaysPrivateGenerationsLogged(solanaCommitAuthorization(b, requestId, storageSucceeded)))
  ensures (inv(b) ==> canSolanaCommitAuthorization(b, requestId, storageSucceeded) ==> alwaysWalletValid(solanaCommitAuthorization(b, requestId, storageSucceeded)))
  ensures (inv(b) ==> canSolanaCommitAuthorization(b, requestId, storageSucceeded) ==> alwaysSolanaPartitionAuthorized(solanaCommitAuthorization(b, requestId, storageSucceeded)))
  ensures (inv(b) ==> canSolanaCommitAuthorization(b, requestId, storageSucceeded) ==> stepConsentsAppendOnly(b, solanaCommitAuthorization(b, requestId, storageSucceeded)))
  ensures (inv(b) ==> canSolanaCommitAuthorization(b, requestId, storageSucceeded) ==> stepGenerationIdentityFixed(b, solanaCommitAuthorization(b, requestId, storageSucceeded)))
  ensures (inv(b) ==> canSolanaCommitAuthorization(b, requestId, storageSucceeded) ==> stepEvidenceIdentityFixed(b, solanaCommitAuthorization(b, requestId, storageSucceeded)))
{
  if inv(b) && canSolanaCommitAuthorization(b, requestId, storageSucceeded) {
    backend__wallets_commitAuthorization_ensures(b.solanaWallet, requestId, storageSucceeded);
  }
}

lemma bindAuthorize_ensures(b: Binding, by_: string, signature: EvmConsentSignature)
  ensures (inv(b) ==> canBindAuthorize(b, by_, signature) ==> alwaysConsentsVerified(bindAuthorize(b, by_, signature)))
  ensures (inv(b) ==> canBindAuthorize(b, by_, signature) ==> alwaysPaymentsKeyed(bindAuthorize(b, by_, signature)))
  ensures (inv(b) ==> canBindAuthorize(b, by_, signature) ==> alwaysOneLiveGeneration(bindAuthorize(b, by_, signature)))
  ensures (inv(b) ==> canBindAuthorize(b, by_, signature) ==> alwaysPrivateGenerationsLogged(bindAuthorize(b, by_, signature)))
  ensures (inv(b) ==> canBindAuthorize(b, by_, signature) ==> alwaysWalletValid(bindAuthorize(b, by_, signature)))
  ensures (inv(b) ==> canBindAuthorize(b, by_, signature) ==> alwaysSolanaPartitionAuthorized(bindAuthorize(b, by_, signature)))
  ensures (inv(b) ==> canBindAuthorize(b, by_, signature) ==> stepConsentsAppendOnly(b, bindAuthorize(b, by_, signature)))
  ensures (inv(b) ==> canBindAuthorize(b, by_, signature) ==> stepGenerationIdentityFixed(b, bindAuthorize(b, by_, signature)))
  ensures (inv(b) ==> canBindAuthorize(b, by_, signature) ==> stepEvidenceIdentityFixed(b, bindAuthorize(b, by_, signature)))
{
  if inv(b) && canBindAuthorize(b, by_, signature) {
    var auths := b.wallet.authorizations;
    assert signature.claim == authorizedClaim(b);
    assert |auths| > 0;
    assert auths[|auths| - 1] in auths;
    if !(exists c :: c in b.consents && sameKey(c, signature.claim, signature.network, signature.vault, signature.chainId, signature.version, signature.expiresAt)) {
      var xs := b.consents;
      var added := Consent(signature.claim, signature.network, signature.vault, signature.chainId, signature.version, signature.expiresAt, signature.recoveredSigner, nowSeconds(b));
      assert bindAuthorize(b, by_, signature).consents == xs + [added];
      forall c | c in xs + [added]
        ensures |ProofLib.Filter((o: Consent) => sameKey(o, c.claim, c.network, c.vault, c.chainId, c.version, c.expiresAt), xs + [added])| == 1
      {
        ProofLib.FilterAppend((o: Consent) => sameKey(o, c.claim, c.network, c.vault, c.chainId, c.version, c.expiresAt), xs, added);
        if sameKey(added, c.claim, c.network, c.vault, c.chainId, c.version, c.expiresAt) {
          ProofLib.FilterNone((o: Consent) => sameKey(o, c.claim, c.network, c.vault, c.chainId, c.version, c.expiresAt), xs);
        }
      }
    }
  }
}

lemma lawStoredConsentUsableImmediately_ensures(b: Binding, by_: string, signature: EvmConsentSignature)
  ensures (lawStoredConsentUsableImmediately(b, by_, signature) == true)
{
  if canBindAuthorize(b, by_, signature) {
    var after := bindAuthorize(b, by_, signature);
    assert signature.claim == authorizedClaim(b);
    assert authorizedClaim(after) == authorizedClaim(b);
    if exists c :: c in b.consents && sameKey(c, signature.claim, signature.network, signature.vault, signature.chainId, signature.version, signature.expiresAt) {
      var c :| c in b.consents && sameKey(c, signature.claim, signature.network, signature.vault, signature.chainId, signature.version, signature.expiresAt);
      assert c in after.consents;
      assert usable(after, c, signature.network, signature.vault, signature.version);
    } else {
      var added := Consent(signature.claim, signature.network, signature.vault, signature.chainId, signature.version, signature.expiresAt, signature.recoveredSigner, nowSeconds(b));
      assert after.consents == b.consents + [added];
      assert added in after.consents;
      assert usable(after, added, signature.network, signature.vault, signature.version);
    }
  }
}

lemma AdmittedPaymentIsTheAppendedRecord(b: Binding, by_: string, obligation: int)
  ensures canSolanaAdmitAttempt(b, by_, obligation) ==> paymentFor(solanaAdmitAttempt(b, by_, obligation), obligation) == paymentFor(b, obligation).(attemptOpen := true, attemptClaim := solanaClaim(b))
{
  if canSolanaAdmitAttempt(b, by_, obligation) {
    var x := paymentFor(b, obligation).(attemptOpen := true, attemptClaim := solanaClaim(b));
    var kept := ProofLib.Filter((p: PaymentEvidence) => (p.obligation != obligation), b.payments);
    var after := solanaAdmitAttempt(b, by_, obligation);
    assert x.obligation == obligation;
    assert after.payments == kept + [x];
    forall i | 0 <= i < |kept|
      ensures kept[i].obligation != obligation
    {
      assert kept[i] in kept;
      ProofLib.FilterMember((p: PaymentEvidence) => (p.obligation != obligation), b.payments, kept[i]);
    }
    ProofLib.FilterNone((p: PaymentEvidence) => (p.obligation == obligation), kept);
    ProofLib.FilterAppend((p: PaymentEvidence) => (p.obligation == obligation), kept, x);
    assert ProofLib.Filter((p: PaymentEvidence) => (p.obligation == obligation), after.payments) == [x];
  }
}

lemma lawAdmissionOpensOnlyForTheCurrentClaim_ensures(b: Binding, by_: string, obligation: int)
  ensures (lawAdmissionOpensOnlyForTheCurrentClaim(b, by_, obligation) == true)
{
  if canSolanaAdmitAttempt(b, by_, obligation) {
    AdmittedPaymentIsTheAppendedRecord(b, by_, obligation);
    assert solanaAdmitAttempt(b, by_, obligation).generations == b.generations;
  }
}

lemma lawAdmittedAttemptIsPreparable_ensures(b: Binding, by_: string, obligation: int)
  ensures (lawAdmittedAttemptIsPreparable(b, by_, obligation) == true)
{
  if canSolanaAdmitAttempt(b, by_, obligation) {
    var after := solanaAdmitAttempt(b, by_, obligation);
    AdmittedPaymentIsTheAppendedRecord(b, by_, obligation);
    assert after.solanaWallet == b.solanaWallet;
    assert solanaClaim(after) == solanaClaim(b);
    assert solanaReady(after, b.solanaWallet.actor, obligation);
  }
}
