// @source migrations/0009_points_social.sql
// @source backend/points/x.ts
module api_x_connection {
  var s: {phase: str, session: bool, verified: bool, reserved: bool, linked: bool, points: int}
  action init = s' = {phase: "absent", session: true, verified: false, reserved: false, linked: false, points: 0}
  action start = all { s.session, s' = s.with("phase", "pending") }
  action callback = all { s.session, s.phase == "pending", s' = s.with("phase", "processing") }
  action providerVerified = all { s.phase == "processing", s' = s.with("verified", true) }
  action link = all { s.session, s.phase == "processing", s.verified,
    s' = s.with("phase", "connected").with("reserved", true).with("linked", true) }
  action disconnect = all { s.session, s' = s.with("linked", false).with("phase", "absent") }
  action signout = s' = s.with("session", false)
  action step = any { start, callback, providerVerified, link, disconnect, signout, s' = s }
  val invariant = all { s.linked implies (s.reserved and s.verified), s.points == 0 }
  run reservationTest = init.then(start).then(callback).then(providerVerified).then(link).then(disconnect).expect(s.reserved and not(s.linked))
  run signoutRaceTest = init.then(start).then(callback).then(providerVerified).then(signout).expect(not(s.linked))
}
