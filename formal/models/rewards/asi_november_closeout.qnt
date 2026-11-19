// @source backend/payments/monthly.ts
// @source migrations/0143_asi_november_closeout.sql
// @source scripts/guarded-monthly-import.ts
// @source scripts/prepare-asi-november-closeout.ts
// @source scripts/prepare-monthly-rewards.ts
// @source src/lib/payments/asi-november-closeout.ts
// @source src/lib/payments/escrow-cycle.ts
// @evidence scripts/prepare-asi-november-closeout.test.ts
// Time represents before the approved earning cutoff, after that cutoff,
// after calendar close, or after the ordinary automatic admission window.
// Bytes, amounts, identity and DB atomicity are checked in the source test.
module asi_november_closeout {
  type S = { scope: bool, verified: bool, phase: int, base: int,
    frozen: bool, ownerSigned: bool, admitted: bool }
  var s: S

  pure def initial(scope: bool, verified: bool): S =
    { scope: scope, verified: verified, phase: 0, base: 0,
      frozen: false, ownerSigned: false, admitted: false }
  action init = all {
    nondet scope = Bool.oneOf()
    nondet verified = Bool.oneOf()
    s' = initial(scope, verified)
  }
  action initApproved = s' = initial(true, true)
  action advance = all { s.phase < 3, s' = s.with("phase", s.phase + 1) }
  action importCloseout = all {
    s.scope, s.verified, s.phase >= 1, s.base == 0,
    s' = s.with("base", 1)
  }
  action importOrdinary = all { s.phase >= 2, s.base == 0, s' = s.with("base", 2) }
  action ownerFinalize = all {
    s.base != 0, not(s.frozen),
    s.phase >= 2 or (s.base == 1 and s.phase >= 1),
    s' = s.with("frozen", true)
  }
  action automaticFinalize = all {
    s.base != 0, s.phase >= 3, not(s.frozen), s' = s.with("frozen", true)
  }
  action ownerReserve = all {
    s.frozen, not(s.ownerSigned), not(s.admitted), s' = s.with("ownerSigned", true)
  }
  action automaticAdmit = all {
    s.frozen, s.phase >= 3, not(s.admitted), s' = s.with("admitted", true)
  }
  action step = any {
    advance, importCloseout, importOrdinary, ownerFinalize, automaticFinalize,
    ownerReserve, automaticAdmit, s' = s
  }

  val invariant = all {
    s.base == 1 implies (s.scope and s.verified and s.phase >= 1),
    s.base == 2 implies s.phase >= 2,
    s.frozen implies s.base != 0,
    (s.frozen and s.phase < 2) implies s.base == 1,
    s.ownerSigned implies s.frozen,
    s.admitted implies (s.frozen and s.phase >= 3),
  }

  run ownerEarlyCloseTest = initApproved.then(advance)
    .then(importCloseout).then(ownerFinalize).then(ownerReserve)
    .expect(s.ownerSigned and s.phase == 1 and invariant)
  run ordinaryCalendarTest = init.then(advance).then(advance)
    .then(importOrdinary).then(advance).then(automaticFinalize).then(automaticAdmit)
    .expect(s.admitted and s.base == 2 and invariant)
}
