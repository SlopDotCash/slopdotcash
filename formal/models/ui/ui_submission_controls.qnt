// @source src/SecurityBounty.tsx
// @source src/lib/use-action.ts
// @source src/lib/intake-drafts.ts
// @evidence tests/e2e/security-bounty.spec.ts
// @evidence tests/e2e/private-report-send.spec.ts
// @evidence tests/e2e/private-report-composition.spec.ts
// One rendered submission, two requests, one redirect. Backend phase/revision
// transitions and actor checks are external; this model does not turn a grant
// redirect into a report receipt. Disabled UI controls serialize clicks here;
// useAction itself is not a lock against arbitrary programmatic invocation.
module ui_submission_controls {
  var s:{source:str,github:str,terminal:bool,advisory:bool,forward:bool,
    canReview:bool,authorizePolicy:int,retry:bool,localDraft:bool,stored:bool,
    busy:str,needsGrant:bool,error:str,operation:str,revision:int,requestRevision:int,
    intakeRevision:int,attempts:int,redirects:int}
  action init=s'={source:"legacy",github:"draft",terminal:false,advisory:false,forward:false,
    canReview:false,authorizePolicy:-1,retry:false,localDraft:true,stored:true,
    busy:"idle",needsGrant:false,error:"",operation:"",revision:1,requestRevision:0,
    intakeRevision:2,attempts:0,redirects:0}
  val retryable=s.github=="draft" or (s.github=="failed" and not(s.terminal) and not(s.advisory))
  val keepDraft=s.source=="legacy" and not(s.advisory) and
    (Set("draft","submitting","uncertain").contains(s.github) or (s.github=="failed" and not(s.terminal)))
  val canSend=s.source=="legacy" and retryable
  val canSavedSend=s.source=="saved" and s.forward and retryable and
    (s.authorizePolicy==1 or (s.authorizePolicy==-1 and not(s.canReview)))
  val canVerify=s.source=="direct" and s.github=="draft"
  val canReconcile=Set("uncertain","submitted").contains(s.github)
  val canScreen=s.source=="saved" and s.retry
  val authorizeVisible=s.needsGrant or canSavedSend
  val controlsReady=s.busy=="idle"
  action savedReport=all{controlsReady,s'=s.with("source","saved").with("forward",true).with("retry",true)
    .with("authorizePolicy",1).with("localDraft",false)}
  action directReport=all{controlsReady,s'=s.with("source","direct").with("localDraft",false)}
  action observe(state:str):bool=all{controlsReady,
    s'=s.with("github",state).with("localDraft",if(Set("submitted","receipt-verified","abandoned").contains(state))false else s.localDraft)}
  action terminalFailure=all{controlsReady,s'=s.with("github","failed").with("terminal",true).with("localDraft",false)}
  action advisory=all{controlsReady,s'=s.with("advisory",true).with("localDraft",false)}
  action roleFallback(owner:bool,policy:int):bool=all{controlsReady,s'=s.with("canReview",owner).with("authorizePolicy",policy)}
  action loseStorage=all{controlsReady,s'=s.with("stored",false)}
  action restoreStorage=all{controlsReady,s'=s.with("stored",true)}
  action request(kind:str):bool=all{controlsReady,s.attempts<2,
    (kind=="send" and (canSend or canSavedSend)) or (kind=="verify" and canVerify)
      or (kind=="reconcile" and canReconcile) or (kind=="screen" and canScreen),
    s'=s.with("busy","request").with("operation",kind).with("error","")
      .with("requestRevision",if(kind=="screen")s.intakeRevision else s.revision).with("attempts",s.attempts+1)}
  action grantRequired=all{s.busy=="request",s.operation!="authorize",
    s'=s.with("busy","idle").with("needsGrant",true)}
  action requestFails=all{s.busy=="request",s'=s.with("busy","idle").with("error","request")}
  action success(state:str):bool=all{s.busy=="request",s.operation!="authorize",s.revision<3,
    s'=s.with("busy","idle").with("github",state).with("revision",s.revision+1)
      .with("needsGrant",false).with("error","")
      .with("localDraft",if(s.source=="legacy" and Set("draft","submitting","uncertain").contains(state))s.localDraft else false)}
  action rateLimited=all{s.busy=="request",s.operation=="send",s.revision<3,
    s'=s.with("busy","idle").with("github","draft").with("revision",s.revision+1)
      .with("needsGrant",false).with("error","rate")}
  action refuseUnsavedRedirect=all{controlsReady,authorizeVisible,keepDraft,not(s.stored),
    s'=s.with("error","storage")}
  action authorize=all{controlsReady,authorizeVisible,(not(keepDraft) or s.stored),s.redirects<1,
    s'=s.with("busy","request").with("operation","authorize").with("error","")}
  action redirect=all{s.busy=="request",s.operation=="authorize",s.redirects<1,
    s'=s.with("busy","navigating").with("redirects",s.redirects+1)}
  // New document construction, not a timer or promise-finally reset.
  action navigationReturns=all{s.busy=="navigating",
    s'=s.with("busy","idle").with("needsGrant",false).with("error","")}
  action step=any{savedReport,directReport,observe("uncertain"),observe("submitted"),observe("failed"),
    observe("receipt-verified"),terminalFailure,advisory,roleFallback(true,-1),roleFallback(false,-1),roleFallback(true,1),roleFallback(false,0),
    loseStorage,restoreStorage,request("send"),request("verify"),request("reconcile"),request("screen"),grantRequired,requestFails,
    success("draft"),success("uncertain"),success("submitted"),success("receipt-verified"),rateLimited,
    refuseUnsavedRedirect,authorize,redirect,navigationReturns,s'=s}
  val invariant=all{s.attempts<=2,s.redirects<=1,s.revision<=3,
    s.busy=="navigating" implies not(controlsReady),
    s.busy=="request" and s.operation=="authorize" implies(not(keepDraft) or s.stored),
    canSend implies s.source=="legacy",canSavedSend implies(s.source=="saved" and s.forward and retryable),
    s.source!="legacy" implies not(s.localDraft)}
  run grantRequiredKeepsDraftAndRequestsAuthorizationTest=init.then(request("send")).then(grantRequired)
    .expect(s.needsGrant and s.localDraft and controlsReady and s.github=="draft")
  run unsavedLegacyDraftCannotLeaveForGithubTest=init.then(request("send")).then(grantRequired).then(loseStorage)
    .then(refuseUnsavedRedirect).expect(s.error=="storage" and s.redirects==0 and controlsReady)
    .then(restoreStorage).then(authorize).then(redirect).expect(not(controlsReady) and s.localDraft)
  run redirectStaysBusyUntilNewDocumentTest=init.then(savedReport).then(authorize).then(redirect)
    .then(request("send").fail())
  run returnedGrantCanSendWithoutChangingReportTest=init.then(savedReport).then(authorize).then(redirect).then(navigationReturns)
    .then(request("send")).then(success("submitted")).expect(s.github=="submitted" and not(s.needsGrant))
  run uncertainUsesReconcileNotResendTest=init.then(observe("uncertain")).then(request("send").fail())
  run reconcileRefusalDoesNotInventAbsenceTest=init.then(observe("uncertain")).then(request("reconcile")).then(requestFails)
    .expect(s.github=="uncertain" and not(canSend) and controlsReady)
  run intakeRetryUsesIntakeRevisionTest=init.then(savedReport).then(request("screen")).expect(s.requestRevision==s.intakeRevision)
  run explicitAuthorizeFalseOverridesRoleFallbackTest=init.then(savedReport).then(roleFallback(false,0)).expect(not(canSavedSend))
  run absentAuthorizeUsesHistoricalRoleFallbackTest=init.then(savedReport).then(roleFallback(true,-1)).expect(not(canSavedSend))
    .then(roleFallback(false,-1)).expect(canSavedSend)
  run terminalFailureHasNoResendTest=init.then(terminalFailure).then(request("send").fail())
  run directDraftUsesVerificationOnlyTest=init.then(directReport).expect(canVerify and not(canSend)).then(request("verify"))
    .then(success("receipt-verified")).expect(not(s.localDraft))
}
