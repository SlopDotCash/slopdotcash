// @source workers/notify/handler.ts
// @source workers/notify/index.ts
// @source workers/slopbot/failure-alerts.ts
// @source workers/slopbot/spend-alerts.ts
// Two configured administrators, one already claimed private service request.
// A fulfilled email binding promise is provider acceptance, not delivery.
// A thrown promise is unknown; it is not proof of non-acceptance. No resend.
module notification_admin_fanout {
  var s: { phase: str, recipient: int, calls: Set[int], accepted: Set[int],
    failed: bool, response: int, caller: str }
  action init = s' = { phase: "admission", recipient: 1, calls: Set(),
    accepted: Set(), failed: false, response: 0, caller: "pending" }
  action admit = all { s.phase == "admission", s' = s.with("phase", "ready") }
  action invalid = all { s.phase == "admission", s' = s.with("phase", "responded").with("response", 400) }
  action misconfigured = all { s.phase == "admission", s' = s.with("phase", "responded").with("response", 500) }
  action send = all { s.phase == "ready", s.recipient <= 2,
    s' = s.with("phase", "sending").with("calls", s.calls.union(Set(s.recipient))) }
  action providerReply(accepted: bool): bool = all { s.phase == "sending",
    s' = s.with("phase", "ready").with("recipient", s.recipient + 1)
      .with("accepted", if (accepted) s.accepted.union(Set(s.recipient)) else s.accepted)
      .with("failed", s.failed or not(accepted)) }
  action respond = all { s.phase == "ready", s.recipient == 3,
    s' = s.with("phase", "responded").with("response", if (s.failed) 502 else 202) }
  action callerReply(received: bool): bool = all { s.phase == "responded",
    s' = s.with("phase", "done").with("caller",
      if (received and s.response == 202) "accepted" else "ambiguous") }
  action crash = all { Set("ready", "sending").contains(s.phase),
    s' = s.with("phase", "done").with("caller", "ambiguous") }
  action step = any { admit, invalid, misconfigured, send, providerReply(true),
    providerReply(false), respond, callerReply(true), callerReply(false), crash, s' = s }
  val invariant = all { s.calls.subseteq(Set(1, 2)), s.accepted.subseteq(s.calls),
    s.caller == "accepted" implies s.response == 202 and s.accepted == Set(1, 2),
    s.response == 202 implies not(s.failed) and s.calls == Set(1, 2) }
  run allRecipientsAcceptedTest = init.then(admit).then(send).then(providerReply(true))
    .then(send).then(providerReply(true)).then(respond).then(callerReply(true)).expect(s.caller == "accepted")
  run firstFailureStillAttemptsSecondTest = init.then(admit).then(send).then(providerReply(false))
    .then(send).then(providerReply(true)).then(respond).then(callerReply(true))
    .expect(s.calls == Set(1, 2) and s.accepted == Set(2) and s.response == 502 and s.caller == "ambiguous")
  run secondFailureRetainsKnownAcceptanceTest = init.then(admit).then(send).then(providerReply(true))
    .then(send).then(providerReply(false)).then(respond).expect(s.accepted == Set(1) and s.response == 502)
  run lostReplyDoesNotEraseAcceptanceTest = init.then(admit).then(send).then(providerReply(true))
    .then(send).then(providerReply(true)).then(respond).then(callerReply(false))
    .expect(s.accepted == Set(1, 2) and s.caller == "ambiguous")
  run crashAfterFirstRecipientRetainsUncertaintyTest = init.then(admit).then(send).then(providerReply(true))
    .then(send).then(crash).expect(s.accepted == Set(1) and s.calls == Set(1, 2) and s.caller == "ambiguous")
  run invalidRequestDoesNotSendTest = init.then(invalid).then(callerReply(true)).expect(s.calls.size() == 0 and s.response == 400)
  run invalidConfigurationDoesNotSendTest = init.then(misconfigured).then(callerReply(true)).expect(s.calls.size() == 0 and s.response == 500)
}
