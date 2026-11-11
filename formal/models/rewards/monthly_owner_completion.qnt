// @source backend/payments/monthly.ts
// @source backend/payments/handler.ts
// @source migrations/0062_monthly_allocations.sql
// @source migrations/0081_monthly_asset_amount_range.sql
// One already-authorized mutation, two registry versions and one cutoff.
// At most two competing setting/allocation writes precede its SQL execution.
// GitHub authorization and amount/proposal validity are external predicates.
// Source-only revision; no parser, scenario, simulation or verifier was run.
module monthly_owner_completion {
  type State = {phase:str,kind:str,registry:bool,revision:int,digest:int,status:str,
    seenRevision:int,seenDigest:int,steward:int,seenSteward:int,settingSequence:int,seenSetting:int,
    allocationSequence:int,seenAllocation:int,automatic:bool,banned:bool,
    frozen:bool,afterCutoff:bool,writes:int,error:str}
  var s:State
  action init = s'={phase:"idle",kind:"none",registry:true,revision:1,digest:1,status:"active",
    seenRevision:0,seenDigest:0,steward:1,seenSteward:0,settingSequence:0,seenSetting:0,
    allocationSequence:0,seenAllocation:0,automatic:true,banned:false,
    frozen:false,afterCutoff:false,writes:0,error:"none"}
  // This boundary follows successful authorization against this version.
  // A later read may authorize a different actor; identity is not inferred
  // from a previous request or from the immutable proposal's older manifest.
  action begin(kind:str):bool=all{s.phase=="idle",s.registry,not(s.banned),
    Set("allocation","enable","disable").contains(kind),
    s'=s.with("phase","queued").with("kind",kind)
      .with("seenRevision",s.revision).with("seenDigest",s.digest)
      .with("seenSteward",s.steward)
      .with("seenSetting",s.settingSequence).with("seenAllocation",s.allocationSequence)}
  // The revision rebinds the authorized steward: the queued mutation was
  // authorized against steward 1 and steward 2 must refuse it.
  action changeProject(status:str):bool=all{Set("idle","queued").contains(s.phase),s.revision==1,
    Set("active","paused").contains(status),
    s'=s.with("revision",2).with("digest",2).with("status",status).with("steward",2)}
  // A manifest edit that keeps the steward only bumps the revision: a
  // queued opt-out retries once against the fresh revision and commits.
  action changeManifest(status:str):bool=all{Set("idle","queued").contains(s.phase),s.revision==1,
    Set("active","paused").contains(status),
    s'=s.with("revision",2).with("digest",2).with("status",status)}
  action loseRegistry=all{s.phase=="queued",s'=s.with("registry",false)}
  action banActor=all{s.phase=="queued",s'=s.with("banned",true)}
  action otherOptOut=all{s.phase=="queued",s.settingSequence<2,
    s'=s.with("automatic",false).with("settingSequence",s.settingSequence+1)}
  action otherEnable=all{s.phase=="queued",s.settingSequence<2,
    s'=s.with("automatic",true).with("settingSequence",s.settingSequence+1)}
  action otherAllocation=all{s.phase=="queued",s.allocationSequence<2,
    s'=s.with("allocationSequence",s.allocationSequence+1)}
  action cutoff=all{s.phase=="queued",s'=s.with("afterCutoff",true)}
  action freeze=all{s.phase=="queued",s'=s.with("frozen",true)}
  val registryCurrent=s.registry and s.revision==s.seenRevision and s.digest==s.seenDigest
  val allocationCurrent=not(s.frozen) and s.allocationSequence==s.seenAllocation
    and (not(s.automatic) or not(s.afterCutoff))
  val settingCurrent=s.kind=="disable" or s.settingSequence==s.seenSetting
  // The opt-out bypass is steward-scoped, not revision-scoped: a disable
  // commits past a revision that kept the authorizing steward (the
  // implementation retries the INSERT once against the fresh revision),
  // but a revision that rebinds the steward still refuses it, so a stale
  // opt-out cannot overtake the new owner's fresh enable. Allocations and
  // enables keep the full revision guard.
  val stewardCurrent=s.steward==s.seenSteward
  val allowed=(if(s.kind=="disable")s.registry and stewardCurrent else registryCurrent) and not(s.banned)
    and (if(s.kind=="allocation")allocationCurrent else settingCurrent)
  val refusal=if(not(s.registry))"payment_registry_unavailable"
    else if(s.kind=="disable" and not(stewardCurrent))"project_changed"
    else if(not(registryCurrent))"project_changed"
    else if(s.banned)"account_banned"
    // The WHERE gate runs before the allocation trigger and unique constraint.
    // A cutoff-suppressed row cannot reach either conflicting-write check.
    else if(s.kind=="allocation" and s.automatic and s.afterCutoff)"cutoff_passed"
    else if(s.kind=="allocation")"allocations_changed" else "setting_changed"
  action execute=all{s.phase=="queued",
    s'=if(allowed)s.with("phase","committed").with("writes",1)
      .with("allocationSequence",if(s.kind=="allocation")s.allocationSequence+1 else s.allocationSequence)
      .with("settingSequence",if(s.kind=="allocation")s.settingSequence else s.settingSequence+1)
      .with("automatic",if(s.kind=="allocation")s.automatic else s.kind=="enable")
      else s.with("phase","refused").with("error",refusal)}
  action step=any{begin("allocation"),begin("enable"),begin("disable"),
    changeProject("active"),changeProject("paused"),changeManifest("active"),changeManifest("paused"),
    loseRegistry,banActor,
    otherOptOut,otherEnable,otherAllocation,cutoff,freeze,execute,s'=s}
  // The model ends at the mutation result. Later registry changes do not
  // retroactively invalidate an earlier correctly authorized durable write.
  val invariant=all{s.writes>=0,s.writes<=1,s.settingSequence<=3,s.allocationSequence<=3,
    s.phase=="committed" implies((if(s.kind=="disable")s.registry and stewardCurrent else registryCurrent) and not(s.banned) and s.writes==1),
    s.phase=="refused" implies s.writes==0,
    s.phase=="committed" and s.kind=="allocation" implies
      (not(s.frozen) and s.allocationSequence==s.seenAllocation+1
        and (not(s.automatic) or not(s.afterCutoff))),
    s.phase=="committed" and s.kind=="enable" implies s.settingSequence==s.seenSetting+1}
  run currentAllocationCommitsTest=init.then(begin("allocation")).then(execute)
    .expect(s.phase=="committed" and s.allocationSequence==1)
  run currentEnableCommitsTest=init.then(begin("enable")).then(execute)
    .expect(s.phase=="committed" and s.automatic)
  run allocationRefusesChangedAuthorityTest=init.then(begin("allocation")).then(changeProject("active")).then(execute)
    .expect(s.error=="project_changed" and s.writes==0)
  run enableRefusesChangedAuthorityTest=init.then(begin("enable")).then(changeProject("active")).then(execute)
    .expect(s.error=="project_changed" and s.writes==0)
  run disableRefusesChangedStewardTest=init.then(begin("disable")).then(changeProject("active")).then(execute)
    .expect(s.error=="project_changed" and s.writes==0)
  run disableCommitsDespiteSameStewardRevisionTest=init.then(begin("disable")).then(changeManifest("active")).then(execute)
    .expect(s.phase=="committed" and not(s.automatic) and s.writes==1)
  run staleDisableCannotOvertakeNewOwnerEnableTest=init.then(begin("disable")).then(changeProject("active")).then(otherEnable).then(execute)
    .expect(s.error=="project_changed" and s.writes==0 and s.automatic and s.settingSequence==1)
  run missingRegistryRefusesMutationTest=init.then(begin("disable")).then(loseRegistry).then(execute)
    .expect(s.error=="payment_registry_unavailable" and s.writes==0)
  run delayedEnableCannotOvertakeOptOutTest=init.then(begin("enable")).then(otherOptOut).then(execute)
    .expect(s.error=="setting_changed" and not(s.automatic) and s.settingSequence==1)
  run explicitOffCanFollowAnotherOffTest=init.then(begin("disable")).then(otherOptOut).then(execute)
    .expect(s.phase=="committed" and not(s.automatic) and s.settingSequence==2)
  run allocationCutoffStillRefusesTest=init.then(begin("allocation")).then(cutoff).then(execute)
    .expect(s.error=="cutoff_passed" and s.writes==0)
  run currentOffAllowsAllocationAfterCutoffTest=init.then(begin("allocation")).then(cutoff).then(otherOptOut).then(execute)
    .expect(s.phase=="committed" and not(s.automatic))
  run frozenMonthStillRefusesTest=init.then(begin("allocation")).then(freeze).then(execute)
    .expect(s.error=="allocations_changed" and s.writes==0)
  run competingAllocationStillRefusesTest=init.then(begin("allocation")).then(otherAllocation).then(execute)
    .expect(s.error=="allocations_changed" and s.allocationSequence==1)
  run cutoffPrecedesFrozenMonthRefusalTest=init.then(begin("allocation")).then(freeze).then(cutoff).then(execute)
    .expect(s.error=="cutoff_passed" and s.writes==0)
  run cutoffPrecedesCompetingAllocationRefusalTest=init.then(begin("allocation")).then(otherAllocation).then(cutoff).then(execute)
    .expect(s.error=="cutoff_passed" and s.writes==0 and s.allocationSequence==1)
  run newBanStillRefusesTest=init.then(begin("disable")).then(banActor).then(execute)
    .expect(s.error=="account_banned" and s.writes==0)
  run unchangedPausedProjectMayUpdateSettingTest=init.then(changeProject("paused")).then(begin("disable")).then(execute)
    .expect(s.phase=="committed" and s.status=="paused" and not(s.automatic))
}
