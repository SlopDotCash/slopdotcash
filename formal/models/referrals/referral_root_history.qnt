// @source contracts/evm/src/ReferralDistributor.sol
// @evidence contracts/evm/test/ReferralControlRegression.t.sol
// Five epochs, total representatives1..5, cap2, clock1..7, spacing1.
// The first root is normalized to total2 at time1; later totals remain1..5.
// Caller authority, token funding and Merkle verification are in other models.
module referral_root_history {
  type Epoch={total:int,posted:int,voided:bool,priorMax:int}
  var s:{epochs:List[Epoch],now:int,highWater:int,lastLive:int,sealed:bool}
  action init=s'={epochs:List(),now:1,highWater:0,lastLive:0,sealed:false}
  val live=s.epochs.indices().filter(i=>not(s.epochs[i].voided))
  val actualMax=live.fold(0,(best,i)=>if(s.epochs[i].total>best)s.epochs[i].total else best)
  val actualLast=live.fold(0,(last,i)=>if(s.epochs[i].posted>last)s.epochs[i].posted else last)
  action tick=all{s.epochs.length()>0,s.now<7,s'=s.with("now",s.now+1)}
  action post(total:int):bool=all{s.epochs.length()<5,total>=1,total<=5,total<=s.highWater+2,
    s.epochs.length()>0 or total==2,
    s.lastLive==0 or s.now>=s.lastLive+1,
    s'=s.with("epochs",s.epochs.append({total:total,posted:s.now,voided:false,priorMax:s.highWater}))
      .with("lastLive",s.now).with("highWater",if(total>s.highWater)total else s.highWater).with("sealed",false)}
  action void=all{s.epochs.length()>0,not(s.epochs[s.epochs.length()-1].voided),not(s.sealed),
    val last=s.epochs.length()-1
    val previousLive=live.exclude(Set(last))
    s'=s.with("epochs",s.epochs.replaceAt(last,s.epochs[last].with("voided",true)))
      .with("highWater",s.epochs[last].priorMax)
      .with("lastLive",previousLive.fold(0,(lastTime,i)=>if(s.epochs[i].posted>lastTime)s.epochs[i].posted else lastTime))}
  action claim=all{live.size()>0,s'=s.with("sealed",true)}
  action step={nondet total=oneOf(Set(1,2,3,4,5)) any{tick,post(total),void,claim,s'=s}}
  val invariant=all{s.highWater==actualMax,s.lastLive==actualLast,s.epochs.length()<=5,
    s.epochs.indices().forall(i=>s.epochs[i].priorMax>=0 and s.epochs[i].priorMax<=5)}
  run olderHighSurvivesLowerEpochsTest=init.then(post(2)).then(tick).then(post(4)).then(tick).then(post(2))
    .then(tick).then(post(3)).then(void).expect(s.highWater==4 and s.lastLive==3 and invariant)
  run repeatedVoidPreservesHighTest=init.then(post(2)).then(tick).then(post(4)).then(tick).then(post(2))
    .then(tick).then(post(5)).then(void).then(post(3)).then(void).expect(s.highWater==4 and s.lastLive==3 and invariant)
  run voidFirstRestoresEmptyMarksTest=init.then(post(2)).then(void).expect(s.highWater==0 and s.lastLive==0)
  run sealedLatestCannotVoidTest=init.then(post(2)).then(claim).then(void.fail())
  run spacingFollowsLatestLiveTimeTest=init.then(post(2)).then(post(3).fail())
}
