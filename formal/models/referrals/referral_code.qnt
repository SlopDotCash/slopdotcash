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
// GitHub logins: login is the login each account has on GitHub now, 0 once
// the account is gone; cached is the login the member record stored at the
// last sign-in. An account may rename to a free login, and another account
// may then take the old one. The link forwards a login and capture resolves
// that login on GitHub, so the link reads the account's current login by its
// permanent id, never the cached one. An unanswered GitHub read answers 503
// and changes nothing.
module referral_code {
  type S = { owner: int -> int, first: int -> int, used: int -> int,
    login: int -> int, cached: int -> int }
  val accounts = Set(1, 2)
  val names = Set(1, 2, 3)
  val logins = Set(1, 2, 3)
  val limit = 2
  var s: S
  action init = s' = { owner: names.mapBy(_ => 0), first: names.mapBy(_ => 0),
    used: accounts.mapBy(_ => 0), login: accounts.mapBy(a => a),
    cached: accounts.mapBy(a => a) }
  def held(a: int): int = names.filter(n => s.owner.get(n) == a).size()
  def accepted(a: int, n: int, reserved: bool, team: bool, github: int): bool = and {
    not(reserved), not(team),
    or { s.owner.get(n) == a,
      and { s.owner.get(n) == 0, github == 0 or github == a, held(a) < limit } } }
  action choose(a: int, n: int, reserved: bool, team: bool, github: int): bool = all {
    accounts.contains(a), names.contains(n), accepted(a, n, reserved, team, github),
    s' = { ...s, owner: s.owner.set(n, a),
      first: if (s.first.get(n) == 0) s.first.set(n, a) else s.first,
      used: s.used.set(a, n) } }
  action refuse(a: int, n: int, reserved: bool, team: bool, github: int): bool = all {
    accounts.contains(a), names.contains(n), not(accepted(a, n, reserved, team, github)),
    s' = s }
  // GitHub renames and deletions, and sign-in refreshing the cached login.
  def free(l: int): bool = accounts.forall(b => s.login.get(b) != l)
  action rename(a: int, l: int): bool = all {
    accounts.contains(a), logins.contains(l), s.login.get(a) != 0, free(l),
    s' = { ...s, login: s.login.set(a, l) } }
  action leave(a: int): bool = all {
    accounts.contains(a), s.login.get(a) != 0,
    s' = { ...s, login: s.login.set(a, 0) } }
  action signIn(a: int): bool = all {
    accounts.contains(a), s.login.get(a) != 0,
    s' = { ...s, cached: s.cached.set(a, s.login.get(a)) } }
  // The account a link forwards for; 0 forwards to the form without a referrer.
  def forwards(n: int): int = {
    val a = s.owner.get(n)
    if (a != 0 and s.used.get(a) == n) a else 0
  }
  // The login the link puts in `ref`: the account's current GitHub login, read
  // by its id; 0 (no referrer) when nobody has the name in use or the account
  // is gone.
  def forwardedLogin(n: int): int =
    if (forwards(n) == 0) 0 else s.login.get(forwards(n))
  // The account capture records for a login: whoever holds it on GitHub now.
  def holder(l: int): int = accounts.fold(0, (h, a) => if (s.login.get(a) == l) a else h)
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
      refuse(a, n, reserved, team, github) },
    { nondet a = accounts.oneOf()
      nondet l = logins.oneOf()
      rename(a, l) },
    { nondet a = accounts.oneOf()
      leave(a) },
    { nondet a = accounts.oneOf()
      signIn(a) } }
  val invariant = and {
    // A name never changes account, in use or replaced.
    names.forall(n => s.owner.get(n) == s.first.get(n)),
    // The name in use is the account's own, and no account exceeds its limit.
    accounts.forall(a => if (s.used.get(a) == 0) true else s.owner.get(s.used.get(a)) == a),
    accounts.forall(a => held(a) <= limit),
    // A link forwards for at most the one account that has it in use.
    names.forall(n => if (forwards(n) == 0) true else s.used.get(forwards(n)) == n),
    // Capture records the account the link forwards for, or no referrer.
    names.forall(n => forwardedLogin(n) == 0 or holder(forwardedLogin(n)) == forwards(n)) }
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
  run renamedAccountLinkNamesItsCurrentLoginTest = init
    .then(choose(1, 1, false, false, 0)).expect(forwardedLogin(1) == 1)
    .then(rename(1, 3)).expect(forwardedLogin(1) == 3 and s.cached.get(1) == 1)
    .then(rename(2, 1)).expect(forwardedLogin(1) == 3 and holder(1) == 2 and holder(3) == 1)
    .expect(invariant)
  run goneAccountLinkForwardsWithoutReferrerTest = init
    .then(choose(1, 1, false, false, 0)).then(leave(1))
    .expect(forwards(1) == 1 and forwardedLogin(1) == 0)
    .then(signIn(1).fail())
}
