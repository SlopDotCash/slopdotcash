// @source migrations/0147_repo_requests.sql
// @source backend/referrals/repo-requests.ts
// @source src/lib/repo-requests.ts
// @evidence backend/referrals/repo-requests.test.ts
// Requested repos: two accounts, two repositories, a limit of one active flag
// an account (the handler allows ten) and a flag life of two ticks (the
// handler uses 90 days). exp is the tick a flag stops counting, 0 for never
// flagged; wd marks a withdrawn flag. A flag counts while it is not withdrawn
// and exp is later than now. The request's facts are inputs: merged is the
// member's merged-work standing, team marks an administrator or moderator,
// github is 0 for a public, unforked, unarchived repository, 1 when GitHub
// did not answer and 2 for any refused fact; own marks the member's own
// repository. Each accepted request is one database statement, so it is one
// step; any refusal changes nothing. Syntax, case and the GitHub read are
// predicates of the handler. A repository listed on Slop later stays in the
// table but leaves the public board.
module repo_request {
  type S = { exp: (int, int) -> int, wd: (int, int) -> bool,
    merged: (int, int) -> bool, now: int, listed: int -> bool }
  val accounts = Set(1, 2)
  val repos = Set(1, 2)
  val limit = 1
  val life = 2
  val horizon = 4
  val pairs = tuples(accounts, repos)
  var s: S
  action init = s' = { exp: pairs.mapBy(_ => 0), wd: pairs.mapBy(_ => false),
    merged: pairs.mapBy(_ => false), now: 1, listed: repos.mapBy(_ => false) }
  def active(a: int, r: int): bool =
    not(s.wd.get((a, r))) and s.exp.get((a, r)) > s.now
  def held(a: int): int = repos.filter(r => active(a, r)).size()
  // The public count of a repository; a listed repository has no row.
  def board(r: int): int =
    if (s.listed.get(r)) 0 else accounts.filter(a => active(a, r)).size()
  def accepted(a: int, r: int, merged: bool, team: bool, github: int,
    own: bool): bool = and {
    merged, not(team), github == 0, not(s.listed.get(r)), not(own),
    active(a, r) or held(a) < limit }
  action flag(a: int, r: int, merged: bool, team: bool, github: int,
    own: bool): bool = all {
    accounts.contains(a), repos.contains(r),
    accepted(a, r, merged, team, github, own),
    s' = { ...s, exp: s.exp.set((a, r), s.now + life),
      wd: s.wd.set((a, r), false), merged: s.merged.set((a, r), merged) } }
  action refuse(a: int, r: int, merged: bool, team: bool, github: int,
    own: bool): bool = all {
    accounts.contains(a), repos.contains(r),
    not(accepted(a, r, merged, team, github, own)), s' = s }
  action withdraw(a: int, r: int): bool = all {
    accounts.contains(a), repos.contains(r), active(a, r),
    s' = { ...s, wd: s.wd.set((a, r), true) } }
  action tick = all { s.now < horizon, s' = { ...s, now: s.now + 1 } }
  action listRepo(r: int): bool = all {
    repos.contains(r), not(s.listed.get(r)),
    s' = { ...s, listed: s.listed.set(r, true) } }
  action step = any {
    { nondet a = accounts.oneOf()
      nondet r = repos.oneOf()
      nondet merged = Set(false, true).oneOf()
      nondet team = Set(false, true).oneOf()
      nondet github = Set(0, 1, 2).oneOf()
      nondet own = Set(false, true).oneOf()
      any { flag(a, r, merged, team, github, own),
        refuse(a, r, merged, team, github, own) } },
    { nondet a = accounts.oneOf()
      nondet r = repos.oneOf()
      withdraw(a, r) },
    tick,
    { nondet r = repos.oneOf()
      listRepo(r) } }
  val invariant = and {
    // No account exceeds its limit of active flags.
    accounts.forall(a => held(a) <= limit),
    // Every active flag came from an account with merged work.
    pairs.forall(p => active(p._1, p._2) implies s.merged.get(p)),
    // A flag never counts longer than its life from now.
    pairs.forall(p => s.exp.get(p) <= s.now + life),
    // The board counts only active flags and never shows a listed repository.
    repos.forall(r => board(r) <= accounts.size()),
    repos.forall(r => s.listed.get(r) implies board(r) == 0) }
  run flagCountsAndExpiresTest = init
    .then(flag(1, 1, true, false, 0, false)).expect(board(1) == 1)
    .then(flag(2, 1, true, false, 0, false)).expect(board(1) == 2)
    .then(tick).then(tick).expect(board(1) == 0 and held(1) == 0)
    .expect(invariant)
  run renewMovesTheExpiryTest = init
    .then(flag(1, 1, true, false, 0, false)).then(tick)
    .then(flag(1, 1, true, false, 0, false)).then(tick)
    .expect(board(1) == 1)
  run withdrawnFlagCanReturnTest = init
    .then(flag(1, 1, true, false, 0, false)).then(withdraw(1, 1))
    .expect(board(1) == 0)
    .then(flag(1, 1, true, false, 0, false)).expect(board(1) == 1)
  run withdrawnFlagCannotBeWithdrawnAgainTest = init
    .then(flag(1, 1, true, false, 0, false)).then(withdraw(1, 1))
    .then(withdraw(1, 1).fail())
  run limitRefusesASecondRepoTest = init
    .then(flag(1, 1, true, false, 0, false))
    .then(flag(1, 2, true, false, 0, false).fail())
  run limitStillAllowsARenewalTest = init
    .then(flag(1, 1, true, false, 0, false))
    .then(refuse(1, 2, true, false, 0, false)).expect(held(1) == 1)
    .then(flag(1, 1, true, false, 0, false)).expect(held(1) == 1)
  run noMergedWorkRefusedTest = init.then(flag(1, 1, false, false, 0, false).fail())
  run teamAccountRefusedTest = init.then(flag(1, 1, true, true, 0, false).fail())
  run githubDownStoresNothingTest = init
    .then(refuse(1, 1, true, false, 1, false)).expect(board(1) == 0 and held(1) == 0)
  run ownRepoRefusedTest = init.then(flag(1, 1, true, false, 0, true).fail())
  run listedRepoRefusedAndLeavesTheBoardTest = init
    .then(flag(1, 1, true, false, 0, false)).then(listRepo(1))
    .expect(board(1) == 0 and held(1) == 1)
    .then(flag(2, 1, true, false, 0, false).fail())
}
