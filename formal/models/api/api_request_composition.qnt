// @source backend/http.ts
// @source backend/pages.ts
// @source functions/api/v1/[[path]].ts
// @source backend/slopbot/value-import.ts
// Request-local config and actor checks. Malformed payment configuration
// must fail payment operations without preventing independent signout/read.
module api_request_composition {
  var s: { paymentValid: bool, actor: int, expected: int, bodyValid: bool,
    route: str, admin: bool, status: str, mutation: bool }
  action init = s' = {paymentValid: false, actor: 1, expected: 1, bodyValid: true,
    route: "none", admin: false, status: "idle", mutation: false}
  action request(route: str): bool = all { s.status == "idle", s' = s.with("route", route) }
  action switchActor = all { s.status == "idle", s' = s.with("actor", 2) }
  action invalidateWrite = all { s.status == "idle", s' = s.with("bodyValid", false) }
  action grantAdmin = s' = s.with("admin", true)
  action validPaymentConfig = all { s.status == "idle", s' = s.with("paymentValid", true) }
  action execute = all { s.status == "idle", s.route != "none",
    val authorized = s.actor == s.expected and (s.route != "import" or s.admin)
    val available = s.route != "payment" or s.paymentValid
    val valid = s.route == "read" or s.bodyValid
    s' = s.with("status", if (not(authorized)) "denied" else if (not(valid)) "invalid" else if (not(available)) "unavailable" else "ok")
      .with("mutation", authorized and valid and available and s.route != "read") }
  action step = { nondet route = Set("read", "signout", "payment", "import").oneOf()
    any { request(route), switchActor, invalidateWrite, grantAdmin, validPaymentConfig, execute, s' = s } }
  val invariant = all { s.status == "ok" implies s.actor == s.expected,
    s.mutation and s.route == "payment" implies s.paymentValid,
    s.mutation and s.route == "import" implies s.admin }
  run brokenPaymentAllowsSignoutTest = init.then(request("signout")).then(execute)
    .expect(s.status == "ok" and s.mutation and not(s.paymentValid))
  run brokenPaymentCannotPayTest = init.then(request("payment")).then(execute)
    .expect(s.status == "unavailable" and not(s.mutation))
  run changedActorCannotReadTest = init.then(request("read")).then(switchActor).then(execute)
    .expect(s.status == "denied")
}
