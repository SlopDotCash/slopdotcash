// @source workers/slopbot/reporting-readiness.ts
// @source workers/slopbot/reporting-readiness-service.ts
// @source backend/security/reporting-readiness.ts
// @source migrations/0086_repository_reporting_status.sql
module api_reporting_readiness {
  var s: {target: int, observed: int, now: int, observedAt: int, enabled: bool, lastAnswer: str}
  action init = s' = {target: 1, observed: 0, now: 0, observedAt: 0, enabled: false, lastAnswer: "unknown"}
  action observe(isEnabled: bool): bool = s' = s.with("observed", s.target).with("observedAt", s.now).with("enabled", isEnabled).with("lastAnswer", "unknown")
  action revision = all { s.target == 1, s' = s.with("target", 2).with("lastAnswer", "unknown") }
  action tick = all { s.now < 4, s' = s.with("now", s.now + 1).with("lastAnswer", "unknown") }
  val fresh = s.observed == s.target and s.now - s.observedAt < 3
  action read = s' = s.with("lastAnswer", if (fresh) { if(s.enabled) "enabled" else "disabled" } else "unknown")
  action outage = s' = s.with("lastAnswer", "unavailable")
  action step = any { observe(true), observe(false), revision, tick, read, outage, s' = s }
  val invariant = Set("enabled","disabled").contains(s.lastAnswer) implies fresh
  run identityChangeTest = init.then(observe(true)).then(revision).then(read).expect(s.lastAnswer == "unknown")
  run disabledIsNotUnavailableTest = init.then(observe(false)).then(read).expect(s.lastAnswer == "disabled").then(outage).expect(s.lastAnswer == "unavailable")
}
