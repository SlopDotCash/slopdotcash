// @source migrations/0016_binding_authorizations.sql
// @source backend/payments/handler.ts
// @source workers/payment-executor/core.ts
// @source workers/payment-executor/binding-shared.ts
// Store an immutable row per version/expiry. The API refuses short and overly
// long consent; execution chooses latest usable expiry for the current version.
// Time units abstract the 600-second submission margin and 90-day lifetime.
module binding_consent_renewal {
  type S = { now: int, version: int, rows: Set[int] }
  var s: S
  action init = s' = { now: 0, version: 0, rows: Set() }
  action authorize(version: int, expiry: int): bool = all {
    expiry > s.now + 1, expiry <= s.now + 3,
    s' = s.with("rows", s.rows.union(Set(version * 10 + expiry))) }
  val usable = s.rows.filter(row => row / 10 == s.version and row % 10 > s.now + 1)
  val selected = usable.fold(0, (prior, row) => if(row % 10 > prior) row % 10 else prior)
  action tick = all { s.now < 3, s' = s.with("now", s.now + 1) }
  action bind = all { s.version < 1, usable.size() > 0, s' = s.with("version", s.version + 1) }
  action choices = { nondet version = Set(0, 1).oneOf() nondet expiry = 1.to(5).oneOf() authorize(version, expiry) }
  action step = any { choices, tick, bind, s' = s }
  val invariant = all { selected == 0 or selected > s.now + 1,
    s.rows.forall(row => row >= 2 and row <= 15) }
  run renewalDoesNotEditOldConsentTest = init.then(authorize(0, 2)).then(tick)
    .expect(selected == 0).then(authorize(0, 4)).expect(s.rows == Set(2, 4) and selected == 4 and invariant)
  run latestExpirySelectedTest = init.then(authorize(0, 2)).then(authorize(0, 3)).expect(selected == 3 and invariant)
  run expiredConsentCannotBindTest = init.then(authorize(0, 2)).then(tick).then(bind.fail())
  run versionSeparatesConsentTest = init.then(authorize(0, 3)).then(bind).expect(selected == 0 and s.rows == Set(3) and invariant)
}
