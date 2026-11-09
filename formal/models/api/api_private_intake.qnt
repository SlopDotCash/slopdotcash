// @source migrations/0059_private_security_submissions.sql
// @source migrations/0101_durable_security_intake.sql
// @source backend/security/report-intake.ts
// @source backend/security/verified-intake.ts
// @source backend/security/submissions.ts
// @source backend/security/intake-grant.ts
// @source backend/security/github-advisories.ts
// @source backend/security/reporting-readiness.ts
// @source backend/security/case-store.ts
// @source backend/security/submission-store.ts
// @evidence backend/security/report-intake.test.ts
// @evidence backend/security/submissions.test.ts
// Private intake: durable screening, maintainer routing review and the
// reporter-authorized GitHub forward (PRD section 8, SEC-07, SEC-17).
// Screening: queued -> running (claim CAS on the intake revision) -> one of
// legitimate, needs-information, spam, unavailable (finish CAS on the claimed
// revision while still running). queued, unavailable and a running claim past
// its age are recoverable; another worker may then claim again. A late finish
// from a replaced claim writes nothing. `qualified` mirrors qualifiedIntake:
// an explicit forward, or no review and a legitimate screen.
// Forwarding: every GitHub call (send, reconcile listing, receipt check) needs
// the reporter's grant read for this submission, session and account
// (readGrant); a grant for another account or an expired grant reads as none.
// The send is recorded before GitHub is called under an EXISTS guard on the
// qualified intake revision. Bounds: two screening workers, two send attempts,
// two report versions; new writes need intake revision < 7, so a finishing
// claim can reach 8. A replaced claim's late finish is checked through
// `resultFrom`. The ghosts `ungrantedCall`, `sentUnqualified` and `routedUnqualified` record an
// unguarded write; the invariant requires each to stay false.
module api_private_intake {
  var s: { phase: str, screening: str, stale: bool, review: str, routed: bool,
    rev: int, claim: int -> int, lastClaim: int, resultFrom: int,
    reportVersion: int, grant: str, attempts: int,
    ungrantedCall: bool, sentUnqualified: bool, routedUnqualified: bool }

  val held = Set("needs-information", "spam", "unavailable")
  val results = Set("legitimate", "needs-information", "spam", "unavailable")
  val qualified = s.review == "forward" or (s.review == "none" and s.screening == "legitimate")
  val recoverable = s.review == "none" and
    (Set("queued", "unavailable").contains(s.screening) or (s.screening == "running" and s.stale))
  // readGrant returns a grant only for this reporter's live, unexpired grant.
  val granted = s.grant == "reporter"
  val canRevise = Set("draft", "failed").contains(s.phase) and
    (s.review == "request-information" or (s.review == "none" and held.contains(s.screening)))

  action init = s' = { phase: "draft", screening: "queued", stale: false, review: "none",
    routed: false, rev: 1, claim: Set(1, 2).mapBy(_ => 0), lastClaim: 0, resultFrom: 0,
    reportVersion: 1, grant: "none", attempts: 0,
    ungrantedCall: false, sentUnqualified: false, routedUnqualified: false }

  // screenStoredReport: claim with revision CAS.
  action claimScreen(w: int): bool = all { recoverable, s.rev < 7, s.claim.get(w) == 0,
    s' = s.with("screening", "running").with("stale", false).with("rev", s.rev + 1)
      .with("claim", s.claim.set(w, s.rev + 1)).with("lastClaim", w) }
  action ageOut = all { s.screening == "running", not(s.stale), s' = s.with("stale", true) }
  // The finish UPDATE matches only the claimed revision while still running.
  action finishScreen(w: int, result: str): bool = all { s.claim.get(w) > 0,
    val applies = s.rev == s.claim.get(w) and s.screening == "running"
    s' = (if (applies) s.with("screening", result).with("rev", s.rev + 1).with("resultFrom", w)
          else s).with("claim", s.claim.set(w, 0)) }
  // A maintainer routing review; it takes precedence over screening.
  action reviewRouting(decision: str): bool = all { s.rev < 7,
    s' = s.with("review", decision).with("rev", s.rev + 1) }
  // routedNotice: notifications are inserted only under the qualified EXISTS guard.
  action route = all { qualified, not(s.routed), s.rev < 7,
    s' = s.with("routed", true).with("rev", s.rev + 1).with("routedUnqualified", s.routedUnqualified or not(qualified)) }
  // The reporter revises a held or information-requested report.
  action revise = all { canRevise, s.reportVersion < 2, s.rev < 7,
    s' = s.with("reportVersion", s.reportVersion + 1).with("screening", "queued").with("stale", false)
      .with("review", "none").with("routed", false).with("rev", s.rev + 1) }
  // Grant lifecycle: authorization for the signed-in reporter, a callback
  // naming another account, or expiry.
  action authorize(account: str): bool = all { s' = s.with("grant", account) }
  action expire = all { s.grant == "reporter", s' = s.with("grant", "expired") }
  // sendSubmission: requireGrant, then the guarded "submitting" transition,
  // then createReport with that grant. GitHub's answer arrives separately.
  action send = all { s.phase == "draft", granted, qualified, s.attempts < 2,
    s' = s.with("phase", "submitting").with("attempts", s.attempts + 1)
      .with("ungrantedCall", s.ungrantedCall or not(granted))
      .with("sentUnqualified", s.sentUnqualified or not(qualified)) }
  action githubAnswer(outcome: str): bool = all { s.phase == "submitting",
    s' = s.with("phase",
      if (outcome == "created") "submitted" else if (outcome == "rejected") "failed"
      else if (outcome == "rate-limited") "draft" else "uncertain") }
  // An empty listing is an observation, not proof no copy can appear later;
  // api_submission_recovery retains late copies and claim/readback races.
  // reconcileSubmission lists by marker with the grant; an empty settled
  // listing reopens the draft, a match adopts the earliest advisory.
  action reconcile(found: bool): bool = all { s.phase == "uncertain", granted,
    s' = s.with("phase", if (found) "submitted" else "draft")
      .with("ungrantedCall", s.ungrantedCall or not(granted)) }
  action verifyReceipt = all { s.phase == "submitted", granted,
    s' = s.with("phase", "receipt-verified").with("ungrantedCall", s.ungrantedCall or not(granted)) }

  action step = any {
    nondet w = Set(1, 2).oneOf()
    nondet result = results.oneOf()
    any { claimScreen(w), finishScreen(w, result) },
    ageOut,
    nondet decision = Set("forward", "request-information").oneOf()
    reviewRouting(decision),
    route, revise,
    nondet account = Set("reporter", "other").oneOf()
    authorize(account),
    expire, send,
    nondet outcome = Set("created", "rejected", "rate-limited", "uncertain").oneOf()
    githubAnswer(outcome),
    nondet found = Set(true, false).oneOf()
    reconcile(found),
    verifyReceipt,
    s' = s,
  }

  val invariant = all {
    not(s.ungrantedCall), not(s.sentUnqualified), not(s.routedUnqualified),
    // A settled screening result belongs to the latest claim.
    results.contains(s.screening) and s.resultFrom > 0 implies s.resultFrom == s.lastClaim,
    s.screening == "running" implies s.lastClaim > 0,
    s.phase != "draft" and s.phase != "failed" implies s.attempts > 0,
    s.attempts <= 2, s.reportVersion <= 2, s.rev <= 8,
  }

  run legitimateRoutesAndForwardsTest = init.then(claimScreen(1)).then(finishScreen(1, "legitimate"))
    .then(route).then(authorize("reporter")).then(send).then(githubAnswer("created")).then(verifyReceipt)
    .expect(s.phase == "receipt-verified" and s.routed and invariant)
  run staleScreenCannotOverwriteRetryTest = init.then(claimScreen(1)).then(ageOut).then(claimScreen(2))
    .then(finishScreen(2, "legitimate")).then(finishScreen(1, "spam"))
    .expect(s.screening == "legitimate" and s.resultFrom == 2 and invariant)
  run freshRunningScreenNotReclaimedTest = init.then(claimScreen(1)).then(claimScreen(2).fail())
  run unavailableScreenRetriesTest = init.then(claimScreen(1)).then(finishScreen(1, "unavailable"))
    .then(claimScreen(2)).then(finishScreen(2, "needs-information"))
    .expect(s.screening == "needs-information" and not(qualified) and invariant)
  run heldReportRevisedAndRequeuedTest = init.then(claimScreen(1)).then(finishScreen(1, "spam"))
    .then(revise).expect(s.screening == "queued" and s.reportVersion == 2 and invariant)
  run heldReportCannotSendTest = init.then(claimScreen(1)).then(finishScreen(1, "spam"))
    .then(authorize("reporter")).then(send.fail())
  run forwardOverridesSpamTest = init.then(claimScreen(1)).then(finishScreen(1, "spam"))
    .then(reviewRouting("forward")).then(route).then(authorize("reporter")).then(send)
    .expect(s.phase == "submitting" and invariant)
  run forwardedReportNotRescreenedTest = init.then(claimScreen(1)).then(finishScreen(1, "unavailable"))
    .then(reviewRouting("forward")).then(claimScreen(2).fail())
  run requestInformationBlocksSendTest = init.then(claimScreen(1)).then(finishScreen(1, "legitimate"))
    .then(reviewRouting("request-information")).then(authorize("reporter")).then(send.fail())
  run sendWithoutGrantRefusedTest = init.then(claimScreen(1)).then(finishScreen(1, "legitimate")).then(send.fail())
  run otherAccountGrantRefusedTest = init.then(claimScreen(1)).then(finishScreen(1, "legitimate"))
    .then(authorize("other")).then(send.fail())
  run expiredGrantRefusesReconcileTest = init.then(claimScreen(1)).then(finishScreen(1, "legitimate"))
    .then(authorize("reporter")).then(send).then(githubAnswer("uncertain")).then(expire)
    .then(reconcile(true).fail())
  run renewedGrantReconcilesTest = init.then(claimScreen(1)).then(finishScreen(1, "legitimate"))
    .then(authorize("reporter")).then(send).then(githubAnswer("uncertain")).then(expire)
    .then(authorize("reporter")).then(reconcile(true)).then(verifyReceipt)
    .expect(s.phase == "receipt-verified" and invariant)
  run rateLimitedReopensDraftTest = init.then(claimScreen(1)).then(finishScreen(1, "legitimate"))
    .then(authorize("reporter")).then(send).then(githubAnswer("rate-limited")).then(send)
    .expect(s.attempts == 2 and s.phase == "submitting" and invariant)
  run emptyReconcileReopensDraftTest = init.then(claimScreen(1)).then(finishScreen(1, "legitimate"))
    .then(authorize("reporter")).then(send).then(githubAnswer("uncertain")).then(reconcile(false))
    .expect(s.phase == "draft" and s.attempts == 1 and invariant)
}
