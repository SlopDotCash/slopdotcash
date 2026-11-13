// @source workers/payment-executor/bootstrap-workflow.mjs
// Workflow fixture verifies four generated empty attesters: all signing routes
// and accidental cron refuse without reading a signer/RPC or making an outbound call.
module inactive_attester {
  type S = { configured: bool, refusedRoutes: Set[int], cronRefused: bool,
    secretReads: int, outbound: int, success: bool }
  var s: S
  action init = s' = { configured: false, refusedRoutes: Set(), cronRefused: false, secretReads: 0, outbound: 0, success: false }
  action configure = s' = s.with("configured", true)
  action route(id: int): bool = all { s.configured, s' = s.with("refusedRoutes", s.refusedRoutes.union(Set(id))) }
  action cron = all { s.configured, s' = s.with("cronRefused", true) }
  action pass = all { s.refusedRoutes == 1.to(7), s.cronRefused, s' = s.with("success", true) }
  action step = { nondet id = 1.to(7).oneOf() any { configure,route(id),cron,pass,s'=s } }
  val invariant = all { s.secretReads == 0, s.outbound == 0, s.success implies s.refusedRoutes == 1.to(7) and s.cronRefused }
  run inactiveCronRefusedTest = init.then(configure).then(cron).expect(s.cronRefused and invariant)
  run incompleteQualificationRefusedTest = init.then(configure).then(route(1)).then(cron).then(pass.fail())
}
