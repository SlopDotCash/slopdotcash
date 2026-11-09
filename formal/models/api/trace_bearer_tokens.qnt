// @source backend/trace/auth.ts
// @source backend/trace/handler.ts
// @source backend/trace/contracts.ts
// @evidence scripts/trace-upload-attachable.test.ts
// One sign OR verify invocation, all subsets of the three roles, and ten
// timestamp boundary representatives. Times are seconds relative to captured
// now=0; translating all timestamps by an epoch offset preserves comparisons.
// Observable later time advances 0 -> 31 -> 602, but verification uses the
// request's captured now, not continuous wall-clock knowledge. The caller's
// operator set is a fixed per-invocation snapshot; later global policy changes
// and mutation of the provided Set are outside this bound.
// Header length/syntax, base64url, JSON, exact claim fields, id/login/jti and
// secret-byte checks are predicate classes. HMAC/key operations can succeed,
// refuse a signature, or throw; authenticity is assumed, not proved here.
// Secret text remains the original ASCII bytes, not base64-decoded material.
// The signer checks claim shape but has no current-time or TTL admission rule.
// The verifier applies TTL to original roles before operator allowlist filtering.
// Token return is not authorization for an arbitrary route; see dispatcher model.
// Existing workflows exercise signing/verification indirectly, not every
// malformed-input, clock-boundary or crypto-error case below. All are unexecuted.
module trace_bearer_tokens {
  type Times = { issued: int, expires: int }
  val roleSets = Set(Set(), Set("contributor"), Set("project_owner"), Set("operator"),
    Set("contributor", "project_owner"), Set("contributor", "operator"),
    Set("project_owner", "operator"), Set("contributor", "project_owner", "operator"))
  val times = Set({issued: 0, expires: 1}, {issued: 30, expires: 31},
    {issued: 31, expires: 32}, {issued: -31, expires: -30},
    {issued: -30, expires: -29}, {issued: 0, expires: 300},
    {issued: 0, expires: 301}, {issued: 0, expires: 600},
    {issued: 0, expires: 601}, {issued: 0, expires: 0})
  val headers = Set("valid", "absent", "oversized", "syntax", "signature-length")
  val cryptoResults = Set("ok", "refused", "error")
  var s: { phase: str, mode: str, roles: Set[str], returnedRoles: Set[str],
    issued: int, expires: int, allowlisted: bool, laterNow: int,
    signed: bool, authenticated: bool, result: str }
  action init = s' = { phase: "setup", mode: "verify", roles: Set(), returnedRoles: Set(),
    issued: 0, expires: 0, allowlisted: false, laterNow: 0,
    signed: false, authenticated: false, result: "pending" }
  action configure(mode: str, roles: Set[str], time: Times, allowlisted: bool): bool = all {
    s.phase == "setup", Set("sign", "verify").contains(mode), roleSets.contains(roles), times.contains(time),
    s' = s.with("phase", "secret").with("mode", mode).with("roles", roles)
      .with("issued", time.issued).with("expires", time.expires).with("allowlisted", allowlisted) }
  action advanceNow = all { s.phase != "setup", s.laterNow < 602,
    s' = s.with("laterNow", if (s.laterNow == 0) 31 else 602) }
  action secret(valid: bool): bool = all { s.phase == "secret",
    s' = s.with("phase", if (not(valid)) "done" else if (s.mode == "verify") "header" else "claims")
      .with("result", if (valid) "pending" else "error") }
  action header(kind: str): bool = all { s.phase == "header", headers.contains(kind),
    s' = s.with("phase", if (kind == "valid") "decode" else "done")
      .with("result", if (kind == "valid") "pending" else "null") }
  action decode(valid: bool): bool = all { s.phase == "decode",
    s' = s.with("phase", if (valid) "verify-hmac" else "done")
      .with("result", if (valid) "pending" else "null") }
  action crypto(result: str): bool = all {
    Set("verify-hmac", "sign-hmac").contains(s.phase), cryptoResults.contains(result),
    s.mode == "verify" or result != "refused",
    s' = s.with("phase", if (result == "ok" and s.mode == "verify") "json" else "done")
      .with("signed", result == "ok" and s.mode == "sign")
      .with("result", if (result == "error") "error" else if (result == "refused") "null"
        else if (s.mode == "sign") "token" else "pending") }
  action parse(valid: bool): bool = all { s.phase == "json",
    s' = s.with("phase", if (valid) "claims" else "done").with("result", if (valid) "pending" else "null") }
  action claims(valid: bool): bool = {
    val accepted = valid and s.roles.size() > 0 and s.expires > s.issued
    all { s.phase == "claims",
      s' = s.with("phase", if (accepted) (if (s.mode == "verify") "time" else "sign-hmac") else "done")
        .with("result", if (accepted) "pending" else if (s.mode == "verify") "null" else "error") }
  }
  val timeAllowed = s.issued <= 30 and s.expires > -30
    and s.expires - s.issued <= (if (s.roles.contains("operator")) 300 else 600)
  action checkTime = all { s.phase == "time",
    s' = s.with("phase", if (timeAllowed) "roles" else "done").with("result", if (timeAllowed) "pending" else "null") }
  action filterRoles = {
    val roles = if (s.allowlisted) s.roles else s.roles.exclude(Set("operator"))
    all { s.phase == "roles",
      s' = s.with("phase", "done").with("returnedRoles", roles)
        .with("authenticated", roles.size() > 0).with("result", if (roles.size() > 0) "actor" else "null") }
  }
  action step = {
    nondet mode = Set("sign", "verify").oneOf()
    nondet roles = roleSets.oneOf()
    nondet time = times.oneOf()
    nondet yes = Set(false, true).oneOf()
    nondet kind = headers.oneOf()
    nondet result = cryptoResults.oneOf()
    any { configure(mode, roles, time, yes), advanceNow, secret(yes), header(kind), decode(yes),
      crypto(result), parse(yes), claims(yes), checkTime, filterRoles, s' = s }
  }
  val invariant = all {
    Set(0, 31, 602).contains(s.laterNow),
    s.signed implies s.mode == "sign" and s.roles.size() > 0 and s.expires > s.issued,
    s.authenticated implies s.mode == "verify" and timeAllowed and s.returnedRoles.size() > 0,
    s.returnedRoles.subseteq(s.roles),
    s.returnedRoles.contains("operator") implies s.allowlisted,
    s.result == "actor" iff s.authenticated,
    s.result == "token" iff s.signed,
    Set("null", "error").contains(s.result) implies not(s.signed) and not(s.authenticated) }

  action verifiedClaims(roles: Set[str], time: Times, allowed: bool): bool = init
    .then(configure("verify", roles, time, allowed)).then(secret(true)).then(header("valid"))
    .then(decode(true)).then(crypto("ok")).then(parse(true)).then(claims(true))
  action signing(roles: Set[str], time: Times): bool = init.then(configure("sign", roles, time, false))
    .then(secret(true)).then(claims(true))

  run validContributorReturnsActorTest = verifiedClaims(Set("contributor"), {issued:0,expires:600}, false)
    .then(checkTime).then(filterRoles).expect(s.authenticated and invariant)
  run secretFailurePrecedesBearerInspectionTest = init.then(configure("verify", Set("contributor"), {issued:0,expires:1}, false))
    .then(secret(false)).expect(s.result == "error" and invariant)
  run missingBearerRefusesTest = init.then(configure("verify", Set("contributor"), {issued:0,expires:1}, false))
    .then(secret(true)).then(header("absent")).expect(s.result == "null" and invariant)
  run oversizedBearerRefusesTest = init.then(configure("verify", Set("contributor"), {issued:0,expires:1}, false))
    .then(secret(true)).then(header("oversized")).expect(s.result == "null" and invariant)
  run wrongSignatureLengthRefusesTest = init.then(configure("verify", Set("contributor"), {issued:0,expires:1}, false))
    .then(secret(true)).then(header("signature-length")).expect(s.result == "null" and invariant)
  run invalidBase64RefusesTest = init.then(configure("verify", Set("contributor"), {issued:0,expires:1}, false))
    .then(secret(true)).then(header("valid")).then(decode(false)).expect(s.result == "null" and invariant)
  run invalidSignatureRefusesBeforeJsonTest = init.then(configure("verify", Set("contributor"), {issued:0,expires:1}, false))
    .then(secret(true)).then(header("valid")).then(decode(true)).then(crypto("refused")).expect(s.result == "null" and invariant)
  run cryptoErrorThrowsInsteadOfRefusalTest = init.then(configure("verify", Set("contributor"), {issued:0,expires:1}, false))
    .then(secret(true)).then(header("valid")).then(decode(true)).then(crypto("error")).expect(s.result == "error" and invariant)
  run invalidJsonRefusesTest = init.then(configure("verify", Set("contributor"), {issued:0,expires:1}, false))
    .then(secret(true)).then(header("valid")).then(decode(true)).then(crypto("ok")).then(parse(false)).expect(s.result == "null" and invariant)
  run invalidClaimShapeRefusesTest = init.then(configure("verify", Set("contributor"), {issued:0,expires:1}, false))
    .then(secret(true)).then(header("valid")).then(decode(true)).then(crypto("ok")).then(parse(true)).then(claims(false))
    .expect(s.result == "null" and invariant)
  run emptyRolesRefuseTest = verifiedClaims(Set(), {issued:0,expires:1}, false).expect(s.result == "null" and invariant)
  run zeroLifetimeRefusesTest = verifiedClaims(Set("contributor"), {issued:0,expires:0}, false).expect(s.result == "null" and invariant)
  run futureSkewBoundaryAcceptedTest = verifiedClaims(Set("contributor"), {issued:30,expires:31}, false)
    .then(checkTime).then(filterRoles).expect(s.authenticated and invariant)
  run beyondFutureSkewRefusesTest = verifiedClaims(Set("contributor"), {issued:31,expires:32}, false)
    .then(checkTime).expect(s.result == "null" and invariant)
  run expirySkewBoundaryRefusesTest = verifiedClaims(Set("contributor"), {issued:-31,expires:-30}, false)
    .then(checkTime).expect(s.result == "null" and invariant)
  run insideExpirySkewAcceptedTest = verifiedClaims(Set("contributor"), {issued:-30,expires:-29}, false)
    .then(checkTime).then(filterRoles).expect(s.authenticated and invariant)
  run contributorLifetimeAboveTenMinutesRefusesTest = verifiedClaims(Set("contributor"), {issued:0,expires:601}, false)
    .then(checkTime).expect(s.result == "null" and invariant)
  run operatorFiveMinuteBoundaryAcceptedTest = verifiedClaims(Set("operator"), {issued:0,expires:300}, true)
    .then(checkTime).then(filterRoles).expect(s.returnedRoles == Set("operator") and invariant)
  run operatorAboveFiveMinutesRefusesTest = verifiedClaims(Set("operator"), {issued:0,expires:301}, true)
    .then(checkTime).expect(s.result == "null" and invariant)
  run unlistedOperatorOnlyRefusesTest = verifiedClaims(Set("operator"), {issued:0,expires:300}, false)
    .then(checkTime).then(filterRoles).expect(s.result == "null" and s.returnedRoles == Set() and invariant)
  run unlistedOperatorRetainsOtherRolesTest = verifiedClaims(Set("operator","contributor"), {issued:0,expires:300}, false)
    .then(checkTime).then(filterRoles).expect(s.returnedRoles == Set("contributor") and invariant)
  run ttlUsesOriginalRolesBeforeFilteringTest = verifiedClaims(Set("operator","contributor"), {issued:0,expires:600}, false)
    .then(checkTime).expect(s.result == "null" and invariant)
  run verifierUsesCapturedTimeTest = verifiedClaims(Set("contributor"), {issued:0,expires:1}, false)
    .then(advanceNow).then(advanceNow).then(checkTime).then(filterRoles)
    .expect(s.authenticated and s.laterNow > s.expires and invariant)
  run signerDoesNotEnforceVerifierTtlTest = signing(Set("operator"), {issued:0,expires:601}).then(crypto("ok"))
    .expect(s.signed and not(timeAllowed) and invariant)
  run signerDoesNotCheckCurrentAllowlistTest = signing(Set("operator"), {issued:0,expires:300}).then(crypto("ok"))
    .expect(s.signed and not(s.allowlisted) and not(s.authenticated) and invariant)
  run signingErrorDoesNotReturnTokenTest = signing(Set("contributor"), {issued:0,expires:600}).then(crypto("error"))
    .expect(s.result == "error" and not(s.signed) and invariant)
}
