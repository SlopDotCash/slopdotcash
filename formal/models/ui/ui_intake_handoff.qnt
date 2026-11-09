// @source src/SecurityBounty.tsx
// @evidence tests/e2e/security-bounty.spec.ts
// One mounted program, initial read and two optional rechecks. The backend
// readiness schema/time values are predicates; stored intake and optional
// GitHub delivery are independent capabilities, not a promise of acceptance.
// draft means the mounted editor's fields; durable draft storage is separate.
module ui_intake_handoff {
  var s: {phase:str, ready:bool, url:bool, stored:bool, stale:bool,
    rechecking:bool, timer:bool, requests:int, mounted:bool, draft:bool}
  action init=s'={phase:"checking",ready:false,url:false,stored:false,stale:false,
    rechecking:false,timer:false,requests:1,mounted:true,draft:false}
  val localForm=s.mounted and s.phase=="checked" and s.stored
  val githubLink=s.mounted and s.phase=="checked" and s.ready and s.url and not(s.stale)
  val retryVisible=s.phase=="error" or
    (s.phase=="checked" and (s.stale or not(s.ready) or not(s.url)))
  action retry=all{s.mounted,retryVisible,not(s.rechecking),s.requests<3,
    s'=if(s.phase=="checked") s.with("rechecking",true).with("requests",s.requests+1)
      .with("timer",not(s.stale))
      else s.with("phase","checking").with("requests",s.requests+1)}
  action reply(ready:bool,url:bool,stored:bool,stale:bool):bool=all{
    s.mounted,s.phase=="checking" or s.rechecking,
    s'=s.with("phase","checked").with("ready",ready).with("url",url)
      .with("stored",stored).with("stale",stale).with("rechecking",false)
      .with("timer",not(stale))}
  action reject=all{s.mounted,s.phase=="checking" or s.rechecking,
    s'=if(s.phase=="checked") s.with("stale",true).with("rechecking",false).with("timer",false)
      else s.with("phase","error").with("timer",false)}
  action expire=all{s.mounted,s.timer,s.phase=="checked",
    s'=s.with("stale",true).with("timer",false)}
  action editDraft=all{localForm,s'=s.with("draft",true)}
  action unmount=s'=s.with("mounted",false).with("timer",false).with("draft",false)
  action departedReply=all{not(s.mounted),s'=s}
  action step=any{retry,reject,expire,editDraft,unmount,departedReply,
    nondet ready=oneOf(Set(false,true)) nondet url=oneOf(Set(false,true))
    nondet stored=oneOf(Set(false,true)) nondet stale=oneOf(Set(false,true))
    reply(ready,url,stored,stale),s'=s}
  val invariant=all{s.requests>=1,s.requests<=3,
    githubLink implies not(s.stale),s.timer implies s.mounted and s.phase=="checked" and not(s.stale),
    s.rechecking implies s.phase=="checked",
    s.stale and s.stored and s.mounted and s.phase=="checked" implies localForm}
  run initialFailureHasRetryTest=init.then(reject).expect(s.phase=="error" and retryVisible and not(localForm) and not(githubLink))
  run independentStoredIntakeTest=init.then(reply(false,false,true,false)).expect(localForm and not(githubLink))
  run githubWithoutStoredIntakeTest=init.then(reply(true,true,false,false)).expect(githubLink and not(localForm))
  run expiryHidesOnlyGitHubLinkTest=init.then(reply(true,true,true,false)).then(editDraft).then(expire)
    .expect(not(githubLink) and localForm and s.draft)
  run recheckRetainsDraftAndStaleObservationTest=init.then(reply(true,true,true,false)).then(editDraft).then(expire).then(retry)
    .expect(s.rechecking and localForm and s.draft and not(githubLink))
  run failedRecheckRetainsStoredRouteTest=init.then(reply(true,true,true,false)).then(editDraft).then(expire).then(retry).then(reject)
    .expect(s.stale and localForm and s.draft and not(githubLink))
  run successfulRecheckRestoresFreshLinkTest=init.then(reply(true,true,true,true)).then(retry).then(reply(true,true,true,false))
    .expect(githubLink and not(s.rechecking))
  run staleReadyResponseCannotShowLinkTest=init.then(reply(true,true,true,true)).expect(localForm and not(githubLink))
  run unmountClearsTimerAndIgnoresLateReplyTest=init.then(reply(true,true,true,false)).then(unmount).then(departedReply)
    .expect(not(githubLink) and not(localForm) and not(s.timer))
}
