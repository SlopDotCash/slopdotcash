// @source scripts/pr-evidence-artifacts.mjs
// @source scripts/pr-evidence-policy.mjs
// Transport/control contract only, not media-parser proof. Only approved HTTPS
// origins are fetched; GitHub API credentials never follow a CDN redirect.
// A transient retry restarts at the original authority. Two attempts/four redirects.
module artifact_transport {
  type S={origin:str,phase:str,attempts:int,redirects:int,calls:List[str],accepted:bool,digest:bool}
  var s:S
  action init=s'={origin:"github",phase:"ready",attempts:0,redirects:0,calls:List(),accepted:false,digest:false}
  action request=all{s.phase=="ready",s'=s.with("phase","waiting").with("attempts",if(s.origin=="github") s.attempts+1 else s.attempts)
    .with("calls",s.calls.append(if(s.origin=="github") "github-token" else "cdn-no-token"))}
  action redirect(trusted:bool):bool=all{s.phase=="waiting",s'=if(trusted and s.redirects<4) s.with("origin","cdn").with("phase","ready").with("redirects",s.redirects+1) else s.with("phase","failed")}
  action transient=all{s.phase=="waiting",s'=s.with("phase",if(s.attempts<2) "retry" else "failed")}
  action retry=all{s.phase=="retry",s'=s.with("origin","github").with("redirects",0).with("phase","ready")}
  action terminal=all{s.phase=="waiting",s'=s.with("phase","failed")}
  action accept(valid:bool,complete:bool,document:bool):bool=all{s.phase=="waiting",valid,not(document) or complete,
    s'=s.with("phase","done").with("accepted",true).with("digest",complete)}
  action step=any{request,redirect(true),redirect(false),transient,retry,terminal,accept(true,true,true),accept(true,false,false),s'=s}
  val invariant=all{s.attempts<=2,s.redirects<=4,s.calls.indices().forall(i=>s.calls.nth(i)!="cdn-token"),s.digest implies s.accepted,s.accepted implies s.phase=="done"}
  run transientRetryStartsAtAuthorityTest=init.then(request).then(redirect(true)).then(request).then(transient).then(retry)
    .then(request).then(redirect(true)).then(request).then(accept(true,true,true))
    .expect(s.calls==List("github-token","cdn-no-token","github-token","cdn-no-token") and invariant)
  run terminalFailureNotRetriedTest=init.then(request).then(terminal).then(retry.fail())
  run untrustedRedirectRefusedTest=init.then(request).then(redirect(false)).then(request.fail())
  run partialMediaHasNoFullDigestTest=init.then(request).then(accept(true,false,false)).expect(s.accepted and not(s.digest) and invariant)
  run incompleteDocumentRefusedTest=init.then(request).then(accept(true,false,true).fail())
}
