// @source contracts/evm/src/ProjectEscrow.sol
// @source contracts/solana/programs/slop-escrow/src/lib.rs
// @evidence contracts/evm/test/BindingLifecycle.t.sol
// @evidence contracts/evm/test/BoundedAttester.t.sol
// @evidence contracts/solana/integration/escrow.e2e.mjs
// One actor/project, 8 binding versions, 2 sequential awards, ticks0..3,
// binding delay0 or1, and Solana rotation delay0 or1 (EVM is always0).
// Signature/account ownership and rotation authorization are external
// predicates; rotation timing is explicit because it changes the veto waiver.
// Finite reduction: the former `cancelled` and `paid` version sets are kept
// only for the current binding version. Every guard reads membership of
// `s.version` alone, `veto` and `pay` add only `s.version`, and `bind` moves to
// a fresh version that neither set contains. An older version's membership is
// therefore frozen once superseded and never read again except by the
// disjointness invariant, which was already checked for that version while it
// was current. `currentCancelled`/`currentPaid` (reset by `bind`) keep every
// guard and the invariant's truth, and remove the 2^8 history subsets.
module binding_veto_policy {
  type S={chain:str,delay:int,now:int,version:int,boundAt:int,paidVersion:int,
    count:int,currentCancelled:bool,currentPaid:bool,pending:bool,confirmed:bool,
    rotationDelay:int,rotationAt:int,award:bool,awards:int,committedAt:int}
  def initial(chain:str,delay:int,rotationDelay:int):S={chain:chain,delay:delay,now:0,version:0,boundAt:0,paidVersion:0,
    count:0,currentCancelled:false,currentPaid:false,pending:false,confirmed:false,rotationDelay:rotationDelay,rotationAt:0,
    award:false,awards:0,committedAt:0}
  var s:S
  action init={nondet chain=oneOf(Set("evm","solana")) nondet delay=oneOf(Set(0,1))
    nondet rotationDelay=oneOf(Set(0,1)) s'=initial(chain,delay,if(chain=="evm")0 else rotationDelay)}
  action evm=s'=initial("evm",1,0)
  action solana=s'=initial("solana",1,1)
  action zeroDelay=s'=initial("evm",0,0)
  action solanaZeroRotation=s'=initial("solana",1,0)
  action tick=all{s.now<3,s'=s.with("now",s.now+1)}
  action bind=all{s.version<8,s'=s.with("version",s.version+1).with("boundAt",s.now)
    .with("currentCancelled",false).with("currentPaid",false)}
  action commit=all{not(s.award),s.awards<2,s'=s.with("award",true).with("awards",s.awards+1).with("committedAt",s.now)}
  action proposeRotation=all{not(s.pending),s'=s.with("pending",true).with("confirmed",false)
    .with("rotationAt",s.now+s.rotationDelay)}
  action confirmRotation=all{s.chain=="solana",s.pending,not(s.confirmed),s'=s.with("confirmed",true)}
  action cancelRotation=all{s.pending,s'=s.with("pending",false).with("confirmed",false).with("rotationAt",0)}
  action executeRotation=all{s.pending,s.chain=="evm" or s.confirmed,s.now>=s.rotationAt,
    s'=s.with("pending",false).with("confirmed",false).with("rotationAt",0)}
  val waiver=s.pending and (s.chain=="evm" or s.confirmed)
  def commitWindow(includeAward:bool):bool = s.now<s.committedAt+s.delay and
    (if(s.chain=="evm")s.awards>0 else includeAward and s.award)
  action veto(owner:bool,includeAward:bool):bool=all{owner,s.version>0,s.version!=s.paidVersion,
    not(s.currentCancelled),s.now<s.boundAt+s.delay or commitWindow(includeAward),
    waiver or s.count<3,
    s'=s.with("currentCancelled",true).with("count",if(waiver)s.count else s.count+1)}
  action pay(expected:int):bool=all{s.award,s.version>0,expected==s.version,not(s.currentCancelled),
    s.now>=s.committedAt+s.delay,
    s'=s.with("paidVersion",s.version).with("currentPaid",true).with("count",0).with("award",false)}
  action step=any{tick,bind,commit,proposeRotation,confirmRotation,cancelRotation,executeRotation,
    veto(true,true),veto(true,false),veto(false,true),pay(s.version),pay(s.version-1),s'=s}
  val invariant=all{s.count>=0,s.count<=3,s.version<=8,s.awards<=2,
    s.paidVersion<=s.version,not(s.currentCancelled and s.currentPaid),
    s.currentPaid implies s.paidVersion==s.version,
    s.confirmed implies (s.pending and s.chain=="solana"),
    not(s.pending) implies s.rotationAt==0,
    s.chain=="evm" implies s.rotationDelay==0}
  action reachCap=bind.then(veto(true,false)).then(bind).then(veto(true,false)).then(bind).then(veto(true,false)).then(bind)
  run cappedBeforeFirstPaymentTest=evm.then(reachCap).then(veto(true,false).fail())
  run evmPendingWaivesWithoutCountingTest=evm.then(reachCap).then(proposeRotation).then(veto(true,false))
    .expect(s.count==3).then(cancelRotation).then(bind).then(veto(true,false).fail())
  run solanaProposalAloneDoesNotWaiveTest=solana.then(reachCap).then(proposeRotation).then(veto(true,false).fail())
  run solanaConfirmedWaivesUntilExecutionTest=solana.then(reachCap).then(proposeRotation).then(confirmRotation)
    .then(veto(true,false)).expect(s.count==3).then(tick).then(executeRotation).then(bind).then(veto(true,false).fail())
  run solanaConfirmedRotationStillWaitsTest=solana.then(proposeRotation).then(confirmRotation)
    .then(executeRotation.fail())
  run solanaConfirmedRotationExecutesAfterWaitTest=solana.then(proposeRotation).then(confirmRotation)
    .then(tick).then(executeRotation)
    .expect(not(s.pending) and not(s.confirmed) and s.rotationAt==0)
  run solanaRotationWithoutConfirmationRefusedTest=solana.then(proposeRotation).then(tick).then(executeRotation.fail())
  run solanaConfirmationReplayRefusedTest=solana.then(proposeRotation).then(confirmRotation).then(confirmRotation.fail())
  run solanaCancelledRotationResetsClockTest=solana.then(proposeRotation).then(confirmRotation).then(cancelRotation)
    .expect(not(s.pending) and not(s.confirmed) and s.rotationAt==0).then(tick).then(proposeRotation)
    .expect(s.rotationAt==2 and not(s.confirmed)).then(confirmRotation).then(executeRotation.fail())
  run solanaZeroDelayStillNeedsConfirmationTest=solanaZeroRotation.then(proposeRotation)
    .then(executeRotation.fail())
  run solanaZeroDelayConfirmedExecutionTest=solanaZeroRotation.then(proposeRotation)
    .then(confirmRotation).then(executeRotation)
  run evmConfirmationRefusedTest=evm.then(proposeRotation).then(confirmRotation.fail())
  run evmRotationExecutesWithoutConfirmationTest=evm.then(proposeRotation).then(executeRotation)
    .expect(s.now==0 and not(s.pending) and s.rotationAt==0)
  run paymentResetsBudgetTest=evm.then(reachCap).then(commit).then(tick).then(pay(4)).then(bind).then(veto(true,false))
    .expect(s.paidVersion==4 and s.count==1 and invariant)
  run paidBindingCannotBeVetoedTest=evm.then(bind).then(commit).then(tick).then(pay(1)).then(commit).then(veto(true,true).fail())
  run cancelledBindingCannotPayTest=evm.then(bind).then(commit).then(veto(true,false)).then(tick).then(pay(1).fail())
  run zeroDelayHasNoVetoWindowTest=zeroDelay.then(bind).then(commit).then(veto(true,true).fail())
  run oldBindingCanUseNewAwardWindowTest=solana.then(bind).then(tick).then(commit).then(veto(true,true)).expect(s.count==1)
  run solanaRequiresNamedUnpaidAwardTest=solana.then(bind).then(tick).then(commit).then(veto(true,false).fail())
  run nonOwnerCannotVetoTest=evm.then(bind).then(veto(false,true).fail())
  run duplicateVetoCannotConsumeBudgetTest=evm.then(bind).then(veto(true,false)).then(veto(true,false).fail())
}
