// @source src/lib/use-time-boundary.ts
// @source src/lib/use-snapshot.ts
// @source src/ContributorAllocation.tsx
// @source src/OwnerAwards.tsx
// One mounted boundary. Its render may precede expiry while the passive effect
// starts after expiry. Effect and due-timer fairness are explicit for liveness.
module ui_time_boundary {
  var s: { expired: bool, installed: bool, armed: bool, renderedExpired: bool, ticks: int }
  action init = s' = {expired: false, installed: false, armed: false, renderedExpired: false, ticks: 0}
  action passDeadline = s' = s.with("expired", true)
  action installEffect = all { not(s.installed), s' = s.with("installed", true)
    .with("armed", not(s.expired)).with("renderedExpired", s.expired)
    .with("ticks", if (s.expired) 1 else 0) }
  action fireTimer = all { s.armed, s.expired, s' = s.with("armed", false)
    .with("renderedExpired", true).with("ticks", 1) }
  action unrelatedRender = s' = s
  action step = any { passDeadline, installEffect, fireTimer, unrelatedRender }
  val invariant = all { s.ticks <= 1, s.ticks >= 0,
    s.installed and s.expired and not(s.armed) implies s.renderedExpired }
  temporal boundaryEventuallyVisibleProperty = all {
    installEffect.weakFair(s), fireTimer.weakFair(s)
  }.implies(always(s.expired implies eventually(s.renderedExpired)))
  run normalTimerTest = init.then(installEffect).then(passDeadline).then(fireTimer).expect(s.renderedExpired and s.ticks == 1)
  run delayedEffectTest = init.then(passDeadline).then(installEffect).expect(s.renderedExpired and not(s.armed))
  run noRerenderLoopTest = init.then(passDeadline).then(installEffect).then(unrelatedRender).then(unrelatedRender).expect(s.ticks == 1)
}
