// @source backend/projects/verified-enforcement.ts
// @source migrations/0060_contributor_flags.sql
// @source migrations/0072_account_reinstatements.sql
// @source backend/vetting/flags.ts
// @source backend/vetting/persistence.ts
// @source backend/vetting/handler.ts
// @source backend/projects/enforcement.ts
// @evidence scripts/vetting-scan-flags.test.ts
// Three reporters, four immutable flag IDs, two content/pin versions and one
// pending scan. Duplicate requests are projected as a refusal with no change.
// Closing a captured flag and reinstating the project are separate outcomes.
// Reused clean results can resolve captured flags but cannot reinstate. A
// presentation revision preserves content clearance; a security-content or
// live-pin change prevents immediate reinstatement. Confirmed bans absorb.
// This refinement and its named scenarios are source-authored, unexecuted.
module vetting_flag_reinstatement {
  pure val ids=Set(1,2,3,4)
  var s:{flags:Set[int],owners:int->int,history:int->str,created:int,captured:Set[int],
    restriction:str,restrictionEpoch:int,scanEpoch:int,revision:int,scannedRevision:int,content:int,scannedContent:int,
    pin:int,scannedPin:int,pinReadable:bool,result:str,pending:bool,exempt:bool,everBanned:bool}
  action init=s'={flags:Set(),owners:ids.mapBy(_=>0),history:ids.mapBy(_=>"unused"),created:0,captured:Set(),
    restriction:"clear",restrictionEpoch:0,scanEpoch:0,revision:1,scannedRevision:0,content:1,scannedContent:0,
    pin:1,scannedPin:0,pinReadable:true,result:"none",pending:false,exempt:false,everBanned:false}
  action flag(reporter:int):bool={
    val duplicate=s.flags.exists(id=>s.owners.get(id)==reporter)
    val id=s.created+1
    val updatedFlags=s.flags.union(Set(id))
    val pauses=s.restriction=="clear" and updatedFlags.size()>=2
    all{Set(1,2,3).contains(reporter),duplicate or s.created<4,
      s'=if(duplicate)s else s.with("flags",updatedFlags).with("created",id)
        .with("owners",s.owners.set(id,reporter)).with("history",s.history.set(id,"active"))
        .with("restriction",if(pauses)"quarantined" else s.restriction)
        .with("restrictionEpoch",if(pauses)s.restrictionEpoch+1 else s.restrictionEpoch)}
  }
  action withdraw(reporter:int):bool={
    val closing=s.flags.filter(id=>s.owners.get(id)==reporter)
    s'=s.with("flags",s.flags.exclude(closing))
      .with("history",ids.mapBy(id=>if(closing.contains(id))"withdrawn" else s.history.get(id)))
  }
  action expire(id:int):bool=all{s.flags.contains(id),
    s'=s.with("flags",s.flags.exclude(Set(id))).with("history",s.history.set(id,"expired"))}
  action requestScan=all{not(s.pending),
    s'=s.with("pending",true).with("captured",s.flags).with("scannedContent",s.content)
      .with("scannedPin",s.pin).with("scannedRevision",s.revision)
      .with("scanEpoch",s.restrictionEpoch).with("result","none")}
  // Only security-relevant content changes invalidate this comparison.
  action revise=all{s.content==1,s.revision<3,s'=s.with("content",2).with("revision",s.revision+1)}
  action presentationRevision=all{s.revision<3,s'=s.with("revision",s.revision+1)}
  action advancePin=all{s.pin==1,s'=s.with("pin",2)}
  action pinUnavailable=s'=s.with("pinReadable",false)
  action pinAvailable=s'=s.with("pinReadable",true)
  action admissionExemption=s'=s.with("exempt",true)
  val fresh=s.content==s.scannedContent and s.pin==s.scannedPin and s.pinReadable
    and s.scanEpoch==s.restrictionEpoch and s.flags.subseteq(s.captured)
  action completeClean={
    val closing=s.flags.intersect(s.captured)
    val restore=fresh and s.restriction=="quarantined"
    all{s.pending,
      s'=s.with("pending",false).with("result","clean")
        .with("restriction",if(restore)"clear" else s.restriction)
        .with("flags",s.flags.exclude(closing))
        .with("history",ids.mapBy(id=>if(closing.contains(id))"resolved" else s.history.get(id)))}
  }
  action completeReusedClean={
    val closing=s.flags.intersect(s.captured)
    all{s.pending,
      s'=s.with("pending",false).with("result","reused-clean")
        .with("flags",s.flags.exclude(closing))
        .with("history",ids.mapBy(id=>if(closing.contains(id))"resolved" else s.history.get(id)))}
  }
  // A recorded clean scan can later reinstate once its live pin is readable.
  action retryReinstatement=all{not(s.pending),s.result=="clean",fresh,s.restriction=="quarantined",s.revision==s.scannedRevision,
    s'=s.with("restriction","clear")}
  action incomplete=all{s.pending,s'=s.with("pending",false).with("result","incomplete")}
  action confirmedMalice=all{s.pending,
    s'=s.with("pending",false).with("result","malicious").with("restriction","banned").with("everBanned",true)
      .with("restrictionEpoch",if(s.restriction=="banned")s.restrictionEpoch else s.restrictionEpoch+1)}
  action step={nondet reporter=Set(1,2,3).oneOf() nondet id=ids.oneOf()
    any{flag(reporter),withdraw(reporter),expire(id),requestScan,revise,presentationRevision,advancePin,
      pinUnavailable,pinAvailable,admissionExemption,completeClean,completeReusedClean,retryReinstatement,incomplete,confirmedMalice,s'=s}}
  val invariant=all{s.created>=0,s.created<=4,s.revision>=1,s.revision<=3,s.restrictionEpoch<=3,
    s.flags==ids.filter(id=>s.history.get(id)=="active"),
    s.flags.size()>=2 implies s.restriction!="clear",
    s.everBanned implies s.restriction=="banned",
    s.flags.map(id=>s.owners.get(id)).size()==s.flags.size(),
    s.flags.forall(id=>s.owners.get(id)>=1 and s.owners.get(id)<=3),
    s.scannedContent<=s.content,s.scannedPin<=s.pin,s.scannedRevision<=s.revision}
  run duplicateReporterTest=init.then(flag(1)).then(flag(1))
    .expect(s.restriction=="clear" and s.flags.size()==1 and s.created==1)
  run withdrawalDoesNotReinstateTest=init.then(flag(1)).then(flag(2)).then(withdraw(2))
    .expect(s.restriction=="quarantined" and s.history.get(2)=="withdrawn")
  run freshScanReinstatesTest=init.then(flag(1)).then(flag(2)).then(requestScan).then(completeClean)
    .expect(s.restriction=="clear" and s.flags==Set() and s.history.get(1)=="resolved")
  run newFlagPreventsReinstatementTest=init.then(flag(1)).then(flag(2)).then(requestScan).then(flag(3)).then(completeClean)
    .expect(s.restriction=="quarantined" and s.flags==Set(3) and s.history.get(1)=="resolved")
  run exemptionDoesNotOverrideRestrictionTest=init.then(flag(1)).then(flag(2)).then(admissionExemption)
    .expect(s.restriction=="quarantined")
  run cleanScanDoesNotUndoBanTest=init.then(requestScan).then(confirmedMalice).then(requestScan).then(completeClean)
    .expect(s.restriction=="banned")
  run sameReporterRefileHasNewIdentityTest=init.then(flag(1)).then(flag(2)).then(requestScan)
    .then(withdraw(1)).then(flag(1)).then(completeClean)
    .expect(s.restriction=="quarantined" and s.flags==Set(3)
      and s.history.get(1)=="withdrawn" and s.history.get(2)=="resolved" and s.owners.get(3)==1)
  run stalePinStillResolvesCapturedFlagsTest=init.then(flag(1)).then(flag(2)).then(requestScan).then(advancePin).then(completeClean)
    .expect(s.restriction=="quarantined" and s.flags==Set()
      and s.history.get(1)=="resolved" and s.history.get(2)=="resolved")
  run unavailablePinDefersOnlyReinstatementTest=init.then(flag(1)).then(flag(2)).then(requestScan).then(pinUnavailable)
    .then(completeClean).expect(s.flags==Set() and s.restriction=="quarantined")
    .then(pinAvailable).then(retryReinstatement).expect(s.restriction=="clear")
  run presentationRevisionKeepsContentClearanceTest=init.then(flag(1)).then(flag(2)).then(requestScan)
    .then(presentationRevision).then(completeClean).expect(s.restriction=="clear" and s.revision==2)
  run changedContentCannotReinstateTest=init.then(flag(1)).then(flag(2)).then(requestScan).then(revise).then(completeClean)
    .expect(s.restriction=="quarantined" and s.flags==Set() and s.history.get(1)=="resolved")
  run expiredFlagHistorySurvivesRefileTest=init.then(flag(1)).then(expire(1)).then(flag(1))
    .expect(s.history.get(1)=="expired" and s.history.get(2)=="active" and s.flags==Set(2))
  run changedRevisionDefersRecordedRetryTest=init.then(flag(1)).then(flag(2)).then(requestScan).then(pinUnavailable)
    .then(completeClean).then(presentationRevision).then(pinAvailable)
    .expect(s.restriction=="quarantined" and s.flags==Set()).then(retryReinstatement.fail())
  run refiledIdDuringScanKeepsPauseTest=init.then(flag(1)).then(flag(2)).then(requestScan)
    .then(withdraw(2)).then(flag(2)).then(completeClean)
    .expect(s.restriction=="quarantined" and s.flags==Set(3) and s.history.get(1)=="resolved")
  run scanBeforePauseDoesNotReinstateTest=init.then(flag(1)).then(requestScan).then(flag(2)).then(completeClean)
    .expect(s.restriction=="quarantined" and s.flags==Set(2))
  run staleRevisionDoesNotReinstateTest=init.then(flag(1)).then(flag(2)).then(requestScan).then(revise).then(completeClean)
    .expect(s.restriction=="quarantined")
  run reusedCleanResolvesButKeepsPauseTest=init.then(flag(1)).then(flag(2)).then(requestScan).then(completeReusedClean)
    .expect(s.restriction=="quarantined" and s.flags==Set()).then(retryReinstatement.fail())
  run expiryAllowsRefileTest=init.then(flag(1)).then(expire(1)).then(flag(1))
    .expect(s.flags==Set(2) and s.restriction=="clear")
}
