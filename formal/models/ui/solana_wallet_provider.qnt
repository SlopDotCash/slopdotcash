// @source src/lib/use-payout-wallets.ts
// @source src/Earnings.tsx
// @source src/PayoutConsent.tsx
// @source src/SolanaBountyRecovery.tsx
// @source src/SolanaBountyPayment.tsx
// @source src/lib/solana-vault-actions.ts
// @evidence tests/e2e/payout-wallet-picker.spec.ts
// @evidence tests/e2e/payout-consent.spec.ts
// @evidence tests/e2e/solana-history-recovery.spec.ts
// @evidence tests/e2e/solana-vault-actions.spec.ts
// One selected provider (Wallet Standard or legacy), one connection and two
// method invocations. Two addresses, two same-address account objects and two
// chains represent account removal/rotation/replacement and chain withdrawal.
// Discovery filtering, first eligible connected account, UTF-8/base64 encoding
// and byte arrays are predicates/classes rather than parser/crypto proofs.
// Standard connect does not recheck registration after its await. It captures
// address and optional method exposure; each later method finds the current
// account by address. An added feature does not add a method to this existing
// connection. A same-address new object is passed to the provider, not the
// captured object. Legacy methods reconnect to the captured provider and
// compare the returned address to the captured string; removing a browser
// global is not revocation of that object.
// Generic text sign and byte signMessage share the same fresh gate and 64-byte
// result check. Standard also verifies echoed message bytes. Legacy has no
// echoed-message result, so it cannot verify those bytes or a signature's
// validity here. Transaction signing checks presence only; even empty/changed
// transaction bytes require independent caller validation. No signature or
// chain finality is proved by this adapter model.
// sign/send require the requested account chain, feature and legacy format.
// Byte/text message signing requires its feature but no specific chain.
// beforeSend is synchronous, runs once after the gate, and may refuse before
// the provider is invoked. Its own wallet mutations are excluded. Later
// withdrawal cannot cancel an in-flight provider call: a send effect may
// precede or follow a lost/invalid reply. Caller component/session ownership,
// persistent send reservations and financial authorization are separate.
// Old generic-sign bypasses are negative controls outside step. The listed
// fixtures are partial evidence; no tests, parsers, providers or checks ran.
module solana_wallet_provider {
  val ids = Set(1, 2)
  val addresses = Set(1, 2)
  val methods = Set("text", "message", "transaction", "send")
  val capabilities = Set("message", "transaction", "send", "both")
  type Operation = { phase: str, method: str, address: int, chain: int,
    checked: bool, matched: bool, registered: bool, feature: bool, chainMatch: bool,
    legacyFormat: bool, usedObject: int, reconnected: bool,
    callback: bool, invoked: bool, encoded: bool, result: str }
  val idle: Operation = { phase: "unused", method: "text", address: 1, chain: 1,
    checked: false, matched: false, registered: false, feature: false, chainMatch: false,
    legacyFormat: false, usedObject: 0, reconnected: false,
    callback: false, invoked: false, encoded: false, result: "none" }
  var s: { configured: bool, kind: str, phase: str, registered: bool,
    address: int, accountObject: int, capturedAddress: int,
    exposedTransaction: bool, exposedSend: bool, messageFeature: bool,
    transactionFeature: bool, sendFeature: bool, chains: Set[int],
    transactionLegacy: bool, sendLegacy: bool, operations: int -> Operation,
    effects: Set[int] }
  action init = s' = { configured: false, kind: "standard", phase: "idle",
    registered: true, address: 1, accountObject: 1, capturedAddress: 0,
    exposedTransaction: false, exposedSend: false, messageFeature: true,
    transactionFeature: true, sendFeature: true, chains: Set(1, 2),
    transactionLegacy: true, sendLegacy: true, operations: ids.mapBy(_ => idle), effects: Set() }
  def ended(op: Operation, result: str): Operation = op.with("phase", "done").with("result", result)
  def feature(method: str): bool = if (Set("text", "message").contains(method)) s.messageFeature
    else if (method == "transaction") s.transactionFeature else s.sendFeature
  def exposed(method: str): bool = Set("text", "message").contains(method)
    or (method == "transaction" and s.exposedTransaction) or (method == "send" and s.exposedSend)
  def outcomes(method: str): Set[str] = if (method == "transaction")
    Set("exact", "changed-transaction", "empty-transaction", "missing", "throw")
    else if (method == "send") Set("exact", "short", "missing", "throw")
    else Set("exact", "short", "changed-message", "missing", "throw")
  action configure(kind: str): bool = all { not(s.configured), Set("standard", "legacy").contains(kind),
    s' = s.with("configured", true).with("kind", kind) }
  action connect = all { s.configured, s.phase == "idle", s' = s.with("phase", "connecting") }
  action connectReply(account: int, caps: str, valid: bool): bool = all {
    s.phase == "connecting", addresses.contains(account), capabilities.contains(caps),
    s' = if (not(valid)) s.with("phase", "connect-error") else s.with("phase", "connected")
      .with("capturedAddress", account)
      .with("exposedTransaction", s.kind == "standard" and Set("transaction", "both").contains(caps))
      .with("exposedSend", s.kind == "standard" and Set("send", "both").contains(caps)) }
  action unregister = all { s.registered, s' = s.with("registered", false) }
  action setAddress(address: int): bool = all { Set(0, 1, 2).contains(address), s' = s.with("address", address) }
  action replaceAccountObject = all { s.accountObject == 1, s' = s.with("accountObject", 2) }
  action withdrawFeature(method: str): bool = all { methods.contains(method),
    s' = if (Set("text", "message").contains(method)) s.with("messageFeature", false)
      else if (method == "transaction") s.with("transactionFeature", false) else s.with("sendFeature", false) }
  action removeChain(chain: int): bool = all { addresses.contains(chain), s.chains.contains(chain),
    s' = s.with("chains", s.chains.exclude(Set(chain))) }
  action removeLegacyFormat(method: str): bool = all { Set("transaction", "send").contains(method),
    s' = if (method == "transaction") s.with("transactionLegacy", false) else s.with("sendLegacy", false) }
  action begin(id: int, method: str, chain: int): bool = all {
    s.phase == "connected", ids.contains(id), methods.contains(method), addresses.contains(chain),
    s.operations.get(id).phase == "unused",
    s' = s.with("operations", s.operations.set(id,
      (if (not(exposed(method))) ended(idle, "unsupported") else idle.with("phase", if (s.kind == "legacy") "reconnect" else "gate"))
        .with("method", method).with("address", s.capturedAddress).with("chain", chain))) }
  // Standard gate and feature invocation are synchronous up to the provider
  // promise. Only the explicitly supplied beforeSend callback lies between.
  action standardInvoke(id: int, callbackSucceeds: bool): bool = {
    val op = s.operations.get(id)
    val chainRequired = Set("transaction", "send").contains(op.method)
    val chainMatch = not(chainRequired) or s.chains.contains(op.chain)
    val legacyFormat = not(chainRequired) or (if (op.method == "transaction") s.transactionLegacy else s.sendLegacy)
    val permitted = s.registered and s.address == op.address and feature(op.method) and chainMatch
    val callback = permitted and legacyFormat and op.method == "send"
    val invoke = permitted and legacyFormat and (not(callback) or callbackSucceeds)
    val observed = op.with("checked", true).with("matched", s.address == op.address)
      .with("registered", s.registered).with("feature", feature(op.method))
      .with("chainMatch", chainMatch).with("legacyFormat", legacyFormat).with("usedObject", s.accountObject)
      .with("callback", callback)
    all { s.kind == "standard", op.phase == "gate",
      s' = s.with("operations", s.operations.set(id,
        if (invoke) observed.with("phase", "provider-wait").with("invoked", true)
        else ended(observed, if (not(permitted)) "wallet-changed" else if (not(legacyFormat)) "legacy-format" else "callback-error"))) }
  }
  action reconnect(id: int): bool = {
    val op = s.operations.get(id)
    all { s.kind == "legacy", op.phase == "reconnect",
      s' = s.with("operations", s.operations.set(id, op.with("phase", "reconnect-wait").with("reconnected", true))) }
  }
  // Address comparison and signMessage invocation share the continuation after
  // the reconnect promise; there is no invented asynchronous gap between them.
  action reconnectReply(id: int, valid: bool): bool = {
    val op = s.operations.get(id)
    val matching = valid and s.address == op.address
    all { op.phase == "reconnect-wait", s' = s.with("operations", s.operations.set(id,
      if (matching) op.with("phase", "provider-wait").with("checked", true).with("matched", true).with("feature", true)
        .with("chainMatch", true).with("legacyFormat", true).with("usedObject", s.accountObject).with("invoked", true)
      else ended(op, if (valid) "wallet-changed" else "provider-error"))) }
  }
  action providerReply(id: int, outcome: str): bool = {
    val op = s.operations.get(id)
    val accepted = outcome == "exact"
      or (op.method == "transaction" and Set("changed-transaction", "empty-transaction").contains(outcome))
      or (s.kind == "legacy" and Set("text", "message").contains(op.method) and outcome == "changed-message")
    all { op.phase == "provider-wait", outcomes(op.method).contains(outcome),
      s' = s.with("operations", s.operations.set(id,
        ended(op.with("encoded", accepted and op.method == "text"),
          if (accepted) "ok" else if (outcome == "throw") "provider-error" else "invalid-result"))) }
  }
  action sendEffect(id: int): bool = {
    val op = s.operations.get(id)
    all { op.invoked, op.method == "send", not(s.effects.contains(id)),
      s' = s.with("effects", s.effects.union(Set(id))) }
  }
  // Old text wrappers skipped the shared fresh gate/reconnect entirely.
  action oldTextInvoke(id: int): bool = {
    val op = s.operations.get(id)
    all { op.method == "text", Set("gate", "reconnect").contains(op.phase),
      s' = s.with("operations", s.operations.set(id, op.with("phase", "provider-wait").with("invoked", true))) }
  }
  action step = {
    nondet id = ids.oneOf()
    nondet method = methods.oneOf()
    nondet chain = addresses.oneOf()
    nondet address = Set(0, 1, 2).oneOf()
    nondet account = addresses.oneOf()
    nondet caps = capabilities.oneOf()
    nondet kind = Set("standard", "legacy").oneOf()
    nondet outcome = Set("exact", "short", "changed-message", "changed-transaction", "empty-transaction", "missing", "throw").oneOf()
    nondet yes = Set(false, true).oneOf()
    any { configure(kind), connect, connectReply(account, caps, yes), unregister, setAddress(address), replaceAccountObject,
      withdrawFeature(method), removeChain(chain), removeLegacyFormat(method), begin(id, method, chain),
      standardInvoke(id, yes), reconnect(id), reconnectReply(id, yes), providerReply(id, outcome), sendEffect(id), s' = s }
  }
  val invariant = all {
    Set(0, 1, 2).contains(s.address), Set(0, 1, 2).contains(s.capturedAddress), s.effects.subseteq(ids),
    s.phase == "connected" implies addresses.contains(s.capturedAddress),
    ids.forall(id => {
      val op = s.operations.get(id)
      all { op.invoked implies op.checked and op.matched and op.feature and op.chainMatch and op.legacyFormat,
        op.invoked and s.kind == "standard" implies op.registered,
        op.invoked and s.kind == "legacy" implies op.reconnected,
        op.invoked and op.method == "send" implies op.callback,
        op.encoded implies op.method == "text" and op.result == "ok",
        s.effects.contains(id) implies op.invoked and op.method == "send" }
    }) }
  action connected(kind: str, caps: str): bool = init.then(configure(kind)).then(connect).then(connectReply(1, caps, true))
  action standardCall(id: int, method: str): bool = begin(id, method, 1).then(standardInvoke(id, true))
  action legacyCall(id: int, method: str): bool = begin(id, method, 1).then(reconnect(id)).then(reconnectReply(id, true))

  run standardTextUsesFreshSharedMessageGateTest = connected("standard", "both").then(standardCall(1, "text")).then(providerReply(1, "exact"))
    .expect(s.operations.get(1).encoded and invariant)
  run standardBytesUseFreshSharedMessageGateTest = connected("standard", "message").then(standardCall(1, "message")).then(providerReply(1, "exact"))
    .expect(s.operations.get(1).result == "ok" and not(s.operations.get(1).encoded) and invariant)
  run withdrawnStandardWalletRefusesTextPromptTest = connected("standard", "both").then(unregister).then(standardCall(1, "text"))
    .expect(s.operations.get(1).result == "wallet-changed" and not(s.operations.get(1).invoked) and invariant)
  run oldStandardTextCouldPromptWithdrawnWalletNegativeControlTest = connected("standard", "both").then(unregister)
    .then(begin(1, "text", 1)).then(oldTextInvoke(1)).then(providerReply(1, "exact")).expect(not(invariant))
  run changedStandardAccountRefusesMessageTest = connected("standard", "both").then(setAddress(2)).then(standardCall(1, "message"))
    .expect(s.operations.get(1).result == "wallet-changed" and invariant)
  run removedStandardAccountRefusesTextTest = connected("standard", "both").then(setAddress(0)).then(standardCall(1, "text"))
    .expect(s.operations.get(1).result == "wallet-changed" and invariant)
  run sameAddressReplacementUsesCurrentAccountObjectTest = connected("standard", "both").then(replaceAccountObject).then(standardCall(1, "message"))
    .then(providerReply(1, "exact")).expect(s.operations.get(1).usedObject == 2 and invariant)
  run removedMessageFeatureRefusesTextTest = connected("standard", "both").then(withdrawFeature("message")).then(standardCall(1, "text"))
    .expect(not(s.operations.get(1).invoked) and invariant)
  run textRejectsShortSignatureThroughSharedHelperTest = connected("standard", "both").then(standardCall(1, "text")).then(providerReply(1, "short"))
    .expect(s.operations.get(1).result == "invalid-result" and not(s.operations.get(1).encoded) and invariant)
  run standardRejectsChangedEchoedMessageTest = connected("standard", "message").then(standardCall(1, "message")).then(providerReply(1, "changed-message"))
    .expect(s.operations.get(1).result == "invalid-result" and invariant)
  run standardConnectMayReturnAfterUnregisterTest = init.then(configure("standard")).then(connect).then(unregister).then(connectReply(1, "both", true))
    .then(standardCall(1, "text")).expect(s.phase == "connected" and not(s.operations.get(1).invoked) and invariant)
  run invalidConnectReplyCreatesNoConnectionTest = init.then(configure("standard")).then(connect).then(connectReply(1, "both", false))
    .expect(s.phase == "connect-error" and s.capturedAddress == 0 and invariant)
  run initiallyMissingTransactionMethodRemainsUnavailableTest = connected("standard", "message").then(begin(1, "transaction", 1))
    .expect(s.operations.get(1).result == "unsupported" and not(s.operations.get(1).invoked) and invariant)
  run transactionRequiresCurrentRequestedChainTest = connected("standard", "both").then(removeChain(1)).then(standardCall(1, "transaction"))
    .expect(s.operations.get(1).result == "wallet-changed" and invariant)
  run messageDoesNotRequireSpecificChainTest = connected("standard", "both").then(removeChain(1)).then(removeChain(2))
    .then(standardCall(1, "message")).then(providerReply(1, "exact")).expect(s.operations.get(1).result == "ok" and invariant)
  run transactionRequiresLegacyFormatTest = connected("standard", "both").then(removeLegacyFormat("transaction")).then(standardCall(1, "transaction"))
    .expect(s.operations.get(1).result == "legacy-format" and not(s.operations.get(1).invoked) and invariant)
  run signedTransactionBytesNeedCallerVerificationTest = connected("standard", "both").then(standardCall(1, "transaction"))
    .then(providerReply(1, "changed-transaction")).expect(s.operations.get(1).result == "ok" and invariant)
  run emptyTransactionArrayIsTruthyAtAdapterBoundaryTest = connected("standard", "both").then(standardCall(1, "transaction"))
    .then(providerReply(1, "empty-transaction")).expect(s.operations.get(1).result == "ok" and invariant)
  run sendCallbackRefusalPreventsProviderCallTest = connected("standard", "both").then(begin(1, "send", 1)).then(standardInvoke(1, false))
    .expect(s.operations.get(1).callback and not(s.operations.get(1).invoked) and s.operations.get(1).result == "callback-error" and invariant)
  run withdrawnWalletNeverReachesSendCallbackTest = connected("standard", "both").then(unregister).then(standardCall(1, "send"))
    .expect(not(s.operations.get(1).callback) and not(s.operations.get(1).invoked) and invariant)
  run acceptedSendCanOutliveAccountWithdrawalTest = connected("standard", "both").then(standardCall(1, "send")).then(unregister)
    .then(sendEffect(1)).then(providerReply(1, "exact")).expect(s.effects == Set(1) and s.operations.get(1).result == "ok" and invariant)
  run failedSendReplyDoesNotProveNoEffectTest = connected("standard", "both").then(standardCall(1, "send")).then(providerReply(1, "throw"))
    .then(sendEffect(1)).expect(s.operations.get(1).result == "provider-error" and s.effects == Set(1) and invariant)
  run shortSendSignatureDoesNotEraseEffectTest = connected("standard", "both").then(standardCall(1, "send")).then(sendEffect(1))
    .then(providerReply(1, "short")).expect(s.operations.get(1).result == "invalid-result" and s.effects == Set(1) and invariant)
  run legacyTextReconnectsBeforeSigningTest = connected("legacy", "message").then(legacyCall(1, "text")).then(providerReply(1, "exact"))
    .expect(s.operations.get(1).reconnected and s.operations.get(1).encoded and invariant)
  run legacyChangedAddressRefusesTextTest = connected("legacy", "message").then(setAddress(2)).then(legacyCall(1, "text"))
    .expect(s.operations.get(1).result == "wallet-changed" and not(s.operations.get(1).invoked) and invariant)
  run oldLegacyTextCouldPromptChangedAccountNegativeControlTest = connected("legacy", "message").then(setAddress(2))
    .then(begin(1, "text", 1)).then(oldTextInvoke(1)).then(providerReply(1, "exact")).expect(not(invariant))
  run legacyTextRejectsShortSignatureTest = connected("legacy", "message").then(legacyCall(1, "text")).then(providerReply(1, "short"))
    .expect(s.operations.get(1).result == "invalid-result" and invariant)
  run legacyCannotVerifyUnreturnedMessageBytesTest = connected("legacy", "message").then(legacyCall(1, "message")).then(providerReply(1, "changed-message"))
    .expect(s.operations.get(1).result == "ok" and invariant)
  run legacyReconnectFailurePreventsSignaturePromptTest = connected("legacy", "message").then(begin(1, "text", 1)).then(reconnect(1))
    .then(reconnectReply(1, false)).expect(s.operations.get(1).result == "provider-error" and not(s.operations.get(1).invoked) and invariant)
  run twoConcurrentCallsRetainTheirOwnResultsTest = connected("standard", "both").then(standardCall(1, "text")).then(standardCall(2, "message"))
    .then(providerReply(2, "short")).then(providerReply(1, "exact"))
    .expect(s.operations.get(1).result == "ok" and s.operations.get(2).result == "invalid-result" and invariant)
}
