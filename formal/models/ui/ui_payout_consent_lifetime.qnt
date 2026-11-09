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
//
// Finite step reductions. Each action has a *With(..., reduce) form; direct
// actions and named scenarios pass false and keep the exact state. step
// passes true, which applies settle to every successor:
// - error is write-only (only scenarios read it), so step records "none".
// - An operation stops being current for good: begin needs an unused slot
//   and active == 0, and every context or mount change clears active. A
//   non-current operation only moves itself to stopped, or (admit) adds its
//   own requested step to accepted, which keeps accepted within requests.
//   step therefore stores every non-current operation as one stopped record.
//   A done operation keeps only its phase and context, which the notice
//   conjunct reads; nothing else reads it again.
// - Within a current operation, observedActor is read only at session-reply
//   and only by comparison with -1 and the operation actor (1 or 2), response
//   only at http-wait, next only in the session and http phases, and the
//   wallet/signature validity flags only before the check that reads them.
//   step stores the unread values in one fixed form.
// - loadSnapshot is read only when loadActive (otherwise parentReply leaves
//   the state unchanged), and after the single context change the cookie is
//   compared only with the fixed actor, so step stores 0 for both when unread.
// - Operation IDs are opaque, so step begins the lowest unused slot, and
//   cookie choices other than the actor are offered once after the change.
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
  // Finite-step canonical form; see the header. Direct actions pass false.
  pure def settledOperation(op: Operation, isCurrent: bool): Operation =
    if (op.phase == "unused") op
    else if (op.phase == "done") idle.with("phase", "done").with("context", op.context)
    else if (not(isCurrent)) idle.with("phase", "stopped")
    else {
      val session = Set("session-wait", "session-reply").contains(op.phase)
      op.with("observedActor", if (op.phase != "session-reply") -1
          else if (op.observedActor == -1 or op.observedActor == op.actor) op.observedActor else 0)
        .with("response", if (op.phase == "http-wait") op.response else "none")
        .with("next", if (session or op.phase == "http-wait") op.next else "none")
        .with("walletValid", op.walletValid or not(op.phase == "prepare-check"
          or (session and op.next == "prepare")))
        .with("signatureValid", op.signatureValid or not(op.phase == "write-check"
          or (session and op.next == "write")))
    }
  def settle(reduce: bool, st: State): State = if (not(reduce)) st else {
    val operations = ids.mapBy(id => settledOperation(st.operations.get(id),
      st.mounted and st.active == id and st.operations.get(id).context == st.context))
    st.with("operations", operations).with("error", "none")
      .with("loadSnapshot", if (st.loadActive) st.loadSnapshot else 0)
      .with("cookie", if (st.context == 1 or st.cookie == st.actor) st.cookie else 0)
  }
  def stopped(id: int): State = s.with("operations", s.operations.set(id, s.operations.get(id).with("phase", "stopped")))
  def failure(id: int, kind: str): State = if (not(current(id))) stopped(id)
    else stopped(id).with("active", 0).with("busy", 0).with("error", kind)
  def accessLost(id: int): State = if (not(current(id))) stopped(id)
    else failure(id, "account").with("visibleActor", 0).with("open", false)
      .with("notice", 0).with("loadActive", false)
  action cookieWith(actor: int, reduce: bool): bool = all { Set(0, 1, 2).contains(actor), s' = settle(reduce, s.with("cookie", actor)) }
  action cookie(actor: int): bool = cookieWith(actor, false)
  action openWith(reduce: bool): bool = all { s.mounted, s.visibleActor > 0, s.active == 0, s' = settle(reduce, s.with("open", true)) }
  action open = openWith(false)
  action closeWith(reduce: bool): bool = all { s.open, s.active == 0, s' = settle(reduce, s.with("open", false).with("error", "none")) }
  action close = closeWith(false)
  action beginWith(id: int, family: str, reduce: bool): bool = all {
    s.mounted, s.open, s.active == 0, ids.contains(id), Set("evm", "solana").contains(family),
    s.operations.get(id).phase == "unused", s.visibleActor == s.actor,
    s' = settle(reduce, s.with("active", id).with("busy", id).with("notice", 0).with("error", "none")
      .with("operations", s.operations.set(id, idle.with("phase", "connect-check")
        .with("context", s.context).with("actor", s.actor).with("family", family)))) }
  action begin(id: int, family: str): bool = beginWith(id, family, false)
  action contextChangesWith(actor: int, reduce: bool): bool = all { s.mounted, s.context == 1, ids.contains(actor),
    s' = settle(reduce, s.with("context", 2).with("actor", actor).with("visibleActor", actor)
      .with("active", 0).with("busy", 0).with("open", false).with("notice", 0).with("error", "none")
      .with("loadActive", false)) }
  action contextChanges(actor: int): bool = contextChangesWith(actor, false)
  action departWith(reduce: bool): bool = all { s.mounted,
    s' = settle(reduce, s.with("mounted", false).with("active", 0).with("busy", 0).with("open", false).with("notice", 0)) }
  action depart = departWith(false)
  action explicitSignOutWith(reduce: bool): bool = all { s.mounted,
    s' = settle(reduce, s.with("cookie", 0).with("visibleActor", 0).with("loadActive", false)
      .with("active", 0).with("busy", 0).with("open", false).with("notice", 0)) }
  action explicitSignOut = explicitSignOutWith(false)
  action startSessionWith(id: int, reduce: bool): bool = {
    val op = s.operations.get(id)
    val nextValue = if (op.phase == "connect-check") "connect-wait"
      else if (op.phase == "prepare-check") "prepare"
      else if (op.phase == "sign-check") "sign"
      else if (op.phase == "write-check") "write" else "success"
    all { Set("connect-check", "prepare-check", "sign-check", "write-check", "success-check").contains(op.phase),
      s' = settle(reduce, if (current(id)) s.with("operations", s.operations.set(id, op.with("phase", "session-wait").with("next", nextValue)))
        else stopped(id)) }
  }
  action startSession(id: int): bool = startSessionWith(id, false)
  action observeSessionWith(id: int, available: bool, reduce: bool): bool = {
    val op = s.operations.get(id)
    all { op.phase == "session-wait", s' = settle(reduce, s.with("operations", s.operations.set(id,
      op.with("phase", "session-reply").with("observedActor", if (available) s.cookie else -1)))) }
  }
  action observeSession(id: int, available: bool): bool = observeSessionWith(id, available, false)
  action finishSessionWith(id: int, reduce: bool): bool = {
    val op = s.operations.get(id)
    all { op.phase == "session-reply",
      s' = settle(reduce, if (not(current(id))) stopped(id)
        else if (op.observedActor == -1) failure(id, "session")
        else if (op.observedActor != op.actor) accessLost(id)
        else if (op.next == "prepare" and not(op.walletValid)) failure(id, "wallet")
        else if (op.next == "write" and not(op.signatureValid)) failure(id, "signature")
        else s.with("operations", s.operations.set(id, op.with("phase", op.next)))) }
  }
  action finishSession(id: int): bool = finishSessionWith(id, false)
  action connectedWith(id: int, matches: bool, reduce: bool): bool = {
    val op = s.operations.get(id)
    all { op.phase == "connect-wait", s' = settle(reduce, if (not(current(id))) stopped(id)
      else s.with("operations", s.operations.set(id, op.with("phase", "prepare-check").with("walletValid", matches)))) }
  }
  action connected(id: int, matches: bool): bool = connectedWith(id, matches, false)
  action requestWith(id: int, reduce: bool): bool = {
    val op = s.operations.get(id)
    all { Set("prepare", "write").contains(op.phase),
      s' = settle(reduce, if (not(current(id))) stopped(id)
        else s.with("operations", s.operations.set(id,
          op.with("requests", op.requests.union(Set(op.phase))).with("next", op.phase)
            .with("response", "none").with("phase", "http-wait")))) }
  }
  action request(id: int): bool = requestWith(id, false)
  action admitWith(id: int, available: bool, reduce: bool): bool = {
    val op = s.operations.get(id)
    val accepted = available and s.cookie == op.actor
    all { op.phase == "http-wait", op.response == "none",
      s' = settle(reduce, s.with("operations", s.operations.set(id, op.with("response",
        if (not(available)) "error" else if (accepted) "ok" else "actor")
        .with("accepted", if (accepted) op.accepted.union(Set(op.next)) else op.accepted)))) }
  }
  action admit(id: int, available: bool): bool = admitWith(id, available, false)
  action httpReplyWith(id: int, valid: bool, reduce: bool): bool = {
    val op = s.operations.get(id)
    all { op.phase == "http-wait", op.response != "none",
      s' = settle(reduce, if (not(current(id))) stopped(id)
        else if (op.response == "actor") accessLost(id)
        else if (op.response != "ok" or not(valid)) failure(id, "http")
        else s.with("operations", s.operations.set(id, op.with("phase", if (op.next == "prepare") "verify" else "success-check")))) }
  }
  action httpReply(id: int, valid: bool): bool = httpReplyWith(id, valid, false)
  action verifyWith(id: int, valid: bool, reduce: bool): bool = {
    val op = s.operations.get(id)
    all { op.phase == "verify", s' = settle(reduce, if (not(current(id))) stopped(id)
      else if (not(valid)) failure(id, "prepared")
      else s.with("operations", s.operations.set(id, op.with("phase", "sign-check")))) }
  }
  action verify(id: int, valid: bool): bool = verifyWith(id, valid, false)
  action promptWith(id: int, reduce: bool): bool = {
    val op = s.operations.get(id)
    all { op.phase == "sign", s' = settle(reduce, if (not(current(id))) stopped(id)
      else s.with("operations", s.operations.set(id, op.with("phase", "sign-wait").with("prompts", op.prompts + 1)))) }
  }
  action prompt(id: int): bool = promptWith(id, false)
  action signedWith(id: int, valid: bool, reduce: bool): bool = {
    val op = s.operations.get(id)
    all { op.phase == "sign-wait", s' = settle(reduce, if (not(current(id))) stopped(id)
      else if (op.family == "solana" and not(valid)) failure(id, "signature")
      else s.with("operations", s.operations.set(id, op.with("phase", "write-check").with("signatureValid", valid)))) }
  }
  action signed(id: int, valid: bool): bool = signedWith(id, valid, false)
  action walletRejectedWith(id: int, reduce: bool): bool = {
    val op = s.operations.get(id)
    all { Set("connect-wait", "sign-wait").contains(op.phase), s' = settle(reduce, failure(id, "wallet-rejected")) }
  }
  action walletRejected(id: int): bool = walletRejectedWith(id, false)
  action successWith(id: int, reduce: bool): bool = {
    val op = s.operations.get(id)
    all { op.phase == "success", s' = settle(reduce, if (not(current(id))) stopped(id)
      else s.with("notice", id).with("open", false).with("active", 0).with("busy", 0)
        .with("operations", s.operations.set(id, op.with("phase", "done")))) }
  }
  action success(id: int): bool = successWith(id, false)
  action parentLoadWith(reduce: bool): bool = all { s.mounted, not(s.loadActive), s.visibleActor > 0,
    s' = settle(reduce, s.with("loadActive", true).with("loadSnapshot", s.visibleActor)) }
  action parentLoad = parentLoadWith(false)
  action parentReplyWith(reduce: bool): bool = all { s.loadSnapshot > 0,
    s' = settle(reduce, if (s.loadActive and s.mounted) s.with("visibleActor", s.loadSnapshot).with("loadActive", false) else s) }
  action parentReply = parentReplyWith(false)
  // Negative controls for the old unowned continuation and un-aborted load.
  action oldLatePrompt(id: int): bool = all { not(current(id)), s.operations.get(id).phase != "unused", s' = s.with("badPrompt", true) }
  action oldParentRestore = all { s.loadSnapshot > 0, s.visibleActor == 0,
    s' = s.with("visibleActor", s.loadSnapshot).with("badRestore", true) }
  action step = any {
    // After the context change, cookie values other than the actor are equivalent.
    { nondet actor = Set(0, 1, 2).oneOf()
      all { s.context == 1 or actor == 0 or actor == s.actor, cookieWith(actor, true) } },
    openWith(true), closeWith(true),
    // Operation IDs are opaque, so step begins the lowest unused one.
    { nondet id = ids.oneOf() nondet family = Set("evm", "solana").oneOf()
      all { id == 1 or s.operations.get(1).phase != "unused", beginWith(id, family, true) } },
    { nondet actor = Set(0, 1, 2).oneOf() contextChangesWith(actor, true) },
    departWith(true), explicitSignOutWith(true),
    { nondet id = ids.oneOf() startSessionWith(id, true) },
    { nondet id = ids.oneOf() nondet yes = Set(false, true).oneOf() observeSessionWith(id, yes, true) },
    { nondet id = ids.oneOf() finishSessionWith(id, true) },
    { nondet id = ids.oneOf() nondet yes = Set(false, true).oneOf() connectedWith(id, yes, true) },
    { nondet id = ids.oneOf() requestWith(id, true) },
    { nondet id = ids.oneOf() nondet yes = Set(false, true).oneOf() admitWith(id, yes, true) },
    { nondet id = ids.oneOf() nondet yes = Set(false, true).oneOf() httpReplyWith(id, yes, true) },
    { nondet id = ids.oneOf() nondet yes = Set(false, true).oneOf() verifyWith(id, yes, true) },
    { nondet id = ids.oneOf() promptWith(id, true) },
    { nondet id = ids.oneOf() nondet yes = Set(false, true).oneOf() signedWith(id, yes, true) },
    { nondet id = ids.oneOf() walletRejectedWith(id, true) },
    { nondet id = ids.oneOf() successWith(id, true) },
    parentLoadWith(true), parentReplyWith(true), s' = s
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
