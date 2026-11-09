// @source workers/notify/security.ts
// @source workers/notify/activity.ts
// @source migrations/0030_security_notification_outbox.sql
// @source migrations/0033_optional_notification_email.sql
// @evidence formal/tests/notification-delivery.test.ts
// One outbox, five attempts, two destination identities/evidence identifiers.
// A held reconciliation read interleaves with another committed receipt.
// retryWithoutProviderCall writes next_attempt_at under the same
// state='sending' AND attempts=? fence as recordDelivery; `dueWriter` is the
// attempt whose transition last set the backoff.
module notification_delivery {
  type Proof = {phase:str,attempt:int,destination:int,id:int,outcome:str}
  var s: {phase:str,attempt:int,destination:int,due:bool,dueWriter:int,used:Set[int],held:Proof,result:bool}
  val noProof={phase:"none",attempt:0,destination:0,id:0,outcome:"none"}
  action init = s'={phase:"queued",attempt:0,destination:1,due:true,dueWriter:0,used:Set(),held:noProof,result:false}
  action claim = all {Set("queued","retrying").contains(s.phase),s.due,s.attempt<5,
    s'=s.with("phase","sending").with("attempt",s.attempt+1).with("due",false)}
  action destination(version:int):bool = all{s.phase=="sending",s'=s.with("destination",version)}
  action provider(outcome:str):bool = all{s.phase=="sending",Set("provider-accepted","ambiguous","suppressed").contains(outcome),s'=s.with("phase",outcome)}
  action noSendRetry = all{s.phase=="sending",s'=s.with("phase",if(s.attempt==5)"exhausted" else "retrying").with("due",false).with("dueWriter",s.attempt)}
  // The backoff write of any (possibly stale) worker: it lands only for the
  // current claim; otherwise the fenced UPDATE changes no row.
  action retryBackoff(attempt:int):bool = s'=if(attempt==s.attempt and s.phase=="sending")
    s.with("due",false).with("dueWriter",attempt) else s
  action staleClaim = all{s.phase=="sending",s'=s.with("phase","ambiguous")}
  action backoffElapsed = all{s.phase=="retrying",s'=s.with("due",true)}
  // The guarded completion write only. Preparation metadata and live workers
  // crossing the last local check are covered by notification_attempt_ownership.
  action oldCompletion(attempt:int):bool = all{attempt!=s.attempt or s.phase!="sending",s'=s}
  action readProof(id:int,outcome:str):bool = all{Set("provider-accepted","ambiguous").contains(s.phase),
    s'=s.with("held",{phase:s.phase,attempt:s.attempt,destination:s.destination,id:id,outcome:outcome})}
  def valid(p:Proof):bool = Set("provider-accepted","ambiguous").contains(s.phase) and
    p.phase==s.phase and p.attempt==s.attempt and p.destination==s.destination and not(s.used.contains(p.id))
  def afterProof(p:Proof):str = if(p.outcome=="not-accepted") {if(s.attempt==5)"exhausted" else "retrying"} else p.outcome
  action commitProof(p:Proof):bool = s'=if(valid(p))s.with("phase",afterProof(p)).with("used",s.used.union(Set(p.id))).with("due",false).with("dueWriter",s.attempt).with("result",true) else s.with("result",false)
  action commitHeld = commitProof(s.held)
  action otherProof(id:int,outcome:str):bool = commitProof({phase:s.phase,attempt:s.attempt,destination:s.destination,id:id,outcome:outcome})
  action step = any {claim,destination(1),destination(2),provider("provider-accepted"),provider("ambiguous"),provider("suppressed"),
    noSendRetry,staleClaim,backoffElapsed,oldCompletion(0),oldCompletion(1),oldCompletion(2),oldCompletion(3),oldCompletion(4),oldCompletion(5),
    nondet a=oneOf(Set(1,2,3,4,5)) retryBackoff(a),
    nondet id=oneOf(Set(1,2)) nondet outcome=oneOf(Set("not-accepted","delivered","bounced","suppressed")) any{readProof(id,outcome),otherProof(id,outcome)},
    commitHeld,s'=s}
  val invariant = all{s.attempt>=0,s.attempt<=5,s.used.subseteq(Set(1,2)),
    Set("delivered","bounced").contains(s.phase) implies s.used.size()>0,
    s.phase=="exhausted" implies s.attempt==5,
    // Only the current attempt's transitions set a retrying row's backoff.
    s.phase=="retrying" implies s.dueWriter==s.attempt,
    s.dueWriter<=s.attempt}
  run ambiguityCanBeDeliveredTest=init.then(claim).then(provider("ambiguous")).then(readProof(1,"delivered")).then(commitHeld).expect(s.phase=="delivered")
  run acceptedCanBeRejectedTest=init.then(claim).then(provider("provider-accepted")).then(readProof(1,"not-accepted")).then(commitHeld).expect(s.phase=="retrying" and not(s.due))
  run competingReceiptsCommitOnceTest=init.then(claim).then(provider("ambiguous")).then(readProof(1,"delivered")).then(otherProof(1,"delivered")).then(commitHeld).expect(not(s.result) and s.used==Set(1))
  run staleAttemptCannotReconcileTest=init.then(claim).then(provider("ambiguous")).then(readProof(1,"delivered")).then(otherProof(2,"not-accepted"))
    .then(backoffElapsed).then(claim).then(destination(2)).then(provider("ambiguous")).then(commitHeld).expect(not(s.result) and s.phase=="ambiguous" and s.attempt==2)
  run lostWorkerCannotOverwriteTest=init.then(claim).then(staleClaim).then(oldCompletion(1)).expect(s.phase=="ambiguous")
  run staleRetryCannotMoveBackoffTest=init.then(claim).then(staleClaim).then(readProof(1,"not-accepted")).then(commitHeld)
    .then(backoffElapsed).then(retryBackoff(1)).expect(s.phase=="retrying" and s.due and s.dueWriter==1)
  run staleRetryAfterNewClaimTest=init.then(claim).then(staleClaim).then(readProof(1,"not-accepted")).then(commitHeld)
    .then(backoffElapsed).then(claim).then(retryBackoff(1)).expect(s.phase=="sending" and s.attempt==2 and s.dueWriter==1)
  run currentRetrySetsBackoffTest=init.then(claim).then(retryBackoff(1)).then(noSendRetry)
    .expect(s.phase=="retrying" and not(s.due) and s.dueWriter==1)
  run fiveAttemptsExhaustTest=init.then(claim).then(noSendRetry).then(backoffElapsed).then(claim).then(noSendRetry).then(backoffElapsed)
    .then(claim).then(noSendRetry).then(backoffElapsed).then(claim).then(noSendRetry).then(backoffElapsed).then(claim).then(noSendRetry)
    .expect(s.phase=="exhausted" and s.attempt==5)
}
