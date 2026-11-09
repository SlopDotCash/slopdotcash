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
// Exhaustive verification explores a reduced `step`; the comment above it
// states each reduction argument. Direct actions and scenarios are unreduced.
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
  // `initial` is shared by `init` and the `initState` helper so scenario
  // helpers never reuse the TLA+ init action (QNT409).
  val initial = { configured: false, kind: "standard", phase: "idle",
    registered: true, address: 1, accountObject: 1, capturedAddress: 0,
    exposedTransaction: false, exposedSend: false, messageFeature: true,
    transactionFeature: true, sendFeature: true, chains: Set(1, 2),
    transactionLegacy: true, sendLegacy: true, operations: ids.mapBy(_ => idle), effects: Set() }
  action init = s' = initial
  action initState = s' = initial
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
  // Step-only compaction (reduction 6 below). Direct actions pass false.
  def stored(compact: bool, op: Operation): Operation =
    if (not(compact)) op
    else if (op.phase == "done" and not(op.invoked)) idle.with("phase", "done")
    else if (op.invoked) op.with("chain", 1)
    else op
  action begin(id: int, method: str, chain: int): bool = beginAs(id, method, chain, false)
  action beginAs(id: int, method: str, chain: int, compact: bool): bool = all {
    s.phase == "connected", ids.contains(id), methods.contains(method), addresses.contains(chain),
    s.operations.get(id).phase == "unused",
    s' = s.with("operations", s.operations.set(id, stored(compact,
      (if (not(exposed(method))) ended(idle, "unsupported") else idle.with("phase", if (s.kind == "legacy") "reconnect" else "gate"))
        .with("method", method).with("address", s.capturedAddress).with("chain", chain)))) }
  // Standard gate and feature invocation are synchronous up to the provider
  // promise. Only the explicitly supplied beforeSend callback lies between.
  action standardInvoke(id: int, callbackSucceeds: bool): bool = standardInvokeAs(id, callbackSucceeds, false)
  action standardInvokeAs(id: int, callbackSucceeds: bool, compact: bool): bool = {
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
      s' = s.with("operations", s.operations.set(id, stored(compact,
        if (invoke) observed.with("phase", "provider-wait").with("invoked", true)
        else ended(observed, if (not(permitted)) "wallet-changed" else if (not(legacyFormat)) "legacy-format" else "callback-error")))) }
  }
  action reconnect(id: int): bool = {
    val op = s.operations.get(id)
    all { s.kind == "legacy", op.phase == "reconnect",
      s' = s.with("operations", s.operations.set(id, op.with("phase", "reconnect-wait").with("reconnected", true))) }
  }
  // Address comparison and signMessage invocation share the continuation after
  // the reconnect promise; there is no invented asynchronous gap between them.
  action reconnectReply(id: int, valid: bool): bool = reconnectReplyAs(id, valid, false)
  action reconnectReplyAs(id: int, valid: bool, compact: bool): bool = {
    val op = s.operations.get(id)
    val matching = valid and s.address == op.address
    all { op.phase == "reconnect-wait", s' = s.with("operations", s.operations.set(id, stored(compact,
      if (matching) op.with("phase", "provider-wait").with("checked", true).with("matched", true).with("feature", true)
        .with("chainMatch", true).with("legacyFormat", true).with("usedObject", s.accountObject).with("invoked", true)
      else ended(op, if (valid) "wallet-changed" else "provider-error")))) }
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
  // Finite `step` reductions (formal/README.md, "Scoped nondeterministic
  // choices" and "Dead environment changes"). Direct actions and named
  // scenarios are unchanged.
  // 1. Each nondeterministic choice is scoped to the one action that reads it.
  //    The disjunction of per-action existentials equals the former single
  //    existential over every choice, so successors are unchanged.
  // 2. Wallet-environment changes (registration, address, account object,
  //    features, chains, legacy formats) are taken only while a later
  //    transition can still read the changed field. Only begin, standardInvoke
  //    and reconnectReply read them, all after `phase == "connected"`, and
  //    that phase is final. Before connection every reachable state satisfies
  //    the invariant (all operations unused, captured address 0) and connect,
  //    connectReply and configure read no environment field, so an earlier
  //    change commutes past the connection. After connection a field that no
  //    pending operation can read again stays unread forever (operations only
  //    advance and exposure is fixed): changing it reaches a state that
  //    differs only in that unread field, with the same invariant truth and
  //    the same successors. Legacy reads only the address and account object;
  //    Standard reads transaction or send fields only when that method was
  //    exposed and an unused or gated operation may still use it.
  // 3. The account object is copied only to `usedObject`, which no guard or
  //    invariant reads (scenarios check it through direct actions), so step
  //    does not replace it.
  // 4. Message methods never read the operation chain, so step begins them
  //    with chain 1 only.
  // 5. Operation ids are interchangeable (identical idle records, symmetric
  //    guards, effects and invariant). Swapping them maps every path to one in
  //    which operation 1 begins first, so step begins operation 2 only after
  //    operation 1.
  // 6. A finished operation that never invoked the provider is read by no
  //    guard, update or invariant conjunct beyond its phase and `invoked`
  //    (sendEffect requires `invoked`), so step stores one canonical finished
  //    record for it. An invoked operation no longer reads its chain, so step
  //    stores chain 1 for it. Scenarios inspect results through direct actions.
  val replyOutcomes = Set("exact", "short", "changed-message", "changed-transaction", "empty-transaction", "missing", "throw")
  def mayRead(methodSet: Set[str]): bool = s.phase == "connected" and ids.exists(id => {
    val op = s.operations.get(id)
    op.phase == "unused" or (Set("gate", "reconnect", "reconnect-wait").contains(op.phase) and methodSet.contains(op.method))
  })
  val standardLive = s.kind == "standard" and mayRead(methods)
  val messageLive = s.kind == "standard" and mayRead(Set("text", "message"))
  val transactionLive = s.kind == "standard" and s.exposedTransaction and mayRead(Set("transaction"))
  val sendLive = s.kind == "standard" and s.exposedSend and mayRead(Set("send"))
  def methodLive(method: str): bool = if (method == "transaction") transactionLive
    else if (method == "send") sendLive else messageLive
  action step = any {
    { nondet kind = Set("standard", "legacy").oneOf() configure(kind) },
    connect,
    { nondet account = addresses.oneOf() nondet caps = capabilities.oneOf() nondet yes = Set(false, true).oneOf()
      connectReply(account, caps, yes) },
    all { standardLive, unregister },
    all { mayRead(methods), nondet address = Set(0, 1, 2).oneOf() setAddress(address) },
    { nondet method = methods.oneOf() all { methodLive(method), withdrawFeature(method) } },
    { nondet chain = addresses.oneOf() all { transactionLive or sendLive, removeChain(chain) } },
    { nondet method = Set("transaction", "send").oneOf() all { methodLive(method), removeLegacyFormat(method) } },
    { nondet id = ids.oneOf() nondet method = methods.oneOf() nondet chain = addresses.oneOf()
      all { id == 1 or s.operations.get(1).phase != "unused",
        Set("transaction", "send").contains(method) or chain == 1, beginAs(id, method, chain, true) } },
    { nondet id = ids.oneOf() nondet yes = Set(false, true).oneOf() standardInvokeAs(id, yes, true) },
    { nondet id = ids.oneOf() reconnect(id) },
    { nondet id = ids.oneOf() nondet yes = Set(false, true).oneOf() reconnectReplyAs(id, yes, true) },
    { nondet id = ids.oneOf() nondet outcome = replyOutcomes.oneOf() providerReply(id, outcome) },
    { nondet id = ids.oneOf() sendEffect(id) },
    s' = s }
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
  action connected(kind: str, caps: str): bool = initState.then(configure(kind)).then(connect).then(connectReply(1, caps, true))
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
