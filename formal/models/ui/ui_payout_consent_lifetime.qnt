// @source src/PayoutConsent.tsx
// @source src/Earnings.tsx
// @source src/lib/project-api.ts
// @source backend/payments/handler.ts
// @source backend/http.ts
// @evidence tests/e2e/payout-consent.spec.ts
// Two operation slots, two committed review contexts and actors, one parent
// concurrent account read. Families share the continuation protocol; prepared EVM typed
// data and Solana wire/signature validation are explicit predicates, not
// cryptographic proofs. Wallet rejection, malformed replies and API failure
// are finite outcome classes. No provider can be forcibly disconnected here.
// Session observation and reply are separate: a successful observation does
// not lock the cookie. Every write carries the captured expected actor; the
// server can retain an admitted effect after cancellation or a lost reply.
// Current-operation checks guard continuations, prompts, writes and feedback.
// Context change/unmount/explicit sign-out invalidates ownership. Access loss
// also aborts the parent's account load so its previously read snapshot cannot
// restore the old view. No current-cookie-at-display or cross-service atomicity
// guarantee is made. Only one parent read is modeled; deadlines/fetch abortion
// and wallet discovery are separate contracts. Both old-order controls are
// excluded from step. All scenarios were authored without executing checks.
module ui_payout_consent_lifetime {
  val ids = Set(1, 2)
  type Operation = { phase: str, context: int, actor: int, family: str,
    next: str, observedActor: int, prompts: int, requests: Set[str],
    accepted: Set[str], response: str, walletValid: bool, signatureValid: bool }
  val idle: Operation = { phase: "unused", context: 0, actor: 0, family: "evm",
    next: "none", observedActor: -1, prompts: 0, requests: Set(), accepted: Set(), response: "none",
    walletValid: true, signatureValid: true }
  type State = { mounted: bool, context: int, actor: int, cookie: int, open: bool,
    active: int, busy: int, notice: int, error: str, visibleActor: int,
    loadActive: bool, loadSnapshot: int, badPrompt: bool, badRestore: bool,
    operations: int -> Operation }
  var s: State
  action init = s' = { mounted: true, context: 1, actor: 1, cookie: 1, open: false,
    active: 0, busy: 0, notice: 0, error: "none", visibleActor: 1,
    loadActive: false, loadSnapshot: 0, badPrompt: false, badRestore: false,
    operations: ids.mapBy(_ => idle) }
  def operation(id: int): Operation = if (ids.contains(id)) s.operations.get(id) else idle
  def current(id: int): bool = s.mounted and s.active == id
    and operation(id).context == s.context
  def stopped(id: int): State = s.with("operations", s.operations.set(id, s.operations.get(id).with("phase", "stopped")))
  def failure(id: int, kind: str): State = if (not(current(id))) stopped(id)
    else stopped(id).with("active", 0).with("busy", 0).with("error", kind)
  def accessLost(id: int): State = if (not(current(id))) stopped(id)
    else failure(id, "account").with("visibleActor", 0).with("open", false)
      .with("notice", 0).with("loadActive", false)
  action cookie(actor: int): bool = all { Set(0, 1, 2).contains(actor), s' = s.with("cookie", actor) }
  action open = all { s.mounted, s.visibleActor > 0, s.active == 0, s' = s.with("open", true) }
  action close = all { s.open, s.active == 0, s' = s.with("open", false).with("error", "none") }
  action begin(id: int, family: str): bool = all {
    s.mounted, s.open, s.active == 0, ids.contains(id), Set("evm", "solana").contains(family),
    s.operations.get(id).phase == "unused", s.visibleActor == s.actor,
    s' = s.with("active", id).with("busy", id).with("notice", 0).with("error", "none")
      .with("operations", s.operations.set(id, idle.with("phase", "connect-check")
        .with("context", s.context).with("actor", s.actor).with("family", family))) }
  action contextChanges(actor: int): bool = all { s.mounted, s.context == 1, ids.contains(actor),
    s' = s.with("context", 2).with("actor", actor).with("visibleActor", actor)
      .with("active", 0).with("busy", 0).with("open", false).with("notice", 0).with("error", "none")
      .with("loadActive", false) }
  action depart = all { s.mounted,
    s' = s.with("mounted", false).with("active", 0).with("busy", 0).with("open", false).with("notice", 0) }
  action explicitSignOut = all { s.mounted,
    s' = s.with("cookie", 0).with("visibleActor", 0).with("loadActive", false)
      .with("active", 0).with("busy", 0).with("open", false).with("notice", 0) }
  action startSession(id: int): bool = {
    val op = s.operations.get(id)
    val nextValue = if (op.phase == "connect-check") "connect-wait"
      else if (op.phase == "prepare-check") "prepare"
      else if (op.phase == "sign-check") "sign"
      else if (op.phase == "write-check") "write" else "success"
    all { Set("connect-check", "prepare-check", "sign-check", "write-check", "success-check").contains(op.phase),
      s' = if (current(id)) s.with("operations", s.operations.set(id, op.with("phase", "session-wait").with("next", nextValue)))
        else stopped(id) }
  }
  action observeSession(id: int, available: bool): bool = {
    val op = s.operations.get(id)
    all { op.phase == "session-wait", s' = s.with("operations", s.operations.set(id,
      op.with("phase", "session-reply").with("observedActor", if (available) s.cookie else -1))) }
  }
  action finishSession(id: int): bool = {
    val op = s.operations.get(id)
    all { op.phase == "session-reply",
      s' = if (not(current(id))) stopped(id)
        else if (op.observedActor == -1) failure(id, "session")
        else if (op.observedActor != op.actor) accessLost(id)
        else if (op.next == "prepare" and not(op.walletValid)) failure(id, "wallet")
        else if (op.next == "write" and not(op.signatureValid)) failure(id, "signature")
        else s.with("operations", s.operations.set(id, op.with("phase", op.next))) }
  }
  action connected(id: int, matches: bool): bool = {
    val op = s.operations.get(id)
    all { op.phase == "connect-wait", s' = if (not(current(id))) stopped(id)
      else s.with("operations", s.operations.set(id, op.with("phase", "prepare-check").with("walletValid", matches))) }
  }
  action request(id: int): bool = {
    val op = s.operations.get(id)
    all { Set("prepare", "write").contains(op.phase),
      s' = if (not(current(id))) stopped(id)
        else s.with("operations", s.operations.set(id,
          op.with("requests", op.requests.union(Set(op.phase))).with("next", op.phase)
            .with("response", "none").with("phase", "http-wait"))) }
  }
  action admit(id: int, available: bool): bool = {
    val op = s.operations.get(id)
    val accepted = available and s.cookie == op.actor
    all { op.phase == "http-wait", op.response == "none",
      s' = s.with("operations", s.operations.set(id, op.with("response",
        if (not(available)) "error" else if (accepted) "ok" else "actor")
        .with("accepted", if (accepted) op.accepted.union(Set(op.next)) else op.accepted))) }
  }
  action httpReply(id: int, valid: bool): bool = {
    val op = s.operations.get(id)
    all { op.phase == "http-wait", op.response != "none",
      s' = if (not(current(id))) stopped(id)
        else if (op.response == "actor") accessLost(id)
        else if (op.response != "ok" or not(valid)) failure(id, "http")
        else s.with("operations", s.operations.set(id, op.with("phase", if (op.next == "prepare") "verify" else "success-check"))) }
  }
  action verify(id: int, valid: bool): bool = {
    val op = s.operations.get(id)
    all { op.phase == "verify", s' = if (not(current(id))) stopped(id)
      else if (not(valid)) failure(id, "prepared")
      else s.with("operations", s.operations.set(id, op.with("phase", "sign-check"))) }
  }
  action prompt(id: int): bool = {
    val op = s.operations.get(id)
    all { op.phase == "sign", s' = if (not(current(id))) stopped(id)
      else s.with("operations", s.operations.set(id, op.with("phase", "sign-wait").with("prompts", op.prompts + 1))) }
  }
  action signed(id: int, valid: bool): bool = {
    val op = s.operations.get(id)
    all { op.phase == "sign-wait", s' = if (not(current(id))) stopped(id)
      else if (op.family == "solana" and not(valid)) failure(id, "signature")
      else s.with("operations", s.operations.set(id, op.with("phase", "write-check").with("signatureValid", valid))) }
  }
  action walletRejected(id: int): bool = {
    val op = s.operations.get(id)
    all { Set("connect-wait", "sign-wait").contains(op.phase), s' = failure(id, "wallet-rejected") }
  }
  action success(id: int): bool = {
    val op = s.operations.get(id)
    all { op.phase == "success", s' = if (not(current(id))) stopped(id)
      else s.with("notice", id).with("open", false).with("active", 0).with("busy", 0)
        .with("operations", s.operations.set(id, op.with("phase", "done"))) }
  }
  action parentLoad = all { s.mounted, not(s.loadActive), s.visibleActor > 0,
    s' = s.with("loadActive", true).with("loadSnapshot", s.visibleActor) }
  action parentReply = all { s.loadSnapshot > 0,
    s' = if (s.loadActive and s.mounted) s.with("visibleActor", s.loadSnapshot).with("loadActive", false) else s }
  // Negative controls for the old unowned continuation and un-aborted load.
  action oldLatePrompt(id: int): bool = all { not(current(id)), s.operations.get(id).phase != "unused", s' = s.with("badPrompt", true) }
  action oldParentRestore = all { s.loadSnapshot > 0, s.visibleActor == 0,
    s' = s.with("visibleActor", s.loadSnapshot).with("badRestore", true) }
  action step = {
    nondet id = ids.oneOf()
    nondet actor = Set(0, 1, 2).oneOf()
    nondet family = Set("evm", "solana").oneOf()
    nondet yes = Set(false, true).oneOf()
    any { cookie(actor), open, close, begin(id, family), contextChanges(actor), depart, explicitSignOut,
      startSession(id), observeSession(id, yes), finishSession(id), connected(id, yes), request(id), admit(id, yes),
      httpReply(id, yes), verify(id, yes), prompt(id), signed(id, yes), walletRejected(id), success(id), parentLoad, parentReply, s' = s }
  }
  val invariant = all { not(s.badPrompt), not(s.badRestore), s.busy == s.active,
    s.active > 0 implies current(s.active),
    s.notice > 0 implies operation(s.notice).context == s.context and operation(s.notice).phase == "done",
    ids.forall(id => s.operations.get(id).prompts <= 1
      and s.operations.get(id).accepted.subseteq(s.operations.get(id).requests)),
    s.visibleActor == 0 implies not(s.loadActive) }
  action checked(id: int): bool = startSession(id).then(observeSession(id, true)).then(finishSession(id))
  action started(id: int, family: str): bool = open.then(begin(id, family)).then(checked(id))
  action prepared(id: int): bool = connected(id, true).then(checked(id)).then(request(id)).then(admit(id, true))
    .then(httpReply(id, true)).then(verify(id, true)).then(checked(id))
  action signAndWrite(id: int): bool = prompt(id).then(signed(id, true)).then(checked(id)).then(request(id))
  action accepted(id: int): bool = admit(id, true).then(httpReply(id, true)).then(checked(id)).then(success(id))

  run evmConsentCompletesWithoutPaymentClaimTest = init.then(started(1, "evm")).then(prepared(1)).then(signAndWrite(1)).then(accepted(1))
    .expect(s.notice == 1 and not(s.open) and invariant)
  run solanaConsentCompletesWithoutPaymentClaimTest = init.then(started(1, "solana")).then(prepared(1)).then(signAndWrite(1)).then(accepted(1))
    .expect(s.notice == 1 and s.operations.get(1).accepted == Set("prepare", "write") and invariant)
  run unmountDuringConnectionStopsRequestTest = init.then(started(1, "evm")).then(depart).then(connected(1, true))
    .expect(s.operations.get(1).requests == Set() and s.busy == 0 and invariant)
  run unmountDuringPrepareStopsPromptTest = init.then(started(1, "solana")).then(connected(1, true)).then(checked(1))
    .then(request(1)).then(admit(1, true)).then(depart).then(httpReply(1, true))
    .expect(s.operations.get(1).prompts == 0 and invariant)
  run unmountDuringSigningStopsWriteTest = init.then(started(1, "solana")).then(prepared(1)).then(prompt(1)).then(depart).then(signed(1, true))
    .expect(s.operations.get(1).requests == Set("prepare") and invariant)
  run acceptedWriteSurvivesUnmountWithoutNoticeTest = init.then(started(1, "evm")).then(prepared(1)).then(signAndWrite(1))
    .then(admit(1, true)).then(depart).then(httpReply(1, true))
    .expect(s.operations.get(1).accepted.contains("write") and s.notice == 0 and invariant)
  run contextChangeStopsOldPromptTest = init.then(started(1, "evm")).then(prepared(1)).then(contextChanges(1)).then(prompt(1))
    .expect(s.operations.get(1).prompts == 0 and invariant)
  run oldReplyDoesNotResetNewOperationTest = init.then(started(1, "evm")).then(contextChanges(1)).then(started(2, "evm"))
    .then(connected(1, false)).expect(s.active == 2 and s.busy == 2 and s.error == "none" and invariant)
  run wrongInitialActorCannotConnectTest = init.then(cookie(2)).then(started(1, "evm"))
    .expect(s.visibleActor == 0 and s.operations.get(1).requests == Set() and invariant)
  run accountChangeDuringConnectStopsPreparationTest = init.then(started(1, "evm")).then(cookie(2)).then(connected(1, true)).then(checked(1))
    .expect(s.visibleActor == 0 and s.operations.get(1).requests == Set() and invariant)
  run accountChangeDuringPreparationStopsSigningTest = init.then(started(1, "solana")).then(connected(1, true)).then(checked(1))
    .then(request(1)).then(admit(1, true)).then(cookie(2)).then(httpReply(1, true)).then(verify(1, true)).then(checked(1))
    .expect(s.visibleActor == 0 and s.operations.get(1).prompts == 0 and invariant)
  run accountChangeDuringSigningStopsAuthorizationTest = init.then(started(1, "evm")).then(prepared(1)).then(prompt(1))
    .then(cookie(2)).then(signed(1, true)).then(checked(1))
    .expect(s.visibleActor == 0 and not(s.operations.get(1).requests.contains("write")) and invariant)
  run expectedActorHeaderRefusesPostCheckSwapTest = init.then(started(1, "evm")).then(prepared(1)).then(prompt(1)).then(signed(1, true))
    .then(checked(1)).then(cookie(2)).then(request(1)).then(admit(1, true)).then(httpReply(1, true))
    .expect(not(s.operations.get(1).accepted.contains("write")) and s.visibleActor == 0 and invariant)
  run admittedOldWriteDoesNotPublishToNewActorTest = init.then(started(1, "evm")).then(prepared(1)).then(signAndWrite(1))
    .then(admit(1, true)).then(cookie(2)).then(httpReply(1, true)).then(checked(1))
    .expect(s.operations.get(1).accepted.contains("write") and s.notice == 0 and s.visibleActor == 0 and invariant)
  run badPreparedBytesStopBeforeWalletTest = init.then(started(1, "solana")).then(connected(1, true)).then(checked(1))
    .then(request(1)).then(admit(1, true)).then(httpReply(1, true)).then(verify(1, false))
    .expect(s.error == "prepared" and s.operations.get(1).prompts == 0 and invariant)
  run changedWalletRefusesPreparationTest = init.then(started(1, "evm")).then(connected(1, false)).then(checked(1))
    .expect(s.error == "wallet" and s.operations.get(1).requests == Set() and invariant)
  run accountLossPrecedesWrongConnectedWalletTest = init.then(started(1, "evm")).then(cookie(2)).then(connected(1, false)).then(checked(1))
    .expect(s.visibleActor == 0 and s.error == "account" and invariant)
  run evmAccountLossPrecedesMalformedSignatureTest = init.then(started(1, "evm")).then(prepared(1)).then(prompt(1))
    .then(cookie(2)).then(signed(1, false)).then(checked(1)).expect(s.visibleActor == 0 and s.error == "account" and invariant)
  run invalidSolanaSignatureKeepsDialogRetryableTest = init.then(started(1, "solana")).then(prepared(1)).then(prompt(1)).then(signed(1, false))
    .expect(s.open and s.active == 0 and s.error == "signature" and invariant)
  run rejectedWalletPromiseKeepsDialogRetryableTest = init.then(started(1, "evm")).then(prepared(1)).then(prompt(1)).then(walletRejected(1))
    .expect(s.open and s.active == 0 and s.error == "wallet-rejected" and not(s.operations.get(1).requests.contains("write")) and invariant)
  run busyControllerRefusesDoubleActivationTest = init.then(started(1, "evm")).expect(s.active == 1 and invariant)
    .then(begin(2, "evm").fail())
  run busyDialogRefusesUserCancelTest = init.then(started(1, "evm")).expect(s.open and invariant).then(close.fail())
  run idleCancelClosesDialogTest = init.then(open).then(close).expect(not(s.open) and invariant)
  run unavailableSessionStopsBeforeWalletTest = init.then(open).then(begin(1, "evm")).then(startSession(1))
    .then(observeSession(1, false)).then(finishSession(1))
    .expect(s.error == "session" and s.operations.get(1).requests == Set() and invariant)
  run explicitSignOutStopsWalletContinuationTest = init.then(started(1, "solana")).then(explicitSignOut).then(connected(1, true))
    .expect(s.visibleActor == 0 and s.operations.get(1).requests == Set() and invariant)
  run abortedParentReadCannotRestoreAfterAccessLossTest = init.then(parentLoad).then(started(1, "evm")).then(cookie(2))
    .then(connected(1, true)).then(checked(1)).then(parentReply)
    .expect(s.visibleActor == 0 and not(s.loadActive) and invariant)
  run staleSessionReplyStopsBeforeConnectionTest = init.then(open).then(begin(1, "evm")).then(startSession(1)).then(observeSession(1, true))
    .then(depart).then(finishSession(1)).expect(s.operations.get(1).phase == "stopped" and invariant)
  run postObservationCookieChangeIsCaughtByHeaderTest = init.then(started(1, "evm")).then(connected(1, true))
    .then(startSession(1)).then(observeSession(1, true)).then(cookie(2)).then(finishSession(1))
    .then(request(1)).then(admit(1, true)).then(httpReply(1, true)).expect(s.visibleActor == 0 and invariant)
  run latePromptOldBehaviorNegativeControlTest = init.then(started(1, "evm")).then(depart).then(oldLatePrompt(1)).expect(not(invariant))
  run parentRestoreOldBehaviorNegativeControlTest = init.then(parentLoad).then(started(1, "evm")).then(cookie(2))
    .then(connected(1, true)).then(checked(1)).then(oldParentRestore).expect(not(invariant))
}
