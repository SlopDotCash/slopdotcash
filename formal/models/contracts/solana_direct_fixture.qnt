// @evidence backend/security/direct-solana.integration.ts
// @evidence backend/security/direct-solana-api.integration.ts
// @source scripts/local-solana-validator.mjs
// Harness ownership only. The native/SPL/Token-2022 assertions and API payment
// state machines remain their real integration scenarios and domain models.
// Mode 1: native/SPL/Token-2022. Mode 2: SOL-full/SOL-split/SPL-split.
module solana_direct_fixture {
  var s:{mode:int,phase:str,logOpen:bool,proxyOpen:bool,owned:bool,
    verified:int,caseOpen:bool,failed:bool,passed:bool}
  action init=s'={mode:1,phase:"new",logOpen:false,proxyOpen:false,owned:false,
    verified:0,caseOpen:false,failed:false,passed:false}
  val required=3
  action useApi=all{s.phase=="new",s'=s.with("mode",2)}
  action openLocalResources=all{s.phase=="new",s'=s.with("phase","resources")
    .with("logOpen",true).with("proxyOpen",s.mode==2)}
  action start=all{s.phase=="resources",s'=s.with("phase","starting")}
  action ready=all{s.phase=="starting",s'=s.with("phase","ready").with("owned",true)}
  action rejectStart=all{s.phase=="starting",s'=s.with("phase","failed")
    .with("failed",true).with("logOpen",false).with("proxyOpen",false)}
  action startCleanupUnknown=all{s.phase=="starting",s'=s.with("phase","unknown")
    .with("owned",true).with("failed",true).with("logOpen",false).with("proxyOpen",false)}
  action beginCase=all{s.phase=="ready",s.verified<required,not(s.caseOpen),s'=s.with("caseOpen",true)}
  action assertionsPass=all{s.phase=="ready",s.caseOpen,s'=s.with("caseOpen",false).with("verified",s.verified+1)}
  action assertionsFail=all{s.phase=="ready",s.caseOpen,s'=s.with("phase","failed").with("failed",true)}
  action reportPass=all{s.phase=="ready",s.verified==required,not(s.caseOpen),s'=s.with("passed",true)}
  action closeLocal=all{Set("ready","failed").contains(s.phase),s.owned,
    s'=s.with("phase","closing").with("proxyOpen",false)}
  action stopConfirmed=all{s.phase=="closing",s'=s.with("phase","closed").with("owned",false).with("logOpen",false)}
  action stopUnknown=all{s.phase=="closing",s'=s.with("phase","unknown").with("failed",true).with("logOpen",false)}
  action step=any{useApi,openLocalResources,start,ready,rejectStart,startCleanupUnknown,
    beginCase,assertionsPass,assertionsFail,reportPass,closeLocal,stopConfirmed,stopUnknown,s'=s}
  val invariant=all{s.verified<=required,s.passed implies(s.verified==required),
    s.phase=="closed" implies(not(s.owned) and not(s.logOpen) and not(s.proxyOpen)),
    s.phase=="unknown" implies(s.owned and s.failed),s.proxyOpen implies(s.mode==2)}
  run directAssetCasesThenOwnedCleanupTest=init.then(openLocalResources).then(start).then(ready)
    .then(beginCase).then(assertionsPass).then(beginCase).then(assertionsPass).then(beginCase).then(assertionsPass)
    .then(reportPass).then(closeLocal).then(stopConfirmed).expect(s.passed and not(s.owned))
  run apiFailureStillClosesValidatorTest=init.then(useApi).then(openLocalResources).then(start).then(ready)
    .then(beginCase).then(assertionsFail).then(closeLocal).then(stopConfirmed).expect(s.failed and not(s.passed) and not(s.proxyOpen))
  run startupFailureClosesProxyAndLogTest=init.then(useApi).then(openLocalResources).then(start).then(rejectStart)
    .expect(not(s.proxyOpen) and not(s.logOpen) and s.failed)
  run unknownEngineStateCannotClaimStoppedTest=init.then(openLocalResources).then(start).then(startCleanupUnknown)
    .expect(s.owned and s.failed and not(s.passed))
}
