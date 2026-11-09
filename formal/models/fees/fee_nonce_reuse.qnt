// @source workers/fee-converter/core.ts
// @source workers/fee-converter/native-gas.ts
// @source workers/fee-converter/evm.ts
// @evidence workers/fee-converter/native-gas.test.ts
// Up to three different intents reuse one still-unused EVM nonce. A failed
// business intent keeps its native liability. Claims/approvals do not expire
// like swaps, and a spent nonce without a receipt identifies no winner.
module fee_nonce_reuse {
  var s: {clock:int,count:int,kinds:List[str],states:List[str],nonceUsed:bool,
    winner:int,settled:bool,held:int,spent:int}
  action init=s'={clock:0,count:0,kinds:["none","none","none"],states:["none","none","none"],
    nonceUsed:false,winner:0,settled:false,held:0,spent:0}
  action advance=all{s.clock<4,s'=s.with("clock",s.clock+1)}
  action admit(kind)=all{s.count<3,not(s.nonceUsed),s.states.indices().forall(i=>s.states.nth(i)!="open"),
    s'=s.with("kinds",s.kinds.replaceAt(s.count,kind)).with("states",s.states.replaceAt(s.count,"open"))
      .with("count",s.count+1).with("held",s.count+1)}
  action expire(index)=all{index<s.count,s.states.nth(index)=="open",s.kinds.nth(index)=="conversion",
    not(s.nonceUsed),s.clock>index+1,s'=s.with("states",s.states.replaceAt(index,"failed"))}
  action nonceAdvanced=all{s.count>0,s'=s.with("nonceUsed",true)}
  action receipt(index)=all{index<s.count,s.winner==0,
    s'=s.with("nonceUsed",true).with("winner",index+1).with("states",s.states.replaceAt(index,
      if(s.kinds.nth(index)=="conversion" and s.clock>index+1) "failed" else "finalized"))}
  action settle=all{s.winner>0,not(s.settled),s'=s.with("settled",true).with("held",0).with("spent",1)}
  action step={nondet kind=Set("conversion","approval","claim").oneOf() nondet index=Set(0,1,2).oneOf()
    any{advance,admit(kind),expire(index),nonceAdvanced,receipt(index),settle,s'=s}}
  val invariant=all{s.count<=3,s.held+s.spent<=3,
    s.settled implies(s.winner>0 and s.held==0),s.winner<=s.count,
    s.winner==0 and s.count>0 implies s.held==s.count}
  run expiredSwapCanYieldSameNonceToApprovalTest=init.then(admit("conversion")).then(advance).then(advance)
    .then(expire(0)).then(admit("approval")).expect(s.count==2 and s.held==2 and invariant)
  run approvalCannotExpireIntoAnotherIntentTest=init.then(admit("approval")).then(advance).then(advance)
    .then(expire(0).fail())
  run threeIntentsKeepOneNonceLiabilityTest=init.then(admit("conversion")).then(advance).then(advance).then(expire(0))
    .then(admit("conversion")).then(advance).then(expire(1)).then(admit("conversion"))
    .then(receipt(0)).then(settle).expect(s.count==3 and s.winner==1 and s.spent==1 and invariant)
  run nonceAdvancedWithoutReceiptStaysHeldTest=init.then(admit("conversion")).then(nonceAdvanced)
    .expect(s.states.nth(0)=="open" and s.held==1).then(settle.fail())
  run lateExpiredIntentCannotBecomeSuccessfulTest=init.then(admit("conversion")).then(advance).then(advance)
    .then(expire(0)).then(admit("approval")).then(receipt(0))
    .expect(s.states.nth(0)=="failed" and s.winner==1 and s.held==2 and invariant)
}
