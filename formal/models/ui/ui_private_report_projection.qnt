// @source src/PrivateReportSummary.tsx
// @source src/SecurityBounty.tsx
// @evidence tests/e2e/security-bounty.spec.ts
// @evidence tests/e2e/inbox-report-account-change.spec.ts
// @evidence tests/e2e/private-report-composition.spec.ts
// Finite input classes for the pure combined intake/GitHub projection. The
// backend owns which combinations are reachable; the view does not grant an
// award or infer GitHub delivery from a Slop intake/routing result.
module ui_private_report_projection {
  var s:{github:str,intake:str,forward:bool,routingPending:bool,reviewed:bool,
    retry:bool,canReview:bool,canRevise:bool,terminal:bool,advisory:bool,future:bool}
  action init=s'={github:"draft",intake:"none",forward:false,routingPending:false,reviewed:false,
    retry:false,canReview:false,canRevise:false,terminal:false,advisory:false,future:true}
  val githubNotice=if(s.github=="uncertain")
    (if(s.future)"github-wait-after" else "github-check-now") else
    Map("draft"->"github-draft","submitting"->"github-submitting","submitted"->"github-submitted",
      "receipt-verified"->"github-receipt-verified","failed"->"github-failed","abandoned"->"github-abandoned").get(s.github)
  val primary=if(s.intake=="none")githubNotice
    else if(s.forward and s.routingPending)"owner-notification-pending"
    else if(s.forward and s.reviewed)"owner-cleared-no-award"
    else Map("none"->"screening-none","queued"->"screening-queued","running"->"screening-running",
      "legitimate"->"screening-legitimate","needs-information"->"screening-needs-information",
      "spam"->"screening-spam","unavailable"->"screening-unavailable").get(s.intake)
  val secondary=s.intake!="none" and s.github!="draft"
  val githubNeedsAction=Set("submitting","submitted","uncertain").contains(s.github)
    or (s.github=="failed" and not(s.terminal) and not(s.advisory))
  val held=Set("needs-information","spam","unavailable").contains(s.intake)
  val needsAction=githubNeedsAction or (if(s.intake!="none")
    s.retry or (held and (s.canReview or s.canRevise))
    else not(Set("receipt-verified","abandoned").contains(s.github)))
  val retryLabel=if(not(s.retry) or s.intake=="none")"none"
    else if(s.forward)"Retry owner notification" else "Retry screening"
  action github(state:str):bool=s'=s.with("github",state)
  action intake(state:str):bool=s'=s.with("intake",state)
  action chooseGithub={nondet v=Set("draft","submitting","uncertain","submitted","receipt-verified","failed","abandoned").oneOf() github(v)}
  action chooseIntake={nondet v=Set("none","queued","running","legitimate","needs-information","spam","unavailable").oneOf() intake(v)}
  action forward=s'=s.with("forward",not(s.forward))
  action routing=s'=s.with("routingPending",not(s.routingPending))
  action review=s'=s.with("reviewed",not(s.reviewed))
  action retry=s'=s.with("retry",not(s.retry))
  action reviewer=s'=s.with("canReview",not(s.canReview))
  action reporter=s'=s.with("canRevise",not(s.canRevise))
  action terminal=s'=s.with("terminal",not(s.terminal))
  action advisory=s'=s.with("advisory",not(s.advisory))
  action deadline=s'=s.with("future",not(s.future))
  action step=any{chooseGithub,chooseIntake,forward,routing,review,retry,reviewer,reporter,terminal,advisory,deadline,s'=s}
  val invariant=all{
    s.intake=="none" implies primary==githubNotice,
    s.intake!="none" and s.forward and s.routingPending implies primary=="owner-notification-pending",
    s.intake!="none" and s.forward and not(s.routingPending) and s.reviewed implies primary=="owner-cleared-no-award",
    githubNeedsAction implies needsAction,
    s.intake=="none" and Set("receipt-verified","abandoned").contains(s.github) implies not(needsAction),
    secondary implies s.intake!="none" and s.github!="draft"
  }
  run routingPendingPrecedesHumanAndGithubStatusTest=init.then(intake("spam")).then(github("failed"))
    .then(forward).then(review).then(routing).expect(primary=="owner-notification-pending" and secondary and needsAction)
  run humanClearanceIsNotAnAwardTest=init.then(intake("needs-information")).then(forward).then(review)
    .expect(primary=="owner-cleared-no-award" and not(secondary))
  run automaticScreeningKeepsSeparateGithubFailureTest=init.then(intake("legitimate")).then(forward).then(github("failed"))
    .expect(primary=="screening-legitimate" and githubNotice=="github-failed" and secondary and needsAction)
  run uncertainReceiptStillNeedsAttentionAfterScreeningTest=init.then(intake("legitimate")).then(github("uncertain"))
    .expect(needsAction and githubNotice=="github-wait-after").then(deadline).expect(githubNotice=="github-check-now")
  run completedGithubCanStillNeedReporterEvidenceTest=init.then(github("receipt-verified")).then(intake("needs-information"))
    .then(reporter).expect(needsAction and primary=="screening-needs-information")
  run savedOptionalGithubDraftDoesNotDemandDeliveryTest=init.then(intake("legitimate")).then(forward)
    .expect(not(needsAction) and not(secondary))
  run notificationRetryIsDistinctFromScreeningRetryTest=init.then(intake("unavailable")).then(retry)
    .expect(retryLabel=="Retry screening").then(forward).expect(retryLabel=="Retry owner notification")
}
