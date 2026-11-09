// @source migrations/0008_points.sql
// @source migrations/0063_account_closure_notification_events.sql
// @source migrations/0056_points_telegram.sql
// @source backend/points/handler.ts
// @source backend/identity-assertion.ts
module api_accounts {
  var s: {member: str, sessions: Set[int], visible: bool, xLinked: bool, reservedX: bool, consent: bool, obligation: int}
  action init = s' = {member: "absent", sessions: Set(), visible: false, xLinked: false, reservedX: false, consent: false, obligation: 1}
  action join(reopen: bool): bool = all { s.member != "closed" or reopen,
    s' = s.with("member", "active").with("visible", true).with("sessions", s.sessions.union(Set(1))) }
  action otherSession = all { s.member == "active", s' = s.with("sessions", s.sessions.union(Set(2))) }
  action connectX = all { s.member == "active", s.sessions.size() > 0,
    s' = s.with("xLinked", true).with("reservedX", true) }
  action optIn = all { s.member == "active", s.sessions.size() > 0, s' = s.with("consent", true) }
  action revoke(id: int): bool = s' = s.with("sessions", s.sessions.exclude(Set(id)))
  action close = all { s.member == "active", s.sessions.size() > 0,
    s' = s.with("member", "closed").with("sessions", Set()).with("visible", false).with("xLinked", false).with("consent", false) }
  action step = any { join(false), join(true), otherSession, connectX, optIn, revoke(1), revoke(2), close, s' = s }
  val invariant = all { s.member == "closed" implies (s.sessions == Set() and not(s.visible) and not(s.xLinked) and not(s.consent)),
    s.xLinked implies s.reservedX, s.obligation == 1, s.visible implies s.member == "active" }
  run closureTest = init.then(join(false)).then(otherSession).then(connectX).then(optIn).then(close)
    .expect(s.sessions == Set() and s.reservedX and s.obligation == 1)
  run reopenTest = init.then(join(false)).then(close).then(join(true)).expect(s.visible and not(s.xLinked))
  run currentSignoutTest = init.then(join(false)).then(otherSession).then(revoke(1)).expect(s.sessions == Set(2))
}
