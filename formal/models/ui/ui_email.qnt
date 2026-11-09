// @source src/InboxEmail.tsx
// @evidence tests/e2e/email-controls.spec.ts
// Settings projection only. Link capture/consumption belongs to ui_email_actions;
// HTTP ownership/session gates belong to ui_email_preference_requests and
// ui_email_parent. These actions assume a current actor's validated response.
// Two addresses, two request keys, at most three submissions, two channels,
// all five pending-delivery states and three destination availability classes.
// A queued/sent/unknown verification is not destination verification or consent;
// a 202 adopts the complete current snapshot, which may also reflect another
// already-completed verification or preference change during the request.
// Existing enabled flags can survive temporarily unavailable destination reads.
// expiresAt is validated but not locally scheduled: the label changes only on
// a fresh server snapshot. This model makes no continuous-expiry claim.
// Local edits invalidate the idempotency key; a failed identical retry retains
// it. Same-actor refresh preserves draft fields. No delivery/provider proof or
// backend idempotency implementation is modeled here. Source-only, unexecuted.
module ui_email {
  val pendingStates=Set("none","queued","sending","sent","unknown","expired")
  type S={status:str,availability:str,enrollment:bool,pending:str,pendingAddress:int,
    activity:bool,security:bool,editing:bool,draft:int,choiceActivity:bool,choiceSecurity:bool,
    key:int,nextKey:int,submissions:int,mode:str,targetActivity:bool,targetSecurity:bool,
    sentKey:int,sentAddress:int,versionSent:bool,blocked:bool,error:bool,clockExpired:bool}
  var s:S
  action init=s'={status:"ready",availability:"unverified",enrollment:true,pending:"none",pendingAddress:0,
    activity:false,security:false,editing:false,draft:0,choiceActivity:false,choiceSecurity:false,
    key:0,nextKey:0,submissions:0,mode:"idle",targetActivity:false,targetSecurity:false,
    sentKey:0,sentAddress:0,versionSent:false,blocked:false,error:false,clockExpired:false}
  val ready=s.status=="ready"
  val editor=ready and s.enrollment and (s.editing or (s.availability=="unverified" and s.pending=="none"))
  def canToggle(activity:bool):bool=ready and not(s.blocked) and s.mode=="idle"
    and (s.availability=="verified" or (if(activity)s.activity else s.security))
  action snapshot(availability:str,enrollment:bool,pending:str,activity:bool,security:bool):bool=all{
    s.mode=="idle",Set("verified","unverified","unavailable").contains(availability),pendingStates.contains(pending),
    s'=s.with("status","ready").with("availability",availability).with("enrollment",enrollment)
      .with("pending",pending).with("pendingAddress",if(pending=="none")0 else 1)
      .with("activity",activity).with("security",security).with("blocked",false)}
  action edit=all{ready,s.enrollment,s.mode=="idle",
    s'=s.with("editing",true).with("draft",if(s.pending!="none")s.pendingAddress else if(s.availability=="verified")2 else 0)
      .with("choiceActivity",s.activity).with("choiceSecurity",s.security).with("key",0).with("error",false)}
  action address(value:int):bool=all{editor,s.mode=="idle",Set(1,2).contains(value),s'=s.with("draft",value).with("key",0)}
  action choices(activity:bool,security:bool):bool=all{editor,s.mode=="idle",
    s'=s.with("choiceActivity",activity).with("choiceSecurity",security).with("key",0)}
  action cancel=all{editor,s.editing,s.mode=="idle",s'=s.with("editing",false)}
  action enroll=all{editor,not(s.blocked),s.mode=="idle",s.draft>0,s.submissions<3,s.key>0 or s.nextKey<2,
    s'=s.with("mode","enroll").with("submissions",s.submissions+1).with("error",false)
      .with("key",if(s.key==0)s.nextKey+1 else s.key).with("nextKey",if(s.key==0)s.nextKey+1 else s.nextKey)
      .with("sentKey",if(s.key==0)s.nextKey+1 else s.key).with("sentAddress",s.draft)
      .with("targetActivity",s.choiceActivity).with("targetSecurity",s.choiceSecurity)}
  action toggle(activity:bool):bool=all{canToggle(activity),s.submissions<3,
    val nextActivity=if(activity)not(s.activity) else s.activity
    val nextSecurity=if(activity)s.security else not(s.security)
    s'=s.with("mode","save").with("submissions",s.submissions+1).with("error",false)
      .with("targetActivity",nextActivity).with("targetSecurity",nextSecurity)
      .with("versionSent",(nextActivity or nextSecurity) and s.availability=="verified")}
  action accepted=all{s.mode=="save",
    s'=s.with("mode","idle").with("activity",s.targetActivity).with("security",s.targetSecurity)}
  action enrollmentReply(availability:str,enrollment:bool,pending:str,address:int,activity:bool,security:bool):bool=all{
    s.mode=="enroll",Set("verified","unverified","unavailable").contains(availability),
    pendingStates.contains(pending),Set(1,2).contains(address),
    s'=s.with("mode","idle").with("status","ready").with("availability",availability).with("enrollment",enrollment)
      .with("activity",activity).with("security",security).with("pending",pending)
      .with("pendingAddress",if(pending=="none")0 else address).with("editing",false).with("key",0)}
  action queuedReply=enrollmentReply(s.availability,s.enrollment,"queued",s.sentAddress,s.activity,s.security)
  action rejected=all{s.mode!="idle",s'=s.with("mode","idle").with("error",true)}
  action destinationChanged=all{s.mode=="save",s'=s.with("mode","idle").with("status","loading").with("blocked",true).with("error",true)}
  action backgroundCheck=all{ready,s.mode=="idle",s'=s.with("blocked",true)}
  action readFailure=all{s.mode=="idle",s'=s.with("status","error").with("blocked",false)}
  action clockExpiry=s'=s.with("clockExpired",true)
  action actorChange=s'=s.with("status","loading").with("blocked",true).with("editing",false)
    .with("draft",0).with("choiceActivity",false).with("choiceSecurity",false).with("key",0).with("mode","idle")
  action step={nondet availability=Set("verified","unverified","unavailable").oneOf()
    nondet pending=pendingStates.oneOf() nondet yes=Set(false,true).oneOf() nondet other=Set(false,true).oneOf()
    nondet enrollment=Set(false,true).oneOf()
    nondet value=Set(1,2).oneOf()
    any{snapshot(availability,enrollment,pending,yes,other),edit,address(value),choices(yes,other),cancel,enroll,toggle(yes),
      accepted,enrollmentReply(availability,enrollment,pending,value,yes,other),rejected,
      destinationChanged,backgroundCheck,readFailure,clockExpiry,actorChange,s'=s}}
  val invariant=all{s.nextKey<=2,s.submissions<=3,s.key>=0,s.key<=s.nextKey,
    s.mode=="enroll" implies s.sentKey>0 and s.sentAddress>0,
    editor implies ready and s.enrollment,
    s.mode=="save" and (s.targetActivity or s.targetSecurity) and s.availability=="verified" implies s.versionSent}
  run unverifiedStartsWithEnrollmentTest=init.expect(editor and not(canToggle(true)))
  run queuedDoesNotActivateConsentTest=init.then(address(1)).then(choices(true,true)).then(enroll).then(queuedReply)
    .expect(s.pending=="queued" and not(s.activity) and not(s.security) and not(editor) and s.key==0)
  run sameFailedRequestReusesKeyTest=init.then(address(1)).then(enroll).then(rejected).then(enroll)
    .expect(s.sentKey==1 and s.nextKey==1 and invariant)
  run editedAddressGetsNewKeyTest=init.then(address(1)).then(enroll).then(rejected).then(address(2)).then(enroll)
    .expect(s.sentAddress==2 and s.sentKey==2 and invariant)
  run changedConsentGetsNewKeyTest=init.then(address(1)).then(enroll).then(rejected).then(choices(true,false)).then(enroll)
    .expect(s.sentKey==2 and s.targetActivity and invariant)
  run pendingAddressPrefillsEditorTest=init.then(snapshot("verified",true,"sent",false,true)).then(edit)
    .expect(s.draft==1 and not(s.choiceActivity) and s.choiceSecurity and editor)
  run verifiedAddressPrefillsWithoutPendingTest=init.then(snapshot("verified",true,"none",true,false)).then(edit).expect(s.draft==2 and s.choiceActivity)
  run cancelKeepsPendingReceiptTest=init.then(snapshot("unverified",true,"unknown",false,false)).then(edit).then(address(2)).then(cancel)
    .expect(s.pending=="unknown" and s.pendingAddress==1 and not(editor) and s.submissions==0)
  run backgroundCheckStillAllowsCancelTest=init.then(snapshot("unverified",true,"unknown",false,false)).then(edit).then(backgroundCheck).then(cancel)
    .expect(s.blocked and not(s.editing) and not(editor) and s.submissions==0)
  run delayedEnrollmentCanAlreadyBeSentTest=init.then(address(1)).then(enroll)
    .then(enrollmentReply("unverified",true,"sent",1,false,false)).expect(s.pending=="sent" and s.key==0 and not(editor))
  run acceptedReplayCanReturnUnknownDeliveryTest=init.then(address(1)).then(enroll).then(rejected).then(enroll)
    .then(enrollmentReply("unverified",true,"unknown",1,false,false)).expect(s.pending=="unknown" and s.sentKey==1 and not(s.activity))
  run acceptedSnapshotCanReflectCompletedVerificationTest=init.then(address(1)).then(enroll)
    .then(enrollmentReply("verified",true,"none",1,true,false)).expect(s.activity and s.availability=="verified" and s.pending=="none")
  run noLocalExpiryRepaintClaimTest=init.then(snapshot("unverified",true,"sent",false,false)).then(clockExpiry)
    .expect(s.pending=="sent" and s.clockExpired)
  run refreshedExpiryChangesOnlyReceiptTest=init.then(snapshot("unverified",true,"sent",false,false)).then(clockExpiry)
    .then(snapshot("unverified",true,"expired",false,false)).expect(s.pending=="expired" and not(s.activity) and not(s.security))
  run unavailableDestinationStillAllowsOptOutTest=init.then(snapshot("unavailable",false,"none",true,false)).then(toggle(true)).then(accepted)
    .expect(not(s.activity) and not(s.versionSent) and invariant)
  run unavailableDestinationCannotOptInTest=init.then(snapshot("unavailable",false,"none",false,false)).then(toggle(true).fail())
  run eachSwitchKeepsTheOtherChoiceTest=init.then(snapshot("verified",true,"none",false,true)).then(toggle(true))
    .expect(s.targetActivity and s.targetSecurity and s.versionSent).then(accepted).expect(s.activity and s.security)
  run turningOneOffRetainsVersionForOtherOnTest=init.then(snapshot("verified",true,"none",true,true)).then(toggle(true))
    .expect(not(s.targetActivity) and s.targetSecurity and s.versionSent)
  run turningBothOffNeedsNoVersionTest=init.then(snapshot("verified",true,"none",false,true)).then(toggle(false))
    .expect(not(s.targetActivity) and not(s.targetSecurity) and not(s.versionSent))
  run preferenceFailureKeepsPriorFlagsTest=init.then(snapshot("verified",true,"none",false,true)).then(toggle(true)).then(rejected)
    .expect(not(s.activity) and s.security and s.error)
  run destinationConflictRequiresFreshReadTest=init.then(snapshot("verified",true,"none",false,false)).then(toggle(true)).then(destinationChanged)
    .expect(s.status=="loading" and not(canToggle(true)) and not(s.activity))
  run backgroundCheckPreservesEditableDraftTest=init.then(address(1)).then(backgroundCheck).then(address(2))
    .expect(editor and s.draft==2).then(enroll.fail())
  run enrollmentUnavailableHidesEditorTest=init.then(snapshot("unverified",false,"expired",false,false)).expect(not(editor))
  run actorChangeDropsDraftAndKeyTest=init.then(address(1)).then(enroll).then(rejected).then(actorChange)
    .expect(s.draft==0 and s.key==0 and not(editor))
}
