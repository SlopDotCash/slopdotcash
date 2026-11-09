// @source backend/payments/monthly-reserve-release.ts
// @source workers/payment-executor/monthly-release.ts
// @source contracts/evm/monthly-reserve.ts
// @source contracts/solana/monthly-reserve.ts
// Service policy for exceptional whole untouched wrong-sum reserve release.
module monthly_release {
  type S = { owner: bool, fresh: bool, rootMatches: bool, wrongTotal: bool,
    untouched: bool, signed: bool, released: bool, pending: int, free: int }
  var s: S
  action init = s' = { owner: false, fresh: false, rootMatches: false, wrongTotal: false,
    untouched: true, signed: false, released: false, pending: 4, free: 0 }
  action inspect(owner: bool, fresh: bool, root: bool, wrong: bool): bool = all { not(s.signed),
    s' = s.with("owner", owner).with("fresh", fresh).with("rootMatches", root).with("wrongTotal", wrong) }
  action materialize = all { not(s.signed), s' = s.with("untouched", false).with("pending", 2) }
  action authorize = all { s.owner, s.fresh, s.rootMatches, s.wrongTotal, s.untouched, not(s.released),
    s' = s.with("signed", true) }
  action release = all { s.signed, not(s.released), s.untouched,
    s' = s.with("released", true).with("free", s.pending).with("pending", 0) }
  action inspectAny = { nondet owner = Set(true,false).oneOf()
    nondet fresh = Set(true,false).oneOf()
    nondet root = Set(true,false).oneOf()
    nondet wrong = Set(true,false).oneOf()
    inspect(owner,fresh,root,wrong) }
  action step = any { inspectAny, materialize, authorize, release, s' = s }
  val invariant = s.released implies all { s.owner, s.fresh, s.rootMatches, s.wrongTotal, s.untouched, s.free == 4, s.pending == 0 }
  run wrongTotalReleaseTest = init.then(inspect(true,true,true,true)).then(authorize).then(release).expect(invariant)
  run healthyRefusedTest = init.then(inspect(true,true,true,false)).then(authorize.fail())
  run touchedRefusedTest = init.then(inspect(true,true,true,true)).then(materialize).then(authorize.fail())
}
