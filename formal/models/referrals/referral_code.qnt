// @source migrations/0124_referral_codes.sql
// @source backend/referrals/codes.ts
// @source src/lib/referral-code.ts
// @evidence backend/referrals/codes.test.ts
// Custom referral codes: two accounts, three names and a limit of two names an
// account (the handler allows five). owner 0 means nobody holds the name;
// used 0 means the account has no name in use. GitHub is an input: the
// account whose login the name is, 0 for none. An unanswered GitHub lookup
// refuses the request and is the same unchanged state as any other refusal.
// A name is recorded, retired and put in use in one database transaction, so
// each accepted request is one step. Syntax, case folding, the reserved list
// and the closed-account join of the link are predicates of the handler.
module referral_code {
  type S = { owner: int -> int, first: int -> int, used: int -> int }
  val accounts = Set(1, 2)
  val names = Set(1, 2, 3)
  val limit = 2
  var s: S
  action init = s' = { owner: names.mapBy(_ => 0), first: names.mapBy(_ => 0),
    used: accounts.mapBy(_ => 0) }
  def held(a: int): int = names.filter(n => s.owner.get(n) == a).size()
  def accepted(a: int, n: int, reserved: bool, team: bool, github: int): bool = and {
    not(reserved), not(team),
    or { s.owner.get(n) == a,
      and { s.owner.get(n) == 0, github == 0 or github == a, held(a) < limit } } }
  action choose(a: int, n: int, reserved: bool, team: bool, github: int): bool = all {
    accounts.contains(a), names.contains(n), accepted(a, n, reserved, team, github),
    s' = { owner: s.owner.set(n, a),
      first: if (s.first.get(n) == 0) s.first.set(n, a) else s.first,
      used: s.used.set(a, n) } }
  action refuse(a: int, n: int, reserved: bool, team: bool, github: int): bool = all {
    accounts.contains(a), names.contains(n), not(accepted(a, n, reserved, team, github)),
    s' = s }
  // The account a link forwards for; 0 forwards to the form without a referrer.
  def forwards(n: int): int = {
    val a = s.owner.get(n)
    if (a != 0 and s.used.get(a) == n) a else 0
  }
  action step = any {
    { nondet a = accounts.oneOf()
      nondet n = names.oneOf()
      nondet reserved = Set(false, true).oneOf()
      nondet team = Set(false, true).oneOf()
      nondet github = Set(0, 1, 2).oneOf()
      choose(a, n, reserved, team, github) },
    { nondet a = accounts.oneOf()
      nondet n = names.oneOf()
      nondet reserved = Set(false, true).oneOf()
      nondet team = Set(false, true).oneOf()
      nondet github = Set(0, 1, 2).oneOf()
      refuse(a, n, reserved, team, github) } }
  val invariant = and {
    // A name never changes account, in use or replaced.
    names.forall(n => s.owner.get(n) == s.first.get(n)),
    // The name in use is the account's own, and no account exceeds its limit.
    accounts.forall(a => if (s.used.get(a) == 0) true else s.owner.get(s.used.get(a)) == a),
    accounts.forall(a => held(a) <= limit),
    // A link forwards for at most the one account that has it in use.
    names.forall(n => if (forwards(n) == 0) true else s.used.get(forwards(n)) == n) }
  run replacedNameStaysWithItsAccountTest = init
    .then(choose(1, 1, false, false, 0)).expect(forwards(1) == 1)
    .then(choose(1, 2, false, false, 0)).expect(forwards(1) == 0 and forwards(2) == 1)
    .then(choose(1, 1, false, false, 0)).expect(forwards(1) == 1 and forwards(2) == 0)
    .expect(invariant)
  run otherAccountCannotTakeAReplacedNameTest = init
    .then(choose(1, 1, false, false, 0)).then(choose(1, 2, false, false, 0))
    .then(choose(2, 1, false, false, 0).fail())
  run reservedNameRefusedTest = init.then(choose(1, 1, true, false, 0).fail())
  run teamAccountRefusedTest = init.then(choose(1, 1, false, true, 0).fail())
  run anotherGithubLoginRefusedTest = init.then(choose(1, 1, false, false, 2).fail())
  run refusedNameChangesNothingTest = init
    .then(refuse(1, 1, false, false, 2)).expect(forwards(1) == 0 and held(1) == 0)
    .then(choose(1, 1, false, false, 1)).expect(forwards(1) == 1)
  run limitRefusesANewNameTest = init
    .then(choose(1, 1, false, false, 0)).then(choose(1, 2, false, false, 0))
    .then(choose(1, 3, false, false, 0).fail())
  run limitStillAllowsAReturnTest = init
    .then(choose(1, 1, false, false, 0)).then(choose(1, 2, false, false, 0))
    .then(refuse(1, 3, false, false, 0)).expect(forwards(2) == 1)
    .then(choose(2, 3, false, false, 0)).expect(forwards(3) == 2)
    .then(choose(1, 1, false, false, 0)).expect(forwards(1) == 1 and forwards(2) == 0)
}
