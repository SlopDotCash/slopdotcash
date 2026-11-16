// @source workers/referral-accrual/core.ts
// @source workers/referral-accrual/store.ts
// @source workers/referral-accrual/poster.ts
// @source migrations/0087_referral_root_posts.sql
// @evidence workers/referral-accrual/poster.test.ts
// Posting a filed referral root is distinct from calculating accruals and
// claiming a root. Two periods, two signatures, two contract epochs. Exact
// gas arithmetic, log/receipt cryptography and the disabled live activation
// gate are separate contracts; `identity` and `gas` abstract their checks.
module referral_posting {
  var s: {phase:str,row:str,period:int,rowEpoch:int,nextEpoch:int,
    accepted:Set[int],signatures:int,raw:int,journaled:Set[int],broadcasts:Set[int],
    identity:bool,gas:bool,paused:bool,pendingRoot:bool,acknowledged:bool,result:str}
  action init = s'={phase:"idle",row:"none",period:1,rowEpoch:0,nextEpoch:0,
    accepted:Set(),signatures:0,raw:0,journaled:Set(),broadcasts:Set(),
    identity:true,gas:true,paused:false,pendingRoot:false,acknowledged:false,result:"none"}
  action policy(identity,gas,paused,pendingRoot) = all {s.phase=="idle",
    s'=s.with("identity",identity).with("gas",gas).with("paused",paused).with("pendingRoot",pendingRoot)}
  val open = Set("submitted","unknown").contains(s.row)
  action prepare = all {s.phase=="idle",not(open),s.identity,s.gas,not(s.paused),not(s.pendingRoot),
    s.row!="voided" or s.acknowledged,not(s.accepted.contains(s.period)),s.signatures<2,
    s'=s.with("phase","prepared").with("signatures",s.signatures+1).with("raw",s.signatures+1)}
  action journal = all {s.phase=="prepared",not(open),
    s'=s.with("phase","journaled").with("row","submitted").with("rowEpoch",s.nextEpoch)
      .with("accepted",s.accepted.union(Set(s.period))).with("journaled",s.journaled.union(Set(s.raw)))}
  action initialBroadcast(ok) = all {s.phase=="journaled",s.journaled.contains(s.raw),
    s'=s.with("phase","idle").with("broadcasts",s.broadcasts.union(Set(s.raw)))
      .with("row",if(ok) "submitted" else "unknown").with("result",if(ok) "posted" else "in_flight")}
  action receiptMissing = all {s.phase=="idle",open,s'=s.with("result","in_flight")}
  action rebroadcast(ok) = all {s.phase=="idle",open,s.identity,s.gas,
    s'=s.with("broadcasts",s.broadcasts.union(Set(s.raw)))
      .with("row",if(ok) "submitted" else "unknown").with("result","in_flight")}
  action finalizedOpen(voided) = all {s.phase=="idle",open,s.identity,s.nextEpoch<2,
    s'=s.with("row",if(voided) "voided" else "finalized").with("nextEpoch",s.nextEpoch+1)
      .with("result",if(voided) "halted_after_void" else "nothing_to_post")}
  action failedOpen = all {s.phase=="idle",open,s.identity,
    s'=s.with("row","failed").with("accepted",s.accepted.exclude(Set(s.period))).with("result","none")}
  // A previously finalized post is rechecked before a successor is considered.
  // Loss of canonical final evidence holds the run without erasing its history.
  action uncertainFinal = all {s.phase=="idle",s.row=="finalized",
    s'=s.with("result","in_flight")}
  action recheckFinal(voided) = all {s.phase=="idle",s.row=="finalized",s.identity,
    s'=s.with("row",if(voided) "voided" else "finalized")
      .with("result",if(voided) "halted_after_void" else "nothing_to_post")}
  action acknowledgeVoid = all {s.row=="voided",s'=s.with("acknowledged",true)}
  action nextFile = all {s.phase=="idle",s.period==1,
    s.row=="finalized" or (s.row=="voided" and s.acknowledged),s.result!="in_flight",
    s'=s.with("period",2).with("result","none")}
  action blocked = all {s.phase=="idle",
    not(s.identity) or not(s.gas) or s.paused or s.pendingRoot or (s.row=="voided" and not(s.acknowledged)),
    s'=s.with("result",if(not(s.identity)) "chain_mismatch" else
      if(s.row=="voided" and not(s.acknowledged)) "halted_after_void" else
      if(s.paused) "paused" else if(s.pendingRoot) "pending_root" else "gas_budget")}
  action discardUnjournaled = all {s.phase=="prepared",s'=s.with("phase","idle")}
  action step = {nondet a=Set(true,false).oneOf() nondet b=Set(true,false).oneOf()
    any {policy(a,b,false,false),policy(true,true,a,b),prepare,journal,initialBroadcast(a),
      receiptMissing,rebroadcast(a),finalizedOpen(a),failedOpen,uncertainFinal,recheckFinal(a),
      acknowledgeVoid,nextFile,blocked,discardUnjournaled,s'=s}}
  val invariant = all {s.signatures<=2,s.nextEpoch<=2,s.accepted.subseteq(Set(1,2)),
    s.broadcasts.subseteq(s.journaled),open implies s.journaled.contains(s.raw),
    Set("finalized","voided").contains(s.row) implies (s.accepted.contains(s.period) or s.period==2)}
  run unknownRetryKeepsSignedBytesTest = init.then(prepare).then(journal).then(initialBroadcast(false))
    .then(rebroadcast(true)).expect(s.signatures==1 and s.broadcasts==Set(1) and invariant)
  run canonicalVoidAfterFinalizedTest = init.then(prepare).then(journal).then(initialBroadcast(true))
    .then(finalizedOpen(false)).then(uncertainFinal).then(recheckFinal(false)).then(recheckFinal(true))
    .expect(s.row=="voided" and s.result=="halted_after_void" and invariant)
  run voidRequiresAcknowledgementTest = init.then(prepare).then(journal).then(initialBroadcast(true))
    .then(finalizedOpen(true)).then(nextFile.fail())
  run failedPostDoesNotConsumeEpochTest = init.then(prepare).then(journal).then(initialBroadcast(true))
    .then(failedOpen).then(prepare).then(journal).then(initialBroadcast(true)).then(finalizedOpen(false))
    .expect(s.signatures==2 and s.nextEpoch==1 and s.rowEpoch==0 and invariant)
  run changedDeploymentRefusesRetryTest = init.then(prepare).then(journal).then(initialBroadcast(false))
    .then(policy(false,true,false,false)).then(rebroadcast(true).fail())
  run unjournaledSignatureCannotBroadcastTest = init.then(prepare).then(initialBroadcast(true).fail())
}
