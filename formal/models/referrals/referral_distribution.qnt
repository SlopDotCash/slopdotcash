// @source migrations/0087_referral_root_posts.sql
// @source contracts/evm/src/ReferralDistributor.sol
// @source workers/referral-accrual/poster.ts
// @source backend/referrals/claims.ts
// @source backend/referrals/cache.ts
// One active root, one claimant, totals <=4. Root can be voided only before claim.
module referral_distribution {
  type S = { total: int, claimed: int, previous: int, root: bool, sealed: bool,
    paused: bool, epochs: int, balance: int, voided: bool }
  var s: S
  action init = s' = { total: 0, claimed: 0, previous: 0, root: false, sealed: false,
    paused: false, epochs: 0, balance: 4, voided: false }
  action post(total: int): bool = all { not(s.paused), s.epochs < 2, total >= s.claimed,
    total <= s.balance + s.claimed, total <= s.total + 2,
    s' = s.with("previous", s.total).with("total", total).with("root", true)
      .with("sealed", false).with("voided", false).with("epochs", s.epochs + 1) }
  action claim(cumulative: int): bool = all { not(s.paused), s.root,
    cumulative > s.claimed, cumulative <= s.total,
    s' = s.with("balance", s.balance - (cumulative - s.claimed)).with("claimed", cumulative).with("sealed", true) }
  action voidRoot = all { s.root, not(s.sealed), not(s.voided),
    s' = s.with("root", s.previous > 0).with("total", s.previous).with("voided", true) }
  action pause = s' = s.with("paused", true)
  action unpause = s' = s.with("paused", false)
  action step = any { post(1), post(2), post(3), post(4), claim(1), claim(2), claim(3), claim(4), voidRoot, pause, unpause, s' = s }
  val invariant = all { s.claimed >= 0, s.balance >= 0, s.claimed + s.balance == 4,
    s.sealed implies s.claimed > 0 }
  run sealedRootTest = init.then(post(2)).then(claim(1)).then(voidRoot.fail())
  run cumulativeNotRepeatedTest = init.then(post(2)).then(claim(1)).then(claim(1).fail())
  run pausedClaimTest = init.then(post(2)).then(pause).then(claim(1).fail())
  run immediateClaimTest = init.then(post(2)).then(claim(2)).expect(s.claimed == 2 and invariant)
}
