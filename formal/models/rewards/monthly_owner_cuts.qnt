// @source backend/payments/monthly.ts
// @source backend/payments/handler.ts
// @source backend/notifications/events.ts
// @source migrations/0126_monthly_allocation_cuts.sql
// @source src/lib/use-monthly-cuts.ts
// Owner cuts (PRD section 6, operator decision of 15 November 2026). One
// contributor, a proposal of 2 and clock steps: 0 open, 1 the final 24 hours
// before the cutoff, 2 the cutoff. A change below the proposal is a cut: it
// needs a reason, writes its public record and one notice with the change,
// and starts a 24-hour notice before the owner can finalize. The public list
// reflects only the latest change. The coordinator freezes at the cutoff when
// automatic finalization is on or the owner pledged the month on chain in the
// paying vault (operator decision of 15 November 2026), so either closes cuts
// in the final window and every change at the cutoff. A pledge names the
// current or a later month (both contracts refuse an earlier one), so this
// month's pledge comes at step 0, before the month ends. That is at least 24
// hours before the cutoff only because the deployed schedule puts the cutoff
// 72 hours after the month ends (owner decision D1, MONTHLY_PAYMENT_SCHEDULE
// in wrangler.toml and wrangler.staging.toml); a cutoff under 24 hours after
// the month ends is outside this model.
module monthly_owner_cuts {
  type State = {now:int,automatic:bool,pledged:bool,amount:int,changes:int,
    cutRecords:int,notices:int,latestIsCut:bool,lastCutAt:int,frozen:bool,
    coordinatorFroze:bool,error:str}
  var s:State
  pure val PROPOSED = 2
  action init = s'={now:0,automatic:true,pledged:false,amount:PROPOSED,changes:0,
    cutRecords:0,notices:0,latestIsCut:false,lastCutAt:-1,frozen:false,
    coordinatorFroze:false,error:"none"}
  // The month freezes at the cutoff without the owner.
  val freezesAtCutoff=s.automatic or s.pledged
  // One change at execution time; `reason` is whether a valid 20 to 500
  // character reason accompanied it.
  action change(amount:int,reason:bool):bool={
    val cut=amount<PROPOSED
    val error=if(cut and not(reason))"cut_reason_required"
      else if(cut and freezesAtCutoff and s.now>=1)"cut_notice_window" else "none"
    all{not(s.frozen),not(freezesAtCutoff and s.now>=2),s.changes<3,
      s'=if(error!="none")s.with("error",error)
        else s.with("amount",amount).with("changes",s.changes+1)
          .with("cutRecords",if(cut)s.cutRecords+1 else s.cutRecords)
          .with("notices",if(cut)s.notices+1 else s.notices)
          .with("latestIsCut",cut)
          .with("lastCutAt",if(cut)s.now else s.lastCutAt)
          .with("error","none")}}
  action tick=all{s.now<3,s'=s.with("now",s.now+1)}
  action optOut=all{s.automatic,s'=s.with("automatic",false)}
  action pledge=all{not(s.pledged),s.now==0,s'=s.with("pledged",true)}
  // The owner's finalize waits one notice period (one clock step) after the
  // latest cut.
  action finalize=all{not(s.frozen),s.now>=1,
    s'=if(s.lastCutAt>=0 and s.now<s.lastCutAt+1)s.with("error","cut_notice_pending")
      else s.with("frozen",true).with("error","none")}
  action coordinatorFreeze=all{not(s.frozen),freezesAtCutoff,s.now>=2,
    s'=s.with("frozen",true).with("coordinatorFroze",true)}
  action step=any{
    nondet amount=0.to(PROPOSED).oneOf()
    nondet reason=Set(false,true).oneOf()
    change(amount,reason),
    tick,optOut,pledge,finalize,coordinatorFreeze,s'=s}
  // The public list shows the contributor exactly when the latest change cut.
  val listed=s.latestIsCut
  val invariant=all{
    s.cutRecords==s.notices,
    s.cutRecords<=s.changes,
    listed implies s.amount<PROPOSED,
    s.amount>=PROPOSED implies not(listed),
    s.lastCutAt>=0 implies s.cutRecords>0,
    // No cut from the final 24 hours is frozen without its notice.
    s.coordinatorFroze implies s.lastCutAt<1}
  run cutNeedsReasonTest=init.then(change(1,false))
    .expect(s.error=="cut_reason_required" and s.changes==0 and s.cutRecords==0)
  run cutWithReasonNotifiesTest=init.then(change(1,true))
    .expect(s.cutRecords==1 and s.notices==1 and listed)
  run increaseNeedsNoReasonTest=init.then(change(1,true)).then(change(PROPOSED,false))
    .expect(s.changes==2 and not(listed) and s.cutRecords==1)
  run finalWindowRefusesCutTest=init.then(tick).then(change(1,true))
    .expect(s.error=="cut_notice_window" and s.changes==0)
  run optOutAllowsLateCutTest=init.then(tick).then(optOut).then(change(1,true))
    .expect(s.cutRecords==1)
  run finalizeWaitsAfterCutTest=init.then(optOut).then(tick).then(change(1,true))
    .then(finalize).expect(s.error=="cut_notice_pending" and not(s.frozen))
    .then(tick).then(finalize).expect(s.frozen)
  run coordinatorFreezeUnchangedTest=init.then(change(1,true)).then(tick).then(tick)
    .then(coordinatorFreeze).expect(s.frozen and listed)
  run pledgedWindowRefusesCutTest=init.then(optOut).then(pledge).then(tick)
    .then(change(1,true)).expect(s.error=="cut_notice_window" and s.changes==0)
  run pledgedCutoffRefusesChangeTest=init.then(optOut).then(pledge).then(tick)
    .then(tick).then(change(PROPOSED,false)).fail()
  run pledgedCoordinatorFreezeTest=init.then(optOut).then(pledge).then(change(1,true))
    .then(tick).then(tick).then(coordinatorFreeze)
    .expect(s.frozen and s.coordinatorFroze and listed)
}
