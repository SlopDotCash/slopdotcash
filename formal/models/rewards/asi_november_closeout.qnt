// @source .github/workflows/asi-november-closeout.yml
// @source backend/payments/monthly.ts
// @source migrations/0143_asi_november_closeout.sql
// @source scripts/guarded-monthly-import.ts
// @source scripts/prepare-asi-november-closeout.ts
// @source scripts/run-asi-november-closeout.ts
// @source scripts/prepare-monthly-rewards.ts
// @source src/OwnerAwards.tsx
// @source src/lib/payments/asi-november-closeout.ts
// @source src/lib/payments/escrow-cycle.ts
// @evidence scripts/prepare-asi-november-closeout.test.ts
// Time represents before the approved earning cutoff, after that cutoff,
// after calendar close, or after the ordinary automatic admission window.
// Bytes, amounts, identity and DB atomicity are checked in the source test.
module asi_november_closeout {
  type S = { scope: bool, verified: bool, phase: int, base: int, previewed: bool,
    frozen: bool, ownerSigned: bool, admitted: bool }
  var s: S

  pure def initial(scope: bool, verified: bool): S =
    { scope: scope, verified: verified, phase: 0, base: 0, previewed: false,
      frozen: false, ownerSigned: false, admitted: false }
  action init = all {
    nondet scope = Bool.oneOf()
    nondet verified = Bool.oneOf()
    s' = initial(scope, verified)
  }
  action initApproved = s' = initial(true, true)
  action advance = all { s.phase < 3, s' = s.with("phase", s.phase + 1) }
  action previewCloseout = all {
    s.scope, s.verified, s.phase >= 1, s.base == 0,
    s' = s.with("previewed", true)
  }
  action importCloseout = all {
    s.previewed, s.scope, s.verified, s.phase >= 1, s.base == 0,
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
  val closeoutMonthVisible = s.scope and s.phase >= 1
  val proposalEditable = s.base == 2 and not(s.frozen)
  action step = any {
    advance, previewCloseout, importCloseout, importOrdinary, ownerFinalize, automaticFinalize,
    ownerReserve, automaticAdmit, s' = s
  }

  val invariant = all {
    s.base == 1 implies (s.previewed and s.scope and s.verified and s.phase >= 1),
    s.base == 2 implies s.phase >= 2,
    s.base == 1 implies (closeoutMonthVisible and not(proposalEditable)),
    s.frozen implies s.base != 0,
    (s.frozen and s.phase < 2) implies s.base == 1,
    s.ownerSigned implies s.frozen,
    s.admitted implies (s.frozen and s.phase >= 3),
  }

  run ownerEarlyCloseTest = initApproved.then(advance)
    .then(previewCloseout).then(importCloseout).then(ownerFinalize).then(ownerReserve)
    .expect(s.ownerSigned and s.phase == 1 and closeoutMonthVisible and invariant)
  run ordinaryCalendarTest = init.then(advance).then(advance)
    .then(importOrdinary).then(advance).then(automaticFinalize).then(automaticAdmit)
    .expect(s.admitted and s.base == 2 and invariant)
}
