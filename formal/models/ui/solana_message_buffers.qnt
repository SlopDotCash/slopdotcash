// @source src/lib/use-payout-wallets.ts
// @source src/SolanaBountyRecovery.tsx
// @source backend/security/direct-solana-recovery.ts
// @evidence tests/e2e/payout-wallet-picker.spec.ts
// One shared message-helper invocation, Standard or legacy; two same-length
// message byte identities and two signature byte identities. Signature length
// is missing/63/64 and echoed-message length is equal/different. IDs abstract
// entire byte arrays, not hashes or real signatures. Crypto-valid below is a
// separate illustrative relation; the helper never verifies that relation.
// Caller message, private expected snapshot, provider input/echo, provider
// signature and returned signature are distinct buffers in fixed step.
// Standard copies before exposing input and compares echo to its unexposed
// expected snapshot. Legacy snapshots before reconnect but receives no echo;
// it can check only the returned signature length. Both return a signature
// copy. Generic text sign delegates here before base64 encoding.
// Authority/account/feature checks and provider discovery are preconditions
// covered by solana_wallet_provider. No callback, chain send or payment is
// modeled. Provider or caller mutations may occur around awaits; validation
// and its returned copy are one synchronous continuation. Caller mutation of
// its returned copy is permitted and cannot mutate the provider's buffer.
// Missing/malformed provider shapes collapse to refusal. A 64-byte signature
// and exact echo are not proof of cryptographic validity. In particular, this
// model does not claim the recovery caller validates before caching signatures.
// Old shared input/return actions are excluded from step and used only in
// negative controls. Existing browser definitions are partial evidence; no
// test, parser, checker or provider was executed for this model.
module solana_message_buffers {
  val identities = Set(1, 2)
  val echoKinds = Set("input", "copy", "other", "short", "absent")
  var s: { phase: str, kind: str, caller: int, entry: int, expected: int,
    providerInput: int, inputExposed: bool, inputShared: bool, callerMutated: bool,
    present: bool, echo: int, echoAliasesInput: bool, echoLength: bool,
    providerSignature: int, signatureLength: int, returnedSignature: int,
    signatureAtValidation: int, returnShared: bool, returnedMutated: bool,
    echoAtValidation: int, accepted: bool }
  action init = s' = { phase: "idle", kind: "standard", caller: 1, entry: 0, expected: 0,
    providerInput: 0, inputExposed: false, inputShared: false, callerMutated: false,
    present: false, echo: 0, echoAliasesInput: false, echoLength: false,
    providerSignature: 0, signatureLength: 0, returnedSignature: 0,
    signatureAtValidation: 0, returnShared: false, returnedMutated: false,
    echoAtValidation: 0, accepted: false }
  def other(value: int): int = if (value == 1) 2 else 1
  val echoed = if (s.echoAliasesInput) s.providerInput else s.echo
  val comparison = if (s.inputShared) s.caller else s.expected
  val acceptable = s.present and s.signatureLength == 64 and
    (s.kind == "legacy" or (s.echoLength and echoed == comparison))
  val cryptoValid = s.returnedSignature == s.entry
  action start(kind: str): bool = all {
    s.phase == "idle", Set("standard", "legacy").contains(kind),
    s' = s.with("kind", kind).with("phase", if (kind == "legacy") "reconnect" else "provider")
      .with("entry", s.caller).with("expected", s.caller).with("providerInput", s.caller)
      .with("inputExposed", kind == "standard") }
  action reconnectReply(allowed: bool): bool = all { s.phase == "reconnect",
    s' = s.with("phase", if (allowed) "provider" else "refused").with("inputExposed", allowed) }
  action mutateCaller = all { s.phase != "idle",
    s' = s.with("caller", other(s.caller)).with("callerMutated", true)
      .with("providerInput", if (s.inputShared) other(s.caller) else s.providerInput) }
  action mutateProviderInput = all { s.inputExposed, Set("provider", "validate", "returned", "refused").contains(s.phase),
    s' = s.with("providerInput", other(s.providerInput))
      .with("caller", if (s.inputShared) other(s.providerInput) else s.caller) }
  action providerReply(signature: int, byteLength: int, echoKind: str, present: bool): bool = all {
    s.phase == "provider", identities.contains(signature), Set(0, 63, 64).contains(byteLength), echoKinds.contains(echoKind),
    s' = s.with("phase", "validate").with("present", present).with("providerSignature", signature)
      .with("signatureLength", byteLength).with("echoAliasesInput", echoKind == "input")
      .with("echo", if (echoKind == "other") other(s.providerInput) else if (echoKind == "absent") 0 else s.providerInput)
      .with("echoLength", not(Set("short", "absent").contains(echoKind))) }
  action mutateProviderEcho = all { Set("validate", "returned").contains(s.phase),
    not(s.echoAliasesInput), identities.contains(s.echo), s' = s.with("echo", other(s.echo)) }
  action providerFailure = all { s.phase == "provider", s' = s.with("phase", "refused") }
  action mutateProviderSignature = all { Set("validate", "returned").contains(s.phase),
    s' = s.with("providerSignature", other(s.providerSignature))
      .with("returnedSignature", if (s.returnShared and s.phase == "returned") other(s.providerSignature) else s.returnedSignature) }
  action validate = all { s.phase == "validate",
    s' = s.with("phase", if (acceptable) "returned" else "refused").with("accepted", acceptable)
      .with("echoAtValidation", echoed)
      .with("signatureAtValidation", if (acceptable) s.providerSignature else 0)
      .with("returnedSignature", if (acceptable) s.providerSignature else 0) }
  action mutateReturnedSignature = all { s.phase == "returned",
    s' = s.with("returnedSignature", other(s.returnedSignature)).with("returnedMutated", true)
      .with("providerSignature", if (s.returnShared) other(s.returnedSignature) else s.providerSignature) }
  // The former Standard input and expected-message reference were the caller's
  // same array; the former legacy input was also passed without a snapshot.
  action oldStart(kind: str): bool = all { s.phase == "idle", Set("standard", "legacy").contains(kind),
    s' = s.with("kind", kind).with("phase", if (kind == "legacy") "reconnect" else "provider")
      .with("entry", s.caller).with("expected", s.caller).with("providerInput", s.caller)
      .with("inputExposed", kind == "standard").with("inputShared", true) }
  action oldValidateReturnsAlias = all { s.phase == "validate", acceptable,
    s' = s.with("phase", "returned").with("accepted", true).with("returnShared", true)
      .with("echoAtValidation", echoed).with("signatureAtValidation", s.providerSignature)
      .with("returnedSignature", s.providerSignature) }
  action step = {
    nondet kind = Set("standard", "legacy").oneOf()
    nondet signature = identities.oneOf()
    nondet byteLength = Set(0, 63, 64).oneOf()
    nondet echoKind = echoKinds.oneOf()
    nondet yes = Set(false, true).oneOf()
    any { start(kind), reconnectReply(yes), mutateCaller, mutateProviderInput,
      providerReply(signature, byteLength, echoKind, yes), providerFailure,
      mutateProviderEcho, mutateProviderSignature, validate, mutateReturnedSignature, s' = s }
  }
  val invariant = all {
    s.phase != "idle" implies s.expected == s.entry,
    not(s.callerMutated) and s.phase != "idle" implies s.caller == s.entry,
    s.accepted implies s.signatureLength == 64,
    s.accepted and s.kind == "standard" implies s.echoAtValidation == s.entry,
    s.accepted and not(s.returnedMutated) implies s.returnedSignature == s.signatureAtValidation }
  action exact(kind: str): bool = init.then(start(kind))
  action standardReply = providerReply(1, 64, "input", true).then(validate)
  action legacyReady = exact("legacy").then(reconnectReply(true))

  run standardExactEchoReturnsPrivateSignatureTest = exact("standard").then(standardReply)
    .expect(s.accepted and s.returnedSignature == 1 and invariant)
  run providerInputMutationCannotChangeCallerTest = exact("standard").then(mutateProviderInput).then(providerReply(2, 64, "input", true)).then(validate)
    .expect(s.phase == "refused" and s.caller == 1 and s.expected == 1 and invariant)
  run callerMutationDuringAwaitCannotChangeExpectedTest = exact("standard").then(mutateCaller).then(standardReply)
    .expect(s.caller == 2 and s.expected == 1 and s.accepted and invariant)
  run independentDifferentEchoIsRefusedTest = exact("standard").then(providerReply(1, 64, "other", true)).then(validate)
    .expect(s.phase == "refused" and invariant)
  run independentEchoMutationBeforeValidationIsRefusedTest = exact("standard")
    .then(providerReply(1, 64, "copy", true)).then(mutateProviderEcho).then(validate)
    .expect(s.phase == "refused" and invariant)
  run shortSignatureIsRefusedTest = exact("standard").then(providerReply(1, 63, "input", true)).then(validate)
    .expect(s.phase == "refused" and invariant)
  run missingProviderResultIsRefusedTest = exact("standard").then(providerReply(1, 64, "input", false)).then(validate)
    .expect(s.phase == "refused" and invariant)
  run providerMutatesAliasedEchoBeforeValidationTest = exact("standard").then(providerReply(1, 64, "input", true)).then(mutateProviderInput).then(validate)
    .expect(s.phase == "refused" and s.caller == 1 and invariant)
  run exactEchoDoesNotProveSignatureCryptographyTest = exact("standard").then(providerReply(2, 64, "copy", true)).then(validate)
    .expect(s.accepted and not(cryptoValid) and invariant)
  run signatureCopyUsesBytesAtValidationTest = exact("standard").then(providerReply(1, 64, "copy", true)).then(mutateProviderSignature).then(validate)
    .expect(s.accepted and s.returnedSignature == 2 and invariant)
  run laterProviderSignatureMutationCannotChangeReturnedCopyTest = exact("standard").then(standardReply).then(mutateProviderSignature)
    .expect(s.providerSignature == 2 and s.returnedSignature == 1 and invariant)
  run callerOwnsReturnedCopyWithoutChangingProviderTest = exact("standard").then(standardReply).then(mutateReturnedSignature)
    .expect(s.returnedSignature == 2 and s.providerSignature == 1 and invariant)
  run laterEchoMutationCannotChangeValidatedSnapshotTest = exact("standard").then(standardReply).then(mutateProviderInput)
    .expect(s.echoAtValidation == 1 and s.returnedSignature == 1 and invariant)
  run legacySnapshotsBeforeReconnectAwaitTest = exact("legacy").then(mutateCaller).then(reconnectReply(true))
    .then(providerReply(1, 64, "absent", true)).then(validate)
    .expect(s.accepted and s.providerInput == 1 and s.caller == 2 and invariant)
  run legacyHasNoEchoProofButKeepsCallerBufferPrivateTest = legacyReady.then(mutateProviderInput)
    .then(providerReply(2, 64, "absent", true)).then(validate)
    .expect(s.accepted and s.caller == 1 and not(cryptoValid) and invariant)
  run legacyShortSignatureIsRefusedTest = legacyReady.then(providerReply(1, 63, "absent", true)).then(validate)
    .expect(s.phase == "refused" and invariant)
  run legacyReconnectRefusalNeverExposesProviderInputTest = exact("legacy").then(reconnectReply(false))
    .expect(s.phase == "refused" and not(s.accepted) and invariant)
  run oldMutatedStandardInputCouldPassNegativeControlTest = init.then(oldStart("standard")).then(mutateProviderInput)
    .then(providerReply(2, 64, "input", true)).then(validate)
    .expect(s.accepted and s.echoAtValidation != s.entry and not(invariant))
  run oldProviderSignatureAliasCouldChangeReturnedBytesNegativeControlTest = exact("standard")
    .then(providerReply(1, 64, "copy", true)).then(oldValidateReturnsAlias).then(mutateProviderSignature)
    .expect(s.returnedSignature != s.signatureAtValidation and not(invariant))
  run oldLegacyInputAliasCouldChangeCallerNegativeControlTest = init.then(oldStart("legacy")).then(reconnectReply(true))
    .then(mutateProviderInput).then(providerReply(2, 64, "absent", true)).then(validate)
    .expect(s.accepted and s.caller != s.entry and not(invariant))
}
