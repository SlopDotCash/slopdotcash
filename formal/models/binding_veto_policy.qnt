// @source contracts/evm/src/ProjectEscrow.sol
// @source contracts/solana/programs/slop-escrow/src/lib.rs
// @evidence contracts/evm/test/BindingLifecycle.t.sol
// @evidence contracts/evm/test/BoundedAttester.t.sol
// @evidence contracts/solana/integration/escrow.e2e.mjs
// One actor/project, 8 binding versions, 2 awards, ticks0..3 and delay0 or1.
// Signature/account ownership and rotation authorization/finality are external
// predicates; this model covers only veto window/cap and payment interaction.
module binding_veto_policy {
  type S={chain:str,delay:int,now:int,version:int,boundAt:int,paidVersion:int,
    count:int,cancelled:Set[int],paid:Set[int],pending:bool,confirmed:bool,
    award:bool,awards:int,committedAt:int}
  def initial(chain:str,delay:int):S={chain:chain,delay:delay,now:0,version:0,boundAt:0,paidVersion:0,
    count:0,cancelled:Set(),paid:Set(),pending:false,confirmed:false,award:false,awards:0,committedAt:0}
  var s:S
  action init={nondet chain=oneOf(Set("evm","solana")) nondet delay=oneOf(Set(0,1)) s'=initial(chain,delay)}
  action evm=s'=initial("evm",1)
  action solana=s'=initial("solana",1)
  action zeroDelay=s'=initial("evm",0)
  action tick=all{s.now<3,s'=s.with("now",s.now+1)}
  action bind=all{s.version<8,s'=s.with("version",s.version+1).with("boundAt",s.now)}
  action commit=all{not(s.award),s.awards<2,s'=s.with("award",true).with("awards",s.awards+1).with("committedAt",s.now)}
  action proposeRotation=all{not(s.pending),s'=s.with("pending",true).with("confirmed",false)}
  action confirmRotation=all{s.pending,s'=s.with("confirmed",true)}
  action cancelRotation=all{s.pending,s'=s.with("pending",false).with("confirmed",false)}
  action executeRotation=all{s.pending,s.chain=="evm" or s.confirmed,s'=s.with("pending",false).with("confirmed",false)}
  val waiver=s.pending and (s.chain=="evm" or s.confirmed)
  def commitWindow(includeAward:bool):bool = s.now<s.committedAt+s.delay and
    (if(s.chain=="evm")s.awards>0 else includeAward and s.award)
  action veto(owner:bool,includeAward:bool):bool=all{owner,s.version>0,s.version!=s.paidVersion,
    not(s.cancelled.contains(s.version)),s.now<s.boundAt+s.delay or commitWindow(includeAward),
    waiver or s.count<3,
    s'=s.with("cancelled",s.cancelled.union(Set(s.version))).with("count",if(waiver)s.count else s.count+1)}
  action pay(expected:int):bool=all{s.award,s.version>0,expected==s.version,not(s.cancelled.contains(s.version)),
    s.now>=s.committedAt+s.delay,
    s'=s.with("paidVersion",s.version).with("paid",s.paid.union(Set(s.version))).with("count",0).with("award",false)}
  action step=any{tick,bind,commit,proposeRotation,confirmRotation,cancelRotation,executeRotation,
    veto(true,true),veto(true,false),veto(false,true),pay(s.version),pay(s.version-1),s'=s}
  val invariant=all{s.count>=0,s.count<=3,s.version<=8,s.awards<=2,
    s.paidVersion<=s.version,s.cancelled.intersect(s.paid)==Set(),
    s.confirmed implies s.pending}
  action reachCap=bind.then(veto(true,false)).then(bind).then(veto(true,false)).then(bind).then(veto(true,false)).then(bind)
  run cappedBeforeFirstPaymentTest=evm.then(reachCap).then(veto(true,false).fail())
  run evmPendingWaivesWithoutCountingTest=evm.then(reachCap).then(proposeRotation).then(veto(true,false))
    .expect(s.count==3).then(cancelRotation).then(bind).then(veto(true,false).fail())
  run solanaProposalAloneDoesNotWaiveTest=solana.then(reachCap).then(proposeRotation).then(veto(true,false).fail())
  run solanaConfirmedWaivesUntilExecutionTest=solana.then(reachCap).then(proposeRotation).then(confirmRotation)
    .then(veto(true,false)).expect(s.count==3).then(executeRotation).then(bind).then(veto(true,false).fail())
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
