// @source scripts/production-watch.ts
// @source scripts/staging-acceptance-request.mjs
// @source scripts/verify-staging-root.mjs
// @source scripts/verify-staging-backend.mjs
// Health observation is not deployment, login or settlement evidence.
// Transport attempts are three; root retries are six; production reads once.
// One requested resource is modeled, not the complete multi-URL release probe.
// Staging OAuth probes may create a short-lived flow (see api_identity);
// they do not establish completed login or authorize payments.
module deployment_probe {
  var s: {phase:str,mode:str,limit:int,attempt:int,response:str,body:bool,identity:bool,headers:bool,
    passed:bool,paymentsMoved:bool}
  action initialize(mode) = s'={phase:"new",mode:mode,limit:if(mode=="production") 1 else if(mode=="staging-root") 6 else 3,attempt:0,response:"none",body:false,identity:false,
    headers:false,passed:false,paymentsMoved:false}
  action init = {nondet mode=Set("production","staging-transport","staging-root").oneOf() initialize(mode)}
  action request = all {Set("new","retry").contains(s.phase),s.attempt<s.limit,
    s'=s.with("phase","waiting").with("attempt",s.attempt+1)}
  action response(kind,complete,identity,headers) = all {s.phase=="waiting",
    s'=s.with("phase","response").with("response",kind).with("body",complete)
      .with("identity",identity).with("headers",headers)}
  action retry = all {s.phase=="response",s.response=="transient",s.attempt<s.limit,
    s'=s.with("phase","retry")}
  action pass = all {s.phase=="response",s.response=="expected",s.body,s.identity,s.headers,
    s'=s.with("phase","passed").with("passed",true)}
  action stop = all {s.phase=="response",s'=s.with("phase","failed")}
  action step = {nondet k=Set("expected","transient","permanent").oneOf()
    nondet a=Set(false,true).oneOf() nondet b=Set(false,true).oneOf() nondet c=Set(false,true).oneOf()
    any {request,response(k,a,b,c),retry,pass,stop,s'=s}}
  val invariant = all {s.attempt<=s.limit,not(s.paymentsMoved),s.passed implies (
    s.response=="expected" and s.body and s.identity and s.headers)}
  run productionDoesNotRetryTest = initialize("production").then(request).then(response("transient",false,false,false)).then(retry.fail())
  run sixthRootAttemptTest = initialize("staging-root").then(request).then(response("transient",false,false,false)).then(retry)
    .then(request).then(response("transient",false,false,false)).then(retry)
    .then(request).then(response("transient",false,false,false)).then(retry)
    .then(request).then(response("transient",false,false,false)).then(retry)
    .then(request).then(response("transient",false,false,false)).then(retry)
    .then(request).then(response("expected",true,true,true)).then(pass).expect(s.attempt==6 and s.passed)
  run completeExpectedRefusalCanPassTest = init.then(request).then(response("expected",true,true,true)).then(pass)
    .expect(s.passed and not(s.paymentsMoved))
  run wrongIdentityRefusedTest = init.then(request).then(response("expected",true,false,true)).then(pass.fail())
  run bodyFailureCannotPassTest = init.then(request).then(response("expected",false,true,true)).then(pass.fail())
  run boundedTransientRetryTest = initialize("staging-transport").then(request).then(response("transient",false,false,false)).then(retry)
    .then(request).then(response("transient",false,false,false)).then(retry).then(request)
    .then(response("transient",false,false,false)).then(retry.fail())
}
