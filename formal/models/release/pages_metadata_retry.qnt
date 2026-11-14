// @source scripts/prepare-vetting-public-key.ts
// @evidence scripts/prepare-vetting-public-key.test.ts
// One read-only Cloudflare metadata invocation. Transport/429/5xx outcomes
// consume at most three requests, each with a fresh timeout; other statuses
// and invalid metadata fail immediately. Waits are finite, not wall-clock
// timing proofs. Identity validation stands for the preflight project/branch
// check or the scanner key check. Retried reads cannot bypass either check.
module pages_metadata_retry {
  var s: {phase:str,attempt:int,outcome:str,valid:bool,identityMatches:bool,assembled:bool}
  action init = s'={phase:"request",attempt:0,outcome:"none",valid:false,identityMatches:false,assembled:false}
  action request = all {s.phase=="request",s.attempt<3,
    s'=s.with("phase","waiting").with("attempt",s.attempt+1)}
  action reply(kind) = all {s.phase=="waiting",Set("transient","permanent","invalid","valid").contains(kind),
    s'=s.with("outcome",kind).with("phase",
      if(kind=="transient" and s.attempt<3) "delay"
      else if(kind=="valid") "metadata" else "failed").with("valid",kind=="valid")}
  action delay = all {s.phase=="delay",s'=s.with("phase","request")}
  action checkIdentity(matches) = all {s.phase=="metadata",
    s'=s.with("identityMatches",matches).with("assembled",matches)
      .with("phase",if(matches) "assembled" else "failed")}
  action advance = {
    nondet kind=Set("transient","permanent","invalid","valid").oneOf()
    nondet matches=Set(false,true).oneOf()
    any {request,reply(kind),delay,checkIdentity(matches)}
  }
  action step = any {advance,s'=s}
  val invariant = all {s.attempt>=0,s.attempt<=3,
    s.phase=="delay" implies (s.outcome=="transient" and s.attempt<3),
    s.assembled implies (s.valid and s.identityMatches and s.phase=="assembled"),
    Set("permanent","invalid").contains(s.outcome) implies s.phase=="failed"}
  temporal terminationProperty = advance.weakFair(s).implies(eventually(
    Set("assembled","failed").contains(s.phase)))
  run transientReadRecoversTest = init.then(request).then(reply("transient")).then(delay)
    .then(request).then(reply("valid")).then(checkIdentity(true)).expect(s.assembled and s.attempt==2)
  run permanentResponseCannotRetryTest = init.then(request).then(reply("permanent"))
    .expect(s.phase=="failed" and s.attempt==1).then(delay.fail())
  run thirdTransientStopsTest = init.then(request).then(reply("transient")).then(delay)
    .then(request).then(reply("transient")).then(delay).then(request).then(reply("transient"))
    .expect(s.phase=="failed" and s.attempt==3 and not(s.assembled))
  run invalidMetadataCannotRetryTest = init.then(request).then(reply("invalid"))
    .expect(s.phase=="failed").then(delay.fail())
  run recoveredReadCannotChangeIdentityTest = init.then(request).then(reply("transient")).then(delay)
    .then(request).then(reply("valid")).then(checkIdentity(false)).expect(s.phase=="failed" and not(s.assembled))
}
