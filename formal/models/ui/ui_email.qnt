// @source src/InboxEmail.tsx
// Account-bound preferences, pending enrollment, explicit verification/unsubscribe link consumption.
module ui_email {
  var s: { actor: int, viewedActor: int, phase: str, deliveryVerified: bool, enabled: bool, pending: bool, token: bool, consumed: bool }
  action init = s' = { actor: 1, viewedActor: 1, phase: "ready", deliveryVerified: false, enabled: false, pending: false, token: false, consumed: false }
  action beginEnrollment = all { s.actor == s.viewedActor, s.phase == "ready", s' = s.with("pending", true).with("token", true).with("consumed", false) }
  action verifyLink = all { s.actor == s.viewedActor, s.token, not(s.consumed), s' = s.with("deliveryVerified", true).with("pending", false).with("consumed", true) }
  action enable = all { s.actor == s.viewedActor, s.deliveryVerified, s' = s.with("enabled", true) }
  action unsubscribe = s' = s.with("enabled", false)
  action actorChange = s' = s.with("actor", 2).with("phase", "checking").with("token", false).with("pending", false).with("enabled", false)
  action unavailable = s' = s.with("phase", "error")
  action step = any { beginEnrollment, verifyLink, enable, unsubscribe, actorChange, unavailable, s' = s }
  val invariant = all { s.enabled implies s.deliveryVerified, s.pending implies not(s.consumed) }
  run verifyTest = init.then(beginEnrollment).then(verifyLink).then(enable).expect(s.enabled)
  run accountChangeTest = init.then(beginEnrollment).then(actorChange).expect(not(s.token) and not(s.enabled))
  run unsubscribeTest = init.then(beginEnrollment).then(verifyLink).then(enable).then(unsubscribe).expect(not(s.enabled))
}
