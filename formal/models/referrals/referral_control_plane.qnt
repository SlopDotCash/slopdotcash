// @source contracts/evm/src/ReferralDistributor.sol
// @evidence contracts/evm/test/ReferralDistributor.t.sol
// Three role identities, two posts, balance4 and ticks0..5. Rescue delay3 and
// the rescue delay3 abstract its immutable duration, not seconds. Root history
// and post-spacing restoration are modeled separately in referral_root_history.
// live means the newest appended epoch is not voided, not that every older root
// is absent. observeClaim represents a successful claim against that newest root.
module referral_control_plane {
  var s:{owner:int,pending:int,poster:int,paused:bool,tick:int,lastRoot:int,lastUnpause:int,posts:int,
    live:bool,claimed:bool,balance:int,rescued:int}
  action init=s'={owner:1,pending:0,poster:2,paused:false,tick:0,lastRoot:0,lastUnpause:0,posts:0,
    live:false,claimed:false,balance:4,rescued:0}
  action tick=all{s.tick<5,s'=s.with("tick",s.tick+1)}
  action setPoster(caller:int,candidate:int):bool=all{caller==s.owner,candidate>0,candidate!=s.owner,candidate!=s.pending,s'=s.with("poster",candidate)}
  action transferOwner(caller:int,candidate:int):bool=all{caller==s.owner,candidate!=s.poster,s'=s.with("pending",candidate)}
  action acceptOwner(caller:int):bool=all{caller>0,caller==s.pending,s'=s.with("owner",caller).with("pending",0)}
  action pause(caller:int):bool=all{caller==s.owner,not(s.paused),s'=s.with("paused",true)}
  action unpause(caller:int):bool=all{caller==s.owner,s.paused,s'=s.with("paused",false).with("lastUnpause",s.tick)}
  action post(caller:int):bool=all{caller==s.poster,not(s.paused),s.posts<2,s.balance>0,
    s'=s.with("posts",s.posts+1).with("lastRoot",s.tick).with("live",true).with("claimed",false)}
  action observeClaim=all{s.live,not(s.paused),s.balance>0,s'=s.with("claimed",true)}
  action void(caller:int):bool=all{caller==s.owner,s.live,not(s.claimed),s'=s.with("live",false)}
  val rescueAt=(if(s.lastRoot>s.lastUnpause)s.lastRoot else s.lastUnpause)+3
  action rescue(caller:int,validTarget:bool,transferSucceeds:bool):bool=all{caller==s.owner,not(s.paused),validTarget,s.tick>=rescueAt,
    s'=if(transferSucceeds)s.with("rescued",s.rescued+s.balance).with("balance",0) else s}
  action step={nondet caller=oneOf(Set(1,2,3)) nondet candidate=oneOf(Set(0,1,2,3))
    any{tick,setPoster(caller,candidate),transferOwner(caller,candidate),acceptOwner(caller),pause(caller),unpause(caller),post(caller),observeClaim,void(caller),rescue(caller,true,true),rescue(caller,true,false),rescue(caller,false,true),s'=s}}
  val invariant=all{s.owner>0,s.poster>0,s.owner!=s.poster,s.pending!=s.poster,
    s.balance>=0,s.rescued>=0,s.balance+s.rescued==4}
  run pendingOwnerCannotAlsoPostTest=init.then(transferOwner(1,3)).then(setPoster(1,3).fail())
  run cancelledOwnershipCannotBeAcceptedTest=init.then(transferOwner(1,3)).then(transferOwner(1,0)).then(acceptOwner(3).fail())
  run ownerAndPosterRemainSeparateTest=init.then(transferOwner(1,3)).then(acceptOwner(3)).then(setPoster(3,1)).expect(s.owner==3 and s.poster==1 and invariant)
  run voidDoesNotShortenRescueClockTest=init.then(tick).then(post(2)).then(void(1)).then(tick).then(tick).then(rescue(1,true,true).fail())
  run unpauseRestartsRescueClockTest=init.then(tick).then(tick).then(pause(1)).then(tick).then(unpause(1)).then(tick).then(tick).then(rescue(1,true,true).fail())
  run pausedRescueIsRefusedTest=init.then(tick).then(tick).then(tick).then(pause(1)).then(rescue(1,true,true).fail())
  run failedTokenTransferPreservesBalanceTest=init.then(tick).then(tick).then(tick).then(rescue(1,true,false)).expect(s.balance==4 and s.rescued==0)
  run rescueSweepsWithoutChangingRolesTest=init.then(tick).then(tick).then(tick).then(rescue(1,true,true)).expect(s.balance==0 and s.rescued==4 and invariant)
}
