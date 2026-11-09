// @source skills/project-contributor-template/scripts/wallet-claim.mjs
// Planning never authenticates/writes. Explicit register authenticates once,
// reuses an identical claim or appends exactly the observed predecessor.
module contributor_wallet_cli {
  type S = { mode: str, authenticated: bool, current: int, requested: int, read: bool, writes: int, claimed: int, paid: bool }
  var s: S
  action init = s' = { mode:"plan",authenticated:false,current:0,requested:1,read:false,writes:0,claimed:0,paid:false }
  action register = s'=s.with("mode","register")
  action authenticate = all { s.mode=="register",s'=s.with("authenticated",true) }
  action current(id: int): bool = all { s.authenticated,not(s.read),s'=s.with("current",id).with("read",true) }
  action reuse = all { s.read,s.current==s.requested,s'=s.with("claimed",s.current) }
  action appendClaim(expected: int): bool = all { s.read,s.current!=s.requested,expected==s.current,s.writes==0,
    s'=s.with("writes",1).with("claimed",s.requested) }
  action step = any { register,authenticate,current(0),current(1),current(2),reuse,appendClaim(0),appendClaim(2),s'=s }
  val invariant = all { not(s.paid),s.writes<=1,s.writes>0 implies s.authenticated and s.mode=="register" }
  run planNoAuthenticationTest = init.then(authenticate.fail())
  run sameAddressNoWriteTest = init.then(register).then(authenticate).then(current(1)).then(reuse).expect(s.writes==0 and invariant)
  run successorNamesObservedTipTest = init.then(register).then(authenticate).then(current(2)).then(appendClaim(0).fail())
  run appendOnceTest = init.then(register).then(authenticate).then(current(2)).then(appendClaim(2)).expect(s.claimed==1 and invariant)
}
