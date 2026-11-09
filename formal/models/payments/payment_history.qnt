// @source backend/payments/public-records.ts
// @source backend/payments/direct-history.ts
// @source backend/payments/handler.ts
// Stable append boundary; private/closed-member records are excluded from ordinary public views.
module payment_history {
  type S={highest:int,through:int,cursor:int,seen:Set[int],started:bool,privateRecord:int}
  var s:S
  action init=s'={highest:2,through:0,cursor:0,seen:Set(),started:false,privateRecord:2}
  action start=all{not(s.started),s'=s.with("through",s.highest).with("started",true)}
  action appendRecord=all{s.highest<4,s'=s.with("highest",s.highest+1)}
  action page=all{s.started,s.cursor<s.through,
    s'=s.with("cursor",s.cursor+1).with("seen",if(s.cursor+1==s.privateRecord) s.seen else s.seen.union(Set(s.cursor+1)))}
  action step=any{start,appendRecord,page,s'=s}
  val invariant=all{s.cursor<=s.through,s.through<=s.highest,not(s.seen.contains(s.privateRecord)),s.seen.forall(id=>id<=s.through)}
  run appendDoesNotMoveReadBoundaryTest=init.then(start).then(appendRecord).then(page).then(page).expect(s.through==2 and s.seen==Set(1) and invariant)
  run freshReadFindsLaterTest=init.then(appendRecord).then(start).then(page).then(page).then(page).expect(s.seen==Set(1,3) and invariant)
}
