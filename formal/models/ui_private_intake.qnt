// @source src/PrivateReportForm.tsx
// @source src/lib/intake-drafts.ts
// @source src/PrivateReportSummary.tsx
// @source src/SecurityBounty.tsx
// PrivateReportForm/intake-drafts and SecurityBounty SubmissionCard.
// The same attempted payload/key survives uncertain results; changed identity clears drafts.
module ui_private_intake {
  var s: { phase: str, actor: int, owner: int, payload: int, submittedPayload: int, key: int, submittedKey: int, stored: bool, textPresent: bool }
  action init = s' = { phase: "draft", actor: 1, owner: 1, payload: 1,
    submittedPayload: 0, key: 1, submittedKey: 0, stored: true, textPresent: true }
  action edit = all { s.phase == "draft", s' = s.with("payload", 2) }
  action review = all { s.phase == "draft", s.actor == s.owner, s' = s.with("phase", "review") }
  action send = all { Set("review", "uncertain").contains(s.phase), s.actor == s.owner, s.textPresent,
    s' = s.with("phase", "sending").with("submittedPayload", s.payload).with("submittedKey", s.key) }
  action unknownResult = all { s.phase == "sending", s' = s.with("phase", "uncertain") }
  action accepted = all { s.phase == "sending", s' = s.with("phase", "recorded").with("stored", false).with("textPresent", false) }
  action validationRefusal = all { s.phase == "sending", s' = s.with("phase", "draft").with("key", 2) }
  action actorChanged = s' = s.with("actor", 2).with("phase", "signed-out").with("stored", false).with("textPresent", false)
  action step = any { edit, review, send, unknownResult, accepted, validationRefusal, actorChanged, s' = s }
  val invariant = all { Set("sending", "uncertain").contains(s.phase) implies all { s.actor == s.owner, s.submittedPayload == s.payload, s.submittedKey == s.key },
    s.phase == "recorded" implies not(s.stored), s.actor != s.owner implies not(s.textPresent) }
  run uncertainRetryTest = init.then(review).then(send).then(unknownResult).then(send).expect(s.submittedKey == 1 and s.submittedPayload == 1)
  run accountChangeTest = init.then(review).then(send).then(actorChanged).expect(not(s.stored) and not(s.textPresent))
  run acceptedTest = init.then(review).then(send).then(accepted).expect(s.phase == "recorded" and not(s.stored))
}
