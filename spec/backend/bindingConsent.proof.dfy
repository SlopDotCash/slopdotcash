// The wrapped wallet events keep the wallet registry valid by its own proved transitions.
lemma register_ensures(b: Binding, registration: backend__wallets_Registration, by_: string)
  ensures (inv(b) ==> canRegister(b, registration, by_) ==> alwaysConsentsVerified(register(b, registration, by_)))
  ensures (inv(b) ==> canRegister(b, registration, by_) ==> alwaysOneLiveGeneration(register(b, registration, by_)))
  ensures (inv(b) ==> canRegister(b, registration, by_) ==> alwaysSolanaPartitionAuthorized(register(b, registration, by_)))
  ensures (inv(b) ==> canRegister(b, registration, by_) ==> alwaysWalletValid(register(b, registration, by_)))
  ensures (inv(b) ==> canRegister(b, registration, by_) ==> stepConsentsAppendOnly(b, register(b, registration, by_)))
  ensures (inv(b) ==> canRegister(b, registration, by_) ==> stepGenerationIdentityFixed(b, register(b, registration, by_)))
  ensures (inv(b) ==> canRegister(b, registration, by_) ==> stepSolanaPartitionFixed(b, register(b, registration, by_)))
{
  if inv(b) && canRegister(b, registration, by_) {
    backend__wallets_register_ensures(b.wallet, registration, by_);
  }
}

lemma consume_ensures(b: Binding, requestId: int)
  ensures (inv(b) ==> canConsume(b, requestId) ==> alwaysConsentsVerified(consume(b, requestId)))
  ensures (inv(b) ==> canConsume(b, requestId) ==> alwaysOneLiveGeneration(consume(b, requestId)))
  ensures (inv(b) ==> canConsume(b, requestId) ==> alwaysSolanaPartitionAuthorized(consume(b, requestId)))
  ensures (inv(b) ==> canConsume(b, requestId) ==> alwaysWalletValid(consume(b, requestId)))
  ensures (inv(b) ==> canConsume(b, requestId) ==> stepConsentsAppendOnly(b, consume(b, requestId)))
  ensures (inv(b) ==> canConsume(b, requestId) ==> stepGenerationIdentityFixed(b, consume(b, requestId)))
  ensures (inv(b) ==> canConsume(b, requestId) ==> stepSolanaPartitionFixed(b, consume(b, requestId)))
{
  if inv(b) && canConsume(b, requestId) {
    backend__wallets_consume_ensures(b.wallet, requestId);
  }
}

lemma commitAuthorization_ensures(b: Binding, requestId: int, storageSucceeded: bool)
  ensures (inv(b) ==> canCommitAuthorization(b, requestId, storageSucceeded) ==> alwaysConsentsVerified(commitAuthorization(b, requestId, storageSucceeded)))
  ensures (inv(b) ==> canCommitAuthorization(b, requestId, storageSucceeded) ==> alwaysOneLiveGeneration(commitAuthorization(b, requestId, storageSucceeded)))
  ensures (inv(b) ==> canCommitAuthorization(b, requestId, storageSucceeded) ==> alwaysSolanaPartitionAuthorized(commitAuthorization(b, requestId, storageSucceeded)))
  ensures (inv(b) ==> canCommitAuthorization(b, requestId, storageSucceeded) ==> alwaysWalletValid(commitAuthorization(b, requestId, storageSucceeded)))
  ensures (inv(b) ==> canCommitAuthorization(b, requestId, storageSucceeded) ==> stepConsentsAppendOnly(b, commitAuthorization(b, requestId, storageSucceeded)))
  ensures (inv(b) ==> canCommitAuthorization(b, requestId, storageSucceeded) ==> stepGenerationIdentityFixed(b, commitAuthorization(b, requestId, storageSucceeded)))
  ensures (inv(b) ==> canCommitAuthorization(b, requestId, storageSucceeded) ==> stepSolanaPartitionFixed(b, commitAuthorization(b, requestId, storageSucceeded)))
{
  if inv(b) && canCommitAuthorization(b, requestId, storageSucceeded) {
    backend__wallets_commitAuthorization_ensures(b.wallet, requestId, storageSucceeded);
  }
}

lemma bindAuthorize_ensures(b: Binding, by_: string, signature: EvmConsentSignature)
  ensures (inv(b) ==> canBindAuthorize(b, by_, signature) ==> alwaysConsentsVerified(bindAuthorize(b, by_, signature)))
  ensures (inv(b) ==> canBindAuthorize(b, by_, signature) ==> alwaysOneLiveGeneration(bindAuthorize(b, by_, signature)))
  ensures (inv(b) ==> canBindAuthorize(b, by_, signature) ==> alwaysSolanaPartitionAuthorized(bindAuthorize(b, by_, signature)))
  ensures (inv(b) ==> canBindAuthorize(b, by_, signature) ==> alwaysWalletValid(bindAuthorize(b, by_, signature)))
  ensures (inv(b) ==> canBindAuthorize(b, by_, signature) ==> stepConsentsAppendOnly(b, bindAuthorize(b, by_, signature)))
  ensures (inv(b) ==> canBindAuthorize(b, by_, signature) ==> stepGenerationIdentityFixed(b, bindAuthorize(b, by_, signature)))
  ensures (inv(b) ==> canBindAuthorize(b, by_, signature) ==> stepSolanaPartitionFixed(b, bindAuthorize(b, by_, signature)))
{
  if inv(b) && canBindAuthorize(b, by_, signature) {
    var auths := b.wallet.authorizations;
    assert signature.claim == authorizedClaim(b);
    assert |auths| > 0;
    assert auths[|auths| - 1] in auths;
    if !(exists c :: c in b.consents && sameKey(c, signature.claim, signature.network, signature.vault, signature.chainId, signature.version, signature.expiresAt)) {
      var xs := b.consents;
      var added := Consent(signature.claim, signature.network, signature.vault, signature.chainId, signature.version, signature.expiresAt, signature.signer, nowSeconds(b));
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

