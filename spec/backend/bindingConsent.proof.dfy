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
    var w0 := b.wallet.(operatorRecords := [], walletChangedNotices := [], possessionChallenges := [], lastPossessionChallenge := 0, attestations := []);
    WalletStripAux(b.wallet, w0);
    backend__wallets_register_ensures(w0, registration, by_);
    WalletPartitionAgree(backend__wallets_register(w0, registration, by_), backend__wallets_register(b.wallet, registration, by_));
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
    var w0 := b.wallet.(operatorRecords := [], walletChangedNotices := [], possessionChallenges := [], lastPossessionChallenge := 0, attestations := []);
    WalletStripAux(b.wallet, w0);
    backend__wallets_consume_ensures(w0, requestId);
    WalletPartitionAgree(backend__wallets_consume(w0, requestId), backend__wallets_consume(b.wallet, requestId));
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
    var w0 := b.wallet.(operatorRecords := [], walletChangedNotices := [], possessionChallenges := [], lastPossessionChallenge := 0, attestations := []);
    WalletStripAux(b.wallet, w0);
    backend__wallets_commitAuthorization_ensures(w0, requestId, storageSucceeded);
    WalletPartitionAgree(backend__wallets_commitAuthorization(w0, requestId, storageSucceeded), backend__wallets_commitAuthorization(b.wallet, requestId, storageSucceeded));
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
    var w0 := b.solanaWallet.(operatorRecords := [], walletChangedNotices := [], possessionChallenges := [], lastPossessionChallenge := 0, attestations := []);
    WalletStripAux(b.solanaWallet, w0);
    backend__wallets_register_ensures(w0, registration, by_);
    WalletPartitionAgree(backend__wallets_register(w0, registration, by_), backend__wallets_register(b.solanaWallet, registration, by_));
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
    var w0 := b.solanaWallet.(operatorRecords := [], walletChangedNotices := [], possessionChallenges := [], lastPossessionChallenge := 0, attestations := []);
    WalletStripAux(b.solanaWallet, w0);
    backend__wallets_operatorClaim_ensures(w0, by_, request);
    WalletPartitionAgree(backend__wallets_operatorClaim(w0, by_, request), backend__wallets_operatorClaim(b.solanaWallet, by_, request));
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
    var w0 := b.solanaWallet.(operatorRecords := [], walletChangedNotices := [], possessionChallenges := [], lastPossessionChallenge := 0, attestations := []);
    WalletStripAux(b.solanaWallet, w0);
    backend__wallets_consume_ensures(w0, requestId);
    WalletPartitionAgree(backend__wallets_consume(w0, requestId), backend__wallets_consume(b.solanaWallet, requestId));
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
    var w0 := b.solanaWallet.(operatorRecords := [], walletChangedNotices := [], possessionChallenges := [], lastPossessionChallenge := 0, attestations := []);
    WalletStripAux(b.solanaWallet, w0);
    backend__wallets_commitAuthorization_ensures(w0, requestId, storageSucceeded);
    WalletPartitionAgree(backend__wallets_commitAuthorization(w0, requestId, storageSucceeded), backend__wallets_commitAuthorization(b.solanaWallet, requestId, storageSucceeded));
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

lemma WalletStripAux(w: backend__wallets_WalletRegistration, w0: backend__wallets_WalletRegistration)
  requires partitionValid(w)
  requires w0 == w.(operatorRecords := [], walletChangedNotices := [], possessionChallenges := [], lastPossessionChallenge := 0, attestations := [])
  ensures backend__wallets_inv(w0)
{
}

lemma WalletPartitionAgree(a: backend__wallets_WalletRegistration, b: backend__wallets_WalletRegistration)
  requires a.actor == b.actor && a.clock == b.clock && a.claims == b.claims
  requires a.consumptions == b.consumptions && a.authorizations == b.authorizations
  requires partitionValid(a)
  ensures partitionValid(b)
{
}

lemma PaymentsKeyedMeaning(b: Binding)
  ensures alwaysPaymentsKeyed(b) == (b.finalizedHeight >= 0 && (forall p :: p in b.payments ==> p.obligation > 0 && p.owner != "" && |ProofLib.Filter((o: PaymentEvidence) => (o.obligation == p.obligation), b.payments)| == 1))
{
}

lemma PaymentForMember(b: Binding, obligation: int)
  requires alwaysPaymentsKeyed(b)
  ensures paymentFor(b, obligation).obligation > 0 ==> (paymentFor(b, obligation) in b.payments && paymentFor(b, obligation).obligation == obligation)
  ensures paymentFor(b, obligation).privateCase > 0 ==> (paymentFor(b, obligation) in b.payments && paymentFor(b, obligation).obligation == obligation)
  ensures forall p :: p in b.payments && p.obligation == obligation ==> p == paymentFor(b, obligation)
{
  PaymentsKeyedMeaning(b);
  var f := ProofLib.Filter((p: PaymentEvidence) => (p.obligation == obligation), b.payments);
  assert paymentFor(b, obligation) == (if |f| > 0 then f[0] else absentPayment);
  if |f| > 0 {
    ProofLib.FilterMember((p: PaymentEvidence) => (p.obligation == obligation), b.payments, f[0]);
  }
  forall p | p in b.payments && p.obligation == obligation
    ensures p == paymentFor(b, obligation)
  {
    ProofLib.FilterMember((o: PaymentEvidence) => (o.obligation == obligation), b.payments, p);
    assert |f| == 1;
    assert p in f;
    assert p == f[0];
  }
}

lemma FilterKeepOther<T>(keep: T -> bool, eq: T -> bool, xs: seq<T>)
  requires forall x :: x in xs && eq(x) ==> keep(x)
  ensures ProofLib.Filter(eq, ProofLib.Filter(keep, xs)) == ProofLib.Filter(eq, xs)
  decreases |xs|
{
  if |xs| == 0 {
    ProofLib.FilterNil(keep, xs);
    ProofLib.FilterNil(eq, []);
    ProofLib.FilterNil(eq, xs);
  } else {
    assert xs[0] in xs;
    assert forall x :: x in xs[1..] ==> x in xs;
    ProofLib.FilterCons(keep, xs);
    ProofLib.FilterCons(eq, xs);
    var rest := ProofLib.Filter(keep, xs[1..]);
    FilterKeepOther(keep, eq, xs[1..]);
    if keep(xs[0]) {
      var s := [xs[0]] + rest;
      assert ProofLib.Filter(keep, xs) == s;
      assert s[0] == xs[0] && s[1..] == rest;
      ProofLib.FilterCons(eq, s);
    } else {
      assert !eq(xs[0]);
      assert [] + rest == rest;
      assert ProofLib.Filter(keep, xs) == rest;
      assert [] + ProofLib.Filter(eq, xs[1..]) == ProofLib.Filter(eq, xs[1..]);
    }
  }
}

lemma ReplacedPaymentFor(b: Binding, after: Binding, evidence: PaymentEvidence, ob: int)
  requires after == b.(payments := ProofLib.Filter((p: PaymentEvidence) => (p.obligation != evidence.obligation), b.payments) + [evidence])
  ensures ob == evidence.obligation ==> ProofLib.Filter((o: PaymentEvidence) => (o.obligation == ob), after.payments) == [evidence]
  ensures ob != evidence.obligation ==> ProofLib.Filter((o: PaymentEvidence) => (o.obligation == ob), after.payments) == ProofLib.Filter((o: PaymentEvidence) => (o.obligation == ob), b.payments)
  ensures ob == evidence.obligation ==> paymentFor(after, ob) == evidence
  ensures ob != evidence.obligation ==> paymentFor(after, ob) == paymentFor(b, ob)
{
  var neq := (p: PaymentEvidence) => (p.obligation != evidence.obligation);
  var kept := ProofLib.Filter(neq, b.payments);
  var eq := (o: PaymentEvidence) => (o.obligation == ob);
  forall i | 0 <= i < |kept|
    ensures kept[i].obligation != evidence.obligation
  {
    assert kept[i] in kept;
    ProofLib.FilterMember(neq, b.payments, kept[i]);
  }
  ProofLib.FilterAppend(eq, kept, evidence);
  if ob == evidence.obligation {
    ProofLib.FilterNone(eq, kept);
  } else {
    FilterKeepOther(neq, eq, b.payments);
  }
  assert paymentFor(after, ob) == (if |ProofLib.Filter(eq, after.payments)| > 0 then ProofLib.Filter(eq, after.payments)[0] else absentPayment);
  assert paymentFor(b, ob) == (if |ProofLib.Filter(eq, b.payments)| > 0 then ProofLib.Filter(eq, b.payments)[0] else absentPayment);
}

lemma ReplacePaymentValid(b: Binding, after: Binding, evidence: PaymentEvidence)
  requires inv(b)
  requires evidence.obligation > 0 && evidence.owner != ""
  requires after == b.(payments := ProofLib.Filter((p: PaymentEvidence) => (p.obligation != evidence.obligation), b.payments) + [evidence])
  requires paymentFor(b, evidence.obligation).obligation > 0 ==> (paymentFor(b, evidence.obligation).owner == evidence.owner && paymentFor(b, evidence.obligation).network == evidence.network && paymentFor(b, evidence.obligation).vault == evidence.vault && paymentFor(b, evidence.obligation).privateCase == evidence.privateCase && (!paymentFor(b, evidence.obligation).reserved ==> !evidence.reserved))
  ensures alwaysPaymentsKeyed(after)
  ensures alwaysOneLiveGeneration(after)
  ensures alwaysPrivateGenerationsLogged(after)
  ensures stepEvidenceIdentityFixed(b, after)
{
  PaymentsKeyedMeaning(b);
  var neq := (p: PaymentEvidence) => (p.obligation != evidence.obligation);
  var kept := ProofLib.Filter(neq, b.payments);
  forall p | p in kept
    ensures p in b.payments && p.obligation != evidence.obligation
  {
    ProofLib.FilterMember(neq, b.payments, p);
  }
  forall p | p in after.payments
    ensures p.obligation > 0 && p.owner != "" && |ProofLib.Filter((o: PaymentEvidence) => (o.obligation == p.obligation), after.payments)| == 1
  {
    ReplacedPaymentFor(b, after, evidence, p.obligation);
  }
  PaymentsKeyedMeaning(after);
  forall g | g in b.generations
    ensures paymentFor(after, g.obligation).obligation == g.obligation && paymentFor(after, g.obligation).privateCase == g.privateCase && paymentFor(after, g.obligation).owner == paymentFor(b, g.obligation).owner
  {
    ReplacedPaymentFor(b, after, evidence, g.obligation);
    assert paymentFor(b, g.obligation).obligation == g.obligation;
    if g.obligation == evidence.obligation {
      assert paymentFor(b, evidence.obligation).obligation > 0;
    }
  }
  forall p | p in b.payments
    ensures exists q :: q in after.payments && q.obligation == p.obligation && q.owner == p.owner && q.network == p.network && q.vault == p.vault && q.privateCase == p.privateCase && (!p.reserved ==> !q.reserved)
  {
    if p.obligation == evidence.obligation {
      PaymentForMember(b, evidence.obligation);
      assert p == paymentFor(b, evidence.obligation);
      assert evidence in after.payments;
    } else {
      ProofLib.FilterMember(neq, b.payments, p);
      assert p in kept && p in after.payments;
    }
  }
  forall a | a in b.caseAccessLog
    ensures exists p :: p in after.payments && p.privateCase == a.privateCase && p.owner == a.actor
  {
    var p :| p in b.payments && p.privateCase == a.privateCase && p.owner == a.actor;
    if p.obligation == evidence.obligation {
      PaymentForMember(b, evidence.obligation);
      assert p == paymentFor(b, evidence.obligation);
      assert evidence in after.payments;
    } else {
      ProofLib.FilterMember(neq, b.payments, p);
      assert p in after.payments;
    }
  }
}

lemma observePayment_ensures(b: Binding, by_: string, evidence: PaymentEvidence)
  ensures (inv(b) ==> canObservePayment(b, by_, evidence) ==> alwaysConsentsVerified(observePayment(b, by_, evidence)))
  ensures (inv(b) ==> canObservePayment(b, by_, evidence) ==> alwaysPaymentsKeyed(observePayment(b, by_, evidence)))
  ensures (inv(b) ==> canObservePayment(b, by_, evidence) ==> alwaysOneLiveGeneration(observePayment(b, by_, evidence)))
  ensures (inv(b) ==> canObservePayment(b, by_, evidence) ==> alwaysPrivateGenerationsLogged(observePayment(b, by_, evidence)))
  ensures (inv(b) ==> canObservePayment(b, by_, evidence) ==> alwaysWalletValid(observePayment(b, by_, evidence)))
  ensures (inv(b) ==> canObservePayment(b, by_, evidence) ==> alwaysSolanaPartitionAuthorized(observePayment(b, by_, evidence)))
  ensures (inv(b) ==> canObservePayment(b, by_, evidence) ==> stepConsentsAppendOnly(b, observePayment(b, by_, evidence)))
  ensures (inv(b) ==> canObservePayment(b, by_, evidence) ==> stepGenerationIdentityFixed(b, observePayment(b, by_, evidence)))
  ensures (inv(b) ==> canObservePayment(b, by_, evidence) ==> stepEvidenceIdentityFixed(b, observePayment(b, by_, evidence)))
{
  if inv(b) && canObservePayment(b, by_, evidence) {
    ReplacePaymentValid(b, observePayment(b, by_, evidence), evidence);
  }
}

lemma solanaAdmitAttempt_ensures(b: Binding, by_: string, obligation: int)
  ensures (inv(b) ==> canSolanaAdmitAttempt(b, by_, obligation) ==> alwaysConsentsVerified(solanaAdmitAttempt(b, by_, obligation)))
  ensures (inv(b) ==> canSolanaAdmitAttempt(b, by_, obligation) ==> alwaysPaymentsKeyed(solanaAdmitAttempt(b, by_, obligation)))
  ensures (inv(b) ==> canSolanaAdmitAttempt(b, by_, obligation) ==> alwaysOneLiveGeneration(solanaAdmitAttempt(b, by_, obligation)))
  ensures (inv(b) ==> canSolanaAdmitAttempt(b, by_, obligation) ==> alwaysPrivateGenerationsLogged(solanaAdmitAttempt(b, by_, obligation)))
  ensures (inv(b) ==> canSolanaAdmitAttempt(b, by_, obligation) ==> alwaysWalletValid(solanaAdmitAttempt(b, by_, obligation)))
  ensures (inv(b) ==> canSolanaAdmitAttempt(b, by_, obligation) ==> alwaysSolanaPartitionAuthorized(solanaAdmitAttempt(b, by_, obligation)))
  ensures (inv(b) ==> canSolanaAdmitAttempt(b, by_, obligation) ==> stepConsentsAppendOnly(b, solanaAdmitAttempt(b, by_, obligation)))
  ensures (inv(b) ==> canSolanaAdmitAttempt(b, by_, obligation) ==> stepGenerationIdentityFixed(b, solanaAdmitAttempt(b, by_, obligation)))
  ensures (inv(b) ==> canSolanaAdmitAttempt(b, by_, obligation) ==> stepEvidenceIdentityFixed(b, solanaAdmitAttempt(b, by_, obligation)))
{
  if inv(b) && canSolanaAdmitAttempt(b, by_, obligation) {
    PaymentForMember(b, obligation);
    var updated := paymentFor(b, obligation).(attemptOpen := true, attemptClaim := solanaClaim(b));
    ReplacePaymentValid(b, solanaAdmitAttempt(b, by_, obligation), updated);
  }
}

lemma OneLiveGenerationMeaning(b: Binding)
  ensures alwaysOneLiveGeneration(b) == (
    b.lastGeneration >= 0
    && (forall g :: g in b.generations ==>
      g.generation > 0 && g.generation <= b.lastGeneration && g.transaction == g.generation && g.claim > 0
      && g.claim <= |b.solanaWallet.claims| && backend__wallets_alreadyAuthorized(b.solanaWallet, g.claim)
      && g.expiryHeight > 0 && (!g.status.SolanaExpired? || (b.finalizedHeight > g.expiryHeight || g.failedFinalized))
      && (!g.failedFinalized || g.status.SolanaExpired?)
      && paymentFor(b, g.obligation).obligation == g.obligation && paymentFor(b, g.obligation).privateCase == g.privateCase
      && |ProofLib.Filter((o: SolanaGeneration) => (o.generation == g.generation), b.generations)| == 1
      && (!g.status.SolanaExpired? ==> |ProofLib.Filter((o: SolanaGeneration) => ((o.obligation == g.obligation) && (!o.status.SolanaExpired?)), b.generations)| == 1)))
{
}

lemma LiveGenerationMember(b: Binding, obligation: int)
  requires alwaysOneLiveGeneration(b)
  ensures liveGeneration(b, obligation).generation > 0 ==> (liveGeneration(b, obligation) in b.generations && liveGeneration(b, obligation).obligation == obligation && !liveGeneration(b, obligation).status.SolanaExpired?)
  ensures liveGeneration(b, obligation).generation == 0 ==> forall g :: g in b.generations ==> !(g.obligation == obligation && !g.status.SolanaExpired?)
{
  OneLiveGenerationMeaning(b);
  var p := (g: SolanaGeneration) => ((g.obligation == obligation) && (!g.status.SolanaExpired?));
  var f := ProofLib.Filter(p, b.generations);
  assert liveGeneration(b, obligation) == (if |f| > 0 then f[0] else SolanaGeneration(0, 0, 0, 0, SolanaStatus.SolanaExpired, 0, 0, false));
  if |f| > 0 {
    ProofLib.FilterMember(p, b.generations, f[0]);
  } else {
    ProofLib.FilterNone(p, b.generations);
    forall g | g in b.generations ensures !p(g) {
      var i :| 0 <= i < |b.generations| && b.generations[i] == g;
      assert !p(b.generations[i]);
    }
  }
}

lemma solanaRefused_ensures(b: Binding, by_: string, obligation: int)
  ensures (inv(b) ==> canSolanaRefused(b, by_, obligation) ==> alwaysConsentsVerified(solanaRefused(b, by_, obligation)))
  ensures (inv(b) ==> canSolanaRefused(b, by_, obligation) ==> alwaysPaymentsKeyed(solanaRefused(b, by_, obligation)))
  ensures (inv(b) ==> canSolanaRefused(b, by_, obligation) ==> alwaysOneLiveGeneration(solanaRefused(b, by_, obligation)))
  ensures (inv(b) ==> canSolanaRefused(b, by_, obligation) ==> alwaysPrivateGenerationsLogged(solanaRefused(b, by_, obligation)))
  ensures (inv(b) ==> canSolanaRefused(b, by_, obligation) ==> alwaysWalletValid(solanaRefused(b, by_, obligation)))
  ensures (inv(b) ==> canSolanaRefused(b, by_, obligation) ==> alwaysSolanaPartitionAuthorized(solanaRefused(b, by_, obligation)))
  ensures (inv(b) ==> canSolanaRefused(b, by_, obligation) ==> stepConsentsAppendOnly(b, solanaRefused(b, by_, obligation)))
  ensures (inv(b) ==> canSolanaRefused(b, by_, obligation) ==> stepGenerationIdentityFixed(b, solanaRefused(b, by_, obligation)))
  ensures (inv(b) ==> canSolanaRefused(b, by_, obligation) ==> stepEvidenceIdentityFixed(b, solanaRefused(b, by_, obligation)))
{
  if inv(b) && canSolanaRefused(b, by_, obligation) {
    PaymentForMember(b, obligation);
  }
}

lemma solanaPrepare_ensures(b: Binding, by_: string, obligation: int)
  ensures (inv(b) ==> canSolanaPrepare(b, by_, obligation) ==> alwaysConsentsVerified(solanaPrepare(b, by_, obligation)))
  ensures (inv(b) ==> canSolanaPrepare(b, by_, obligation) ==> alwaysPaymentsKeyed(solanaPrepare(b, by_, obligation)))
  ensures (inv(b) ==> canSolanaPrepare(b, by_, obligation) ==> alwaysOneLiveGeneration(solanaPrepare(b, by_, obligation)))
  ensures (inv(b) ==> canSolanaPrepare(b, by_, obligation) ==> alwaysPrivateGenerationsLogged(solanaPrepare(b, by_, obligation)))
  ensures (inv(b) ==> canSolanaPrepare(b, by_, obligation) ==> alwaysWalletValid(solanaPrepare(b, by_, obligation)))
  ensures (inv(b) ==> canSolanaPrepare(b, by_, obligation) ==> alwaysSolanaPartitionAuthorized(solanaPrepare(b, by_, obligation)))
  ensures (inv(b) ==> canSolanaPrepare(b, by_, obligation) ==> stepConsentsAppendOnly(b, solanaPrepare(b, by_, obligation)))
  ensures (inv(b) ==> canSolanaPrepare(b, by_, obligation) ==> stepGenerationIdentityFixed(b, solanaPrepare(b, by_, obligation)))
  ensures (inv(b) ==> canSolanaPrepare(b, by_, obligation) ==> stepEvidenceIdentityFixed(b, solanaPrepare(b, by_, obligation)))
{
  if inv(b) && canSolanaPrepare(b, by_, obligation) {
    OneLiveGenerationMeaning(b);
    PaymentForMember(b, obligation);
    LiveGenerationMember(b, obligation);
    var auths := b.solanaWallet.authorizations;
    assert solanaClaim(b) > 0;
    assert |auths| > 0;
    assert auths[|auths| - 1] in auths;
    var xs := b.generations;
    var added := SolanaGeneration(obligation, b.lastGeneration + 1, solanaClaim(b), b.lastGeneration + 1, SolanaStatus.SolanaPrepared, b.finalizedHeight + blockhashValidity, paymentFor(b, obligation).privateCase, false);
    var after := solanaPrepare(b, by_, obligation);
    assert after.generations == xs + [added];
    forall g | g in xs + [added]
      ensures |ProofLib.Filter((o: SolanaGeneration) => (o.generation == g.generation), xs + [added])| == 1
      ensures !g.status.SolanaExpired? ==> |ProofLib.Filter((o: SolanaGeneration) => ((o.obligation == g.obligation) && (!o.status.SolanaExpired?)), xs + [added])| == 1
    {
      ProofLib.FilterAppend((o: SolanaGeneration) => (o.generation == g.generation), xs, added);
      if g.generation == added.generation {
        ProofLib.FilterNone((o: SolanaGeneration) => (o.generation == g.generation), xs);
      }
      if !g.status.SolanaExpired? {
        ProofLib.FilterAppend((o: SolanaGeneration) => ((o.obligation == g.obligation) && (!o.status.SolanaExpired?)), xs, added);
        if g.obligation == obligation {
          ProofLib.FilterNone((o: SolanaGeneration) => ((o.obligation == g.obligation) && (!o.status.SolanaExpired?)), xs);
        }
      }
    }
    OneLiveGenerationMeaning(after);
  }
}

lemma CompleteGenerationPointwise(b: Binding, by_: string, obligation: int, generation: int, walletSignature: SolanaWalletSignature)
  requires inv(b) && canSolanaComplete(b, by_, obligation, generation, walletSignature)
  ensures |solanaComplete(b, by_, obligation, generation, walletSignature).generations| == |b.generations|
  ensures forall i :: 0 <= i < |b.generations| ==>
    (b.generations[i].generation == generation ==> b.generations[i] == liveGeneration(b, obligation))
    && solanaComplete(b, by_, obligation, generation, walletSignature).generations[i].generation == b.generations[i].generation
    && solanaComplete(b, by_, obligation, generation, walletSignature).generations[i].obligation == b.generations[i].obligation
    && solanaComplete(b, by_, obligation, generation, walletSignature).generations[i].claim == b.generations[i].claim
    && solanaComplete(b, by_, obligation, generation, walletSignature).generations[i].transaction == b.generations[i].transaction
    && solanaComplete(b, by_, obligation, generation, walletSignature).generations[i].expiryHeight == b.generations[i].expiryHeight
    && solanaComplete(b, by_, obligation, generation, walletSignature).generations[i].privateCase == b.generations[i].privateCase
    && solanaComplete(b, by_, obligation, generation, walletSignature).generations[i].failedFinalized == b.generations[i].failedFinalized
    && solanaComplete(b, by_, obligation, generation, walletSignature).generations[i].status.SolanaExpired? == b.generations[i].status.SolanaExpired?
    && (b.generations[i].status.SolanaCompleted? ==> !solanaComplete(b, by_, obligation, generation, walletSignature).generations[i].status.SolanaPrepared?)
    && (b.generations[i].status.SolanaExpired? ==> solanaComplete(b, by_, obligation, generation, walletSignature).generations[i].status.SolanaExpired?)
    && (b.generations[i].generation != generation ==> solanaComplete(b, by_, obligation, generation, walletSignature).generations[i] == b.generations[i])
{
  hide *;
  reveal inv, canSolanaComplete, solanaComplete;
  OneLiveGenerationMeaning(b);
  LiveGenerationMember(b, obligation);
  var xs := b.generations;
  var ys := solanaComplete(b, by_, obligation, generation, walletSignature).generations;
  var target := liveGeneration(b, obligation);
  var k :| 0 <= k < |xs| && xs[k] == target;
  forall i | 0 <= i < |xs|
    ensures xs[i].generation == generation ==> xs[i] == target
  {
    if xs[i].generation == generation {
      ProofLib.FilterCountOneIffUnique((o: SolanaGeneration) => (o.generation == target.generation), xs, (o: SolanaGeneration) => o.generation, k);
      assert i == k;
    }
  }
}

lemma CompleteGenerationOneLive(b: Binding, by_: string, obligation: int, generation: int, walletSignature: SolanaWalletSignature)
  requires inv(b) && canSolanaComplete(b, by_, obligation, generation, walletSignature)
  ensures alwaysOneLiveGeneration(solanaComplete(b, by_, obligation, generation, walletSignature))
  ensures stepGenerationIdentityFixed(b, solanaComplete(b, by_, obligation, generation, walletSignature))
{
  hide *;
  reveal inv, solanaComplete, stepGenerationIdentityFixed;
  OneLiveGenerationMeaning(b);
  CompleteGenerationPointwise(b, by_, obligation, generation, walletSignature);
  var xs := b.generations;
  var after := solanaComplete(b, by_, obligation, generation, walletSignature);
  var ys := after.generations;
  forall g | g in ys
    ensures g.generation > 0 && g.generation <= after.lastGeneration && g.transaction == g.generation && g.claim > 0
      && g.claim <= |after.solanaWallet.claims| && backend__wallets_alreadyAuthorized(after.solanaWallet, g.claim)
      && g.expiryHeight > 0 && (!g.status.SolanaExpired? || (after.finalizedHeight > g.expiryHeight || g.failedFinalized))
      && (!g.failedFinalized || g.status.SolanaExpired?)
      && paymentFor(after, g.obligation).obligation == g.obligation && paymentFor(after, g.obligation).privateCase == g.privateCase
      && |ProofLib.Filter((o: SolanaGeneration) => (o.generation == g.generation), ys)| == 1
      && (!g.status.SolanaExpired? ==> |ProofLib.Filter((o: SolanaGeneration) => ((o.obligation == g.obligation) && (!o.status.SolanaExpired?)), ys)| == 1)
  {
    var i :| 0 <= i < |ys| && ys[i] == g;
    assert xs[i] in xs;
    assert paymentFor(after, g.obligation) == paymentFor(b, g.obligation) by { reveal paymentFor; }
    ProofLib.FilterLengthPointwise((o: SolanaGeneration) => (o.generation == g.generation), (o: SolanaGeneration) => (o.generation == g.generation), xs, ys);
    if !g.status.SolanaExpired? {
      ProofLib.FilterLengthPointwise((o: SolanaGeneration) => ((o.obligation == g.obligation) && (!o.status.SolanaExpired?)), (o: SolanaGeneration) => ((o.obligation == g.obligation) && (!o.status.SolanaExpired?)), xs, ys);
    }
  }
  forall g | g in xs
    ensures exists h :: h in ys && h.generation == g.generation && h.obligation == g.obligation && h.claim == g.claim && h.transaction == g.transaction && h.expiryHeight == g.expiryHeight && h.privateCase == g.privateCase && (!g.status.SolanaCompleted? || !h.status.SolanaPrepared?) && (!g.status.SolanaExpired? || h.status.SolanaExpired?)
  {
    var i :| 0 <= i < |xs| && xs[i] == g;
    assert ys[i] in ys;
  }
  OneLiveGenerationMeaning(after);
}

lemma CompleteGenerationLogged(b: Binding, by_: string, obligation: int, generation: int, walletSignature: SolanaWalletSignature)
  requires inv(b) && canSolanaComplete(b, by_, obligation, generation, walletSignature)
  ensures alwaysPrivateGenerationsLogged(solanaComplete(b, by_, obligation, generation, walletSignature))
{
  hide *;
  reveal inv, canSolanaComplete, solanaComplete, logged, alwaysPrivateGenerationsLogged;
  PaymentForMember(b, obligation);
  var xs := b.generations;
  var after := solanaComplete(b, by_, obligation, generation, walletSignature);
  var ys := after.generations;
  forall g | g in ys && g.privateCase > 0
    ensures exists a :: a in after.caseAccessLog && a.privateCase == g.privateCase && a.actor == paymentFor(after, g.obligation).owner
  {
    var i :| 0 <= i < |ys| && ys[i] == g;
    assert xs[i] in xs && xs[i].privateCase == g.privateCase && xs[i].obligation == g.obligation;
    assert paymentFor(after, g.obligation) == paymentFor(b, g.obligation) by { reveal paymentFor; }
    var a :| a in b.caseAccessLog && a.privateCase == xs[i].privateCase && a.actor == paymentFor(b, xs[i].obligation).owner;
    assert a in after.caseAccessLog;
  }
}

lemma solanaComplete_ensures(b: Binding, by_: string, obligation: int, generation: int, walletSignature: SolanaWalletSignature)
  ensures (inv(b) ==> canSolanaComplete(b, by_, obligation, generation, walletSignature) ==> alwaysConsentsVerified(solanaComplete(b, by_, obligation, generation, walletSignature)))
  ensures (inv(b) ==> canSolanaComplete(b, by_, obligation, generation, walletSignature) ==> alwaysPaymentsKeyed(solanaComplete(b, by_, obligation, generation, walletSignature)))
  ensures (inv(b) ==> canSolanaComplete(b, by_, obligation, generation, walletSignature) ==> alwaysOneLiveGeneration(solanaComplete(b, by_, obligation, generation, walletSignature)))
  ensures (inv(b) ==> canSolanaComplete(b, by_, obligation, generation, walletSignature) ==> alwaysPrivateGenerationsLogged(solanaComplete(b, by_, obligation, generation, walletSignature)))
  ensures (inv(b) ==> canSolanaComplete(b, by_, obligation, generation, walletSignature) ==> alwaysWalletValid(solanaComplete(b, by_, obligation, generation, walletSignature)))
  ensures (inv(b) ==> canSolanaComplete(b, by_, obligation, generation, walletSignature) ==> alwaysSolanaPartitionAuthorized(solanaComplete(b, by_, obligation, generation, walletSignature)))
  ensures (inv(b) ==> canSolanaComplete(b, by_, obligation, generation, walletSignature) ==> stepConsentsAppendOnly(b, solanaComplete(b, by_, obligation, generation, walletSignature)))
  ensures (inv(b) ==> canSolanaComplete(b, by_, obligation, generation, walletSignature) ==> stepGenerationIdentityFixed(b, solanaComplete(b, by_, obligation, generation, walletSignature)))
  ensures (inv(b) ==> canSolanaComplete(b, by_, obligation, generation, walletSignature) ==> stepEvidenceIdentityFixed(b, solanaComplete(b, by_, obligation, generation, walletSignature)))
{
  hide *;
  if inv(b) && canSolanaComplete(b, by_, obligation, generation, walletSignature) {
    reveal inv, solanaComplete;
    var after := solanaComplete(b, by_, obligation, generation, walletSignature);
    CompleteGenerationOneLive(b, by_, obligation, generation, walletSignature);
    CompleteGenerationLogged(b, by_, obligation, generation, walletSignature);
    assert alwaysConsentsVerified(after) by { reveal alwaysConsentsVerified, claimWallet; }
    assert alwaysPaymentsKeyed(after) by { reveal alwaysPaymentsKeyed; }
    assert alwaysWalletValid(after) by { reveal alwaysWalletValid; }
    assert alwaysSolanaPartitionAuthorized(after) by { reveal alwaysSolanaPartitionAuthorized, evmChain, solanaClaim; }
    assert stepConsentsAppendOnly(b, after) by { reveal stepConsentsAppendOnly; }
    assert stepEvidenceIdentityFixed(b, after) by { reveal stepEvidenceIdentityFixed, logged; }
  }
}

lemma ExpireGenerationValid(b: Binding, after: Binding, obligation: int, generation: int, failed: bool)
  requires inv(b)
  requires generation > 0 && liveGeneration(b, obligation).generation == generation
  requires failed || b.finalizedHeight > liveGeneration(b, obligation).expiryHeight
  requires after == b.(generations := seq(|b.generations|, i requires 0 <= i < |b.generations| => if b.generations[i].generation == generation then (if failed then b.generations[i].(status := SolanaStatus.SolanaExpired, failedFinalized := true) else b.generations[i].(status := SolanaStatus.SolanaExpired)) else b.generations[i]))
  ensures alwaysOneLiveGeneration(after)
  ensures stepGenerationIdentityFixed(b, after)
{
  OneLiveGenerationMeaning(b);
  LiveGenerationMember(b, obligation);
  var xs := b.generations;
  var ys := after.generations;
  var target := liveGeneration(b, obligation);
  var k :| 0 <= k < |xs| && xs[k] == target;
  forall i | 0 <= i < |xs|
    ensures xs[i].generation == generation ==> xs[i] == target
    ensures i != k ==> ys[i] == xs[i]
    ensures ys[i].generation == xs[i].generation && ys[i].obligation == xs[i].obligation && ys[i].claim == xs[i].claim && ys[i].transaction == xs[i].transaction && ys[i].expiryHeight == xs[i].expiryHeight && ys[i].privateCase == xs[i].privateCase
    ensures xs[i].status.SolanaCompleted? ==> !ys[i].status.SolanaPrepared?
    ensures xs[i].status.SolanaExpired? ==> ys[i].status.SolanaExpired?
  {
    if xs[i].generation == generation {
      ProofLib.FilterCountOneIffUnique((o: SolanaGeneration) => (o.generation == target.generation), xs, (o: SolanaGeneration) => o.generation, k);
      assert i == k;
    }
  }
  forall g | g in ys
    ensures |ProofLib.Filter((o: SolanaGeneration) => (o.generation == g.generation), ys)| == 1
    ensures !g.status.SolanaExpired? ==> |ProofLib.Filter((o: SolanaGeneration) => ((o.obligation == g.obligation) && (!o.status.SolanaExpired?)), ys)| == 1
  {
    var i :| 0 <= i < |ys| && ys[i] == g;
    assert xs[i] in xs;
    ProofLib.FilterLengthPointwise((o: SolanaGeneration) => (o.generation == g.generation), (o: SolanaGeneration) => (o.generation == g.generation), xs, ys);
    if !g.status.SolanaExpired? {
      assert i != k;
      if g.obligation == obligation {
        ProofLib.FilterTwo((o: SolanaGeneration) => ((o.obligation == obligation) && (!o.status.SolanaExpired?)), xs, i, k);
        assert false;
      }
      ProofLib.FilterLengthPointwise((o: SolanaGeneration) => ((o.obligation == g.obligation) && (!o.status.SolanaExpired?)), (o: SolanaGeneration) => ((o.obligation == g.obligation) && (!o.status.SolanaExpired?)), xs, ys);
    }
  }
  forall g | g in xs
    ensures exists h :: h in ys && h.generation == g.generation && h.obligation == g.obligation && h.claim == g.claim && h.transaction == g.transaction && h.expiryHeight == g.expiryHeight && h.privateCase == g.privateCase && (!g.status.SolanaCompleted? || !h.status.SolanaPrepared?) && (!g.status.SolanaExpired? || h.status.SolanaExpired?)
  {
    var i :| 0 <= i < |xs| && xs[i] == g;
    assert ys[i] in ys;
  }
  OneLiveGenerationMeaning(after);
}

lemma solanaExpire_ensures(b: Binding, by_: string, obligation: int, generation: int)
  ensures (inv(b) ==> canSolanaExpire(b, by_, obligation, generation) ==> alwaysConsentsVerified(solanaExpire(b, by_, obligation, generation)))
  ensures (inv(b) ==> canSolanaExpire(b, by_, obligation, generation) ==> alwaysPaymentsKeyed(solanaExpire(b, by_, obligation, generation)))
  ensures (inv(b) ==> canSolanaExpire(b, by_, obligation, generation) ==> alwaysOneLiveGeneration(solanaExpire(b, by_, obligation, generation)))
  ensures (inv(b) ==> canSolanaExpire(b, by_, obligation, generation) ==> alwaysPrivateGenerationsLogged(solanaExpire(b, by_, obligation, generation)))
  ensures (inv(b) ==> canSolanaExpire(b, by_, obligation, generation) ==> alwaysWalletValid(solanaExpire(b, by_, obligation, generation)))
  ensures (inv(b) ==> canSolanaExpire(b, by_, obligation, generation) ==> alwaysSolanaPartitionAuthorized(solanaExpire(b, by_, obligation, generation)))
  ensures (inv(b) ==> canSolanaExpire(b, by_, obligation, generation) ==> stepConsentsAppendOnly(b, solanaExpire(b, by_, obligation, generation)))
  ensures (inv(b) ==> canSolanaExpire(b, by_, obligation, generation) ==> stepGenerationIdentityFixed(b, solanaExpire(b, by_, obligation, generation)))
  ensures (inv(b) ==> canSolanaExpire(b, by_, obligation, generation) ==> stepEvidenceIdentityFixed(b, solanaExpire(b, by_, obligation, generation)))
{
  if inv(b) && canSolanaExpire(b, by_, obligation, generation) {
    ExpireGenerationValid(b, solanaExpire(b, by_, obligation, generation), obligation, generation, false);
  }
}

lemma solanaFail_ensures(b: Binding, by_: string, obligation: int, generation: int)
  ensures (inv(b) ==> canSolanaFail(b, by_, obligation, generation) ==> alwaysConsentsVerified(solanaFail(b, by_, obligation, generation)))
  ensures (inv(b) ==> canSolanaFail(b, by_, obligation, generation) ==> alwaysPaymentsKeyed(solanaFail(b, by_, obligation, generation)))
  ensures (inv(b) ==> canSolanaFail(b, by_, obligation, generation) ==> alwaysOneLiveGeneration(solanaFail(b, by_, obligation, generation)))
  ensures (inv(b) ==> canSolanaFail(b, by_, obligation, generation) ==> alwaysPrivateGenerationsLogged(solanaFail(b, by_, obligation, generation)))
  ensures (inv(b) ==> canSolanaFail(b, by_, obligation, generation) ==> alwaysWalletValid(solanaFail(b, by_, obligation, generation)))
  ensures (inv(b) ==> canSolanaFail(b, by_, obligation, generation) ==> alwaysSolanaPartitionAuthorized(solanaFail(b, by_, obligation, generation)))
  ensures (inv(b) ==> canSolanaFail(b, by_, obligation, generation) ==> stepConsentsAppendOnly(b, solanaFail(b, by_, obligation, generation)))
  ensures (inv(b) ==> canSolanaFail(b, by_, obligation, generation) ==> stepGenerationIdentityFixed(b, solanaFail(b, by_, obligation, generation)))
  ensures (inv(b) ==> canSolanaFail(b, by_, obligation, generation) ==> stepEvidenceIdentityFixed(b, solanaFail(b, by_, obligation, generation)))
{
  if inv(b) && canSolanaFail(b, by_, obligation, generation) {
    ExpireGenerationValid(b, solanaFail(b, by_, obligation, generation), obligation, generation, true);
  }
}

lemma ConsumedSampleValid(chain: backend__wallets_WalletChain, wallet: string)
  requires wallet != ""
  ensures backend__wallets_inv(consumedSample(chain, wallet))
{
  backend__wallets_initialHolds_ensures();
  var w0 := backend__wallets_initial;
  backend__wallets_selectChain_ensures(w0, chain);
  var w1 := backend__wallets_selectChain(w0, chain);
  var reg := backend__wallets_Registration(wallet, "digest-a", 0);
  backend__wallets_register_ensures(w1, reg, "1");
  var w2 := backend__wallets_register(w1, reg, "1");
  backend__wallets_issue_ensures(w2, 1, 1, "message-a", "1");
  var w3 := backend__wallets_issue(w2, 1, 1, "message-a", "1");
  var ev := backend__wallets_PossessionEvidence(1, 1, 1, wallet, "message-a");
  backend__wallets_readProof_ensures(w3, ev, "1");
  var w4 := backend__wallets_readProof(w3, ev, "1");
  backend__wallets_consume_ensures(w4, 1);
}

lemma initialHolds_ensures()
  ensures inv(initialHolds())
{
  ConsumedSampleValid(backend__wallets_WalletChain.Base, "wallet-a");
  backend__wallets_commitAuthorization_ensures(consumedSample(backend__wallets_WalletChain.Base, "wallet-a"), 1, true);
  ConsumedSampleValid(backend__wallets_WalletChain.Solana, "wallet-s");
  var ps := initial.payments;
  var p1 := ps[0];
  var p2 := ps[1];
  assert ps == [p1, p2];
  forall p | p in ps
    ensures |ProofLib.Filter((o: PaymentEvidence) => (o.obligation == p.obligation), ps)| == 1
  {
    var q := (o: PaymentEvidence) => (o.obligation == p.obligation);
    ProofLib.FilterCons(q, ps);
    ProofLib.FilterCons(q, ps[1..]);
    ProofLib.FilterNil(q, ps[1..][1..]);
  }
  PaymentsKeyedMeaning(initial);
}
