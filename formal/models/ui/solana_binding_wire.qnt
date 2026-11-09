// @source src/lib/payout-consent.ts
// @source src/PayoutConsent.tsx
// @source contracts/solana/transactions.ts
// @evidence tests/e2e/payout-consent.spec.ts
// One prepared legacy binding, one wallet call, two distinct valid signed
// messages and one invalid-output class. Header/count/length, address encoding,
// reconstructed instruction and signature checks are predicates over finite
// byte classes; this is not a parser, Ed25519, PDA or serializer proof.
// The canonical message has two signatures: identity payer, then destination.
// Only the destination signature slot may be filled. Prepared validation
// rebuilds exactly one bind_wallet instruction from the supplied context.
// The attester key is read from the message, not independently authenticated
// against a deployment here. `vault` is compared by the caller; this helper
// does not encode or independently validate it. Bad actor encoding means an
// invalid integer/u64, not the value zero. Version and submission expiry
// come from the message. Values 0/1 and time ranks0..2 witness that this helper
// neither queries chain state nor enforces freshness, version or expiry.
// A private copy of the verified input is retained across wallet execution.
// The returned signed bytes are also copied before the next session await.
// Provider mutations may affect its input/output objects but not those private
// copies. Mutation before output capture is still checked against the private
// input. A completed API request is outside this model; `post` means encoding
// the verified bytes for submission, not acceptance, chain finality or payment.
// Wallet rejection and bad bytes remain separate from success. The old shared
// input/output variants are explicit negative controls outside `step`.
// Browser fixtures are conformance entry points, not executed evidence. No
// parser, checker, browser, wallet, node or provider was run for this model.
module solana_binding_wire {
  val inputClasses = Set("valid", "other-attester", "vault-only", "tx-count", "required-signatures",
    "readonly-signers", "short-prefix", "count-small", "count-large", "wallet-slot", "short-payload",
    "bad-domain-encoding", "bad-claim-encoding", "bad-address", "bad-actor", "attester-is-destination",
    "wrong-actor", "wrong-recipient", "wrong-project", "wrong-program", "wrong-pda", "wrong-domain",
    "wrong-claim", "extra-instruction", "trailing-bytes", "bad-authority-signature")
  val walletClasses = Set("separate", "inplace", "other", "other-inplace", "bad-shape", "bad-authority", "bad-wallet")
  var s: { phase: str, input: str, prepared: int, reviewed: int, preparedEmpty: bool,
    prepareAccepted: bool, inputPrivate: bool, outputPrivate: bool, providerOutput: int,
    output: int, outputShape: bool, authorityValid: bool, walletValid: bool,
    signedAccepted: bool, posted: bool, postedIdentity: int, error: str,
    version: int, expiry: int, now: int, walletCalled: bool }
  action init = s' = { phase: "input", input: "valid", prepared: 1, reviewed: 0, preparedEmpty: true,
    prepareAccepted: false, inputPrivate: true, outputPrivate: true, providerOutput: 0,
    output: 0, outputShape: false, authorityValid: false, walletValid: false,
    signedAccepted: false, posted: false, postedIdentity: 0, error: "none",
    version: 0, expiry: 1, now: 0, walletCalled: false }
  action configure(kind: str, version: int, expiry: int): bool = all {
    s.phase == "input", inputClasses.contains(kind), Set(0, 1).contains(version), Set(0, 1).contains(expiry),
    s' = s.with("input", kind).with("version", version).with("expiry", expiry)
      .with("prepared", if (kind == "other-attester") 2 else 1).with("phase", "prepare") }
  action checkPrepared = {
    val shape = not(Set("tx-count", "required-signatures", "readonly-signers", "short-prefix",
      "count-small", "count-large", "wallet-slot").contains(s.input))
    val calculable = not(Set("short-payload", "bad-domain-encoding", "bad-claim-encoding",
      "bad-address", "bad-actor", "attester-is-destination").contains(s.input))
    val exact = Set("valid", "other-attester", "vault-only").contains(s.input)
    all { s.phase == "prepare",
      s' = if (shape and calculable and exact) s.with("phase", "reviewed")
        .with("prepareAccepted", true).with("reviewed", s.prepared)
        else s.with("phase", "error").with("error",
          if (not(shape)) "shape" else if (not(calculable)) "construction" else "message-or-signature") }
  }
  action advance = all { s.now < 2, s' = s.with("now", s.now + 1) }
  action handoff = all { s.phase == "reviewed", s.prepareAccepted,
    s' = s.with("phase", "wallet").with("walletCalled", true)
      .with("inputPrivate", true).with("outputPrivate", true) }
  action walletReply(kind: str): bool = {
    val changed = Set("other", "other-inplace").contains(kind)
    val output = if (changed) (if (s.reviewed == 1) 2 else 1) else s.reviewed
    val mutateInput = kind == "inplace" or kind == "other-inplace"
    all { s.phase == "wallet", walletClasses.contains(kind),
      s' = s.with("phase", "verify").with("providerOutput", output).with("output", output)
        .with("outputShape", kind != "bad-shape").with("authorityValid", kind != "bad-authority")
        .with("walletValid", kind != "bad-wallet")
        .with("prepared", if (not(s.inputPrivate) and mutateInput) output else s.prepared)
        // A normal in-place signer fills its input's second slot. A substituting
        // provider can leave that input half-signed and return a full copy.
        .with("preparedEmpty", not(not(s.inputPrivate) and kind == "inplace")) }
  }
  action walletRejected = all { s.phase == "wallet", s' = s.with("phase", "error").with("error", "wallet-rejected") }
  action checkSigned = all { s.phase == "verify",
    s' = if (s.preparedEmpty and s.outputShape and s.output == s.prepared and s.authorityValid and s.walletValid)
      s.with("phase", "session-await").with("signedAccepted", true)
      else s.with("phase", "error").with("error", "signed-bytes") }
  action mutateProviderOutput = {
    val changed = if (s.providerOutput == 1) 2 else 1
    all { Set("verify", "session-await").contains(s.phase), s.providerOutput > 0,
      s' = s.with("providerOutput", changed).with("output", if (s.outputPrivate) s.output else changed) }
  }
  action post = all { s.phase == "session-await", s.signedAccepted,
    s' = s.with("phase", "posted").with("posted", true).with("postedIdentity", s.output) }
  // Historical handoff passed the sole verification input and retained the
  // wallet's mutable result. These are deliberately excluded from fixed step.
  action oldSharedInput = all { s.phase == "reviewed",
    s' = s.with("phase", "wallet").with("walletCalled", true)
      .with("inputPrivate", false).with("outputPrivate", true) }
  action oldSharedOutput = all { s.phase == "reviewed",
    s' = s.with("phase", "wallet").with("walletCalled", true)
      .with("inputPrivate", true).with("outputPrivate", false) }
  action step = {
    nondet input = inputClasses.oneOf()
    nondet version = Set(0, 1).oneOf()
    nondet expiry = Set(0, 1).oneOf()
    nondet wallet = walletClasses.oneOf()
    any { configure(input, version, expiry), checkPrepared, advance, handoff, walletReply(wallet), walletRejected,
      checkSigned, mutateProviderOutput, post, s' = s }
  }
  val invariant = all {
    Set(0, 1, 2).contains(s.now), Set(0, 1).contains(s.version), Set(0, 1).contains(s.expiry),
    s.walletCalled implies s.prepareAccepted,
    s.signedAccepted implies s.prepareAccepted and s.output == s.reviewed,
    s.posted implies s.signedAccepted and s.postedIdentity == s.reviewed,
    s.prepareAccepted implies Set("valid", "other-attester", "vault-only").contains(s.input) }
  action prepared(kind: str): bool = init.then(configure(kind, 0, 1)).then(checkPrepared)
  action offered = prepared("valid").then(handoff)
  action signed(kind: str): bool = offered.then(walletReply(kind)).then(checkSigned)

  run canonicalPreparedMessageAcceptedTest = prepared("valid").expect(s.prepareAccepted and s.reviewed == 1 and invariant)
  run wrongTransactionSignatureCountRefusesTest = prepared("tx-count").expect(s.error == "shape" and not(s.walletCalled) and invariant)
  run wrongMessageSignatureCountRefusesTest = prepared("required-signatures").expect(s.error == "shape" and invariant)
  run wrongReadonlySignatureCountRefusesTest = prepared("readonly-signers").expect(s.error == "shape" and invariant)
  run truncatedPrefixRefusesTest = prepared("short-prefix").expect(s.error == "shape" and invariant)
  run tooFewAccountKeysRefusesTest = prepared("count-small").expect(s.error == "shape" and invariant)
  run excessiveAccountKeysRefusesTest = prepared("count-large").expect(s.error == "shape" and invariant)
  run prefilledWalletSlotRefusesTest = prepared("wallet-slot").expect(s.error == "shape" and invariant)
  run shortPayloadRefusesDuringConstructionTest = prepared("short-payload").expect(s.error == "construction" and invariant)
  run malformedDomainRefusesDuringConstructionTest = prepared("bad-domain-encoding").expect(s.error == "construction" and invariant)
  run malformedClaimDigestRefusesTest = prepared("bad-claim-encoding").expect(s.error == "construction" and invariant)
  run invalidContextAddressRefusesTest = prepared("bad-address").expect(s.error == "construction" and invariant)
  run invalidActorEncodingRefusesTest = prepared("bad-actor").expect(s.error == "construction" and invariant)
  run attesterAsDestinationRefusesTest = prepared("attester-is-destination").expect(s.error == "construction" and invariant)
  run changedActorRefusesTest = prepared("wrong-actor").expect(s.error == "message-or-signature" and invariant)
  run changedDestinationRefusesTest = prepared("wrong-recipient").expect(s.error == "message-or-signature" and invariant)
  run changedProjectRefusesTest = prepared("wrong-project").expect(s.error == "message-or-signature" and invariant)
  run changedProgramRefusesTest = prepared("wrong-program").expect(s.error == "message-or-signature" and invariant)
  run changedBindingPdaRefusesTest = prepared("wrong-pda").expect(s.error == "message-or-signature" and invariant)
  run changedNetworkDomainRefusesTest = prepared("wrong-domain").expect(s.error == "message-or-signature" and invariant)
  run changedClaimDigestRefusesTest = prepared("wrong-claim").expect(s.error == "message-or-signature" and invariant)
  run addedInstructionRefusesTest = prepared("extra-instruction").expect(s.error == "message-or-signature" and invariant)
  run trailingBytesRefuseTest = prepared("trailing-bytes").expect(s.error == "message-or-signature" and invariant)
  run invalidPreparedAuthoritySignatureRefusesTest = prepared("bad-authority-signature").expect(s.error == "message-or-signature" and invariant)
  run separateSignedOutputKeepsReviewedBytesTest = signed("separate").then(post).expect(s.postedIdentity == 1 and invariant)
  run inPlaceSignerCannotMutatePrivateReferenceTest = signed("inplace").then(post).expect(s.preparedEmpty and s.postedIdentity == 1 and invariant)
  run changedValidMessageRefusesEvenWithValidSignaturesTest = signed("other").expect(s.error == "signed-bytes" and not(s.posted) and invariant)
  run changedInputAndOutputCannotReplacePrivateReferenceTest = signed("other-inplace").expect(s.error == "signed-bytes" and s.prepared == 1 and invariant)
  run wrongSignedShapeRefusesTest = signed("bad-shape").expect(s.error == "signed-bytes" and invariant)
  run wrongReturnedAuthoritySignatureRefusesTest = signed("bad-authority").expect(s.error == "signed-bytes" and invariant)
  run invalidWalletSignatureRefusesTest = signed("bad-wallet").expect(s.error == "signed-bytes" and invariant)
  run walletRejectionDoesNotReachSubmissionTest = offered.then(walletRejected).expect(s.error == "wallet-rejected" and not(s.posted) and invariant)
  run providerMutationDuringSessionAwaitCannotChangeSubmissionTest = signed("separate").then(mutateProviderOutput).then(post)
    .expect(s.providerOutput == 2 and s.postedIdentity == 1 and invariant)
  run providerMutationBeforeVerificationCannotChangePrivateCopyTest = offered.then(walletReply("separate")).then(mutateProviderOutput)
    .then(checkSigned).then(post).expect(s.providerOutput == 2 and s.postedIdentity == 1 and invariant)
  run expiryAndVersionAreNotFreshnessProofTest = init.then(configure("valid", 1, 0)).then(checkPrepared).then(advance).then(advance)
    .then(handoff).then(walletReply("separate")).then(checkSigned).then(post)
    .expect(s.expiry < s.now and s.version == 1 and s.posted and invariant)
  run independentlyUnpinnedAttesterIsOutsideThisCheckTest = prepared("other-attester").then(handoff).then(walletReply("separate"))
    .then(checkSigned).then(post).expect(s.reviewed == 2 and s.postedIdentity == 2 and invariant)
  run vaultIsCheckedByCallerNotEncodedHereTest = prepared("vault-only").expect(s.prepareAccepted and invariant)
  run oldSharedInputCanAcceptOtherReviewedContextNegativeControlTest = prepared("valid").then(oldSharedInput)
    .then(walletReply("other-inplace")).then(checkSigned).then(post)
    .expect(s.postedIdentity == 2 and s.reviewed == 1 and not(invariant))
  run oldInPlaceSigningFalselyRefusesValidMessageNegativeControlTest = prepared("valid").then(oldSharedInput)
    .then(walletReply("inplace")).then(checkSigned).expect(s.error == "signed-bytes" and s.prepared == s.reviewed)
  run oldSharedOutputCanChangeAfterVerificationNegativeControlTest = prepared("valid").then(oldSharedOutput)
    .then(walletReply("separate")).then(checkSigned).then(mutateProviderOutput).then(post)
    .expect(s.postedIdentity == 2 and s.reviewed == 1 and not(invariant))
}
