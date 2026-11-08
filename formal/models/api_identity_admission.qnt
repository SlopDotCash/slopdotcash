// @source workers/identity/rate-limit.ts
// @source workers/identity/index.ts
// @source migrations/0004_identity_rate_limits.sql
module api_identity_admission {
  var s: {now: int, expiry: int, count: int, accepted: int, storageAvailable: bool}
  action init = s' = {now: 0, expiry: 3, count: 0, accepted: 0, storageAvailable: true}
  action request = all { s.storageAvailable, s.count < 4,
    s' = if(s.now >= s.expiry) s.with("expiry", s.now + 3).with("count", 1).with("accepted", 1)
      else s.with("count", s.count + 1).with("accepted", if(s.count < 2) s.accepted + 1 else s.accepted) }
  action tick = all { s.now < 5, s' = s.with("now", s.now + 1) }
  action outage = s' = s.with("storageAvailable", false)
  action recover = s' = s.with("storageAvailable", true)
  action step = any { request, tick, outage, recover, s' = s }
  val invariant = all { s.accepted <= 2, s.accepted <= s.count }
  run fixedWindowTest = init.then(request).then(request).then(request).expect(s.accepted == 2)
    .then(tick).then(tick).then(tick).then(request).expect(s.accepted == 1)
  run failedClosedTest = init.then(outage).expect(s.accepted == 0)
}
