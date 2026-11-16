// @source src/lib/points.ts
// @source src/lib/verified-aggregation.ts
// Safe-integer boundary abstracted to +/-5. Earned totals are checked before
// signed adjustments; final totals are checked after exact signed accumulation.
module points_total_precision {
  var s:{phase:str,total:int,monthly:int,credits:int,adjustments:int,published:bool}
  action init = s'={phase:"earned",total:0,monthly:0,credits:0,adjustments:0,published:false}
  action credit(amount,currentMonth) = all {s.phase=="earned",s.credits<2,
    s'=s.with("total",s.total+amount).with("credits",s.credits+1)
      .with("monthly",s.monthly+(if(currentMonth) amount else 0))}
  action beginAdjustments = all {s.phase=="earned",
    s'=s.with("phase",if(s.total>5) "refused" else "adjusting")}
  action adjust(amount,currentMonth) = all {s.phase=="adjusting",s.adjustments<2,
    s'=s.with("total",s.total+amount).with("adjustments",s.adjustments+1)
      .with("monthly",s.monthly+(if(currentMonth) amount else 0))}
  action finish = all {s.phase=="adjusting",
    s'=s.with("phase",if(s.total < -5 or s.total>5 or s.monthly < -5 or s.monthly>5) "refused" else "ready")}
  action publish = all {s.phase=="ready",s'=s.with("published",true)}
  action step = {nondet creditAmount=Set(1,2,3,4).oneOf()
    nondet signedAmount=Set(-4,-3,-2,-1,0,1,2,3,4).oneOf()
    nondet currentMonth=Set(false,true).oneOf()
    any {credit(creditAmount,currentMonth),beginAdjustments,adjust(signedAmount,currentMonth),finish,publish,s'=s}}
  val invariant = s.published implies (s.phase=="ready" and s.total>=-5 and s.total<=5 and s.monthly>=-5 and s.monthly<=5)
  run negativeOverflowRefusedTest = init.then(credit(1,true)).then(beginAdjustments)
    .then(adjust(-4,true)).then(adjust(-4,true)).then(finish).expect(s.phase=="refused" and not(s.published))
  run positiveEarnedOverflowRefusedBeforeAdjustmentTest = init.then(credit(3,false)).then(credit(3,false))
    .then(beginAdjustments).expect(s.phase=="refused")
  run exactBoundaryPublishesTest = init.then(credit(3,true)).then(beginAdjustments)
    .then(adjust(-4,true)).then(adjust(-4,true)).then(finish).then(publish).expect(s.total == -5 and invariant)
  run exactSignedCancellationTest = init.then(credit(1,true)).then(beginAdjustments)
    .then(adjust(-4,true)).then(adjust(4,true)).then(finish).then(publish).expect(s.total==1 and invariant)
  run unsafeMonthCannotHideBehindSafeLifetimeTest = init.then(credit(4,false)).then(beginAdjustments)
    .then(adjust(-4,true)).then(adjust(-3,true)).then(finish)
    .expect(s.total == -3 and s.monthly == -7 and s.phase=="refused")
}
