// @source backend/vetting/handler.ts
// @source backend/http.ts
// @evidence scripts/vetting-api.test.ts
// One request, two authenticated actors and signed-out. -1 means an absent
// expected header, 0 malformed, 1/2 valid IDs. Service signature validity is
// an input; its cryptographic/time protocol remains vetting_service_auth.
module vetting_admin_actor {
  var s: { route: str, actor: int, expected: int, admin: bool,
    result: str, accessed: bool }
  action init = s' = { route: "none", actor: 0, expected: -1, admin: false,
    result: "none", accessed: false }
  action adminRequest(actor: int, expected: int, admin: bool): bool = all {
    s.route == "none", Set(0, 1, 2).contains(actor), Set(-1, 0, 1, 2).contains(expected),
    s' = s.with("route", "admin").with("actor", actor).with("expected", expected)
      .with("admin", admin).with("result", if (actor == 0) "unauthorized"
        else if (expected == 0) "invalid_expected_actor"
        else if (expected > 0 and expected != actor) "actor_changed"
        else if (not(admin)) "forbidden" else "admitted") }
  action serviceRequest(expected: int, signed: bool): bool = all { s.route == "none",
    Set(-1, 0, 1, 2).contains(expected),
    s' = s.with("route", "service").with("expected", expected)
      .with("result", if (signed) "admitted" else "invalid_signature") }
  action access = all { s.result == "admitted", s' = s.with("accessed", true) }
  action step = {
    nondet actor = Set(0, 1, 2).oneOf()
    nondet expected = Set(-1, 0, 1, 2).oneOf()
    nondet allowed = Set(false, true).oneOf()
    any { adminRequest(actor, expected, allowed), serviceRequest(expected, allowed), access, s' = s }
  }
  val invariant = all { s.accessed implies s.result == "admitted",
    s.accessed and s.route == "admin" implies s.actor > 0 and s.admin
      and (s.expected == -1 or s.expected == s.actor) }
  run matchingAdminTest = init.then(adminRequest(1, 1, true)).then(access).expect(s.accessed)
  run absentHeaderKeepsLegacyAdminTest = init.then(adminRequest(1, -1, true)).then(access).expect(s.accessed)
  run changedActorCannotReadOrWriteTest = init.then(adminRequest(2, 1, true))
    .expect(s.result == "actor_changed").then(access.fail())
  run malformedHeaderRefusesTest = init.then(adminRequest(1, 0, true))
    .expect(s.result == "invalid_expected_actor").then(access.fail())
  run expectedHeaderDoesNotGrantAdminTest = init.then(adminRequest(2, 2, false))
    .expect(s.result == "forbidden").then(access.fail())
  run signedOutRemainsUnauthorizedTest = init.then(adminRequest(0, 1, false))
    .expect(s.result == "unauthorized").then(access.fail())
  run serviceRouteKeepsIndependentSignatureTest = init.then(serviceRequest(0, true)).then(access)
    .expect(s.accessed and s.route == "service")
}
