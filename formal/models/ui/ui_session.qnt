// @source src/Points.tsx
// @source src/lib/project-api.ts
// @source src/lib/identity-flow.ts
// @source src/lib/local-signin.ts
// @source src/lib/login-return.ts
// Points.tsx; project-api.ts; identity-flow.ts. Actors and generations bounded to two.
module ui_session {
  var s: { phase: str, generation: int, acceptedGeneration: int, actor: int, mounted: bool, cancelled: bool, assertion: bool }
  action init = s' = { phase: "checking", generation: 1, acceptedGeneration: 0, actor: 0, mounted: true, cancelled: false, assertion: false }
  action anonymous = all { s.phase == "checking", s' = s.with("phase", "signed-out") }
  action validSession = all { s.phase == "checking", s.mounted, s' = s.with("phase", "signed-in").with("actor", 1).with("acceptedGeneration", s.generation) }
  action invalidResponse = all { s.phase == "checking", s' = s.with("phase", "error").with("actor", 0) }
  action start = all { s.phase == "signed-out", s' = s.with("phase", "authorizing").with("cancelled", false) }
  action pollPending = all { s.phase == "authorizing", not(s.cancelled), s' = s }
  action assertion = all { s.phase == "authorizing", not(s.cancelled), s' = s.with("phase", "joining").with("assertion", true) }
  action joined = all { s.phase == "joining", s.assertion, not(s.cancelled), s.mounted,
    s' = s.with("phase", "signed-in").with("actor", 1).with("acceptedGeneration", s.generation) }
  action cancel = s' = s.with("phase", "signed-out").with("actor", 0).with("assertion", false).with("cancelled", true)
  action recheck = all { s.generation == 1, s' = s.with("generation", 2).with("phase", "checking").with("actor", 0) }
  action oldCallback = all { s.generation == 2, s' = s }
  action unmount = s' = s.with("mounted", false)
  action step = any { anonymous, validSession, invalidResponse, start, pollPending, assertion, joined, cancel, recheck, oldCallback, unmount, s' = s }
  val invariant = all { s.actor > 0 iff s.phase == "signed-in", s.actor > 0 implies s.acceptedGeneration == s.generation }
  run signInTest = init.then(anonymous).then(start).then(pollPending).then(assertion).then(joined).expect(s.actor == 1)
  run invalidTest = init.then(invalidResponse).expect(s.phase == "error" and s.actor == 0)
  run cancelTest = init.then(anonymous).then(start).then(cancel).expect(s.actor == 0 and not(s.assertion))
  run recheckTest = init.then(validSession).then(recheck).then(oldCallback).expect(s.actor == 0)
}
